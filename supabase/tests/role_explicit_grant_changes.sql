begin;
do $test$
declare actor uuid; source uuid; target uuid:=gen_random_uuid(); initial text[]; actual text[]; one text; two text; revoke_code text; r jsonb; req uuid:=gen_random_uuid(); payload jsonb; baseline text;
begin
 select e.auth_user_id into actor from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 select id into source from public.roles where name='manager';
 select md5(string_agg(permission_id::text,',' order by permission_id)) into baseline from public.role_permissions where role_id=source;
 insert into public.roles(id,name,description,is_system_role,is_active,outlet_access_type) values(target,'qa_rollback_preservation_'||replace(target::text,'-',''),'QA rollback only',false,true,'all');
 insert into public.role_permissions select target,permission_id from public.role_permissions where role_id=source;
 select array_agg(p.code order by p.code) into initial from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=target;
 payload:=jsonb_build_object('id',target,'name','qa_rollback_preservation_'||replace(target::text,'-',''),'description','Metadata changed','permission_changes','[]'::jsonb);
 r:=public.save_role_configuration(gen_random_uuid(),payload,'{}','{}');
 select array_agg(x order by x) into actual from jsonb_array_elements_text(r->'permissions') x;
 if actual is distinct from initial then raise exception 'Metadata lost grants';end if;
 revoke_code:=initial[1];
 r:=public.save_role_configuration(gen_random_uuid(),payload||jsonb_build_object('permission_changes',jsonb_build_array(jsonb_build_object('code',revoke_code,'before',true,'enabled',false))),'{}','{}');
 if jsonb_array_length(r->'permissions')<>cardinality(initial)-1 then raise exception 'Revocation did not change exactly one grant';end if;
 begin
  perform public.save_role_configuration(gen_random_uuid(),payload||jsonb_build_object('permission_changes',jsonb_build_array(jsonb_build_object('code',revoke_code,'before',true,'enabled',false))),'{}','{}');
  raise exception 'Stale same-permission write accepted';
 exception when serialization_failure then null;end;
 select code into one from public.permissions where code<>all(initial) and code<>'payroll.manage' order by code limit 1;
 select code into two from public.permissions where code<>all(initial) and code<>one and code<>'payroll.manage' order by code limit 1;
 payload:=payload||jsonb_build_object('permission_changes',jsonb_build_array(jsonb_build_object('code',one,'before',false,'enabled',true)));
 r:=public.save_role_configuration(req,payload,'{}','{}');
 perform public.save_role_configuration(gen_random_uuid(),payload||jsonb_build_object('permission_changes',jsonb_build_array(jsonb_build_object('code',two,'before',false,'enabled',true))),'{}','{}');
 if public.save_role_configuration(req,payload,'{}','{}') is distinct from r then raise exception 'Retry changed result';end if;
 if (select count(*) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=target and p.code in (one,two))<>2 then raise exception 'Non-overlapping edits lost grant';end if;
 if baseline is distinct from (select md5(string_agg(permission_id::text,',' order by permission_id)) from public.role_permissions where role_id=source) then raise exception 'Real manager changed';end if;
 if has_function_privilege('authenticated','public.save_role_configuration_snapshot_internal(uuid,jsonb,text[],uuid[])','execute') then raise exception 'Internal snapshot exposed';end if;
 perform set_config('request.jwt.claims','{}',true);
 begin perform public.save_role_configuration(gen_random_uuid(),payload,'{}','{}');raise exception 'Anonymous accepted';exception when insufficient_privilege then null;end;
end $test$;
rollback;
