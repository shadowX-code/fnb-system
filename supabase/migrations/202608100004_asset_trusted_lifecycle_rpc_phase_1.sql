-- Trusted, atomic Asset Tracking lifecycle mutations. Browser code supplies intent;
-- these RPCs own all database writes that must commit or roll back together.

create table if not exists public.asset_lifecycle_requests (
  request_id uuid primary key,
  operation text not null check (operation in ('quantity_adjustment', 'inspection_submission')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  outlet_id uuid references public.outlets(id) on delete set null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

revoke all on table public.asset_lifecycle_requests from public, anon, authenticated;

create or replace function public.asset_adjust_quantity(
  p_request_id uuid,
  p_asset_id uuid,
  p_adjustment_type text,
  p_quantity numeric,
  p_reason text,
  p_remark text,
  p_movement_date date
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_asset public.asset_items%rowtype;
  v_movement public.asset_movement_logs%rowtype;
  v_before numeric;
  v_after numeric;
  v_delta numeric;
  v_result jsonb;
  v_type text := lower(coalesce(nullif(btrim(p_adjustment_type), ''), ''));
  v_reason text := coalesce(nullif(btrim(p_reason), ''), v_type);
  v_now timestamptz := now();
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if not public.current_user_has_permission('asset_tracking.manage') then raise exception using errcode = '42501', message = 'Missing permission to adjust asset quantity.'; end if;
  if p_request_id is null or p_asset_id is null or p_quantity is null or p_quantity <= 0 then raise exception 'Request, asset and positive quantity are required.'; end if;
  if v_type not in ('add', 'reduce', 'correction') then raise exception 'Invalid asset adjustment type.'; end if;
  if v_type = 'reduce' and v_reason = 'reduce' then raise exception 'Select a reduce reason.'; end if;
  if v_reason = 'other' and nullif(btrim(p_remark), '') is null then raise exception 'Remark is required when reason is Other.'; end if;

  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_' || p_request_id::text));
  select result into v_result from public.asset_lifecycle_requests where request_id = p_request_id and operation = 'quantity_adjustment';
  if found then return v_result; end if;
  if exists (select 1 from public.asset_lifecycle_requests where request_id = p_request_id) then raise exception 'Request ID was already used for another asset action.'; end if;

  select * into v_asset from public.asset_items where id = p_asset_id for update;
  if not found then raise exception 'Asset was not found.'; end if;
  if not public.current_user_can_access_outlet(v_asset.outlet_id) then raise exception using errcode = '42501', message = 'You cannot adjust assets for this outlet.'; end if;

  v_before := v_asset.current_quantity;
  v_after := case when v_type = 'add' then v_before + p_quantity when v_type = 'reduce' then v_before - p_quantity else p_quantity end;
  if v_after < 0 then raise exception 'Quantity cannot be below 0.'; end if;
  v_delta := v_after - v_before;

  update public.asset_items
  set current_quantity = v_after, updated_by = v_actor, updated_at = v_now
  where id = v_asset.id
  returning * into v_asset;

  insert into public.asset_movement_logs(asset_id,outlet_id,movement_type,quantity_change,quantity_before,quantity_after,reason,remark,movement_date,created_by,created_at)
  values(v_asset.id,v_asset.outlet_id,v_type,v_delta,v_before,v_after,v_reason,nullif(btrim(p_remark),''),coalesce(p_movement_date,current_date),v_actor,v_now)
  returning * into v_movement;

  v_result := jsonb_build_object(
    'asset', jsonb_build_object('id',v_asset.id,'outlet_id',v_asset.outlet_id,'current_quantity',v_asset.current_quantity,'condition',v_asset.condition),
    'movement', jsonb_build_object('id',v_movement.id,'asset_id',v_movement.asset_id,'outlet_id',v_movement.outlet_id,'movement_type',v_movement.movement_type,'quantity_change',v_movement.quantity_change,'quantity_before',v_movement.quantity_before,'quantity_after',v_movement.quantity_after,'reason',v_movement.reason,'remark',v_movement.remark,'movement_date',v_movement.movement_date)
  );
  insert into public.asset_lifecycle_requests(request_id,operation,actor_id,outlet_id,result)
  values(p_request_id,'quantity_adjustment',v_actor,v_asset.outlet_id,v_result);
  return v_result;
end; $$;

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
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if not public.current_user_has_permission('asset_tracking.manage') then raise exception using errcode = '42501', message = 'Missing permission to submit asset inspections.'; end if;
  if p_request_id is null or v_outlet_id is null then raise exception 'Request ID and outlet are required.'; end if;
  if v_status not in ('draft','completed','partial','in_progress','pending_review') then raise exception 'Invalid inspection status.'; end if;
  if jsonb_typeof(v_rows) <> 'array' then raise exception 'Inspection rows must be an array.'; end if;
  if not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode = '42501', message = 'You cannot submit inspections for this outlet.'; end if;

  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_' || p_request_id::text));
  select result into v_result from public.asset_lifecycle_requests where request_id = p_request_id and operation = 'inspection_submission';
  if found then return v_result; end if;
  if exists (select 1 from public.asset_lifecycle_requests where request_id = p_request_id) then raise exception 'Request ID was already used for another asset action.'; end if;

  select id, coalesce(nullif(nickname,''), full_name)
  into v_employee_id, v_checked_by
  from public.employees
  where auth_user_id = v_actor or id = v_actor
  order by case when auth_user_id = v_actor then 0 else 1 end
  limit 1;
  v_checked_by := coalesce(v_checked_by, 'Authenticated user');

  if v_draft_id is not null then
    select * into v_inspection from public.asset_inspections where id = v_draft_id for update;
    if not found then raise exception 'Inspection draft was not found.'; end if;
    if v_inspection.outlet_id <> v_outlet_id then raise exception 'Inspection draft does not belong to this outlet.'; end if;
    update public.asset_inspections set inspection_date=v_date, checked_by=v_checked_by, checked_by_employee_id=v_employee_id,
      category_scope=coalesce(p_payload->'category_scope','{}'::jsonb), status=v_status, summary=coalesce(p_payload->'summary','{}'::jsonb),
      current_step=coalesce(nullif(p_payload->>'current_step','')::integer,1), completion_percentage=coalesce(nullif(p_payload->'summary'->>'completion_percentage','')::numeric,0),
      last_edited_at=v_now,last_edited_by=v_actor,draft_data=coalesce(p_payload->'draft_data','{}'::jsonb),auto_saved=coalesce((p_payload->>'auto_saved')::boolean,false),
      notes=coalesce(p_payload->>'notes',''),remark=coalesce(p_payload->>'remark',''),updated_at=v_now
    where id=v_draft_id returning * into v_inspection;
  else
    insert into public.asset_inspections(outlet_id,inspection_date,checked_by,checked_by_employee_id,category_scope,status,summary,current_step,completion_percentage,last_edited_at,last_edited_by,draft_data,auto_saved,notes,remark,created_by,created_at,updated_at)
    values(v_outlet_id,v_date,v_checked_by,v_employee_id,coalesce(p_payload->'category_scope','{}'::jsonb),v_status,coalesce(p_payload->'summary','{}'::jsonb),coalesce(nullif(p_payload->>'current_step','')::integer,1),coalesce(nullif(p_payload->'summary'->>'completion_percentage','')::numeric,0),v_now,v_actor,coalesce(p_payload->'draft_data','{}'::jsonb),coalesce((p_payload->>'auto_saved')::boolean,false),coalesce(p_payload->>'notes',''),coalesce(p_payload->>'remark',''),v_actor,v_now,v_now)
    returning * into v_inspection;
  end if;

  if v_status not in ('draft','in_progress','pending_review') then
    if v_draft_id is not null then delete from public.asset_inspection_items where inspection_id=v_inspection.id; end if;
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
        coalesce((v_row->>'evidence_required')::boolean,false),
        case when coalesce((v_row->>'evidence_required')::boolean,false) and coalesce(jsonb_array_length(v_row->'evidence'),0)>0 then 'complete' when coalesce((v_row->>'evidence_required')::boolean,false) then 'pending' else 'not_required' end,
        coalesce(v_row->>'remark',''),v_now) returning * into v_item;
      for v_evidence in select value from jsonb_array_elements(coalesce(v_row->'evidence','[]'::jsonb)) loop
        if nullif(btrim(v_evidence->>'image_url'),'') is null then raise exception 'Inspection evidence image is required.'; end if;
        insert into public.asset_inspection_evidence(inspection_item_id,image_url,caption,created_at)
        values(v_item.id,v_evidence->>'image_url',nullif(btrim(v_evidence->>'caption'),''),v_now);
      end loop;
      if v_apply_corrections then
        update public.asset_items set current_quantity=v_counted,condition=v_condition,last_inspection_at=v_date,updated_by=v_actor,updated_at=v_now where id=v_asset.id;
        if v_difference <> 0 then
          insert into public.asset_movement_logs(asset_id,outlet_id,movement_type,quantity_change,quantity_before,quantity_after,reason,remark,movement_date,created_by,created_at)
          values(v_asset.id,v_outlet_id,'correction',v_difference,v_expected,v_counted,'inspection','Inspection correction · ' || v_date::text,v_date,v_actor,v_now);
        end if;
      end if;
    end loop;
  end if;

  v_result := jsonb_build_object('inspection_id',v_inspection.id,'outlet_id',v_inspection.outlet_id,'status',v_inspection.status,'request_id',p_request_id);
  insert into public.asset_lifecycle_requests(request_id,operation,actor_id,outlet_id,result)
  values(p_request_id,'inspection_submission',v_actor,v_outlet_id,v_result);
  return v_result;
end; $$;

revoke all on function public.asset_adjust_quantity(uuid,uuid,text,numeric,text,text,date) from public, anon;
revoke all on function public.asset_submit_inspection(uuid,jsonb) from public, anon;
grant execute on function public.asset_adjust_quantity(uuid,uuid,text,numeric,text,text,date) to authenticated;
grant execute on function public.asset_submit_inspection(uuid,jsonb) to authenticated;
