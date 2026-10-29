-- Read correctness and privacy only; no business fixtures or writes.
begin;
do $qa$
declare owner_id uuid;res jsonb;agent uuid;token text;data jsonb;r jsonb;source jsonb;before jsonb;mid text;resources text;expected integer;resource_name text;
begin
 select e.auth_user_id into strict owner_id from public.employees e join public.roles ro on ro.id=e.role_id where lower(ro.name)='owner' and e.auth_user_id is not null and e.enable_system_login and e.access_state='active' limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);execute 'set local role authenticated';
 res:=public.external_agents_register(gen_random_uuid(),'MeSTI alignment QA '||gen_random_uuid(),'Rollback QA','factory_mesti',array['nav_factory_mesti_raw_material_control_view','nav_factory_mesti_cleaning_view','nav_factory_mesti_equipment_cleaning_view']);agent:=(res->>'identity_id')::uuid;token:=res->>'one_time_credential';
 execute 'set local role postgres';update feedx_integrations.machine_credentials set created_at=statement_timestamp() where identity_id=agent;
 execute 'set local role anon';
 data:=public.factory_agent_resource_query(token,'[{"business_module":"factory_mesti_raw_material_control","resource":"raw_control_standards","action":"list","date_range":{"from":"2026-10-01","to":"2026-10-31"},"limit":100}]')->'results'->0;
 execute 'set local role postgres';select count(*) into expected from public.factory_raw_materials where lower(coalesce(status,''))='active';
 if (data->>'returned')::integer<>expected or exists(select 1 from jsonb_array_elements(data->'items')item where item ?|array['manual_unit_cost','current_balance']) then raise exception 'Canonical active standard coverage/redaction mismatch';end if;
 execute 'set local role anon';
 data:=public.factory_agent_resource_query(token,'[{"business_module":"factory_mesti_raw_material_control","resource":"raw_control_receipts","action":"list","date_range":{"from":"2026-10-01","to":"2026-10-31"},"limit":100}]')->'results'->0;
 execute 'set local role postgres';source:=feedx_integrations.factory_mesti_raw_material_control_receiving_report_core('2026-10-01','2026-10-31',null,null,null,null,null,token);
 if (data->>'returned')::integer<>jsonb_array_length(source) then raise exception 'Canonical completed Receiving evidence count mismatch';end if;
 if exists(select 1 from jsonb_array_elements(data->'items')item where item->>'status'<>'completed' or item ?|array['unit_cost','received_by_name','verified_by_name']) then raise exception 'Receiving state or cross-module privacy mismatch';end if;
 foreach mid in array array['factory_mesti_cleaning','factory_mesti_equipment_cleaning'] loop
 foreach resource_name in array array['requirements','occurrences','evidence'] loop
  execute 'set local role anon';
  data:=public.factory_agent_resource_query(token,jsonb_build_array(jsonb_build_object('business_module',mid,'resource',resource_name,'action','list','date_range',jsonb_build_object('from','2026-10-01','to','2026-10-31'),'limit',100)))->'results'->0;
  execute 'set local role postgres';
  for r in select value from jsonb_array_elements(data->'items') loop
   if resource_name='requirements' then
    if mid='factory_mesti_cleaning' then select jsonb_build_object('cleaning_method',q.cleaning_method) into source from public.factory_mesti_cleaning_requirements q where q.id::text=r->>'requirement_id';else select jsonb_build_object('cleaning_method',q.cleaning_method) into source from public.factory_mesti_equipment_cleaning_requirements q where q.id::text=r->>'requirement_id';end if;
   else
    if mid='factory_mesti_cleaning' then select requirement_snapshot into source from public.factory_mesti_cleaning_occurrences where id::text=r->>'record_id';else select requirement_snapshot into source from public.factory_mesti_equipment_cleaning_occurrences where id::text=r->>'record_id';end if;
   end if;
   if r->>'cleaning_method' is distinct from source->>'cleaning_method' or r->>'method_basis' is distinct from (case when resource_name='requirements' then 'versioned_requirement' else 'issued_snapshot' end) then raise exception 'Issued method snapshot was replaced with current setup';end if;
   if source->>'cleaning_method' is null and r->>'method_availability'<>'unavailable' then raise exception 'Legacy missing method was invented';end if;
   if r ?|array['completed_by_name','verified_by_name'] then raise exception 'Cleaning leaked foreign identity';end if;
  end loop;
 end loop;
 end loop;
 r:=feedx_integrations.navigation_cleaning_method('cleaning','{"code":"cleaning","steps":["Rinse"],"actor_name":"PRIVATE","unknown":{"secret":"PRIVATE"}}');
 if r->'cleaning_method_reference' ?|array['actor_name','unknown'] or r->'cleaning_method_reference'->'steps'<>'["Rinse"]' then raise exception 'Nested Cleaning Method allowlist failed';end if;
 execute 'set local role anon';
 begin perform public.factory_agent_resource_query(token,'[{"business_module":"factory_raw_receiving","resource":"receiving_costs","action":"list","date_range":{"from":"2026-10-01","to":"2026-10-31"}}]');raise exception 'MeSTI grant exposed Receiving domain';exception when insufficient_privilege then null;end;
 execute 'set local role postgres';
end $qa$;
select 'PASS' as canonical_mesti_source_method_provenance_and_privacy;
rollback;
