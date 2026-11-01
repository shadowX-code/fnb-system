-- Restaurant uses the existing machine identity, role grants and request/receipt authority.
-- No existing grants, scopes, credentials or business rows are backfilled.
set check_function_bodies=off;
alter table feedx_integrations.navigation_modules drop constraint navigation_modules_workspace_check;
alter table feedx_integrations.navigation_modules add constraint navigation_modules_workspace_check check(workspace in ('Factory','Restaurant'));
alter table feedx_integrations.navigation_modules add column human_permission text references public.permissions(code);
alter table public.asset_lifecycle_requests add column actor_machine_id uuid references feedx_integrations.machine_identities(id);
alter table public.asset_lifecycle_requests drop constraint asset_lifecycle_requests_actor_check;
alter table public.asset_lifecycle_requests add constraint asset_lifecycle_requests_actor_check check(num_nonnulls(actor_id,actor_employee_id,actor_machine_id)=1);
alter table public.inventory_lifecycle_requests add column actor_machine_id uuid references feedx_integrations.machine_identities(id);
alter table public.inventory_lifecycle_requests drop constraint inventory_lifecycle_requests_actor_check;
alter table public.inventory_lifecycle_requests add constraint inventory_lifecycle_requests_actor_check check(
 (actor_kind='admin' and actor_id is not null and actor_machine_id is null)
 or (actor_kind='crew' and actor_employee_id is not null and actor_id is null and actor_machine_id is null)
 or (actor_kind='machine' and actor_machine_id is not null and actor_id is null and actor_employee_id is null));
