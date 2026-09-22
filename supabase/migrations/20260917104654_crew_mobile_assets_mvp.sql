-- Crew Mobile Assets MVP. Restaurant Asset Tracking remains authoritative;
-- Crew receives a narrow token-bound projection and trusted mutations only.

alter table public.crew_access
  add column if not exists can_adjust_assets boolean not null default false,
  add column if not exists can_perform_asset_inspections boolean not null default false;

alter table public.asset_movement_logs
  add column if not exists created_by_employee_id uuid references public.employees(id) on delete set null;

alter table public.asset_lifecycle_requests
  alter column actor_id drop not null,
  add column if not exists actor_employee_id uuid references public.employees(id) on delete restrict;

alter table public.asset_lifecycle_requests
  drop constraint if exists asset_lifecycle_requests_actor_check;
alter table public.asset_lifecycle_requests
  add constraint asset_lifecycle_requests_actor_check
  check (num_nonnulls(actor_id, actor_employee_id) = 1);

create index if not exists asset_movement_logs_employee_actor_idx
  on public.asset_movement_logs (created_by_employee_id, created_at desc)
  where created_by_employee_id is not null;

create or replace function public.crew_update_asset_access(
  p_employee_id uuid,
  p_can_adjust_assets boolean,
  p_can_perform_asset_inspections boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_access public.crew_access%rowtype;
  v_outlet_id uuid;
  v_before_adjust boolean;
  v_before_inspect boolean;
begin
  if not public.current_user_has_permission('crew_employees.manage') then
    raise exception using errcode = '42501', message = 'Missing permission to manage Crew Access.';
  end if;
  v_outlet_id := public.crew_resolve_employee_outlet(p_employee_id);
  select * into v_access from public.crew_access where employee_id = p_employee_id for update;
  if v_access.employee_id is null or v_access.access_state <> 'active' then
    raise exception using errcode = '22023', message = 'Crew Access must be active before Special Access can be configured.';
  end if;
  if v_outlet_id is null or v_access.primary_outlet_id is distinct from v_outlet_id
     or not public.current_user_can_access_outlet(v_outlet_id) then
    raise exception using errcode = '42501', message = 'Crew Access outlet scope is unavailable or inaccessible.';
  end if;
  v_before_adjust := v_access.can_adjust_assets;
  v_before_inspect := v_access.can_perform_asset_inspections;
  update public.crew_access
  set can_adjust_assets = coalesce(p_can_adjust_assets, false),
      can_perform_asset_inspections = coalesce(p_can_perform_asset_inspections, false),
      updated_at = now()
  where employee_id = p_employee_id
  returning * into v_access;
  if v_before_adjust is distinct from v_access.can_adjust_assets
     or v_before_inspect is distinct from v_access.can_perform_asset_inspections then
    insert into public.audit_logs(action,module,description,metadata)
    values ('crew_access_asset_capabilities_updated','crew','Crew Asset capabilities updated.',jsonb_build_object(
      'employee_id',p_employee_id,'outlet_id',v_outlet_id,'actor_id',auth.uid(),
      'can_adjust_assets_before',v_before_adjust,'can_adjust_assets_after',v_access.can_adjust_assets,
      'can_perform_asset_inspections_before',v_before_inspect,
      'can_perform_asset_inspections_after',v_access.can_perform_asset_inspections));
  end if;
  return jsonb_build_object(
    'employee_id',v_access.employee_id,'access_state',v_access.access_state,
    'can_adjust_assets',v_access.can_adjust_assets,
    'can_perform_asset_inspections',v_access.can_perform_asset_inspections,
    'updated_at',v_access.updated_at);
end;
$$;

create or replace function public.crew_asset_context(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_access public.crew_access%rowtype;
  v_employee public.employees%rowtype;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select * into v_employee from public.employees where id = v_employee_id;
  select * into v_access from public.crew_access
  where employee_id = v_employee_id and access_state = 'active' for share;
  if v_access.employee_id is null
     or v_access.primary_outlet_id is distinct from public.crew_resolve_employee_outlet(v_employee_id)
     or not (v_access.can_adjust_assets or v_access.can_perform_asset_inspections) then
    raise exception using errcode = '42501', message = 'Crew Asset access is unavailable.';
  end if;
  return jsonb_build_object(
    'employee_id',v_employee_id,
    'employee_name',coalesce(nullif(v_employee.nickname,''),v_employee.full_name),
    'outlet_id',v_access.primary_outlet_id,
    'can_adjust_assets',v_access.can_adjust_assets,
    'can_perform_asset_inspections',v_access.can_perform_asset_inspections);
end;
$$;

create or replace function public.crew_update_special_access(
  p_employee_id uuid,
  p_can_initiate_handover boolean,
  p_can_adjust_assets boolean,
  p_can_perform_asset_inspections boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash jsonb;
  v_assets jsonb;
begin
  -- Both compatibility authorities run in this RPC transaction; either all
  -- Special Access changes commit or none do.
  v_cash := public.crew_update_cash_operations_access(p_employee_id,p_can_initiate_handover);
  v_assets := public.crew_update_asset_access(p_employee_id,p_can_adjust_assets,p_can_perform_asset_inspections);
  return v_cash || v_assets;
end;
$$;

create or replace function public.crew_asset_mobile(p_token text, p_asset_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb := public.crew_asset_context(p_token);
  v_employee_id uuid := (v_context->>'employee_id')::uuid;
  v_outlet_id uuid := (v_context->>'outlet_id')::uuid;
  v_outlet_name text;
begin
  select name into v_outlet_name from public.outlets where id = v_outlet_id;
  if p_asset_id is not null and not exists (
    select 1 from public.asset_items where id = p_asset_id and outlet_id = v_outlet_id and status <> 'archived'
  ) then raise exception using errcode = '42501', message = 'Asset is unavailable for this Crew outlet.'; end if;

  return v_context || jsonb_build_object(
    'outlet',jsonb_build_object('id',v_outlet_id,'name',v_outlet_name),
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.sort_order,c.name)
      from public.asset_categories c where c.is_active), '[]'::jsonb),
    'condition_templates',coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'category_id',t.category_id,'name',t.name,'severity',t.severity,
      'requires_photo',t.requires_photo,'requires_remark',t.requires_remark) order by t.sort_order,t.name)
      from public.asset_condition_templates t where t.active), '[]'::jsonb),
    'assets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'asset_code',a.asset_code,'name',a.name,'description',a.description,
      'category_id',a.category_id,'category_name',c.name,'location',a.location,
      'unit',a.unit,'current_quantity',a.current_quantity,'minimum_quantity',a.minimum_quantity,
      'condition',a.condition,'status',a.status,'image_url',a.image_url,'thumbnail_url',a.thumbnail_url,
      'last_inspection_at',a.last_inspection_at,
      'maintenance',coalesce((select jsonb_agg(jsonb_build_object('status',m.status,'scheduled_date',m.scheduled_date,'issue',m.issue) order by coalesce(m.scheduled_date,m.date) desc)
        from public.asset_maintenance_records m where m.asset_id=a.id and m.status in ('scheduled','in_progress')), '[]'::jsonb)
    ) order by a.name) from public.asset_items a join public.asset_categories c on c.id=a.category_id
      where a.outlet_id=v_outlet_id and a.status <> 'archived' and (p_asset_id is null or a.id=p_asset_id)), '[]'::jsonb),
    'inspection_drafts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'inspection_date',i.inspection_date,'category_scope',i.category_scope,'status',i.status,
      'current_step',i.current_step,'completion_percentage',i.completion_percentage,
      'draft_data',i.draft_data,'updated_at',i.updated_at) order by i.updated_at desc)
      from public.asset_inspections i where i.outlet_id=v_outlet_id and i.checked_by_employee_id=v_employee_id
      and i.status in ('draft','in_progress','pending_review')), '[]'::jsonb),
    'inspection_history',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'inspection_date',i.inspection_date,'checked_by',i.checked_by,'status',i.status,
      'summary',i.summary,'notes',i.notes,'created_at',i.created_at) order by i.inspection_date desc,i.created_at desc)
      from (select * from public.asset_inspections where outlet_id=v_outlet_id and status in ('completed','partial','submitted')
        order by inspection_date desc,created_at desc limit 20) i), '[]'::jsonb)
  );
