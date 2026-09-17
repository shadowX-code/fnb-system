-- Crew Asset creation is deliberately narrow: the trusted Asset Tracking model
-- remains authoritative while a separately granted Crew capability can create a
-- new active outlet asset and attach one initial photo.
alter table public.crew_access
  add column if not exists can_add_assets boolean not null default false;

alter table public.asset_items
  add column if not exists created_by_employee_id uuid references public.employees(id) on delete set null;

create index if not exists asset_items_created_by_employee_idx
  on public.asset_items (created_by_employee_id, created_at desc)
  where created_by_employee_id is not null;

alter table public.asset_lifecycle_requests
  drop constraint if exists asset_lifecycle_requests_operation_check;
alter table public.asset_lifecycle_requests
  add constraint asset_lifecycle_requests_operation_check
  check (operation in ('quantity_adjustment', 'inspection_submission', 'inspection_archive', 'maintenance_save', 'import_row', 'asset_creation', 'asset_initial_photo'));

create or replace function public.crew_update_asset_access(
  p_employee_id uuid,
  p_can_adjust_assets boolean,
  p_can_perform_asset_inspections boolean,
  p_can_add_assets boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_access public.crew_access%rowtype;
  v_outlet_id uuid;
  v_before_adjust boolean;
  v_before_inspect boolean;
  v_before_add boolean;
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
  v_before_add := v_access.can_add_assets;
  update public.crew_access
  set can_adjust_assets = coalesce(p_can_adjust_assets, false),
      can_perform_asset_inspections = coalesce(p_can_perform_asset_inspections, false),
      can_add_assets = coalesce(p_can_add_assets, false),
      updated_at = now()
  where employee_id = p_employee_id
  returning * into v_access;
  if v_before_adjust is distinct from v_access.can_adjust_assets
     or v_before_inspect is distinct from v_access.can_perform_asset_inspections
     or v_before_add is distinct from v_access.can_add_assets then
    insert into public.audit_logs(action,module,description,metadata)
    values ('crew_access_asset_capabilities_updated','crew','Crew Asset capabilities updated.',jsonb_build_object(
      'employee_id',p_employee_id,'outlet_id',v_outlet_id,'actor_id',auth.uid(),
      'can_adjust_assets_before',v_before_adjust,'can_adjust_assets_after',v_access.can_adjust_assets,
      'can_perform_asset_inspections_before',v_before_inspect,'can_perform_asset_inspections_after',v_access.can_perform_asset_inspections,
      'can_add_assets_before',v_before_add,'can_add_assets_after',v_access.can_add_assets));
  end if;
  return jsonb_build_object(
    'employee_id',v_access.employee_id,'access_state',v_access.access_state,
    'can_adjust_assets',v_access.can_adjust_assets,
    'can_perform_asset_inspections',v_access.can_perform_asset_inspections,
    'can_add_assets',v_access.can_add_assets,'updated_at',v_access.updated_at);
end;
$$;

create or replace function public.crew_update_special_access(
  p_employee_id uuid,
  p_can_initiate_handover boolean,
  p_can_adjust_assets boolean,
  p_can_perform_asset_inspections boolean,
  p_can_add_assets boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cash jsonb; v_assets jsonb;
begin
  v_cash := public.crew_update_cash_operations_access(p_employee_id,p_can_initiate_handover);
  v_assets := public.crew_update_asset_access(p_employee_id,p_can_adjust_assets,p_can_perform_asset_inspections,p_can_add_assets);
  return v_cash || v_assets;
end;
$$;

create or replace function public.crew_asset_context(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_employee_id uuid; v_access public.crew_access%rowtype; v_employee public.employees%rowtype;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select * into v_employee from public.employees where id = v_employee_id;
  select * into v_access from public.crew_access where employee_id = v_employee_id and access_state = 'active' for share;
  if v_access.employee_id is null
     or v_access.primary_outlet_id is distinct from public.crew_resolve_employee_outlet(v_employee_id)
     or not (v_access.can_add_assets or v_access.can_adjust_assets or v_access.can_perform_asset_inspections) then
    raise exception using errcode = '42501', message = 'Crew Asset access is unavailable.';
  end if;
  return jsonb_build_object(
    'employee_id',v_employee_id,'employee_name',coalesce(nullif(v_employee.nickname,''),v_employee.full_name),
    'outlet_id',v_access.primary_outlet_id,'can_add_assets',v_access.can_add_assets,
    'can_adjust_assets',v_access.can_adjust_assets,'can_perform_asset_inspections',v_access.can_perform_asset_inspections);
end;
$$;

-- Kept at the existing signature so an older web client cannot change an asset
-- condition during a rolling deploy. p_condition is intentionally ignored.
create or replace function public.crew_asset_adjust(
  p_token text, p_request_id uuid, p_asset_id uuid, p_adjustment_type text,
  p_quantity numeric, p_condition text, p_reason text, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_context jsonb := public.crew_asset_context(p_token);
  v_employee_id uuid := (v_context->>'employee_id')::uuid;
  v_outlet_id uuid := (v_context->>'outlet_id')::uuid;
  v_asset public.asset_items%rowtype; v_movement public.asset_movement_logs%rowtype;
  v_before numeric; v_after numeric; v_delta numeric; v_type text := lower(coalesce(p_adjustment_type,'')); v_result jsonb;
begin
  if not coalesce((v_context->>'can_adjust_assets')::boolean,false) then raise exception using errcode='42501',message='Adjust Assets Special Access is required.'; end if;
  if p_request_id is null or p_asset_id is null or p_quantity is null or p_quantity < 0 then raise exception using errcode='22023',message='Request, asset and quantity are required.'; end if;
  if v_type not in ('add','reduce','correction') then raise exception using errcode='22023',message='Invalid asset adjustment type.'; end if;
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
  update public.asset_items set current_quantity=v_after,updated_at=now() where id=v_asset.id returning * into v_asset;
  insert into public.asset_movement_logs(asset_id,outlet_id,movement_type,quantity_change,quantity_before,quantity_after,reason,remark,movement_date,created_by_employee_id,created_at)
  values(v_asset.id,v_outlet_id,v_type,v_delta,v_before,v_after,btrim(p_reason),nullif(btrim(p_note),''),current_date,v_employee_id,now()) returning * into v_movement;
  v_result:=jsonb_build_object('asset',jsonb_build_object('id',v_asset.id,'current_quantity',v_after,'condition',v_asset.condition),'movement',jsonb_build_object('id',v_movement.id,'quantity_before',v_before,'quantity_after',v_after,'quantity_change',v_delta,'reason',v_movement.reason),'actor_employee_id',v_employee_id);
  insert into public.asset_lifecycle_requests(request_id,operation,actor_employee_id,outlet_id,result) values(p_request_id,'quantity_adjustment',v_employee_id,v_outlet_id,v_result);
  return v_result;
end;
$$;

create or replace function public.crew_asset_create(p_token text, p_request_id uuid, p_asset jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_context jsonb := public.crew_asset_context(p_token);
  v_employee_id uuid := (v_context->>'employee_id')::uuid;
  v_outlet_id uuid := (v_context->>'outlet_id')::uuid;
  v_category_id uuid := nullif(p_asset->>'category_id','')::uuid;
  v_name text := nullif(btrim(p_asset->>'name'),'');
  v_unit text := nullif(btrim(p_asset->>'unit'),'');
  v_code text := nullif(btrim(p_asset->>'asset_code'),'');
  v_quantity numeric := coalesce(nullif(p_asset->>'initial_quantity','')::numeric,0);
  v_minimum numeric := coalesce(nullif(p_asset->>'minimum_quantity','')::numeric,0);
  v_asset public.asset_items%rowtype; v_result jsonb;
begin
  if not coalesce((v_context->>'can_add_assets')::boolean,false) then raise exception using errcode='42501',message='Add Assets Special Access is required.'; end if;
  if p_request_id is null or v_name is null or v_category_id is null or v_unit is null then raise exception using errcode='22023',message='Asset name, category and unit are required.'; end if;
  if v_quantity < 0 or v_minimum < 0 then raise exception using errcode='22023',message='Asset quantities cannot be below 0.'; end if;
  if not exists(select 1 from public.asset_categories where id=v_category_id and is_active) then raise exception using errcode='22023',message='Choose an active asset category.'; end if;
  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_'||p_request_id::text));
  select result into v_result from public.asset_lifecycle_requests where request_id=p_request_id and operation='asset_creation';
  if found then return v_result; end if;
  if exists(select 1 from public.asset_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another asset action.'; end if;
  if v_code is not null and exists(select 1 from public.asset_items where outlet_id=v_outlet_id and lower(asset_code)=lower(v_code) and status <> 'archived') then raise exception using errcode='23505',message='Asset code is already in use for this outlet.'; end if;
  insert into public.asset_items(outlet_id,category_id,name,description,asset_code,location,unit,current_quantity,minimum_quantity,status,health_status,maintenance_override,condition,remark,created_by_employee_id,created_at,updated_at)
  values(v_outlet_id,v_category_id,v_name,coalesce(p_asset->>'description',''),v_code,coalesce(p_asset->>'location',''),v_unit,v_quantity,v_minimum,'active','healthy','inherit','healthy','',v_employee_id,now(),now()) returning * into v_asset;
  v_result:=jsonb_build_object('asset',jsonb_build_object('id',v_asset.id,'outlet_id',v_asset.outlet_id,'name',v_asset.name,'current_quantity',v_asset.current_quantity,'unit',v_asset.unit),'actor_employee_id',v_employee_id,'request_id',p_request_id);
  insert into public.asset_lifecycle_requests(request_id,operation,actor_employee_id,outlet_id,result) values(p_request_id,'asset_creation',v_employee_id,v_outlet_id,v_result);
  return v_result;
end;
$$;

create or replace function public.crew_asset_initial_photo_context(p_token text, p_asset_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_context jsonb:=public.crew_asset_context(p_token); v_outlet_id uuid:=(v_context->>'outlet_id')::uuid; v_employee_id uuid:=(v_context->>'employee_id')::uuid;
begin
  if not coalesce((v_context->>'can_add_assets')::boolean,false)
     or not exists(select 1 from public.asset_items where id=p_asset_id and outlet_id=v_outlet_id and created_by_employee_id=v_employee_id and nullif(image_url,'') is null and created_at >= now() - interval '15 minutes') then
    raise exception using errcode='42501',message='Initial asset photo access is unavailable.';
  end if;
  return jsonb_build_object('employee_id',v_employee_id,'outlet_id',v_outlet_id,'asset_id',p_asset_id,'bucket','asset-photos');
end;
$$;

create or replace function public.crew_asset_set_initial_photo(p_token text, p_request_id uuid, p_asset_id uuid, p_image_url text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_context jsonb := public.crew_asset_initial_photo_context(p_token,p_asset_id);
  v_employee_id uuid := (v_context->>'employee_id')::uuid; v_outlet_id uuid := (v_context->>'outlet_id')::uuid;
  v_asset public.asset_items%rowtype; v_result jsonb;
begin
  if p_request_id is null or nullif(btrim(p_image_url),'') is null or p_image_url !~ '^https?://' then raise exception using errcode='22023',message='A valid asset photo is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_'||p_request_id::text));
  select result into v_result from public.asset_lifecycle_requests where request_id=p_request_id and operation='asset_initial_photo';
  if found then return v_result; end if;
  if exists(select 1 from public.asset_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another asset action.'; end if;
  update public.asset_items set image_url=btrim(p_image_url),thumbnail_url=btrim(p_image_url),updated_at=now()
  where id=p_asset_id and outlet_id=v_outlet_id and created_by_employee_id=v_employee_id and nullif(image_url,'') is null and created_at >= now() - interval '15 minutes'
  returning * into v_asset;
  if not found then raise exception using errcode='42501',message='Initial asset photo is no longer available.'; end if;
  v_result:=jsonb_build_object('asset',jsonb_build_object('id',v_asset.id,'image_url',v_asset.image_url),'actor_employee_id',v_employee_id,'request_id',p_request_id);
  insert into public.asset_lifecycle_requests(request_id,operation,actor_employee_id,outlet_id,result) values(p_request_id,'asset_initial_photo',v_employee_id,v_outlet_id,v_result);
  return v_result;
end;
$$;

create or replace function public.asset_tracking_audit_lifecycle_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user_name text;
  v_action text:=case new.operation
    when 'quantity_adjustment' then 'asset_quantity_adjusted'
    when 'asset_creation' then 'asset_created'
    when 'asset_initial_photo' then 'asset_photo_added'
    when 'inspection_submission' then case when coalesce(new.result->>'status','') in ('draft','in_progress','pending_review') then 'asset_inspection_draft_saved' else 'asset_inspection_submitted' end
    when 'inspection_archive' then 'asset_inspection_archived'
    when 'maintenance_save' then 'asset_maintenance_saved'
    when 'import_row' then case when coalesce(new.result->>'action','')='update' then 'asset_edited' else 'asset_created' end
    else 'asset_lifecycle_changed' end;
begin
  select coalesce(nullif(nickname,''),nullif(full_name,'')) into v_user_name from public.employees
  where id=new.actor_employee_id or auth_user_id=new.actor_id or id=new.actor_id
  order by case when id=new.actor_employee_id then 0 when auth_user_id=new.actor_id then 1 else 2 end limit 1;
  insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
  values(v_action,'Asset Tracking',new.actor_id,coalesce(v_user_name,case when new.actor_employee_id is not null then 'Crew member' else 'Authenticated user' end),'Trusted asset lifecycle: '||replace(new.operation,'_',' '),jsonb_build_object('request_id',new.request_id,'operation',new.operation,'outlet_id',new.outlet_id,'actor_id',new.actor_id,'actor_employee_id',new.actor_employee_id,'result',new.result));
  return new;
end;
$$;

create or replace function public.crew_asset_mobile(p_token text, p_asset_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_context jsonb:=public.crew_asset_context(p_token); v_employee_id uuid:=(v_context->>'employee_id')::uuid; v_outlet_id uuid:=(v_context->>'outlet_id')::uuid; v_outlet_name text;
begin
  select name into v_outlet_name from public.outlets where id=v_outlet_id;
  if p_asset_id is not null and not exists(select 1 from public.asset_items where id=p_asset_id and outlet_id=v_outlet_id and status<>'archived') then raise exception using errcode='42501',message='Asset is unavailable for this Crew outlet.'; end if;
  return v_context || jsonb_build_object(
    'outlet',jsonb_build_object('id',v_outlet_id,'name',v_outlet_name),
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.sort_order,c.name) from public.asset_categories c where c.is_active),'[]'::jsonb),
    'condition_templates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'category_id',t.category_id,'name',t.name,'severity',t.severity,'requires_photo',t.requires_photo,'requires_remark',t.requires_remark) order by t.sort_order,t.name) from public.asset_condition_templates t where t.active),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'asset_code',a.asset_code,'name',a.name,'description',a.description,'category_id',a.category_id,'category_name',c.name,'location',a.location,'unit',a.unit,'current_quantity',a.current_quantity,'minimum_quantity',a.minimum_quantity,'condition',a.condition,'status',a.status,'image_url',a.image_url,'thumbnail_url',a.thumbnail_url,'last_inspection_at',a.last_inspection_at,'maintenance',coalesce((select jsonb_agg(jsonb_build_object('status',m.status,'scheduled_date',m.scheduled_date,'issue',m.issue) order by coalesce(m.scheduled_date,m.date) desc) from public.asset_maintenance_records m where m.asset_id=a.id and m.status in ('scheduled','in_progress')),'[]'::jsonb)) order by a.name) from public.asset_items a join public.asset_categories c on c.id=a.category_id where a.outlet_id=v_outlet_id and a.status<>'archived' and (p_asset_id is null or a.id=p_asset_id)),'[]'::jsonb),
    'inspection_drafts',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'inspection_date',i.inspection_date,'category_scope',i.category_scope,'status',i.status,'current_step',i.current_step,'completion_percentage',i.completion_percentage,'draft_data',i.draft_data,'updated_at',i.updated_at) order by i.updated_at desc) from public.asset_inspections i where i.outlet_id=v_outlet_id and i.checked_by_employee_id=v_employee_id and i.status in ('draft','in_progress','pending_review')),'[]'::jsonb),
    'movement_history',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'asset_id',m.asset_id,'asset_name',a.name,'movement_type',m.movement_type,'quantity_before',m.quantity_before,'quantity_after',m.quantity_after,'quantity_change',m.quantity_change,'reason',m.reason,'movement_date',m.movement_date,'created_at',m.created_at,'actor_name',coalesce(e.full_name,case when m.created_by_employee_id=v_employee_id then 'You' else 'Admin' end)) order by m.created_at desc) from (select * from public.asset_movement_logs where outlet_id=v_outlet_id and (p_asset_id is null or asset_id=p_asset_id) order by created_at desc limit 40) m join public.asset_items a on a.id=m.asset_id left join public.employees e on e.id=m.created_by_employee_id),'[]'::jsonb),
    'inspection_history',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'inspection_date',i.inspection_date,'checked_by',i.checked_by,'status',i.status,'summary',i.summary,'notes',i.notes,'created_at',i.created_at,'asset_ids',coalesce((select jsonb_agg(ii.asset_id) from public.asset_inspection_items ii where ii.inspection_id=i.id),'[]'::jsonb),'items',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ii.asset_id,'asset_name',a.name,'expected_quantity',coalesce(ii.expected_quantity,ii.expected_qty),'counted_quantity',coalesce(ii.counted_quantity,ii.counted_qty),'difference',ii.difference,'condition',coalesce(ii.condition,ii.condition_status)) order by a.name) from public.asset_inspection_items ii join public.asset_items a on a.id=ii.asset_id where ii.inspection_id=i.id),'[]'::jsonb)) order by i.inspection_date desc,i.created_at desc) from (select * from public.asset_inspections where outlet_id=v_outlet_id and status in ('completed','partial','submitted') and (p_asset_id is null or exists(select 1 from public.asset_inspection_items ii where ii.inspection_id=asset_inspections.id and ii.asset_id=p_asset_id)) order by inspection_date desc,created_at desc limit 20) i),'[]'::jsonb)
  );
