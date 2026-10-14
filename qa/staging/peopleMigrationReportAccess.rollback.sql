begin;
create temporary table report_qa(key text primary key,id uuid);
grant select on report_qa to authenticated;
do $$declare u uuid:=gen_random_uuid();n uuid:=gen_random_uuid();e uuid:=gen_random_uuid();other_e uuid:=gen_random_uuid();r uuid:=gen_random_uuid();o uuid:=gen_random_uuid();other_o uuid:=gen_random_uuid();begin
 insert into auth.users(id,email,aud,role) values(u,u||'@example.invalid','authenticated','authenticated'),(n,n||'@example.invalid','authenticated','authenticated');
 insert into outlets(id,name,code,is_active,status) values(o,'Disposable report outlet','QARPT1',true,'active'),(other_o,'Disposable other report outlet','QARPT2',true,'active');
 insert into roles(id,name,is_active,outlet_access_type) values(r,'qa_report_'||r,true,'selected');
 insert into role_permissions(role_id,permission_id) select r,id from permissions where code='employees.view';insert into role_outlets values(r,o);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(e,u,'Disposable report viewer',u||'@example.invalid',r,true,'active',true,'Disposable report outlet'),(other_e,n,'Disposable hidden employee',n||'@example.invalid',null,true,'active',true,'Disposable other report outlet');
 insert into employee_employment_structure_migration_report(employee_id,mapped_employment_status) values(e,'active'),(other_e,'active');
 insert into report_qa values('viewer',u),('none',n),('visible',e),('hidden',other_e);
end;$$;
set local role anon;
do $$declare denied boolean:=false;begin begin perform 1 from public.employee_employment_structure_migration_report;exception when insufficient_privilege then denied:=true;end;assert denied,'Anonymous SELECT must be denied';end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from report_qa where key='viewer'),'role','authenticated')::text,true);
do $$declare denied boolean:=false;begin
 assert exists(select 1 from employee_employment_structure_migration_report where employee_id=(select id from report_qa where key='visible')),'Authorized administrative reporting preserved';
 assert not exists(select 1 from employee_employment_structure_migration_report where employee_id=(select id from report_qa where key='hidden')),'Employee Outlet scope retained';
 begin update employee_employment_structure_migration_report set requires_manual_review=true;exception when insufficient_privilege then denied:=true;end;assert denied,'Migration evidence is not browser editable';
end;$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from report_qa where key='none'),'role','authenticated')::text,true);
do $$begin assert not exists(select 1 from employee_employment_structure_migration_report),'Employee without reporting permission sees no retained evidence';end;$$;
rollback;
select 'PASS: anonymous denied, authorized People reporting preserved with employee scope, no browser mutation; all fixtures rolled back' verification;
