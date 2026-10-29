begin;
do $qa$
declare v_owner uuid;v_result jsonb;v_machine uuid;v_data jsonb;v_request uuid:=gen_random_uuid();
begin
 select e.auth_user_id into strict v_owner from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null and e.enable_system_login and e.access_state='active' limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 begin insert into public.audit_logs(action,module,user_id,description,metadata) values('external_agent_capability_granted','access-control',v_owner,'Forged gateway event','{}');raise exception 'Forged gateway event accepted.';exception when insufficient_privilege then null;end;
 begin insert into public.audit_logs(action,module,user_id,description,metadata,trusted_external_agent) values('ordinary_qa_event','system',v_owner,'Forged provenance','{}',true);raise exception 'Forged provenance accepted.';exception when insufficient_privilege then null;end;
 -- These real RPC writes ensure the guard preserves the complete supported workflow.
 v_result:=public.external_agents_register(v_request,'Audit fixture '||v_request,'QA','factory_mesti',array['nav_factory_mesti_cleaning_view']);v_machine:=(v_result->>'identity_id')::uuid;
 perform public.external_agents_set_capability(v_machine,'nav_factory_mesti_cleaning_view',false,true);
 perform public.external_agents_set_enabled(v_machine,false,true);
 v_data:=public.external_agents_admin_data(v_machine);
 if jsonb_array_length(v_data->'management_events')<4 then raise exception 'Trusted workflow history missing.';end if;
 execute 'set local role postgres';
 if (select count(*) from public.audit_logs where trusted_external_agent and user_id=v_owner and (metadata->>'identity_id'=v_machine::text or metadata->'after'->>'identity_id'=v_machine::text or metadata->'after'->>'id'=v_machine::text))<4 then raise exception 'Trusted provenance or canonical actor missing.';end if;
end $qa$;
rollback;
select 'PASS: forged Gateway events and provenance denied; real registration/key/grant/disable audit remains visible, with canonical actor and server-controlled provenance' as result;
