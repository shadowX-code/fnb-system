-- Asset Tracking Phase 1: immutable lifecycle evidence and server-authoritative audit.
-- Pre-deployment Staging audit found no child/outlet mismatches or duplicate
-- inspection-item asset pairs. A completed header with no items is preserved as
-- historical data because this migration does not rewrite legacy evidence.

-- History is read-only to ordinary clients. Asset rows themselves keep the
-- existing archive-via-update path; removing DELETE also prevents a client from
-- cascading an asset deletion into its movement, inspection, and maintenance history.
revoke insert, update, delete on table public.asset_movement_logs from authenticated;
revoke insert, update, delete on table public.asset_inspections from authenticated;
revoke insert, update, delete on table public.asset_inspection_items from authenticated;
revoke insert, update, delete on table public.asset_inspection_evidence from authenticated;
revoke insert, update, delete on table public.asset_maintenance_records from authenticated;
revoke delete on table public.asset_items from authenticated;

drop policy if exists "asset tracking scoped movement insert" on public.asset_movement_logs;
drop policy if exists "asset tracking scoped inspection insert" on public.asset_inspections;
drop policy if exists "asset tracking scoped inspection update" on public.asset_inspections;
drop policy if exists "asset tracking managers can delete inspection drafts" on public.asset_inspections;
drop policy if exists "asset tracking scoped inspection item insert" on public.asset_inspection_items;
drop policy if exists "asset tracking managers can create inspection evidence" on public.asset_inspection_evidence;
drop policy if exists "asset tracking scoped maintenance insert" on public.asset_maintenance_records;
drop policy if exists "asset tracking scoped maintenance update" on public.asset_maintenance_records;
drop policy if exists "asset tracking scoped maintenance delete" on public.asset_maintenance_records;
drop policy if exists "asset tracking scoped asset delete" on public.asset_items;

-- One asset can appear at most once in an inspection. Existing data was audited
-- before this constraint was added; a malformed request now fails atomically.
alter table public.asset_inspection_items
  add constraint asset_inspection_items_inspection_asset_key unique (inspection_id, asset_id);

create or replace function public.asset_tracking_assert_child_outlet()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_asset_outlet_id uuid;
begin
  select outlet_id into v_asset_outlet_id
  from public.asset_items
  where id = new.asset_id;

  if v_asset_outlet_id is null or v_asset_outlet_id <> new.outlet_id then
    raise exception using errcode = '23514', message = 'Asset lifecycle record must use the asset outlet.';
  end if;
  return new;
end;
$$;

drop trigger if exists asset_movement_logs_assert_asset_outlet on public.asset_movement_logs;
create trigger asset_movement_logs_assert_asset_outlet
before insert or update of asset_id, outlet_id on public.asset_movement_logs
for each row execute function public.asset_tracking_assert_child_outlet();

drop trigger if exists asset_maintenance_records_assert_asset_outlet on public.asset_maintenance_records;
create trigger asset_maintenance_records_assert_asset_outlet
before insert or update of asset_id, outlet_id on public.asset_maintenance_records
for each row execute function public.asset_tracking_assert_child_outlet();

create or replace function public.asset_tracking_assert_inspection_item_context()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_inspection_id uuid := case when tg_op = 'DELETE' then old.inspection_id else new.inspection_id end;
  v_asset_id uuid := case when tg_op = 'DELETE' then old.asset_id else new.asset_id end;
  v_inspection_outlet_id uuid;
  v_asset_outlet_id uuid;
  v_status text;
begin
  select outlet_id, status into v_inspection_outlet_id, v_status
  from public.asset_inspections where id = v_inspection_id;
  select outlet_id into v_asset_outlet_id
  from public.asset_items where id = v_asset_id;

  if v_inspection_outlet_id is null or v_asset_outlet_id is null or v_inspection_outlet_id <> v_asset_outlet_id then
    raise exception using errcode = '23514', message = 'Inspection asset must belong to the inspection outlet.';
  end if;
  if v_status not in ('draft', 'in_progress', 'pending_review') then
    raise exception using errcode = '55000', message = 'Finalized inspection items are immutable.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists asset_inspection_items_assert_context on public.asset_inspection_items;
