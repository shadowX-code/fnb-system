-- Disposable clone only; all role, grant, request and audit writes roll back.
begin;
do $test$
declare actor uuid; source uuid; target uuid:=gen_random_uuid(); before_codes text[]; actual text[]; payload jsonb; response jsonb; request_id uuid:=gen_random_uuid();
begin
 select e.auth_user_id into actor from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null limit 1;
 select role_id into source from feedx_integrations.machine_identities order by id limit 1;
 if actor is null or source is null then raise exception 'Existing Owner and labelled agent fixture required';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 insert into public.roles(id,name,description,is_system_role,is_active,outlet_access_type) values(target,'qa_rollback_hidden_'||replace(target::text,'-',''),'Rollback hidden agent grants',false,true,'none');
 insert into public.role_permissions select target,permission_id from public.role_permissions where role_id=source;
 select array_agg(p.code order by p.code) into before_codes from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=target;
 if not exists(select 1 from unnest(before_codes) code where code like 'factory_agent_nav_%') then raise exception 'Fixture has no navigation grant';end if;
 payload:=jsonb_build_object('id',target,'name','qa_rollback_hidden_'||replace(target::text,'-',''),'description','Metadata correction','permission_changes','[]'::jsonb,'preserve_outlet_scope',true);
 response:=public.save_role_configuration(gen_random_uuid(),payload,'{}','{}');
 select array_agg(c order by c) into actual from jsonb_array_elements_text(response->'permissions') c;
 if actual is distinct from before_codes then raise exception 'Metadata save changed hidden grants';end if;
 payload:=payload||jsonb_build_object('permission_changes',jsonb_build_array(jsonb_build_object('code','factory_dashboard.view','before',false,'enabled',true)));
 response:=public.save_role_configuration(request_id,payload,'{}','{}');
 if public.save_role_configuration(request_id,payload,'{}','{}') is distinct from response then raise exception 'Retry changed authority result';end if;
 if jsonb_array_length(response->'permissions')<>cardinality(before_codes)+1 then raise exception 'One human change affected other grants';end if;
 payload:=payload||jsonb_build_object('permission_changes',jsonb_build_array(jsonb_build_object('code','factory_dashboard.view','before',true,'enabled',false)));
 response:=public.save_role_configuration(gen_random_uuid(),payload,'{}','{}');
 select array_agg(c order by c) into actual from jsonb_array_elements_text(response->'permissions') c;
 if actual is distinct from before_codes then raise exception 'Explicit human revocation changed hidden grants';end if;
end $test$;
rollback;
