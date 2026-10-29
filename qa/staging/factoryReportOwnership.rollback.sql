-- Disposable security metadata; preserve all business records and existing agent grants.
begin;
do $$declare role_id uuid;machine_id uuid;token text:='fxm_'||repeat('O',43);resource text;data jsonb;begin
 insert into public.roles(name,is_active,is_system_role,outlet_access_type) values('Report owner rollback '||gen_random_uuid(),true,false,'none') returning id into role_id;
 insert into public.role_permissions(role_id,permission_id) select role_id,id from public.permissions where code in ('factory_mesti_inspection.view','factory_agent_nav_factory_job_orders.view');
 insert into feedx_integrations.machine_identities(name,role_id,enabled,adapter_key) values('Report owner rollback',role_id,true,'factory_mesti') returning id into machine_id;
 insert into feedx_integrations.machine_credentials(identity_id,token_hash,created_at,expires_at) values(machine_id,encode(extensions.digest(token,'sha256'),'hex'),statement_timestamp(),now()+interval '1 day');
 foreach resource in array array['production_records','material_usage','product_movements','receiving_costs'] loop
  begin perform public.factory_agent_resource_query(token,jsonb_build_array(jsonb_build_object('business_module','factory_job_orders','resource',resource,'action','list','date_range',jsonb_build_object('from','2026-10-23','to','2026-10-29'))));raise exception 'Source grant bypassed: %',resource;exception when insufficient_privilege then null;end;
 end loop;
 insert into public.role_permissions(role_id,permission_id) select role_id,id from public.permissions where code in ('factory_agent_nav_factory_production.view','factory_agent_nav_factory_product_movements.view','factory_agent_nav_factory_raw_receiving.view');
 foreach resource in array array['production_records','material_usage','product_movements','receiving_costs'] loop
  data:=public.factory_agent_resource_query(token,jsonb_build_array(jsonb_build_object('business_module','factory_job_orders','resource',resource,'action','list','date_range',jsonb_build_object('from','2026-10-23','to','2026-10-29'))));
  if data->'results'->0->>'business_module'<>'factory_job_orders' then raise exception 'Wrong report owner';end if;
 end loop;
 begin perform public.factory_agent_resource_query(token,'[{"business_module":"factory_production_reports","resource":"production_records","action":"list","date_range":{"from":"2026-10-23","to":"2026-10-29"}}]');raise exception 'Retired permission module accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
select 'PASS: four reporting resources require their sources, work under Overview with authorized sources, and reject the retired module' result;