create trigger asset_inspection_items_assert_context
before insert or update or delete on public.asset_inspection_items
for each row execute function public.asset_tracking_assert_inspection_item_context();

create or replace function public.asset_tracking_assert_inspection_evidence_context()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_item_id uuid := case when tg_op = 'DELETE' then old.inspection_item_id else new.inspection_item_id end;
  v_inspection_outlet_id uuid;
  v_asset_outlet_id uuid;
  v_status text;
begin
  select inspection.outlet_id, asset.outlet_id, inspection.status
  into v_inspection_outlet_id, v_asset_outlet_id, v_status
  from public.asset_inspection_items item
  join public.asset_inspections inspection on inspection.id = item.inspection_id
  join public.asset_items asset on asset.id = item.asset_id
  where item.id = v_item_id;

  if v_inspection_outlet_id is null or v_asset_outlet_id is null or v_inspection_outlet_id <> v_asset_outlet_id then
    raise exception using errcode = '23514', message = 'Inspection evidence must belong to an in-outlet inspection asset.';
  end if;
  if v_status not in ('draft', 'in_progress', 'pending_review') then
    raise exception using errcode = '55000', message = 'Finalized inspection evidence is immutable.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists asset_inspection_evidence_assert_context on public.asset_inspection_evidence;
create trigger asset_inspection_evidence_assert_context
before insert or update or delete on public.asset_inspection_evidence
for each row execute function public.asset_tracking_assert_inspection_evidence_context();

create or replace function public.asset_tracking_assert_inspection_header_mutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status not in ('draft', 'in_progress', 'pending_review') then
    raise exception using errcode = '55000', message = 'Finalized inspections are immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists asset_inspections_assert_mutable on public.asset_inspections;
create trigger asset_inspections_assert_mutable
before update on public.asset_inspections
for each row execute function public.asset_tracking_assert_inspection_header_mutable();

-- This trigger is the only writer of Asset Tracking lifecycle audit rows. It is
-- invoked inside each trusted RPC transaction, after a canonical result exists.
create or replace function public.asset_tracking_audit_lifecycle_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_name text;
  v_action text := case new.operation
    when 'quantity_adjustment' then 'asset_quantity_adjusted'
    when 'inspection_submission' then case when coalesce(new.result->>'status', '') in ('draft', 'in_progress', 'pending_review') then 'asset_inspection_draft_saved' else 'asset_inspection_submitted' end
    when 'inspection_archive' then 'asset_inspection_archived'
    when 'maintenance_save' then 'asset_maintenance_saved'
    when 'import_row' then case when coalesce(new.result->>'action', '') = 'update' then 'asset_edited' else 'asset_created' end
    else 'asset_lifecycle_changed'
  end;
begin
  select coalesce(nullif(nickname, ''), nullif(full_name, '')) into v_user_name
  from public.employees
  where auth_user_id = new.actor_id or id = new.actor_id
  order by case when auth_user_id = new.actor_id then 0 else 1 end
  limit 1;

  insert into public.audit_logs (action, module, user_id, user_name, description, metadata)
  values (
    v_action,
    'Asset Tracking',
    new.actor_id,
    coalesce(v_user_name, 'Authenticated user'),
    'Trusted asset lifecycle: ' || replace(new.operation, '_', ' '),
    jsonb_build_object(
      'request_id', new.request_id,
      'operation', new.operation,
      'outlet_id', new.outlet_id,
      'actor_id', new.actor_id,
      'result', new.result
    )
  );
  return new;
end;
$$;

drop trigger if exists asset_lifecycle_requests_audit on public.asset_lifecycle_requests;
create trigger asset_lifecycle_requests_audit
after insert on public.asset_lifecycle_requests
for each row execute function public.asset_tracking_audit_lifecycle_request();

