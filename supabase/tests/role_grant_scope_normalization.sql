begin;
do $test$ declare actor uuid; target uuid:=gen_random_uuid(); outlet uuid; result jsonb;
begin
 select e.auth_user_id into actor from public.employees e join public.roles r on r.id=e.role_id where r.name='owner' and e.auth_user_id is not null limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 select id into outlet from public.outlets limit 1;
 insert into public.roles(id,name,is_system_role,is_active,outlet_access_type) values(target,'qa_scope_'||replace(target::text,'-',''),false,true,'selected');
 insert into public.role_permissions select target,id from public.permissions where code in ('dashboard.view','factory_dashboard.view');
 insert into public.role_outlets values(target,outlet);
 result:=public.save_role_configuration(gen_random_uuid(),jsonb_build_object('id',target,'name','qa_scope_'||replace(target::text,'-',''),'permission_changes',jsonb_build_array(jsonb_build_object('code','dashboard.view','before',true,'enabled',false))),'{}','{}');
 if result->'permissions'<>'["factory_dashboard.view"]'::jsonb or result->'outlet_ids'<>'[]'::jsonb or result->'role'->>'outlet_access_type'<>'none' then raise exception 'Scope normalization failed: %',result;end if;
end $test$;
rollback;
