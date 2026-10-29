-- Security-only fixtures; every identity, credential, grant and audit event rolls back. No business records change.
begin;
do $$declare owner_id uuid;n record;b record;fixture jsonb;token text;data jsonb;item jsonb;ctx jsonb;ref jsonb;source jsonb;f text;checked integer:=0;denied integer:=0;visible integer:=0;begin
 if (select count(*) from feedx_integrations.navigation_resources)<>97 then raise exception 'Mapping inventory drift';end if;
 if exists(select 1 from feedx_integrations.navigation_resources where relationship_modules<>'{}') then raise exception 'Unclassified contextual dependency';end if;
 select e.auth_user_id into owner_id from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null limit 1;
 for n in select m.id,c.tool_id from feedx_integrations.navigation_modules m join feedx_integrations.capabilities c on c.navigation_module_id=m.id where c.implemented loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);execute 'set local role authenticated';
  fixture:=public.external_agents_register(gen_random_uuid(),'Standalone read rollback '||gen_random_uuid(),'QA','factory_mesti',array[n.tool_id],90);token:=fixture->>'one_time_credential';
  execute 'set local role postgres';update feedx_integrations.machine_credentials set created_at=statement_timestamp() where identity_id=(fixture->>'identity_id')::uuid;
  for b in select nr.*,r.slug from feedx_integrations.navigation_resources nr join feedx_integrations.resources r on r.key=nr.resource_key where nr.module_id=n.id loop
   execute 'set local role anon';
   if exists(select 1 from jsonb_array_elements_text(b.required_modules) dep where dep<>n.id) then
    begin perform public.factory_agent_resource_query(token,jsonb_build_array(jsonb_build_object('business_module',n.id,'resource',b.slug,'action','list','limit',100,'date_range',jsonb_build_object('from','2026-10-23','to','2026-10-29'))));raise exception 'Independent data leaked: %/%',n.id,b.slug;exception when insufficient_privilege then denied:=denied+1;end;
   else
    data:=public.factory_agent_resource_query(token,jsonb_build_array(jsonb_build_object('business_module',n.id,'resource',b.slug,'action','list','limit',100,'date_range',jsonb_build_object('from','2026-10-23','to','2026-10-29'))))->'results'->0;
    execute 'set local role postgres';
    for item in select value from jsonb_array_elements(data->'items') loop
     visible:=visible+1;
     if item ?|array['operator_name','employee_name','completed_by_name','verified_by_name','token','notes','remarks','contacts','password'] then raise exception 'Sensitive field leak: %/%',n.id,b.slug;end if;
     if b.row_scope ? 'module' and item->>'module' is distinct from b.row_scope->>'module' then raise exception 'Shared module leak';end if;
     for ctx in select value from jsonb_each(coalesce(item->'reference_context','{}')) where key<>'limitation' loop
      for ref in select ctx where jsonb_typeof(ctx)='object' union all select value from jsonb_array_elements(case when jsonb_typeof(ctx)='array' then ctx else '[]' end) loop
       if exists(select 1 from jsonb_object_keys(ref) key where key not in ('id','label','status','basis','availability')) then raise exception 'Context exposed independent fields';end if;
      end loop;
     end loop;
    end loop;
    -- Compare contextual scalar fields with the owning saved projection, without expanding related records.
    for source in select v from feedx_integrations.navigation_source_rows(token,n.id,b.slug,'2026-10-23','2026-10-29')v limit 100 loop
     item:=feedx_integrations.navigation_project_row(token,n.id,b.slug,source);
     for f in select key from jsonb_object_keys(b.context_fields)key where b.allowed_fields ? key loop
      if source ? f and item->f is distinct from source->f then raise exception 'Canonical context changed: %/%/%',n.id,b.slug,f;end if;
     end loop;
    end loop;
   end if;
   checked:=checked+1;
  end loop;
  execute 'set local role anon';
  begin perform public.factory_agent_resource_query(token,jsonb_build_array(jsonb_build_object('business_module',case when n.id='factory_storage_locations' then 'factory_equipment' else 'factory_storage_locations' end,'resource',case when n.id='factory_storage_locations' then 'equipment' else 'locations' end,'action','list','date_range',jsonb_build_object('from','2026-10-23','to','2026-10-29'))));raise exception 'Standalone grant expanded another module';exception when insufficient_privilege then null;end;
  execute 'set local role postgres';
 end loop;
 if checked<>97 or denied<>9 then raise exception 'Incomplete mapping audit % / %',checked,denied;end if;
 raise notice 'PASS: % mappings; % sensitive composite/source queries denied; % actual rows inspected',checked,denied,visible;
end $$;
rollback;
select 'PASS: all 97 standalone mapping contracts, 9 independent-source denials, canonical context comparison, shared scopes and field redaction' result;
