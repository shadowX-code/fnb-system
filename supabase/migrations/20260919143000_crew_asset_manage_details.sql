-- Crew may maintain presentation details only when separately granted. Quantity,
-- condition and lifecycle remain owned by their existing trusted mutations.
alter table public.crew_access
  add column if not exists can_manage_asset_details boolean not null default false;

alter table public.asset_lifecycle_requests
  drop constraint if exists asset_lifecycle_requests_operation_check;
alter table public.asset_lifecycle_requests
  add constraint asset_lifecycle_requests_operation_check
  check (operation in ('quantity_adjustment','inspection_submission','inspection_archive','maintenance_save','import_row','asset_creation','asset_initial_photo','asset_details_update'));

create or replace function public.crew_update_asset_access(
  p_employee_id uuid, p_can_adjust_assets boolean, p_can_perform_asset_inspections boolean,
  p_can_add_assets boolean default false, p_can_manage_asset_details boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_access public.crew_access%rowtype; v_outlet_id uuid; v_before jsonb;
begin
  if not public.current_user_has_permission('crew_employees.manage') then raise exception using errcode='42501',message='Missing permission to manage Crew Access.'; end if;
  v_outlet_id:=public.crew_resolve_employee_outlet(p_employee_id);
  select * into v_access from public.crew_access where employee_id=p_employee_id for update;
  if v_access.employee_id is null or v_access.access_state<>'active' then raise exception using errcode='22023',message='Crew Access must be active before Special Access can be configured.'; end if;
  if v_outlet_id is null or v_access.primary_outlet_id is distinct from v_outlet_id or not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode='42501',message='Crew Access outlet scope is unavailable or inaccessible.'; end if;
  v_before:=jsonb_build_object('add',v_access.can_add_assets,'adjust',v_access.can_adjust_assets,'inspect',v_access.can_perform_asset_inspections,'manage_details',v_access.can_manage_asset_details);
  update public.crew_access set can_add_assets=coalesce(p_can_add_assets,false),can_adjust_assets=coalesce(p_can_adjust_assets,false),can_perform_asset_inspections=coalesce(p_can_perform_asset_inspections,false),can_manage_asset_details=coalesce(p_can_manage_asset_details,false),updated_at=now() where employee_id=p_employee_id returning * into v_access;
  if v_before is distinct from jsonb_build_object('add',v_access.can_add_assets,'adjust',v_access.can_adjust_assets,'inspect',v_access.can_perform_asset_inspections,'manage_details',v_access.can_manage_asset_details) then insert into public.audit_logs(action,module,description,metadata) values('crew_access_asset_capabilities_updated','crew','Crew Asset capabilities updated.',jsonb_build_object('employee_id',p_employee_id,'outlet_id',v_outlet_id,'actor_id',auth.uid(),'before',v_before,'after',jsonb_build_object('add',v_access.can_add_assets,'adjust',v_access.can_adjust_assets,'inspect',v_access.can_perform_asset_inspections,'manage_details',v_access.can_manage_asset_details))); end if;
  return jsonb_build_object('employee_id',v_access.employee_id,'can_add_assets',v_access.can_add_assets,'can_adjust_assets',v_access.can_adjust_assets,'can_perform_asset_inspections',v_access.can_perform_asset_inspections,'can_manage_asset_details',v_access.can_manage_asset_details,'updated_at',v_access.updated_at);
end;$$;

create or replace function public.crew_update_special_access(
  p_employee_id uuid,p_can_initiate_handover boolean,p_can_adjust_assets boolean,p_can_perform_asset_inspections boolean,p_can_add_assets boolean default false,p_can_manage_asset_details boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
begin return public.crew_update_cash_operations_access(p_employee_id,p_can_initiate_handover) || public.crew_update_asset_access(p_employee_id,p_can_adjust_assets,p_can_perform_asset_inspections,p_can_add_assets,p_can_manage_asset_details); end;$$;

create or replace function public.crew_asset_context(p_token text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token); v_access public.crew_access%rowtype; v_employee public.employees%rowtype;
begin
  select * into v_employee from public.employees where id=v_employee_id; select * into v_access from public.crew_access where employee_id=v_employee_id and access_state='active' for share;
  if v_access.employee_id is null or v_access.primary_outlet_id is distinct from public.crew_resolve_employee_outlet(v_employee_id) or not(v_access.can_add_assets or v_access.can_adjust_assets or v_access.can_perform_asset_inspections or v_access.can_manage_asset_details) then raise exception using errcode='42501',message='Crew Asset access is unavailable.'; end if;
  return jsonb_build_object('employee_id',v_employee_id,'employee_name',coalesce(nullif(v_employee.nickname,''),v_employee.full_name),'outlet_id',v_access.primary_outlet_id,'can_add_assets',v_access.can_add_assets,'can_adjust_assets',v_access.can_adjust_assets,'can_perform_asset_inspections',v_access.can_perform_asset_inspections,'can_manage_asset_details',v_access.can_manage_asset_details);
end;$$;

create or replace function public.crew_asset_update_details(p_token text,p_request_id uuid,p_asset_id uuid,p_details jsonb,p_original_image_url text default null,p_image_url text default null,p_thumbnail_url text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_context jsonb:=public.crew_asset_context(p_token); v_asset public.asset_items%rowtype; v_result jsonb; v_remove boolean:=coalesce((p_details->>'remove_photo')::boolean,false); v_name text:=nullif(btrim(p_details->>'name'),'');
begin
  if not coalesce((v_context->>'can_manage_asset_details')::boolean,false) then raise exception using errcode='42501',message='Manage Asset Details Special Access is required.'; end if;
  if p_request_id is null or p_asset_id is null or v_name is null then raise exception using errcode='22023',message='Asset name and request ID are required.'; end if;
  if not v_remove and ((p_original_image_url is null) <> (p_image_url is null) or (p_image_url is null) <> (p_thumbnail_url is null)) then raise exception using errcode='22023',message='A complete Asset photo bundle is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_'||p_request_id::text)); select result into v_result from public.asset_lifecycle_requests where request_id=p_request_id and operation='asset_details_update'; if found then return v_result; end if;
  select * into v_asset from public.asset_items where id=p_asset_id for update; if not found or v_asset.outlet_id<>(v_context->>'outlet_id')::uuid or v_asset.status='archived' then raise exception using errcode='42501',message='Asset is unavailable for this Crew outlet.'; end if;
  update public.asset_items set name=v_name,description=coalesce(nullif(btrim(p_details->>'description'),''),''),location=coalesce(nullif(btrim(p_details->>'location'),''),''),original_image_url=case when v_remove then null else coalesce(p_original_image_url,original_image_url) end,image_url=case when v_remove then null else coalesce(p_image_url,image_url) end,thumbnail_url=case when v_remove then null else coalesce(p_thumbnail_url,thumbnail_url) end,updated_at=now() where id=v_asset.id returning * into v_asset;
  v_result:=jsonb_build_object('asset',jsonb_build_object('id',v_asset.id,'name',v_asset.name,'description',v_asset.description,'location',v_asset.location,'original_image_url',v_asset.original_image_url,'image_url',v_asset.image_url,'thumbnail_url',v_asset.thumbnail_url),'actor_employee_id',(v_context->>'employee_id')::uuid);
  insert into public.asset_lifecycle_requests(request_id,operation,actor_employee_id,outlet_id,result) values(p_request_id,'asset_details_update',(v_context->>'employee_id')::uuid,(v_context->>'outlet_id')::uuid,v_result); return v_result;
end;$$;
revoke all on function public.crew_update_asset_access(uuid,boolean,boolean,boolean,boolean) from public,anon,authenticated;
revoke all on function public.crew_update_special_access(uuid,boolean,boolean,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.crew_update_asset_access(uuid,boolean,boolean,boolean,boolean) to authenticated;
grant execute on function public.crew_update_special_access(uuid,boolean,boolean,boolean,boolean,boolean) to authenticated;
revoke all on function public.crew_asset_update_details(text,uuid,uuid,jsonb,text,text,text) from public,anon;
grant execute on function public.crew_asset_update_details(text,uuid,uuid,jsonb,text,text,text) to anon,authenticated;

create or replace function public.crew_access_admin_list(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if p_outlet_id is null or not (public.current_user_has_permission('crew_employees.view') or public.current_user_has_permission('crew_employees.manage')) then raise exception using errcode='42501',message='Missing permission to view Crew Access.'; end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='You cannot view Crew Access outside your outlet scope.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'full_name',e.full_name,'employee_code',e.employee_code,'position',e.position,'workplace',e.workplace,'contact',e.contact,'employment_type',e.employment_type,'employment_status',e.employment_status,'is_active',e.is_active,'crew_access',case when ca.employee_id is null then null else jsonb_build_object('employee_id',ca.employee_id,'mobile_number',ca.mobile_number,'access_state',ca.access_state,'activated_at',ca.activated_at,'disabled_at',ca.disabled_at,'locked_until',ca.locked_until,'last_login_at',ca.last_login_at,'primary_outlet_id',ca.primary_outlet_id,'can_initiate_handover',ca.can_initiate_handover,'can_add_assets',ca.can_add_assets,'can_manage_asset_details',ca.can_manage_asset_details,'can_adjust_assets',ca.can_adjust_assets,'can_perform_asset_inspections',ca.can_perform_asset_inspections) end) order by e.full_name) from public.employees e left join public.crew_access ca on ca.employee_id=e.id where public.crew_resolve_employee_outlet(e.id)=p_outlet_id),'[]'::jsonb);
end;$$;