revoke all on function public.asset_tracking_assert_child_outlet() from public, anon, authenticated;
revoke all on function public.asset_tracking_assert_inspection_item_context() from public, anon, authenticated;
revoke all on function public.asset_tracking_assert_inspection_evidence_context() from public, anon, authenticated;
revoke all on function public.asset_tracking_assert_inspection_header_mutable() from public, anon, authenticated;
revoke all on function public.asset_tracking_audit_lifecycle_request() from public, anon, authenticated;

alter table public.asset_lifecycle_requests
  drop constraint if exists asset_lifecycle_requests_operation_check;
alter table public.asset_lifecycle_requests
  add constraint asset_lifecycle_requests_operation_check
  check (operation in ('quantity_adjustment', 'inspection_submission', 'inspection_archive', 'maintenance_save', 'import_row'));

create or replace function public.asset_submit_inspection(
  p_request_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_employee_id uuid;
  v_checked_by text;
  v_inspection public.asset_inspections%rowtype;
  v_asset public.asset_items%rowtype;
  v_item public.asset_inspection_items%rowtype;
  v_row jsonb;
  v_evidence jsonb;
  v_result jsonb;
  v_draft_id uuid := nullif(p_payload->>'draft_id','')::uuid;
  v_outlet_id uuid := nullif(p_payload->>'outlet_id','')::uuid;
  v_status text := lower(coalesce(nullif(btrim(p_payload->>'status'),''),'completed'));
  v_date date := coalesce(nullif(p_payload->>'inspection_date','')::date,current_date);
  v_expected numeric;
  v_counted numeric;
  v_difference numeric;
  v_condition text;
  v_apply_corrections boolean := coalesce((p_payload->>'apply_corrections')::boolean,true);
  v_now timestamptz := now();
  v_rows jsonb := coalesce(p_payload->'rows','[]'::jsonb);
  v_is_draft boolean;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if not public.current_user_has_permission('asset_tracking.manage') then raise exception using errcode = '42501', message = 'Missing permission to submit asset inspections.'; end if;
  if p_request_id is null or v_outlet_id is null then raise exception 'Request ID and outlet are required.'; end if;
  if v_status not in ('draft','completed','partial','in_progress','pending_review') then raise exception 'Invalid inspection status.'; end if;
  if jsonb_typeof(v_rows) <> 'array' then raise exception 'Inspection rows must be an array.'; end if;
  if not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode = '42501', message = 'You cannot submit inspections for this outlet.'; end if;
  v_is_draft := v_status in ('draft', 'in_progress', 'pending_review');

  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_' || p_request_id::text));
  select result into v_result from public.asset_lifecycle_requests where request_id = p_request_id and operation = 'inspection_submission';
  if found then return v_result; end if;
  if exists (select 1 from public.asset_lifecycle_requests where request_id = p_request_id) then raise exception 'Request ID was already used for another asset action.'; end if;

  if not v_is_draft and exists (
    select 1 from jsonb_array_elements(v_rows) row_value
    group by row_value->>'asset_id'
    having count(*) > 1
  ) then raise exception 'An asset can appear only once in an inspection.'; end if;

  select id, coalesce(nullif(nickname,''), full_name) into v_employee_id, v_checked_by
  from public.employees where auth_user_id = v_actor or id = v_actor
  order by case when auth_user_id = v_actor then 0 else 1 end limit 1;
  v_checked_by := coalesce(v_checked_by, 'Authenticated user');

  if v_draft_id is not null then
    select * into v_inspection from public.asset_inspections where id = v_draft_id for update;
    if not found then raise exception 'Inspection draft was not found.'; end if;
    if v_inspection.outlet_id <> v_outlet_id then raise exception 'Inspection draft does not belong to this outlet.'; end if;
    if v_inspection.status not in ('draft', 'in_progress', 'pending_review') then raise exception using errcode = '55000', message = 'Completed inspections cannot be resubmitted.'; end if;
    -- Clear draft evidence while the header is still mutable. Final status is set only after all rows are accepted.
    if not v_is_draft then delete from public.asset_inspection_items where inspection_id = v_inspection.id; end if;
    update public.asset_inspections set inspection_date=v_date, checked_by=v_checked_by, checked_by_employee_id=v_employee_id,
      category_scope=coalesce(p_payload->'category_scope','{}'::jsonb), status=case when v_is_draft then v_status else v_inspection.status end,
      summary=coalesce(p_payload->'summary','{}'::jsonb), current_step=coalesce(nullif(p_payload->>'current_step','')::integer,1),
      completion_percentage=coalesce(nullif(p_payload->'summary'->>'completion_percentage','')::numeric,0), last_edited_at=v_now,last_edited_by=v_actor,
      draft_data=coalesce(p_payload->'draft_data','{}'::jsonb),auto_saved=coalesce((p_payload->>'auto_saved')::boolean,false),
      notes=coalesce(p_payload->>'notes',''),remark=coalesce(p_payload->>'remark',''),updated_at=v_now
    where id=v_draft_id returning * into v_inspection;
  else
    insert into public.asset_inspections(outlet_id,inspection_date,checked_by,checked_by_employee_id,category_scope,status,summary,current_step,completion_percentage,last_edited_at,last_edited_by,draft_data,auto_saved,notes,remark,created_by,created_at,updated_at)
    values(v_outlet_id,v_date,v_checked_by,v_employee_id,coalesce(p_payload->'category_scope','{}'::jsonb),case when v_is_draft then v_status else 'draft' end,
      coalesce(p_payload->'summary','{}'::jsonb),coalesce(nullif(p_payload->>'current_step','')::integer,1),coalesce(nullif(p_payload->'summary'->>'completion_percentage','')::numeric,0),v_now,v_actor,
      coalesce(p_payload->'draft_data','{}'::jsonb),coalesce((p_payload->>'auto_saved')::boolean,false),coalesce(p_payload->>'notes',''),coalesce(p_payload->>'remark',''),v_actor,v_now,v_now)
    returning * into v_inspection;
  end if;

  if not v_is_draft then
    for v_row in select value from jsonb_array_elements(v_rows) loop
      if nullif(v_row->>'asset_id','') is null then raise exception 'Inspection row asset is required.'; end if;
      select * into v_asset from public.asset_items where id=(v_row->>'asset_id')::uuid for update;
      if not found or v_asset.outlet_id <> v_outlet_id then raise exception 'Inspection asset is invalid for this outlet.'; end if;
      v_expected := v_asset.current_quantity;
      v_counted := coalesce(nullif(v_row->>'counted_quantity','')::numeric,0);
      if v_counted < 0 then raise exception 'Counted quantity cannot be below 0.'; end if;
      v_difference := v_counted-v_expected;
      v_condition := lower(coalesce(nullif(btrim(v_row->>'condition_status'),''),'healthy'));
      if v_condition not in ('healthy','needs_attention','under_maintenance','low_quantity','damaged','missing','disposed') then raise exception 'Invalid inspection condition.'; end if;
      insert into public.asset_inspection_items(inspection_id,asset_id,expected_quantity,counted_quantity,expected_qty,counted_qty,difference,condition,condition_status,condition_template_id,evidence_required,evidence_status,remark,created_at)
      values(v_inspection.id,v_asset.id,v_expected,v_counted,v_expected,v_counted,v_difference,v_condition,v_condition,
        case when nullif(v_row->>'condition_template_id','') like 'fallback-%' then null else nullif(v_row->>'condition_template_id','')::uuid end,
        coalesce((v_row->>'evidence_required')::boolean,false),case when coalesce((v_row->>'evidence_required')::boolean,false) and coalesce(jsonb_array_length(v_row->'evidence'),0)>0 then 'complete' when coalesce((v_row->>'evidence_required')::boolean,false) then 'pending' else 'not_required' end,
        coalesce(v_row->>'remark',''),v_now) returning * into v_item;
      for v_evidence in select value from jsonb_array_elements(coalesce(v_row->'evidence','[]'::jsonb)) loop
        if nullif(btrim(v_evidence->>'image_url'),'') is null then raise exception 'Inspection evidence image is required.'; end if;
        insert into public.asset_inspection_evidence(inspection_item_id,image_url,caption,created_at)
        values(v_item.id,v_evidence->>'image_url',nullif(btrim(v_evidence->>'caption'),''),v_now);
      end loop;
      if v_apply_corrections then
        update public.asset_items set current_quantity=v_counted,condition=v_condition,last_inspection_at=v_date,updated_by=v_actor,updated_at=v_now where id=v_asset.id;
        if v_difference <> 0 then insert into public.asset_movement_logs(asset_id,outlet_id,movement_type,quantity_change,quantity_before,quantity_after,reason,remark,movement_date,created_by,created_at)
          values(v_asset.id,v_outlet_id,'correction',v_difference,v_expected,v_counted,'inspection','Inspection correction · ' || v_date::text,v_date,v_actor,v_now); end if;
      end if;
    end loop;
    update public.asset_inspections set status=v_status, updated_at=v_now where id=v_inspection.id returning * into v_inspection;
  end if;

  v_result := jsonb_build_object('inspection_id',v_inspection.id,'outlet_id',v_inspection.outlet_id,'status',v_inspection.status,'request_id',p_request_id);
  insert into public.asset_lifecycle_requests(request_id,operation,actor_id,outlet_id,result) values(p_request_id,'inspection_submission',v_actor,v_outlet_id,v_result);
  return v_result;
end;
$$;

create or replace function public.asset_archive_inspection_draft(
  p_request_id uuid,
  p_inspection_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_inspection public.asset_inspections%rowtype;
  v_result jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if not public.current_user_has_permission('asset_tracking.manage') then raise exception using errcode = '42501', message = 'Missing permission to archive inspection drafts.'; end if;
  if p_request_id is null or p_inspection_id is null then raise exception 'Request ID and inspection are required.'; end if;
  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_' || p_request_id::text));
  select result into v_result from public.asset_lifecycle_requests where request_id=p_request_id and operation='inspection_archive';
  if found then return v_result; end if;
  if exists(select 1 from public.asset_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another asset action.'; end if;
  select * into v_inspection from public.asset_inspections where id=p_inspection_id for update;
  if not found then raise exception 'Inspection draft was not found.'; end if;
  if not public.current_user_can_access_outlet(v_inspection.outlet_id) then raise exception using errcode = '42501', message = 'You cannot archive this inspection.'; end if;
  if v_inspection.status not in ('draft', 'in_progress', 'pending_review') then raise exception using errcode = '55000', message = 'Only resumable inspection drafts can be archived.'; end if;
  update public.asset_inspections set status='archived',last_edited_at=now(),last_edited_by=v_actor,updated_at=now() where id=v_inspection.id returning * into v_inspection;
  v_result := jsonb_build_object('inspection_id',v_inspection.id,'outlet_id',v_inspection.outlet_id,'status',v_inspection.status,'request_id',p_request_id);
  insert into public.asset_lifecycle_requests(request_id,operation,actor_id,outlet_id,result) values(p_request_id,'inspection_archive',v_actor,v_inspection.outlet_id,v_result);
  return v_result;
end;
$$;

revoke all on function public.asset_submit_inspection(uuid,jsonb) from public, anon;
revoke all on function public.asset_archive_inspection_draft(uuid,uuid) from public, anon;
grant execute on function public.asset_submit_inspection(uuid,jsonb) to authenticated;
grant execute on function public.asset_archive_inspection_draft(uuid,uuid) to authenticated;