end;
$$;

create or replace function public.crew_asset_adjust(
  p_token text,
  p_request_id uuid,
  p_asset_id uuid,
  p_adjustment_type text,
  p_quantity numeric,
  p_condition text,
  p_reason text,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb := public.crew_asset_context(p_token);
  v_employee_id uuid := (v_context->>'employee_id')::uuid;
  v_outlet_id uuid := (v_context->>'outlet_id')::uuid;
  v_asset public.asset_items%rowtype;
  v_movement public.asset_movement_logs%rowtype;
  v_before numeric;
  v_after numeric;
  v_delta numeric;
  v_type text := lower(coalesce(p_adjustment_type,''));
  v_condition text := lower(coalesce(p_condition,''));
  v_result jsonb;
begin
  if not coalesce((v_context->>'can_adjust_assets')::boolean,false) then
    raise exception using errcode = '42501', message = 'Adjust Assets Special Access is required.';
  end if;
  if p_request_id is null or p_asset_id is null or p_quantity is null or p_quantity < 0 then
    raise exception using errcode = '22023', message = 'Request, asset and quantity are required.';
  end if;
  if v_type not in ('add','reduce','correction') then raise exception using errcode='22023',message='Invalid asset adjustment type.'; end if;
  if v_condition not in ('healthy','needs_attention','low_quantity','damaged','missing') then
    raise exception using errcode='22023',message='Crew cannot apply this asset condition.';
  end if;
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='Reason is required.'; end if;
  if lower(btrim(p_reason))='other' and nullif(btrim(p_note),'') is null then raise exception using errcode='22023',message='Note is required for Other.'; end if;

  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_'||p_request_id::text));
  select result into v_result from public.asset_lifecycle_requests where request_id=p_request_id and operation='quantity_adjustment';
  if found then return v_result; end if;
  if exists(select 1 from public.asset_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another asset action.'; end if;
  select * into v_asset from public.asset_items where id=p_asset_id for update;
  if not found or v_asset.outlet_id<>v_outlet_id or v_asset.status='archived' then raise exception using errcode='42501',message='Asset is unavailable for this Crew outlet.'; end if;
  v_before:=v_asset.current_quantity;
  v_after:=case when v_type='add' then v_before+p_quantity when v_type='reduce' then v_before-p_quantity else p_quantity end;
  if v_after<0 then raise exception using errcode='22023',message='Quantity cannot be below 0.'; end if;
  v_delta:=v_after-v_before;
  update public.asset_items set current_quantity=v_after,condition=v_condition,updated_at=now() where id=v_asset.id returning * into v_asset;
  insert into public.asset_movement_logs(asset_id,outlet_id,movement_type,quantity_change,quantity_before,quantity_after,reason,remark,movement_date,created_by_employee_id,created_at)
  values(v_asset.id,v_outlet_id,v_type,v_delta,v_before,v_after,btrim(p_reason),nullif(btrim(p_note),''),current_date,v_employee_id,now()) returning * into v_movement;
  v_result:=jsonb_build_object('asset',jsonb_build_object('id',v_asset.id,'current_quantity',v_after,'condition',v_condition),
    'movement',jsonb_build_object('id',v_movement.id,'quantity_before',v_before,'quantity_after',v_after,'quantity_change',v_delta,'reason',v_movement.reason),
    'actor_employee_id',v_employee_id);
  insert into public.asset_lifecycle_requests(request_id,operation,actor_employee_id,outlet_id,result)
  values(p_request_id,'quantity_adjustment',v_employee_id,v_outlet_id,v_result);
  return v_result;
end;
$$;

create or replace function public.crew_asset_submit_inspection(p_token text,p_request_id uuid,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb := public.crew_asset_context(p_token);
  v_employee_id uuid := (v_context->>'employee_id')::uuid;
  v_employee_name text := v_context->>'employee_name';
  v_outlet_id uuid := (v_context->>'outlet_id')::uuid;
  v_draft_id uuid := nullif(p_payload->>'draft_id','')::uuid;
  v_status text := lower(coalesce(nullif(p_payload->>'status',''),'completed'));
  v_rows jsonb := coalesce(p_payload->'rows','[]'::jsonb);
  v_inspection public.asset_inspections%rowtype;
  v_asset public.asset_items%rowtype;
  v_item public.asset_inspection_items%rowtype;
  v_row jsonb;
  v_evidence jsonb;
  v_expected numeric;
  v_counted numeric;
  v_condition text;
  v_result jsonb;
begin
  if not coalesce((v_context->>'can_perform_asset_inspections')::boolean,false) then
    raise exception using errcode='42501',message='Perform Asset Inspections Special Access is required.';
  end if;
  if p_request_id is null or jsonb_typeof(v_rows)<>'array' then raise exception using errcode='22023',message='Valid inspection request is required.'; end if;
  if v_status not in ('draft','in_progress','completed','partial') then raise exception using errcode='22023',message='Invalid inspection status.'; end if;
  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_'||p_request_id::text));
  select result into v_result from public.asset_lifecycle_requests where request_id=p_request_id and operation='inspection_submission';
  if found then return v_result; end if;
  if exists(select 1 from public.asset_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another asset action.'; end if;
  if v_status not in ('draft','in_progress') and (jsonb_array_length(v_rows)=0 or exists(
    select 1 from jsonb_array_elements(v_rows) r group by r->>'asset_id' having count(*)>1)) then
    raise exception using errcode='22023',message='A completed inspection needs unique asset rows.';
  end if;
  if v_draft_id is not null then
    select * into v_inspection from public.asset_inspections where id=v_draft_id for update;
    if not found or v_inspection.outlet_id<>v_outlet_id or v_inspection.checked_by_employee_id<>v_employee_id then raise exception using errcode='42501',message='Inspection draft is unavailable.'; end if;
    if v_inspection.status not in ('draft','in_progress','pending_review') then raise exception using errcode='55000',message='Completed inspections are immutable.'; end if;
    if v_status not in ('draft','in_progress') then delete from public.asset_inspection_items where inspection_id=v_inspection.id; end if;
    update public.asset_inspections set status=case when v_status in ('draft','in_progress') then v_status else status end,
      category_scope=coalesce(p_payload->'category_scope','{"type":"all","category_ids":[]}'::jsonb),
      current_step=coalesce(nullif(p_payload->>'current_step','')::int,1),
      completion_percentage=coalesce(nullif(p_payload->>'completion_percentage','')::numeric,0),
      draft_data=coalesce(p_payload->'draft_data','{}'::jsonb),notes=coalesce(p_payload->>'notes',''),
      last_edited_at=now(),updated_at=now() where id=v_draft_id returning * into v_inspection;
  else
    insert into public.asset_inspections(outlet_id,inspection_date,checked_by,checked_by_employee_id,category_scope,status,summary,current_step,completion_percentage,last_edited_at,draft_data,auto_saved,notes,remark,created_at,updated_at)
    values(v_outlet_id,current_date,v_employee_name,v_employee_id,coalesce(p_payload->'category_scope','{"type":"all","category_ids":[]}'::jsonb),
      case when v_status in ('draft','in_progress') then v_status else 'draft' end,coalesce(p_payload->'summary','{}'::jsonb),
      coalesce(nullif(p_payload->>'current_step','')::int,1),coalesce(nullif(p_payload->>'completion_percentage','')::numeric,0),now(),
      coalesce(p_payload->'draft_data','{}'::jsonb),false,coalesce(p_payload->>'notes',''),coalesce(p_payload->>'notes',''),now(),now()) returning * into v_inspection;
  end if;
  if v_status not in ('draft','in_progress') then
    for v_row in select value from jsonb_array_elements(v_rows) loop
      select * into v_asset from public.asset_items where id=nullif(v_row->>'asset_id','')::uuid for update;
      if not found or v_asset.outlet_id<>v_outlet_id or v_asset.status='archived' then raise exception using errcode='42501',message='Inspection asset is unavailable.'; end if;
      v_expected:=v_asset.current_quantity; v_counted:=coalesce(nullif(v_row->>'counted_quantity','')::numeric,0);
      v_condition:=lower(coalesce(nullif(v_row->>'condition_status',''),'healthy'));
      if v_counted<0 or v_condition not in ('healthy','needs_attention','low_quantity','damaged','missing') then raise exception using errcode='22023',message='Invalid inspection result.'; end if;
      if coalesce((v_row->>'evidence_required')::boolean,false) and jsonb_array_length(coalesce(v_row->'evidence','[]'::jsonb))=0 then raise exception using errcode='22023',message='Photo evidence is required for this condition.'; end if;
      insert into public.asset_inspection_items(inspection_id,asset_id,expected_quantity,counted_quantity,expected_qty,counted_qty,difference,condition,condition_status,condition_template_id,evidence_required,evidence_status,remark,created_at)
      values(v_inspection.id,v_asset.id,v_expected,v_counted,v_expected,v_counted,v_counted-v_expected,v_condition,v_condition,
        nullif(v_row->>'condition_template_id','')::uuid,coalesce((v_row->>'evidence_required')::boolean,false),
        case when jsonb_array_length(coalesce(v_row->'evidence','[]'::jsonb))>0 then 'complete' else 'not_required' end,
        coalesce(v_row->>'remark',''),now()) returning * into v_item;
      for v_evidence in select value from jsonb_array_elements(coalesce(v_row->'evidence','[]'::jsonb)) loop
        if nullif(v_evidence->>'image_url','') is null then raise exception using errcode='22023',message='Inspection evidence image is required.'; end if;
        insert into public.asset_inspection_evidence(inspection_item_id,image_url,caption,created_at)
        values(v_item.id,v_evidence->>'image_url',nullif(v_evidence->>'caption',''),now());
      end loop;
      update public.asset_items set current_quantity=v_counted,condition=v_condition,last_inspection_at=current_date,updated_at=now() where id=v_asset.id;
      if v_counted<>v_expected then insert into public.asset_movement_logs(asset_id,outlet_id,movement_type,quantity_change,quantity_before,quantity_after,reason,remark,movement_date,created_by_employee_id,created_at)
        values(v_asset.id,v_outlet_id,'correction',v_counted-v_expected,v_expected,v_counted,'inspection','Crew inspection correction',current_date,v_employee_id,now()); end if;
    end loop;
    update public.asset_inspections set status=v_status,summary=jsonb_build_object('total_assets',jsonb_array_length(v_rows),'checked_assets',jsonb_array_length(v_rows),'completion_percentage',100),completion_percentage=100,updated_at=now() where id=v_inspection.id returning * into v_inspection;
  end if;
  v_result:=jsonb_build_object('inspection_id',v_inspection.id,'outlet_id',v_outlet_id,'status',v_inspection.status,'request_id',p_request_id,'actor_employee_id',v_employee_id);
  insert into public.asset_lifecycle_requests(request_id,operation,actor_employee_id,outlet_id,result)
  values(p_request_id,'inspection_submission',v_employee_id,v_outlet_id,v_result);
  return v_result;
end;
$$;

create or replace function public.crew_asset_evidence_context(p_token text,p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_context jsonb:=public.crew_asset_context(p_token); v_outlet_id uuid:=(v_context->>'outlet_id')::uuid;
begin
  if not coalesce((v_context->>'can_perform_asset_inspections')::boolean,false)
     or not exists(select 1 from public.asset_items where id=p_asset_id and outlet_id=v_outlet_id and status<>'archived') then
    raise exception using errcode='42501',message='Inspection evidence access is unavailable.';
  end if;
  return jsonb_build_object('employee_id',v_context->>'employee_id','outlet_id',v_outlet_id,'asset_id',p_asset_id,'bucket','asset-photos');
end;
$$;

create or replace function public.asset_tracking_audit_lifecycle_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_name text;
  v_action text:=case new.operation when 'quantity_adjustment' then 'asset_quantity_adjusted' when 'inspection_submission' then case when coalesce(new.result->>'status','') in ('draft','in_progress','pending_review') then 'asset_inspection_draft_saved' else 'asset_inspection_submitted' end when 'inspection_archive' then 'asset_inspection_archived' when 'maintenance_save' then 'asset_maintenance_saved' when 'import_row' then case when coalesce(new.result->>'action','')='update' then 'asset_edited' else 'asset_created' end else 'asset_lifecycle_changed' end;
begin
  select coalesce(nullif(nickname,''),nullif(full_name,'')) into v_user_name from public.employees
  where id=new.actor_employee_id or auth_user_id=new.actor_id or id=new.actor_id
  order by case when id=new.actor_employee_id then 0 when auth_user_id=new.actor_id then 1 else 2 end limit 1;
  insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
  values(v_action,'Asset Tracking',new.actor_id,coalesce(v_user_name,case when new.actor_employee_id is not null then 'Crew member' else 'Authenticated user' end),
    'Trusted asset lifecycle: '||replace(new.operation,'_',' '),jsonb_build_object('request_id',new.request_id,'operation',new.operation,'outlet_id',new.outlet_id,'actor_id',new.actor_id,'actor_employee_id',new.actor_employee_id,'result',new.result));
  return new;
end;
$$;

revoke all on function public.crew_update_asset_access(uuid,boolean,boolean) from public,anon,authenticated;
revoke all on function public.crew_update_special_access(uuid,boolean,boolean,boolean) from public,anon,authenticated;
revoke all on function public.crew_asset_context(text) from public,anon,authenticated;
revoke all on function public.crew_asset_mobile(text,uuid) from public,anon,authenticated;
revoke all on function public.crew_asset_adjust(text,uuid,uuid,text,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.crew_asset_submit_inspection(text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.crew_asset_evidence_context(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_update_asset_access(uuid,boolean,boolean) to authenticated;
grant execute on function public.crew_update_special_access(uuid,boolean,boolean,boolean) to authenticated;
grant execute on function public.crew_asset_mobile(text,uuid) to anon,authenticated;
grant execute on function public.crew_asset_adjust(text,uuid,uuid,text,numeric,text,text,text) to anon,authenticated;
grant execute on function public.crew_asset_submit_inspection(text,uuid,jsonb) to anon,authenticated;
grant execute on function public.crew_asset_evidence_context(text,uuid) to anon,authenticated;

-- Keep the Admin employee projection current without exposing Crew capabilities publicly.
create or replace function public.crew_access_admin_list(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if p_outlet_id is null or not (public.current_user_has_permission('crew_employees.view') or public.current_user_has_permission('crew_employees.manage')) then raise exception using errcode='42501',message='Missing permission to view Crew Access.'; end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='You cannot view Crew Access outside your outlet scope.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'full_name',e.full_name,'employee_code',e.employee_code,'position',e.position,'workplace',e.workplace,'contact',e.contact,'employment_type',e.employment_type,'employment_status',e.employment_status,'is_active',e.is_active,
    'crew_access',case when ca.employee_id is null then null else jsonb_build_object('employee_id',ca.employee_id,'mobile_number',ca.mobile_number,'access_state',ca.access_state,'activated_at',ca.activated_at,'disabled_at',ca.disabled_at,'locked_until',ca.locked_until,'last_login_at',ca.last_login_at,'primary_outlet_id',ca.primary_outlet_id,'can_initiate_handover',ca.can_initiate_handover,'can_adjust_assets',ca.can_adjust_assets,'can_perform_asset_inspections',ca.can_perform_asset_inspections) end) order by e.full_name)
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id where public.crew_resolve_employee_outlet(e.id)=p_outlet_id),'[]'::jsonb);
end; $$;
revoke all on function public.crew_access_admin_list(uuid) from public,anon,authenticated;
grant execute on function public.crew_access_admin_list(uuid) to authenticated;
