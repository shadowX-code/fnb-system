-- Trusted, atomic Asset Tracking maintenance and per-row import lifecycle mutations.

alter table public.asset_lifecycle_requests
  drop constraint if exists asset_lifecycle_requests_operation_check;
alter table public.asset_lifecycle_requests
  add constraint asset_lifecycle_requests_operation_check
  check (operation in ('quantity_adjustment', 'inspection_submission', 'maintenance_save', 'import_row'));

create or replace function public.asset_save_maintenance(
  p_request_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
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
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if not public.current_user_has_permission('asset_tracking.manage') then raise exception using errcode = '42501', message = 'Missing permission to save asset maintenance.'; end if;
  if p_request_id is null or v_asset_id is null or v_outlet_id is null then raise exception 'Request, asset and outlet are required.'; end if;
  if v_status not in ('scheduled','in_progress','completed') then raise exception 'Invalid maintenance status.'; end if;
  if v_condition is not null and v_condition not in ('healthy','needs_attention','under_maintenance','low_quantity','damaged','missing','disposed') then raise exception 'Invalid asset condition.'; end if;
  if not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode = '42501', message = 'You cannot save maintenance for this outlet.'; end if;

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
  insert into public.asset_lifecycle_requests(request_id,operation,actor_id,outlet_id,result) values(p_request_id,'maintenance_save',v_actor,v_outlet_id,v_result);
  return v_result;
end; $$;

create or replace function public.asset_import_row(
  p_request_id uuid,
  p_asset jsonb,
  p_action text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid(); v_asset public.asset_items%rowtype; v_movement public.asset_movement_logs%rowtype; v_result jsonb;
  v_asset_id uuid := nullif(p_asset->>'id','')::uuid; v_outlet_id uuid := nullif(p_asset->>'outlet_id','')::uuid; v_action text := lower(coalesce(nullif(btrim(p_action),''),'create'));
  v_before numeric := 0; v_after numeric := coalesce(nullif(p_asset->>'current_quantity','')::numeric,0); v_now timestamptz := now();
begin
  if v_actor is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  if p_request_id is null or v_outlet_id is null or nullif(btrim(p_asset->>'category_id'),'') is null or nullif(btrim(p_asset->>'name'),'') is null then raise exception 'Request, outlet, category and asset name are required.'; end if;
  if v_action not in ('create','update') then raise exception 'Invalid import action.'; end if;
  if v_after < 0 then raise exception 'Asset quantity cannot be below 0.'; end if;
  if not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode='42501', message='You cannot import assets for this outlet.'; end if;
  if (v_action='create' and not public.current_user_has_permission('asset_tracking.create')) or (v_action='update' and not public.current_user_has_permission('asset_tracking.edit')) then raise exception using errcode='42501', message='Missing permission to import this asset row.'; end if;
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
  insert into public.asset_lifecycle_requests(request_id,operation,actor_id,outlet_id,result) values(p_request_id,'import_row',v_actor,v_outlet_id,v_result);
  return v_result;
end; $$;

revoke all on function public.asset_save_maintenance(uuid,jsonb) from public, anon;
revoke all on function public.asset_import_row(uuid,jsonb,text) from public, anon;
grant execute on function public.asset_save_maintenance(uuid,jsonb) to authenticated;
grant execute on function public.asset_import_row(uuid,jsonb,text) to authenticated;