end;
$$;

create or replace function public.crew_access_admin_list(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if p_outlet_id is null or not (public.current_user_has_permission('crew_employees.view') or public.current_user_has_permission('crew_employees.manage')) then raise exception using errcode='42501',message='Missing permission to view Crew Access.'; end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='You cannot view Crew Access outside your outlet scope.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'full_name',e.full_name,'employee_code',e.employee_code,'position',e.position,'workplace',e.workplace,'contact',e.contact,'employment_type',e.employment_type,'employment_status',e.employment_status,'is_active',e.is_active,'crew_access',case when ca.employee_id is null then null else jsonb_build_object('employee_id',ca.employee_id,'mobile_number',ca.mobile_number,'access_state',ca.access_state,'activated_at',ca.activated_at,'disabled_at',ca.disabled_at,'locked_until',ca.locked_until,'last_login_at',ca.last_login_at,'primary_outlet_id',ca.primary_outlet_id,'can_initiate_handover',ca.can_initiate_handover,'can_add_assets',ca.can_add_assets,'can_adjust_assets',ca.can_adjust_assets,'can_perform_asset_inspections',ca.can_perform_asset_inspections) end) order by e.full_name) from public.employees e left join public.crew_access ca on ca.employee_id=e.id where public.crew_resolve_employee_outlet(e.id)=p_outlet_id),'[]'::jsonb);
end;
$$;

revoke all on function public.crew_update_asset_access(uuid,boolean,boolean,boolean) from public,anon,authenticated;
revoke all on function public.crew_update_special_access(uuid,boolean,boolean,boolean,boolean) from public,anon,authenticated;
revoke all on function public.crew_asset_context(text) from public,anon,authenticated;
revoke all on function public.crew_asset_adjust(text,uuid,uuid,text,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.crew_asset_create(text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.crew_asset_initial_photo_context(text,uuid) from public,anon,authenticated;
revoke all on function public.crew_asset_set_initial_photo(text,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.crew_asset_mobile(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_update_asset_access(uuid,boolean,boolean,boolean) to authenticated;
grant execute on function public.crew_update_special_access(uuid,boolean,boolean,boolean,boolean) to authenticated;
grant execute on function public.crew_asset_adjust(text,uuid,uuid,text,numeric,text,text,text) to anon,authenticated;
grant execute on function public.crew_asset_create(text,uuid,jsonb) to anon,authenticated;
grant execute on function public.crew_asset_initial_photo_context(text,uuid) to anon,authenticated;
grant execute on function public.crew_asset_set_initial_photo(text,uuid,uuid,text) to anon,authenticated;
grant execute on function public.crew_asset_mobile(text,uuid) to anon,authenticated;
