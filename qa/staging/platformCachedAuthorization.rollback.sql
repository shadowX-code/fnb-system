-- Staging ujkzdaaadnvcfayuldmh only. All fixtures roll back; no provider calls.
begin;
set local statement_timeout='5s';
create temporary table auth_plan_qa_ids(key text primary key,id uuid);
grant select on auth_plan_qa_ids to authenticated;
do $$
declare
  u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); legacy uuid:=gen_random_uuid();
  e uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); owner_role uuid;
  allowed_outlet uuid; denied_outlet uuid;
begin
  select id into owner_role from roles where lower(name)='owner';
  select id into allowed_outlet from outlets order by id limit 1;
  select id into denied_outlet from outlets where id<>allowed_outlet order by id limit 1;
  assert owner_role is not null and allowed_outlet is not null and denied_outlet is not null;
  insert into auth.users(id,email,aud,role) values
    (u,u||'@example.invalid','authenticated','authenticated'),
    (a,a||'@example.invalid','authenticated','authenticated'),
    (legacy,legacy||'@example.invalid','authenticated','authenticated');
  insert into roles(id,name,is_active,outlet_access_type)
    values(r,'qa_cached_auth_'||r,true,'selected');
  insert into role_permissions(role_id,permission_id)
    select r,id from permissions where code in('product_analytics.view','purchase_input.view','inventory_stock_check.view','crew_roster.manage');
  insert into role_outlets(role_id,outlet_id) values(r,allowed_outlet);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  insert into employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace)
    values(e,u,'Disposable cached-plan QA',u||'@example.invalid',r,true,'active',true,'Management');
  insert into user_profiles(id,email,full_name,role_id,is_active,enable_system_login,access_state)
    values(u,u||'@example.invalid','Stale privileged profile QA',owner_role,true,true,'active'),
    (legacy,legacy||'@example.invalid','Legacy-only QA',owner_role,true,true,'active');
  insert into auth_plan_qa_ids values('user',u),('admin',a),('legacy',legacy),('employee',e),('role',r),
    ('owner',owner_role),('allowed',allowed_outlet),('denied',denied_outlet);
end;$$;
set local role authenticated;
do $$begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth_plan_qa_ids where key='user'),'role','authenticated')::text,true);
  assert current_user_role_id()=(select id from auth_plan_qa_ids where key='role');
  assert current_user_has_permission('product_analytics.view');
  assert current_user_has_permission('purchase_input.view');
  assert current_user_has_permission('inventory_stock_check.view');
  assert current_user_has_permission('duty_roster.edit');
  assert not current_user_has_direct_permission('duty_roster.edit');
  assert not current_user_has_permission('employees.edit');
  assert not current_user_has_permission('nonexistent.permission');
  assert not current_user_has_all_outlet_access();
  assert current_user_can_access_outlet((select id from auth_plan_qa_ids where key='allowed'));
  assert not current_user_can_access_outlet((select id from auth_plan_qa_ids where key='denied'));
  assert not current_user_can_access_outlet(null);
  assert not exists(select 1 from product_sales_items where outlet_id=(select id from auth_plan_qa_ids where key='denied'));
  assert not exists(select 1 from purchase_records where outlet_id=(select id from auth_plan_qa_ids where key='denied'));
  assert not exists(select 1 from inventory_item_outlets where outlet_id=(select id from auth_plan_qa_ids where key='denied'));
  assert not exists(select 1 from inventory_stock_check_items i join inventory_stock_checks s on s.id=i.stock_check_id where s.outlet_id=(select id from auth_plan_qa_ids where key='denied'));
end;$$;
reset role;
update employees set access_state='disabled' where id=(select id from auth_plan_qa_ids where key='employee');
set local role authenticated;
do $$begin
  assert current_user_role_id() is null,'Disabled Employee must not fall back to privileged Profile';
  assert not current_user_has_permission('product_analytics.view');
  assert not current_user_can_access_outlet((select id from auth_plan_qa_ids where key='allowed'));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth_plan_qa_ids where key='legacy'),'role','authenticated')::text,true);
  assert current_user_role_id()=(select id from auth_plan_qa_ids where key='owner');
  assert current_user_has_permission('product_analytics.view');
  assert current_user_has_all_outlet_access();
  assert current_user_can_access_outlet((select id from auth_plan_qa_ids where key='denied'));
  perform set_config('request.jwt.claims','{}',true);
  assert current_user_role_id() is null;
  assert not current_user_has_permission('product_analytics.view');
  assert not current_user_has_all_outlet_access();
end;$$;
reset role;
do $$begin
  assert not has_function_privilege('anon','public.current_user_role_id()','execute');
  assert not has_function_privilege('anon','public.current_user_has_permission(text)','execute');
  assert not has_function_privilege('anon','public.current_user_has_direct_permission(text)','execute');
end;$$;
rollback;
-- Compare complete Owner-visible row contents, not just truncated page counts.
begin;
set local statement_timeout='5s';
create temporary table auth_plan_expected(name text primary key,total bigint,digest text);
grant select on auth_plan_expected to authenticated;
do $$declare t text; n bigint; h text;begin
  foreach t in array array['product_sales_items','purchase_records','inventory_item_outlets','inventory_stock_check_items'] loop
    execute format('select count(*),md5(string_agg(md5(to_jsonb(r)::text),'''' order by id)) from public.%I r',t) into n,h;
    insert into auth_plan_expected values(t,n,h);
  end loop;
  perform set_config('request.jwt.claims',(select jsonb_build_object('sub',e.auth_user_id,'email',u.email,'role','authenticated')::text
    from employees e join auth.users u on u.id=e.auth_user_id join roles r on r.id=e.role_id
    where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
end;$$;
set local role authenticated;
do $$declare expected record; n bigint; h text;begin
  assert current_user_has_all_outlet_access();
  for expected in select * from auth_plan_expected loop
    execute format('select count(*),md5(string_agg(md5(to_jsonb(r)::text),'''' order by id)) from public.%I r',expected.name) into n,h;
    assert n=expected.total and h is not distinct from expected.digest, 'Complete row set/content differs for '||expected.name;
  end loop;
end;$$;
rollback;
select 'PASS: Employee precedence, disabled denial, legacy compatibility, direct/alias grants, selected-outlet RLS isolation, anonymous grants, same-transaction claim freshness; fixtures rolled back' verification;