create function feedx_integrations.restaurant_actor_outlet(p_machine uuid,p_outlet uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when p_machine is null then public.current_user_can_access_outlet(p_outlet) else exists(
 select 1 from feedx_integrations.machine_identities m join public.roles r on r.id=m.role_id
 join public.outlets o on o.id=p_outlet where m.id=p_machine and m.enabled and r.is_active and lower(r.name) not in ('owner','admin')
 and (r.outlet_access_type='all' or (r.outlet_access_type='selected' and exists(select 1 from public.role_outlets ro where ro.role_id=r.id and ro.outlet_id=o.id)))) end;
$$;
revoke all on function feedx_integrations.restaurant_actor_outlet(uuid,uuid) from public,anon,authenticated;
create function feedx_integrations.restaurant_actor_can(p_machine uuid,p_permission text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when p_machine is null then public.current_user_has_permission(p_permission) else exists(
 select 1 from feedx_integrations.machine_identities m join public.roles r on r.id=m.role_id and r.is_active
 join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id
 join feedx_integrations.capabilities c on c.permission_code=p.code and c.implemented and c.workspace='Restaurant'
 where m.id=p_machine and m.enabled and lower(r.name) not in ('owner','admin') and (
 exists(select 1 from feedx_integrations.factory_actions a where a.key=c.tool_id and a.human_permission=p_permission)
 or exists(select 1 from feedx_integrations.navigation_modules rr where rr.id=c.navigation_module_id and c.action_type='view' and rr.human_permission=p_permission))) end;
$$;
revoke all on function feedx_integrations.restaurant_actor_can(uuid,text) from public,anon,authenticated;

do $$ begin if md5(pg_get_functiondef('public.asset_import_row(uuid,jsonb,text)'::regprocedure))<>'4a4b32c06713c47126ab506809291993' then raise exception 'Restaurant authority preimage changed: asset_import_row(uuid,jsonb,text)';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_asset_import_row(p_machine uuid, p_request_id uuid, p_asset jsonb, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare
  v_actor uuid := case when p_machine is null then auth.uid() end; v_asset public.asset_items%rowtype; v_movement public.asset_movement_logs%rowtype; v_result jsonb;
  v_asset_id uuid := nullif(p_asset->>'id','')::uuid; v_outlet_id uuid := nullif(p_asset->>'outlet_id','')::uuid; v_action text := lower(coalesce(nullif(btrim(p_action),''),'create'));
  v_before numeric := 0; v_after numeric := coalesce(nullif(p_asset->>'current_quantity','')::numeric,0); v_now timestamptz := now();
begin
  if p_machine is null and v_actor is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  if p_request_id is null or v_outlet_id is null or nullif(btrim(p_asset->>'category_id'),'') is null or nullif(btrim(p_asset->>'name'),'') is null then raise exception 'Request, outlet, category and asset name are required.'; end if;
  if v_action not in ('create','update') then raise exception 'Invalid import action.'; end if;
  if v_after < 0 then raise exception 'Asset quantity cannot be below 0.'; end if;
  if not feedx_integrations.restaurant_actor_outlet(p_machine,v_outlet_id) then raise exception using errcode='42501', message='You cannot import assets for this outlet.'; end if;
  if (v_action='create' and not feedx_integrations.restaurant_actor_can(p_machine,'asset_tracking.create')) or (v_action='update' and not feedx_integrations.restaurant_actor_can(p_machine,'asset_tracking.edit')) then raise exception using errcode='42501', message='Missing permission to import this asset row.'; end if;
  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_' || p_request_id::text));
  select result into v_result from public.asset_lifecycle_requests where request_id=p_request_id and operation='import_row'; if found then return v_result; end if;
  if exists(select 1 from public.asset_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another asset action.'; end if;
  if v_action='update' then
    if v_asset_id is null then raise exception 'Asset ID is required for an import update.'; end if;
    select * into v_asset from public.asset_items where id=v_asset_id for update;
    if not found or v_asset.outlet_id<>v_outlet_id then raise exception 'Import asset is invalid for this outlet.'; end if;
    v_before:=v_asset.current_quantity;
    update public.asset_items set category_id=(p_asset->>'category_id')::uuid,name=p_asset->>'name',description=coalesce(p_asset->>'description',''),asset_code=nullif(btrim(p_asset->>'asset_code'),''),location=coalesce(p_asset->>'location',''),purchase_date=nullif(p_asset->>'purchase_date','')::date,warranty_expiry=nullif(p_asset->>'warranty_expiry','')::date,notes=coalesce(p_asset->>'notes',''),image_url=coalesce(p_asset->>'image_url',''),thumbnail_url=coalesce(p_asset->>'thumbnail_url',''),health_status=coalesce(nullif(p_asset->>'health_status',''),'healthy'),maintenance_override=coalesce(nullif(p_asset->>'maintenance_override',''),'inherit'),condition=coalesce(nullif(p_asset->>'condition',''),'healthy'),unit=coalesce(nullif(p_asset->>'unit',''),'unit'),current_quantity=v_after,minimum_quantity=coalesce(nullif(p_asset->>'minimum_quantity','')::numeric,0),status=coalesce(nullif(p_asset->>'status',''),'active'),remark=coalesce(p_asset->>'remark',''),updated_by=v_actor,updated_at=v_now where id=v_asset.id returning * into v_asset;
  else
    insert into public.asset_items(outlet_id,category_id,name,description,asset_code,location,purchase_date,warranty_expiry,notes,image_url,thumbnail_url,health_status,maintenance_override,condition,unit,current_quantity,minimum_quantity,status,remark,created_by,updated_by,created_at,updated_at)
    values(v_outlet_id,(p_asset->>'category_id')::uuid,p_asset->>'name',coalesce(p_asset->>'description',''),nullif(btrim(p_asset->>'asset_code'),''),coalesce(p_asset->>'location',''),nullif(p_asset->>'purchase_date','')::date,nullif(p_asset->>'warranty_expiry','')::date,coalesce(p_asset->>'notes',''),coalesce(p_asset->>'image_url',''),coalesce(p_asset->>'thumbnail_url',''),coalesce(nullif(p_asset->>'health_status',''),'healthy'),coalesce(nullif(p_asset->>'maintenance_override',''),'inherit'),coalesce(nullif(p_asset->>'condition',''),'healthy'),coalesce(nullif(p_asset->>'unit',''),'unit'),v_after,coalesce(nullif(p_asset->>'minimum_quantity','')::numeric,0),coalesce(nullif(p_asset->>'status',''),'active'),coalesce(p_asset->>'remark',''),v_actor,v_actor,v_now,v_now) returning * into v_asset;
  end if;
  if v_after<>v_before then insert into public.asset_movement_logs(asset_id,outlet_id,movement_type,quantity_change,quantity_before,quantity_after,reason,remark,movement_date,created_by,created_at) values(v_asset.id,v_outlet_id,'correction',v_after-v_before,v_before,v_after,'import',case when v_action='update' then 'Asset updated from import' else 'Asset created from import' end,current_date,v_actor,v_now) returning * into v_movement; end if;
  v_result:=jsonb_build_object('asset',jsonb_build_object('id',v_asset.id,'outlet_id',v_asset.outlet_id,'current_quantity',v_asset.current_quantity),'movement_id',v_movement.id,'action',v_action,'request_id',p_request_id);
  insert into public.asset_lifecycle_requests(request_id,operation,actor_id,outlet_id,result,actor_machine_id) values(p_request_id,'import_row',v_actor,v_outlet_id,v_result,p_machine);
  return v_result;
end; $function$;

revoke all on function feedx_integrations.ra_asset_import_row(uuid,uuid,jsonb,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.asset_import_row(p_request_id uuid, p_asset jsonb, p_action text)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ select feedx_integrations.ra_asset_import_row(null::uuid,p_request_id,p_asset,p_action); $function$;

do $$ begin if md5(pg_get_functiondef('public.asset_submit_inspection(uuid,jsonb)'::regprocedure))<>'b76adac9c346f52a0f630620dcc1dcb4' then raise exception 'Restaurant authority preimage changed: asset_submit_inspection(uuid,jsonb)';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_asset_submit_inspection(p_machine uuid, p_request_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare
  v_actor uuid := case when p_machine is null then auth.uid() end;
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
  if p_machine is null and v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if not feedx_integrations.restaurant_actor_can(p_machine,'asset_tracking.manage') then raise exception using errcode = '42501', message = 'Missing permission to submit asset inspections.'; end if;
  if p_request_id is null or v_outlet_id is null then raise exception 'Request ID and outlet are required.'; end if;
  if v_status not in ('draft','completed','partial','in_progress','pending_review') then raise exception 'Invalid inspection status.'; end if;
  if jsonb_typeof(v_rows) <> 'array' then raise exception 'Inspection rows must be an array.'; end if;
  if not feedx_integrations.restaurant_actor_outlet(p_machine,v_outlet_id) then raise exception using errcode = '42501', message = 'You cannot submit inspections for this outlet.'; end if;
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
  v_checked_by := case when p_machine is not null then 'External Agent: '||(select name from feedx_integrations.machine_identities where id=p_machine) else coalesce(v_checked_by,'Authenticated user') end;

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
  insert into public.asset_lifecycle_requests(request_id,operation,actor_id,outlet_id,result,actor_machine_id) values(p_request_id,'inspection_submission',v_actor,v_outlet_id,v_result,p_machine);
  return v_result;
end;
$function$;

revoke all on function feedx_integrations.ra_asset_submit_inspection(uuid,uuid,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.asset_submit_inspection(p_request_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ select feedx_integrations.ra_asset_submit_inspection(null::uuid,p_request_id,p_payload); $function$;

do $$ begin if md5(pg_get_functiondef('public.asset_save_maintenance(uuid,jsonb)'::regprocedure))<>'dac0e8e07eeba1b8ae47099344c7716d' then raise exception 'Restaurant authority preimage changed: asset_save_maintenance(uuid,jsonb)';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_asset_save_maintenance(p_machine uuid, p_request_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare
  v_actor uuid := case when p_machine is null then auth.uid() end;
  v_asset public.asset_items%rowtype;
  v_record public.asset_maintenance_records%rowtype;
  v_result jsonb;
  v_asset_id uuid := nullif(p_payload->>'asset_id','')::uuid;
  v_outlet_id uuid := nullif(p_payload->>'outlet_id','')::uuid;
  v_record_id uuid := nullif(p_payload->>'id','')::uuid;
  v_status text := coalesce(nullif(btrim(p_payload->>'status'),''),'scheduled');
  v_condition text := nullif(btrim(p_payload->>'condition_intent'),'');
  v_now timestamptz := now();
begin
  if p_machine is null and v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if not feedx_integrations.restaurant_actor_can(p_machine,'asset_tracking.manage') then raise exception using errcode = '42501', message = 'Missing permission to save asset maintenance.'; end if;
  if p_request_id is null or v_asset_id is null or v_outlet_id is null then raise exception 'Request, asset and outlet are required.'; end if;
  if v_status not in ('scheduled','in_progress','completed') then raise exception 'Invalid maintenance status.'; end if;
  if v_condition is not null and v_condition not in ('healthy','needs_attention','under_maintenance','low_quantity','damaged','missing','disposed') then raise exception 'Invalid asset condition.'; end if;
  if not feedx_integrations.restaurant_actor_outlet(p_machine,v_outlet_id) then raise exception using errcode = '42501', message = 'You cannot save maintenance for this outlet.'; end if;

  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_' || p_request_id::text));
  select result into v_result from public.asset_lifecycle_requests where request_id=p_request_id and operation='maintenance_save';
  if found then return v_result; end if;
  if exists(select 1 from public.asset_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another asset action.'; end if;
  select * into v_asset from public.asset_items where id=v_asset_id for update;
  if not found or v_asset.outlet_id <> v_outlet_id then raise exception 'Asset is invalid for this outlet.'; end if;

  if v_record_id is not null then
    select * into v_record from public.asset_maintenance_records where id=v_record_id for update;
    if not found or v_record.asset_id <> v_asset.id or v_record.outlet_id <> v_outlet_id then raise exception 'Maintenance record is invalid for this asset.'; end if;
    update public.asset_maintenance_records set
      date=coalesce(nullif(p_payload->>'date','')::date,current_date),maintenance_type=coalesce(nullif(btrim(p_payload->>'maintenance_type'),''),'repair'),priority=coalesce(nullif(btrim(p_payload->>'priority'),''),'medium'),
      issue=coalesce(p_payload->>'issue',''),action_taken=coalesce(p_payload->>'action_taken',''),vendor=coalesce(p_payload->>'vendor',''),cost=coalesce(nullif(p_payload->>'cost','')::numeric,0),status=v_status,
      scheduled_date=nullif(p_payload->>'scheduled_date','')::date,completed_date=nullif(p_payload->>'completed_date','')::date,next_service_date=nullif(p_payload->>'next_service_date','')::date,
      remark=coalesce(p_payload->>'remark',''),photo_url=coalesce(p_payload->>'photo_url',''),updated_at=v_now
    where id=v_record.id returning * into v_record;
  else
    insert into public.asset_maintenance_records(asset_id,outlet_id,date,maintenance_type,priority,issue,action_taken,vendor,cost,status,scheduled_date,completed_date,next_service_date,remark,photo_url,created_by,created_at,updated_at)
    values(v_asset.id,v_outlet_id,coalesce(nullif(p_payload->>'date','')::date,current_date),coalesce(nullif(btrim(p_payload->>'maintenance_type'),''),'repair'),coalesce(nullif(btrim(p_payload->>'priority'),''),'medium'),coalesce(p_payload->>'issue',''),coalesce(p_payload->>'action_taken',''),coalesce(p_payload->>'vendor',''),coalesce(nullif(p_payload->>'cost','')::numeric,0),v_status,nullif(p_payload->>'scheduled_date','')::date,nullif(p_payload->>'completed_date','')::date,nullif(p_payload->>'next_service_date','')::date,coalesce(p_payload->>'remark',''),coalesce(p_payload->>'photo_url',''),v_actor,v_now,v_now)
    returning * into v_record;
  end if;
  if v_condition is not null then update public.asset_items set condition=v_condition,updated_by=v_actor,updated_at=v_now where id=v_asset.id; end if;
  v_result := jsonb_build_object('record',jsonb_build_object('id',v_record.id,'asset_id',v_record.asset_id,'outlet_id',v_record.outlet_id,'date',v_record.date,'maintenance_type',v_record.maintenance_type,'priority',v_record.priority,'issue',v_record.issue,'action_taken',v_record.action_taken,'vendor',v_record.vendor,'cost',v_record.cost,'status',v_record.status,'scheduled_date',v_record.scheduled_date,'completed_date',v_record.completed_date,'next_service_date',v_record.next_service_date,'remark',v_record.remark,'photo_url',v_record.photo_url,'created_by',v_record.created_by,'created_at',v_record.created_at,'updated_at',v_record.updated_at),'condition',v_condition);
  insert into public.asset_lifecycle_requests(request_id,operation,actor_id,outlet_id,result,actor_machine_id) values(p_request_id,'maintenance_save',v_actor,v_outlet_id,v_result,p_machine);
  return v_result;
end; $function$;

revoke all on function feedx_integrations.ra_asset_save_maintenance(uuid,uuid,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.asset_save_maintenance(p_request_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ select feedx_integrations.ra_asset_save_maintenance(null::uuid,p_request_id,p_payload); $function$;

do $$ begin if md5(pg_get_functiondef('public.inventory_save_manual_movement(uuid,jsonb)'::regprocedure))<>'9e3143d7dc3c920c50cb5f04b4715632' then raise exception 'Restaurant authority preimage changed: inventory_save_manual_movement(uuid,jsonb)';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_inventory_save_manual_movement(p_machine uuid, p_request_id uuid, p_movement jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare v_actor uuid:=case when p_machine is null then auth.uid() end; v_row public.inventory_movements%rowtype; v_result jsonb; v_now timestamptz:=now(); v_id uuid:=nullif(p_movement->>'id','')::uuid; v_outlet uuid:=nullif(p_movement->>'outlet_id','')::uuid; v_item uuid:=nullif(p_movement->>'inventory_item_id','')::uuid; v_type text:=initcap(coalesce(nullif(p_movement->>'movement_type',''),'Adjustment')); v_qty numeric:=nullif(p_movement->>'quantity','')::numeric;
begin
  if p_machine is null and v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if not feedx_integrations.restaurant_actor_can(p_machine,'inventory_movements.create') then raise exception using errcode='42501',message='Missing permission to create inventory movements.'; end if;
  if p_request_id is null or v_outlet is null or v_item is null or v_qty is null or v_qty=0 then raise exception 'Request, outlet, item and non-zero quantity are required.'; end if;
  if lower(v_type) not in ('adjustment','purchase','waste','transfer out','transfer in') then raise exception 'Unsupported inventory movement type.'; end if;
  if not feedx_integrations.restaurant_actor_outlet(p_machine,v_outlet) then raise exception using errcode='42501',message='You cannot record movements for this outlet.'; end if;
  if lower(v_type)='purchase' then v_qty:=abs(v_qty); elsif lower(v_type)='waste' then v_qty:=-abs(v_qty); end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='manual_movement'; if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another inventory action.'; end if;
  if v_id is null then
    insert into public.inventory_movements(outlet_id,inventory_item_id,movement_type,quantity,unit,reference_type,reference_id,reference_no,notes,created_by,created_at)
    values(v_outlet,v_item,v_type,v_qty,nullif(p_movement->>'unit',''),coalesce(nullif(p_movement->>'reference_type',''),'manual'),nullif(p_movement->>'reference_id','')::uuid,nullif(p_movement->>'reference_no',''),nullif(p_movement->>'notes',''),v_actor,coalesce(nullif(p_movement->>'created_at','')::timestamptz,v_now)) returning * into v_row;
  else
    select * into v_row from public.inventory_movements where id=v_id for update;
    if not found then raise exception 'Movement record was not found.'; end if;
    if not feedx_integrations.restaurant_actor_outlet(p_machine,v_row.outlet_id) then raise exception using errcode='42501',message='You cannot edit this movement.'; end if;
    update public.inventory_movements set outlet_id=v_outlet,inventory_item_id=v_item,movement_type=v_type,quantity=v_qty,unit=nullif(p_movement->>'unit',''),reference_type=coalesce(nullif(p_movement->>'reference_type',''),'manual'),reference_id=nullif(p_movement->>'reference_id','')::uuid,reference_no=nullif(p_movement->>'reference_no',''),notes=nullif(p_movement->>'notes',''),created_by=v_actor where id=v_id returning * into v_row;
  end if;
  v_result:=jsonb_build_object('movement',to_jsonb(v_row)); insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,outlet_id,result,actor_machine_id,actor_kind) values(p_request_id,'manual_movement',v_actor,v_outlet,v_result,p_machine,case when p_machine is null then 'admin' else 'machine' end); return v_result;
end; $function$;

revoke all on function feedx_integrations.ra_inventory_save_manual_movement(uuid,uuid,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.inventory_save_manual_movement(p_request_id uuid, p_movement jsonb)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ select feedx_integrations.ra_inventory_save_manual_movement(null::uuid,p_request_id,p_movement); $function$;

do $$ begin if md5(pg_get_functiondef('public.inventory_save_waste(uuid,uuid,uuid,text,numeric,text,date,text,text)'::regprocedure))<>'b1349847f28fea40ea2b21ffeca1fd17' then raise exception 'Restaurant authority preimage changed: inventory_save_waste(uuid,uuid,uuid,text,numeric,text,date,text,text)';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_inventory_save_waste(p_machine uuid, p_request_id uuid, p_outlet_id uuid, p_inventory_item_id uuid, p_waste_type text, p_quantity numeric, p_unit text, p_waste_date date, p_notes text, p_photo_url text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare v_actor uuid := case when p_machine is null then auth.uid() end; v_waste public.inventory_waste_records%rowtype; v_movement public.inventory_movements%rowtype; v_result jsonb; v_now timestamptz := now();
begin
  if p_machine is null and v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if not (feedx_integrations.restaurant_actor_can(p_machine,'inventory_waste.create') or feedx_integrations.restaurant_actor_can(p_machine,'inventory_waste.manage') or feedx_integrations.restaurant_actor_can(p_machine,'inventory_control.manage')) then raise exception using errcode = '42501', message = 'Missing permission to record waste.'; end if;
  if p_request_id is null or p_outlet_id is null or p_inventory_item_id is null or p_quantity is null or p_quantity <= 0 then raise exception 'Request, outlet, item and positive quantity are required.'; end if;
  if not feedx_integrations.restaurant_actor_outlet(p_machine,p_outlet_id) then raise exception using errcode = '42501', message = 'You cannot record waste for this outlet.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_' || p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='waste'; if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another inventory action.'; end if;
  insert into public.inventory_waste_records(outlet_id,inventory_item_id,waste_type,quantity,unit,waste_date,notes,photo_url,created_by,created_at,updated_at)
  values(p_outlet_id,p_inventory_item_id,coalesce(nullif(btrim(p_waste_type),''),'Unknown'),p_quantity,nullif(btrim(p_unit),''),coalesce(p_waste_date,current_date),nullif(btrim(p_notes),''),nullif(btrim(p_photo_url),''),v_actor,v_now,v_now) returning * into v_waste;
  insert into public.inventory_movements(outlet_id,inventory_item_id,movement_type,quantity,unit,reference_type,reference_id,reference_no,notes,created_by,created_at)
  values(p_outlet_id,p_inventory_item_id,'Waste',-abs(p_quantity),nullif(btrim(p_unit),''),'waste',v_waste.id,'WASTE-'||upper(left(v_waste.id::text,8)),coalesce(nullif(btrim(p_notes),''),v_waste.waste_type,'Waste recorded'),v_actor,v_now) returning * into v_movement;
  v_result := jsonb_build_object('waste_id',v_waste.id,'movement_id',v_movement.id);
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,outlet_id,result,actor_machine_id,actor_kind) values(p_request_id,'waste',v_actor,p_outlet_id,v_result,p_machine,case when p_machine is null then 'admin' else 'machine' end);
  return v_result;
end; $function$;

revoke all on function feedx_integrations.ra_inventory_save_waste(uuid,uuid,uuid,uuid,text,numeric,text,date,text,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.inventory_save_waste(p_request_id uuid, p_outlet_id uuid, p_inventory_item_id uuid, p_waste_type text, p_quantity numeric, p_unit text, p_waste_date date, p_notes text, p_photo_url text)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ select feedx_integrations.ra_inventory_save_waste(null::uuid,p_request_id,p_outlet_id,p_inventory_item_id,p_waste_type,p_quantity,p_unit,p_waste_date,p_notes,p_photo_url); $function$;

do $$ begin if md5(pg_get_functiondef('public.inventory_save_recipe(uuid,jsonb,jsonb)'::regprocedure))<>'24ff3f81ae2f83a94cd66071eca4c447' then raise exception 'Restaurant authority preimage changed: inventory_save_recipe(uuid,jsonb,jsonb)';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_inventory_save_recipe(p_machine uuid, p_request_id uuid, p_recipe jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare v_actor uuid:=case when p_machine is null then auth.uid() end; v_recipe public.inventory_recipes%rowtype; v_item jsonb; v_result jsonb; v_now timestamptz:=now(); v_id uuid:=nullif(p_recipe->>'id','')::uuid; v_outlet uuid:=nullif(p_recipe->>'outlet_id','')::uuid;
begin
  if p_machine is null and v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if not feedx_integrations.restaurant_actor_can(p_machine,'inventory_recipes.manage') then raise exception using errcode='42501',message='Missing permission to manage recipes.'; end if;
  if p_request_id is null or v_outlet is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Request, outlet and recipe ingredients are required.'; end if;
  if not feedx_integrations.restaurant_actor_outlet(p_machine,v_outlet) then raise exception using errcode='42501',message='You cannot save recipes for this outlet.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text)); select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='recipe'; if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another inventory action.'; end if;
  if v_id is null then insert into public.inventory_recipes(outlet_id,recipe_code,recipe_name,recipe_name_en,recipe_name_cn,menu_category,recipe_photo_url,selling_price,serving_size,status,notes,created_by,created_at,updated_at)
    values(v_outlet,nullif(p_recipe->>'recipe_code',''),nullif(p_recipe->>'recipe_name',''),nullif(p_recipe->>'recipe_name_en',''),nullif(p_recipe->>'recipe_name_cn',''),nullif(p_recipe->>'menu_category',''),nullif(p_recipe->>'recipe_photo_url',''),nullif(p_recipe->>'selling_price','')::numeric,nullif(p_recipe->>'serving_size','')::numeric,coalesce(nullif(p_recipe->>'status',''),'active'),nullif(p_recipe->>'notes',''),v_actor,v_now,v_now) returning * into v_recipe;
  else
    select * into v_recipe from public.inventory_recipes where id=v_id for update;
    if not found or not feedx_integrations.restaurant_actor_outlet(p_machine,v_recipe.outlet_id) then raise exception using errcode='42501',message='You cannot edit this recipe.'; end if;
    update public.inventory_recipes set recipe_code=nullif(p_recipe->>'recipe_code',''),recipe_name=nullif(p_recipe->>'recipe_name',''),recipe_name_en=nullif(p_recipe->>'recipe_name_en',''),recipe_name_cn=nullif(p_recipe->>'recipe_name_cn',''),menu_category=nullif(p_recipe->>'menu_category',''),recipe_photo_url=nullif(p_recipe->>'recipe_photo_url',''),selling_price=nullif(p_recipe->>'selling_price','')::numeric,serving_size=nullif(p_recipe->>'serving_size','')::numeric,status=coalesce(nullif(p_recipe->>'status',''),'active'),notes=nullif(p_recipe->>'notes',''),updated_at=v_now where id=v_id returning * into v_recipe;
  end if;
  delete from public.inventory_recipe_items where recipe_id=v_recipe.id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(coalesce(v_item->>'inventory_item_id',v_item->>'item_id'),'') is null or coalesce(nullif(coalesce(v_item->>'quantity_used',v_item->>'quantityUsed'),'')::numeric,0)<=0 then raise exception 'Recipe ingredients require an item and positive quantity.'; end if;
    insert into public.inventory_recipe_items(recipe_id,inventory_item_id,quantity_used,unit,wastage_percent,remark,created_at,updated_at) values(v_recipe.id,coalesce(nullif(v_item->>'inventory_item_id',''),nullif(v_item->>'item_id',''))::uuid,coalesce(nullif(v_item->>'quantity_used','')::numeric,nullif(v_item->>'quantityUsed','')::numeric),nullif(v_item->>'unit',''),coalesce(nullif(coalesce(v_item->>'wastage_percent',v_item->>'wastagePercent'),'')::numeric,0),nullif(v_item->>'remark',''),v_now,v_now);
  end loop;
  v_result:=jsonb_build_object('recipe',to_jsonb(v_recipe),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at) from public.inventory_recipe_items i where i.recipe_id=v_recipe.id),'[]'::jsonb)); insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,outlet_id,result,actor_machine_id,actor_kind) values(p_request_id,'recipe',v_actor,v_outlet,v_result,p_machine,case when p_machine is null then 'admin' else 'machine' end); return v_result;
end; $function$;

revoke all on function feedx_integrations.ra_inventory_save_recipe(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.inventory_save_recipe(p_request_id uuid, p_recipe jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ select feedx_integrations.ra_inventory_save_recipe(null::uuid,p_request_id,p_recipe,p_items); $function$;

do $$ begin if md5(pg_get_functiondef('public.reporting_monthly_outlet_financials(uuid,integer,integer)'::regprocedure))<>'4e2e7b9f46987b7de34c8f3970cb892d' then raise exception 'Restaurant authority preimage changed: reporting_monthly_outlet_financials(uuid,integer,integer)';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_reporting_monthly_outlet_financials(p_machine uuid, p_outlet_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare
  v_outlet public.outlets%rowtype;
  v_has_sales boolean;
  v_has_purchases boolean;
  v_has_opex boolean;
  v_revenue numeric;
  v_purchase_based_cogs numeric;
  v_opex numeric;
  v_complete boolean;
begin
  if p_machine is null and auth.uid() is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if p_outlet_id is null or p_year is null or p_month is null or p_year not between 2000 and 2100 or p_month not between 1 and 12 then
    raise exception 'A valid outlet and reporting period are required.';
  end if;
  if not (feedx_integrations.restaurant_actor_can(p_machine,'reports.view') or feedx_integrations.restaurant_actor_can(p_machine,'outlet_pnl.view')) then
    raise exception using errcode = '42501', message = 'Missing permission to view reports.';
  end if;
  if not feedx_integrations.restaurant_actor_outlet(p_machine,p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot view reports for this outlet.';
  end if;

  select * into v_outlet from public.outlets where id = p_outlet_id;
  if not found then raise exception using errcode = 'P0002', message = 'Outlet not found.'; end if;

  select exists(select 1 from public.sales_records s where s.outlet_id = p_outlet_id and s.year = p_year and s.month = p_month)
    into v_has_sales;
  select coalesce(sum(case
    when coalesce(c.type, 'channel') = 'channel' then s.amount
    when coalesce(c.type, 'channel') = 'adjustment' then -abs(s.amount)
    else 0
  end), 0)
  into v_revenue
  from public.sales_records s
  left join public.sales_channels c on c.id = s.channel_id
  where s.outlet_id = p_outlet_id and s.year = p_year and s.month = p_month;

  select exists(select 1 from public.purchase_records p where p.outlet_id = p_outlet_id and p.year = p_year and p.month = p_month)
    into v_has_purchases;
  select coalesce(sum(p.amount), 0) into v_purchase_based_cogs
  from public.purchase_records p
  where p.outlet_id = p_outlet_id and p.year = p_year and p.month = p_month;

  select exists(select 1 from public.operating_expenses e where e.outlet_id = p_outlet_id and e.year = p_year and e.month = p_month)
    into v_has_opex;
  select e.amount into v_opex from public.operating_expenses e
  where e.outlet_id = p_outlet_id and e.year = p_year and e.month = p_month;

  v_complete := v_has_sales and v_has_purchases and v_has_opex;
  return jsonb_build_object(
    'outlet', jsonb_build_object('id', v_outlet.id, 'name', v_outlet.name, 'code', v_outlet.code),
    'period', jsonb_build_object('year', p_year, 'month', p_month),
    'financials', jsonb_build_object(
      'revenue', jsonb_build_object('amount', case when v_has_sales then v_revenue else null end, 'presence', case when v_has_sales then 'present' else 'missing' end),
      'purchase_based_cogs', jsonb_build_object('amount', case when v_has_purchases then v_purchase_based_cogs else null end, 'presence', case when v_has_purchases then 'present' else 'missing' end),
      'opex', jsonb_build_object('amount', case when v_has_opex then v_opex else null end, 'presence', case when v_has_opex then 'present' else 'missing' end),
      'net_profit', jsonb_build_object('amount', case when v_complete then v_revenue - v_purchase_based_cogs - v_opex else null end, 'presence', case when v_complete then 'present' else 'missing' end)
    ),
    'financial_completeness', case when v_complete then 'complete' else 'incomplete' end
  );
end; $function$;

revoke all on function feedx_integrations.ra_reporting_monthly_outlet_financials(uuid,uuid,integer,integer) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.reporting_monthly_outlet_financials(p_outlet_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ select feedx_integrations.ra_reporting_monthly_outlet_financials(null::uuid,p_outlet_id,p_year,p_month); $function$;

do $$ begin if md5(pg_get_functiondef('inventory_authority.save_stock_check(uuid,jsonb,jsonb,uuid,uuid,uuid,text)'::regprocedure))<>'c9ef43b861c27f4713b78edcea3c248c' then raise exception 'Restaurant authority preimage changed: inventory_authority.save_stock_check(uuid,jsonb,jsonb,uuid,uuid,uuid,text)';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_save_stock_check(p_machine uuid, p_request_id uuid, p_check jsonb, p_items jsonb, p_scope_outlet uuid, p_actor_user uuid, p_actor_employee uuid, p_actor_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare
  v_check public.inventory_stock_checks%rowtype;
  v_existing public.inventory_stock_checks%rowtype;
  v_row jsonb;
  v_result jsonb;
  v_now timestamptz := now();
  v_status text := coalesce(p_check->>'status','draft');
  v_type text := coalesce(p_check->>'stock_check_type','scheduled');
  v_outlet uuid := nullif(p_check->>'outlet_id','')::uuid;
  v_group uuid := nullif(p_check->>'group_id','')::uuid;
  v_id uuid := nullif(p_check->>'id','')::uuid;
  v_date date := nullif(p_check->>'check_date','')::date;
  v_fingerprint text := md5(jsonb_build_object('check',p_check,'items',p_items)::text);
  v_legacy_item_ids uuid[]:='{}';
begin
 if p_machine is not null and (p_actor_user is not null or p_actor_employee is not null or p_actor_kind<>'machine' or not feedx_integrations.restaurant_actor_outlet(p_machine,p_scope_outlet)) then raise exception using errcode='42501',message='Invalid Restaurant machine principal or outlet';end if;
  if p_request_id is null or v_outlet is null or v_outlet is distinct from p_scope_outlet or v_date is null then
    raise exception 'Request, outlet and stock check date are required.';
  end if;
  if v_type not in ('scheduled','audit') or v_status not in ('draft','submitted') then
    raise exception 'Invalid stock check type or status.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Stock check items are required.'; end if;
  if v_type = 'scheduled' then
    if v_group is null or not exists (select 1 from public.inventory_stock_check_groups where id=v_group and outlet_id=v_outlet) then
      raise exception 'Stock check group does not belong to this outlet.';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests
    where request_id=p_request_id and operation='stock_check'
      and (payload_fingerprint is null or payload_fingerprint=v_fingerprint);
  if found then return v_result; end if;
  if exists (select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then
    raise exception 'Request ID was already used for another or changed inventory action.';
  end if;
  if v_type='scheduled' and v_id is null then
    perform pg_advisory_xact_lock(hashtext('inventory_stock_check_run_'||v_group::text||v_date::text||coalesce(p_check->>'shift','')));
    if exists(select 1 from public.inventory_stock_checks where group_id=v_group and check_date=v_date
      and shift is not distinct from nullif(p_check->>'shift','')) then
      raise exception 'A stock check already exists for this scheduled run.';
    end if;
  end if;
  if v_id is not null then
    select * into v_existing from public.inventory_stock_checks where id=v_id for update;
    if not found then raise exception 'Stock check was not found.'; end if;
    if v_existing.status <> 'draft' then raise exception 'Completed stock checks are immutable.'; end if;
    if v_existing.outlet_id is distinct from v_outlet or v_existing.stock_check_type <> v_type then
      raise exception 'The stock check outlet and type cannot change.';
    end if;
    select coalesce(array_agg(distinct item_id),'{}') into v_legacy_item_ids
      from public.inventory_stock_check_items where stock_check_id=v_id and item_id is not null;
    delete from public.inventory_stock_check_items where stock_check_id=v_id;
    update public.inventory_stock_checks set group_id=case when v_type='audit' then null else v_group end,
      check_name=nullif(p_check->>'check_name',''), shift=nullif(p_check->>'shift',''), check_date=v_date,
      audit_type=case when v_type='audit' then nullif(p_check->>'audit_type','') else null end,
      audit_name=case when v_type='audit' then nullif(p_check->>'audit_name','') else null end,
      audit_category_ids=case when v_type='audit' then coalesce(array(select jsonb_array_elements_text(coalesce(p_check->'audit_category_ids','[]'::jsonb))::uuid),'{}') else '{}' end,
      notes=nullif(p_check->>'notes',''), updated_at=v_now
      where id=v_id returning * into v_check;
  else
    insert into public.inventory_stock_checks(outlet_id,group_id,stock_check_type,check_name,shift,check_date,
      audit_type,audit_name,audit_category_ids,notes,status,created_by,created_by_employee_id,created_at,updated_at)
    values(v_outlet,case when v_type='audit' then null else v_group end,v_type,
      nullif(p_check->>'check_name',''),nullif(p_check->>'shift',''),v_date,
      case when v_type='audit' then nullif(p_check->>'audit_type','') else null end,
      case when v_type='audit' then nullif(p_check->>'audit_name','') else null end,
      case when v_type='audit' then coalesce(array(select jsonb_array_elements_text(coalesce(p_check->'audit_category_ids','[]'::jsonb))::uuid),'{}') else '{}' end,
      nullif(p_check->>'notes',''),'draft',p_actor_user,p_actor_employee,v_now,v_now) returning * into v_check;
  end if;
  for v_row in select value from jsonb_array_elements(p_items) loop
    if nullif(v_row->>'item_id','') is null then raise exception 'Stock check item is required.'; end if;
    if not exists (select 1 from public.inventory_item_outlets where outlet_id=v_outlet and inventory_item_id=(v_row->>'item_id')::uuid)
      and not ((v_row->>'item_id')::uuid=any(v_legacy_item_ids)) then
      raise exception 'Stock check item does not belong to this outlet.';
    end if;
    insert into public.inventory_stock_check_items(stock_check_id,item_id,category_id,par_level_quantity,actual_count_quantity,
      variance,unit,status,notes,skipped,skip_reason,created_at,updated_at)
    values(v_check.id,(v_row->>'item_id')::uuid,nullif(v_row->>'category_id','')::uuid,nullif(v_row->>'par_level_quantity','')::numeric,
      case when coalesce((v_row->>'skipped')::boolean,false) or coalesce((v_row->>'actual_missing')::boolean,false) then null else nullif(v_row->>'actual_count_quantity','')::numeric end,
      case when coalesce((v_row->>'skipped')::boolean,false) or coalesce((v_row->>'na')::boolean,false) then null else coalesce(nullif(v_row->>'variance','')::numeric,0) end,
      nullif(v_row->>'unit',''),coalesce(nullif(v_row->>'status',''),'normal'),nullif(v_row->>'notes',''),
      coalesce((v_row->>'skipped')::boolean,false),case when coalesce((v_row->>'skipped')::boolean,false) then nullif(v_row->>'skip_reason','') else null end,v_now,v_now);
  end loop;
  if v_status='submitted' then
    update public.inventory_stock_checks set status='submitted',submitted_at=v_now,submitted_by=p_actor_employee,updated_at=v_now
      where id=v_check.id returning * into v_check;
    if v_type='scheduled' then
      update public.inventory_stock_check_groups set last_checked_at=v_now,updated_at=v_now where id=v_group;
    end if;
    insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_stock_check_completed','inventory',p_actor_user,'Stock check completed.',
      jsonb_build_object('stock_check_id',v_check.id,'outlet_id',v_outlet,'actor_kind',p_actor_kind,
        'actor_employee_id',p_actor_employee,'request_id',p_request_id));
  end if;
  v_result:=jsonb_build_object('check',to_jsonb(v_check),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at)
    from public.inventory_stock_check_items i where i.stock_check_id=v_check.id),'[]'::jsonb));
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint,actor_machine_id) values(p_request_id,'stock_check',p_actor_user,p_actor_employee,p_actor_kind,v_outlet,v_result,v_fingerprint,p_machine);
  return v_result;
end; $function$;

revoke all on function feedx_integrations.ra_save_stock_check(uuid,uuid,jsonb,jsonb,uuid,uuid,uuid,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION inventory_authority.save_stock_check(p_request_id uuid, p_check jsonb, p_items jsonb, p_scope_outlet uuid, p_actor_user uuid, p_actor_employee uuid, p_actor_kind text)
 RETURNS jsonb
 LANGUAGE sql SET search_path TO 'public','pg_temp'
AS $function$ select feedx_integrations.ra_save_stock_check(null::uuid,p_request_id,p_check,p_items,p_scope_outlet,p_actor_user,p_actor_employee,p_actor_kind); $function$;

do $$ begin if md5(pg_get_functiondef('inventory_authority.save_purchase_order(uuid,jsonb,jsonb,uuid,uuid,uuid,text)'::regprocedure))<>'d758c00c3e9c782285a6e0a209e12d84' then raise exception 'Restaurant authority preimage changed: inventory_authority.save_purchase_order(uuid,jsonb,jsonb,uuid,uuid,uuid,text)';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_save_purchase_order(p_machine uuid, p_request_id uuid, p_order jsonb, p_items jsonb, p_scope_outlet uuid, p_actor_user uuid, p_actor_employee uuid, p_actor_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare
  v_order public.inventory_purchase_orders%rowtype;
  v_existing public.inventory_purchase_orders%rowtype;
  v_check public.inventory_stock_checks%rowtype;
  v_item jsonb; v_result jsonb; v_now timestamptz:=now();
  v_id uuid:=nullif(p_order->>'id','')::uuid;
  v_outlet uuid:=nullif(p_order->>'outlet_id','')::uuid;
  v_supplier uuid:=nullif(p_order->>'supplier_id','')::uuid;
  v_source uuid:=nullif(p_order->>'source_stock_check_id','')::uuid;
  v_source_type text:=coalesce(nullif(p_order->>'source_type',''),'manual');
  v_fingerprint text:=md5(jsonb_build_object('order',p_order,'items',p_items)::text);
  v_source_item public.inventory_stock_check_items%rowtype;
  v_seen_source_items uuid[]:='{}';
begin
 if p_machine is not null and (p_actor_user is not null or p_actor_employee is not null or p_actor_kind<>'machine' or not feedx_integrations.restaurant_actor_outlet(p_machine,p_scope_outlet)) then raise exception using errcode='42501',message='Invalid Restaurant machine principal or outlet';end if;
  if p_request_id is null or v_outlet is null or v_outlet is distinct from p_scope_outlet or v_supplier is null then
    raise exception 'Request, outlet and supplier are required.';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Purchase order requires at least one item.';
  end if;
  if coalesce(nullif(p_order->>'status',''),'draft') <> 'draft' then raise exception 'Only Draft purchase orders can be saved.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='purchase_order'
    and (payload_fingerprint is null or payload_fingerprint=v_fingerprint);
  if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then
    raise exception 'Request ID was already used for another or changed inventory action.';
  end if;
  if v_id is not null then
    select * into v_existing from public.inventory_purchase_orders where id=v_id for update;
    if not found or v_existing.status <> 'draft' then raise exception 'Only Draft purchase orders can be edited.'; end if;
    if v_existing.outlet_id is distinct from v_outlet then raise exception 'Purchase order outlet cannot change.'; end if;
    if coalesce(v_existing.source_type,'manual') is distinct from v_source_type or v_existing.source_stock_check_id is distinct from v_source then
      raise exception 'Purchase order source cannot change.';
    end if;
  end if;
  if v_source_type='stock_check' then
    if v_source is null then raise exception 'Source stock check is required.'; end if;
    perform pg_advisory_xact_lock(hashtext('inventory_stock_check_po_'||v_source::text));
    select * into v_check from public.inventory_stock_checks where id=v_source;
    if not found or v_check.outlet_id is distinct from v_outlet or v_check.stock_check_type <> 'scheduled'
      or v_check.status <> 'submitted' then
      raise exception 'Only a completed scheduled stock check for this outlet can create purchase orders.';
    end if;
    if v_id is null and exists(select 1 from public.inventory_purchase_orders
      where source_type='stock_check' and source_stock_check_id=v_source and supplier_id=v_supplier and status<>'cancelled') then
      raise exception 'A purchase order already exists for this stock check and supplier.';
    end if;
  elsif v_source is not null then
    raise exception 'A source stock check requires stock_check source type.';
  end if;
  if not exists(select 1 from public.supplier_outlets where supplier_id=v_supplier and outlet_id=v_outlet) then
    raise exception 'Supplier is not assigned to this outlet.';
  end if;
  if (v_id is null or v_supplier is distinct from v_existing.supplier_id)
    and not exists(select 1 from public.suppliers where id=v_supplier and status='active') then
    raise exception 'Supplier is not active.';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(v_item->>'item_id','') is null or coalesce(nullif(v_item->>'requested_qty','')::numeric,0)<=0 then
      raise exception 'Purchase order items require an item and positive quantity.';
    end if;
    if not exists(select 1 from public.inventory_item_outlets where outlet_id=v_outlet
      and inventory_item_id=(v_item->>'item_id')::uuid) then
      raise exception 'Purchase order item does not belong to this outlet.';
    end if;
    if v_source_type='stock_check' then
      select * into v_source_item from public.inventory_stock_check_items
        where id=nullif(v_item->>'source_stock_check_item_id','')::uuid and stock_check_id=v_source;
      if not found or v_source_item.item_id is distinct from (v_item->>'item_id')::uuid
        or v_source_item.skipped or v_source_item.actual_count_quantity is null
        or v_source_item.par_level_quantity is null
        or v_source_item.par_level_quantity <= v_source_item.actual_count_quantity then
        raise exception 'Purchase order line is not an eligible stock check shortage.';
      end if;
      if v_source_item.id=any(v_seen_source_items) then raise exception 'A stock check item cannot appear twice in a purchase order.'; end if;
      v_seen_source_items:=array_append(v_seen_source_items,v_source_item.id);
      if not exists(select 1 from public.inventory_item_outlet_suppliers ios
        join public.inventory_item_outlets iio on iio.id=ios.inventory_item_outlet_id
        where iio.outlet_id=v_outlet and iio.inventory_item_id=v_source_item.item_id and ios.supplier_id=v_supplier) then
        raise exception 'Supplier is not assigned to this stock check item.';
      end if;
      if exists(select 1 from public.inventory_purchase_order_items line
        join public.inventory_purchase_orders po on po.id=line.purchase_order_id
        where line.source_stock_check_item_id=v_source_item.id and po.status<>'cancelled'
          and (v_id is null or po.id<>v_id)) then
        raise exception 'A purchase order already exists for this stock check item.';
      end if;
    elsif nullif(v_item->>'source_stock_check_item_id','') is not null then
      raise exception 'Manual purchase orders cannot reference stock check items.';
    end if;
  end loop;
  if v_id is not null then
    update public.inventory_purchase_orders set supplier_id=v_supplier,updated_at=v_now where id=v_id returning * into v_order;
    delete from public.inventory_purchase_order_items where purchase_order_id=v_id;
  else
    insert into public.inventory_purchase_orders(po_no,outlet_id,supplier_id,status,source_type,source_stock_check_id,
      created_by,created_by_employee_id,created_at,updated_at)
    values(nullif(p_order->>'po_no',''),v_outlet,v_supplier,'draft',v_source_type,v_source,p_actor_user,p_actor_employee,v_now,v_now)
    returning * into v_order;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.inventory_purchase_order_items(purchase_order_id,item_id,requested_qty,received_qty,unit,remark,
      source_stock_check_item_id,created_at,updated_at)
    values(v_order.id,(v_item->>'item_id')::uuid,(v_item->>'requested_qty')::numeric,0,
      nullif(v_item->>'unit',''),nullif(v_item->>'remark',''),
      nullif(v_item->>'source_stock_check_item_id','')::uuid,v_now,v_now);
  end loop;
  v_result:=jsonb_build_object('order',to_jsonb(v_order),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at)
    from public.inventory_purchase_order_items i where i.purchase_order_id=v_order.id),'[]'::jsonb));
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint,actor_machine_id) values(p_request_id,'purchase_order',p_actor_user,p_actor_employee,p_actor_kind,v_outlet,v_result,v_fingerprint,p_machine);
  if v_id is null then
    insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_purchase_order_draft_created','inventory',p_actor_user,'Purchase order draft created.',
      jsonb_build_object('purchase_order_id',v_order.id,'outlet_id',v_outlet,'actor_kind',p_actor_kind,
        'actor_employee_id',p_actor_employee,'request_id',p_request_id));
  end if;
  return v_result;
end; $function$;

revoke all on function feedx_integrations.ra_save_purchase_order(uuid,uuid,jsonb,jsonb,uuid,uuid,uuid,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION inventory_authority.save_purchase_order(p_request_id uuid, p_order jsonb, p_items jsonb, p_scope_outlet uuid, p_actor_user uuid, p_actor_employee uuid, p_actor_kind text)
 RETURNS jsonb
 LANGUAGE sql SET search_path TO 'public','pg_temp'
AS $function$ select feedx_integrations.ra_save_purchase_order(null::uuid,p_request_id,p_order,p_items,p_scope_outlet,p_actor_user,p_actor_employee,p_actor_kind); $function$;

do $$ begin if md5(pg_get_functiondef('inventory_authority.transition_purchase_order(uuid,uuid,text,text,uuid,uuid,uuid,text)'::regprocedure))<>'4bf72024e568e4b5aafba50906019b95' then raise exception 'Restaurant authority preimage changed: inventory_authority.transition_purchase_order(uuid,uuid,text,text,uuid,uuid,uuid,text)';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_transition_purchase_order(p_machine uuid, p_order_id uuid, p_request_id uuid, p_action text, p_reason text, p_scope_outlet uuid, p_actor_user uuid, p_actor_employee uuid, p_actor_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare v_order public.inventory_purchase_orders%rowtype; v_result jsonb; v_now timestamptz:=now();
  v_remaining numeric; v_previous_status text; v_previous_submitted_at timestamptz;
  v_fingerprint text:=md5(jsonb_build_object('order_id',p_order_id,'action',p_action,'reason',coalesce(p_reason,''))::text);
begin
 if p_machine is not null and (p_actor_user is not null or p_actor_employee is not null or p_actor_kind<>'machine' or not feedx_integrations.restaurant_actor_outlet(p_machine,p_scope_outlet)) then raise exception using errcode='42501',message='Invalid Restaurant machine principal or outlet';end if;
  if p_order_id is null or p_request_id is null or p_action not in ('submit','confirm','cancel','complete','reopen_draft') then
    raise exception 'Purchase order, request and valid action are required.';
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id
    and operation='purchase_order_transition' and payload_fingerprint=v_fingerprint;
  if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then
    raise exception 'Request ID was already used for another or changed inventory action.';
  end if;
  select * into v_order from public.inventory_purchase_orders where id=p_order_id for update;
  if not found then raise exception 'Purchase order was not found.'; end if;
  if v_order.outlet_id is distinct from p_scope_outlet then
    raise exception using errcode='42501',message='Purchase order outlet is not authorized.';
  end if;
  v_previous_status:=v_order.status;
  v_previous_submitted_at:=v_order.submitted_at;
  if p_action='submit' then
    if v_order.status<>'draft' then raise exception 'Only Draft purchase orders can be submitted.'; end if;
    if not exists(select 1 from public.inventory_purchase_order_items where purchase_order_id=p_order_id) then
      raise exception 'Purchase order requires items before submission.';
    end if;
    update public.inventory_purchase_orders set status='submitted',submitted_at=v_now,updated_at=v_now
      where id=p_order_id returning * into v_order;
  elsif p_action='reopen_draft' then
    if v_order.status<>'submitted' then raise exception 'Only unconfirmed Submitted purchase orders can return to Draft.'; end if;
    if v_order.confirmed_at is not null or exists(select 1 from public.inventory_purchase_receipts where purchase_order_id=p_order_id)
      or exists(select 1 from public.inventory_purchase_order_items where purchase_order_id=p_order_id and received_qty>0) then
      raise exception 'Purchase order cannot return to Draft after supplier confirmation or receiving.';
    end if;
    update public.inventory_purchase_orders set status='draft',submitted_at=null,updated_at=v_now
      where id=p_order_id returning * into v_order;
  elsif p_action='confirm' then
    if v_order.status<>'submitted' then raise exception 'Only Submitted purchase orders can be supplier confirmed.'; end if;
    update public.inventory_purchase_orders set status='supplier_confirmed',confirmed_at=v_now,updated_at=v_now
      where id=p_order_id returning * into v_order;
  elsif p_action='cancel' then
    if v_order.status not in ('draft','submitted','supplier_confirmed') then raise exception 'Purchase order cannot be cancelled in this state.'; end if;
    if exists(select 1 from public.inventory_purchase_receipts where purchase_order_id=p_order_id)
      or exists(select 1 from public.inventory_purchase_order_items where purchase_order_id=p_order_id and received_qty>0) then
      raise exception 'PO cannot be cancelled after receiving has started.';
    end if;
    update public.inventory_purchase_orders set status='cancelled',cancelled_at=v_now,
      cancellation_reason=nullif(btrim(p_reason),''),updated_at=v_now where id=p_order_id returning * into v_order;
  else
    if v_order.status not in ('partial_received','fully_received') then
      raise exception 'Only received purchase orders can be completed.';
    end if;
    select coalesce(sum(greatest(requested_qty-received_qty,0)),0) into v_remaining
      from public.inventory_purchase_order_items where purchase_order_id=p_order_id;
    if v_remaining>0 and nullif(btrim(p_reason),'') is null then
      raise exception 'Completion reason is required for partially fulfilled POs.';
    end if;
    update public.inventory_purchase_orders set status='completed',completed_at=v_now,
      completion_type=case when v_remaining>0 then 'partial' else 'full' end,
      completion_reason=nullif(btrim(p_reason),''),unfulfilled_qty=v_remaining,updated_at=v_now
      where id=p_order_id returning * into v_order;
  end if;
  v_result:=jsonb_build_object('order',to_jsonb(v_order));
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint,actor_machine_id) values(p_request_id,'purchase_order_transition',p_actor_user,p_actor_employee,p_actor_kind,p_scope_outlet,v_result,v_fingerprint,p_machine);
  insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_purchase_order_'||p_action,'inventory',p_actor_user,'Purchase order '||p_action||' recorded.',
      jsonb_build_object('purchase_order_id',p_order_id,'outlet_id',p_scope_outlet,'actor_kind',p_actor_kind,
        'actor_employee_id',p_actor_employee,'request_id',p_request_id,'previous_status',v_previous_status,
        'previous_submitted_at',v_previous_submitted_at,'status',v_order.status,'reason',nullif(btrim(p_reason),'')));
  return v_result;
end; $function$;

revoke all on function feedx_integrations.ra_transition_purchase_order(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION inventory_authority.transition_purchase_order(p_order_id uuid, p_request_id uuid, p_action text, p_reason text, p_scope_outlet uuid, p_actor_user uuid, p_actor_employee uuid, p_actor_kind text)
 RETURNS jsonb
 LANGUAGE sql SET search_path TO 'public','pg_temp'
AS $function$ select feedx_integrations.ra_transition_purchase_order(null::uuid,p_order_id,p_request_id,p_action,p_reason,p_scope_outlet,p_actor_user,p_actor_employee,p_actor_kind); $function$;

do $$ begin if md5(pg_get_functiondef('inventory_authority.receive_purchase_order(uuid,uuid,text,jsonb,uuid,uuid,uuid,text)'::regprocedure))<>'1dbf1831bc584818b3bace923865359b' then raise exception 'Restaurant authority preimage changed: inventory_authority.receive_purchase_order(uuid,uuid,text,jsonb,uuid,uuid,uuid,text)';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_receive_purchase_order(p_machine uuid, p_purchase_order_id uuid, p_request_id uuid, p_remark text, p_items jsonb, p_scope_outlet uuid, p_actor_user uuid, p_actor_employee uuid, p_actor_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare
  v_order public.inventory_purchase_orders%rowtype;
  v_line public.inventory_purchase_order_items%rowtype;
  v_item jsonb; v_receipt public.inventory_purchase_receipts%rowtype;
  v_qty numeric; v_now timestamptz:=now(); v_status text; v_result jsonb;
  v_fingerprint text:=md5(jsonb_build_object('order_id',p_purchase_order_id,'remark',p_remark,'items',p_items)::text);
begin
 if p_machine is not null and (p_actor_user is not null or p_actor_employee is not null or p_actor_kind<>'machine' or not feedx_integrations.restaurant_actor_outlet(p_machine,p_scope_outlet)) then raise exception using errcode='42501',message='Invalid Restaurant machine principal or outlet';end if;
  if p_request_id is null or p_purchase_order_id is null then raise exception 'Purchase order and request ID are required.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id
    and operation='purchase_receipt' and (payload_fingerprint is null or payload_fingerprint=v_fingerprint);
  if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then
    raise exception 'Request ID was already used for another or changed inventory action.';
  end if;
  select * into v_order from public.inventory_purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase order was not found.'; end if;
  if v_order.outlet_id is distinct from p_scope_outlet then
    raise exception using errcode='42501',message='Purchase order outlet is not authorized.';
  end if;
  if v_order.status not in ('submitted','supplier_confirmed','partial_received') then
    raise exception 'Purchase order is not open for receiving.';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Enter received quantity for at least one item.';
  end if;
  insert into public.inventory_purchase_receipts(purchase_order_id,outlet_id,supplier_id,received_by,
    received_by_employee_id,received_at,remark,created_at)
  values(v_order.id,v_order.outlet_id,v_order.supplier_id,p_actor_user,p_actor_employee,v_now,nullif(btrim(p_remark),''),v_now)
  returning * into v_receipt;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty:=nullif(v_item->>'received_qty','')::numeric;
    if v_qty is null or v_qty<=0 then raise exception 'Received quantity must be greater than zero.'; end if;
    select * into v_line from public.inventory_purchase_order_items
      where id=(v_item->>'purchase_order_item_id')::uuid and purchase_order_id=v_order.id for update;
    if not found or v_line.item_id is distinct from (v_item->>'item_id')::uuid then
      raise exception 'Receipt item does not belong to this purchase order.';
    end if;
    if v_qty>v_line.requested_qty-v_line.received_qty then raise exception 'Receive quantity cannot exceed remaining quantity.'; end if;
    insert into public.inventory_purchase_receipt_items(receipt_id,purchase_order_item_id,item_id,received_qty,unit,remark,created_at)
    values(v_receipt.id,v_line.id,v_line.item_id,v_qty,coalesce(nullif(v_item->>'unit',''),v_line.unit),
      nullif(v_item->>'remark',''),v_now);
    update public.inventory_purchase_order_items set received_qty=received_qty+v_qty,updated_at=v_now where id=v_line.id;
    insert into public.inventory_movements(outlet_id,inventory_item_id,movement_type,quantity,unit,reference_type,
      reference_id,reference_no,notes,created_by,created_by_employee_id,created_at)
    values(v_order.outlet_id,v_line.item_id,'Purchase',v_qty,coalesce(nullif(v_item->>'unit',''),v_line.unit),
      'purchase_order',v_order.id,v_order.po_no,
      coalesce(nullif(v_item->>'remark',''),nullif(btrim(p_remark),''),'Purchase receive'),
      p_actor_user,p_actor_employee,v_now);
  end loop;
  select case when bool_and(received_qty>=requested_qty) then 'fully_received' else 'partial_received' end
    into v_status from public.inventory_purchase_order_items where purchase_order_id=v_order.id;
  update public.inventory_purchase_orders set status=v_status,updated_at=v_now where id=v_order.id returning * into v_order;
  v_result:=jsonb_build_object('receipt_id',v_receipt.id,'purchase_order_id',v_order.id,'status',v_order.status);
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint,actor_machine_id) values(p_request_id,'purchase_receipt',p_actor_user,p_actor_employee,p_actor_kind,v_order.outlet_id,v_result,v_fingerprint,p_machine);
  insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_purchase_order_received','inventory',p_actor_user,'Purchase order receipt recorded.',
      jsonb_build_object('purchase_order_id',v_order.id,'receipt_id',v_receipt.id,'outlet_id',v_order.outlet_id,
        'actor_kind',p_actor_kind,'actor_employee_id',p_actor_employee,'request_id',p_request_id,'status',v_status));
  return v_result;
end; $function$;

revoke all on function feedx_integrations.ra_receive_purchase_order(uuid,uuid,uuid,text,jsonb,uuid,uuid,uuid,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION inventory_authority.receive_purchase_order(p_purchase_order_id uuid, p_request_id uuid, p_remark text, p_items jsonb, p_scope_outlet uuid, p_actor_user uuid, p_actor_employee uuid, p_actor_kind text)
 RETURNS jsonb
 LANGUAGE sql SET search_path TO 'public','pg_temp'
AS $function$ select feedx_integrations.ra_receive_purchase_order(null::uuid,p_purchase_order_id,p_request_id,p_remark,p_items,p_scope_outlet,p_actor_user,p_actor_employee,p_actor_kind); $function$;

notify pgrst,'reload schema';
