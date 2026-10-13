-- Staging-only projection rehearsal: disposable records, no providers or execution changes.
begin;
create temporary table marketing_qa_ids(key text primary key,id uuid);
grant select,insert,update on marketing_qa_ids to authenticated;
do $$
declare u uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); other_o uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); other_e uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,aud,role) values(u,'marketing-rollback-'||u::text||'@example.invalid','authenticated','authenticated');
 insert into public.roles(id,name,is_active,outlet_access_type) values(r,'qa_marketing_'||r::text,true,'none');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code like 'marketing_%' or code in ('platform_organizations.manage','platform_customers.manage') or code in ('roles.create','roles.edit','roles.view','employees.view');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace)
 values(e,u,'QA Marketing Rollback','marketing-rollback-'||u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into public.organizations(id,name) values(o,'QA Marketing Organization'),(other_o,'QA Other Tenant');
 insert into public.organization_memberships values(o,e);
 insert into public.brands(id,organization_id,name) values(b,o,'QA Authorized Brand'),(other_b,o,'QA Restricted Brand');
 insert into public.marketing_role_scopes values(o,r,false);
 insert into public.marketing_role_brands values(o,r,b);
 -- Current Platform per-member Brand authority; compatible with older fixtures.
 if to_regclass('public.platform_member_brand_scopes') is not null then
  execute 'insert into public.platform_member_brand_scopes(organization_id,employee_id,all_brands) values($1,$2,false) on conflict(organization_id,employee_id) do update set all_brands=false' using o,e;
  execute 'insert into public.platform_member_brands(organization_id,employee_id,brand_id) values($1,$2,$3) on conflict do nothing' using o,e,b;
 end if;
 insert into auth.users(id,email,aud,role) values(other_u,'marketing-scope-'||other_u::text||'@example.invalid','authenticated','authenticated');
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(other_e,other_u,'QA Out of People Scope','marketing-scope-'||other_u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into marketing_qa_ids values('other_employee',other_e);
 insert into marketing_qa_ids values('user',u),('employee',e),('role',r),('org',o),('brand',b),('other_brand',other_b),('other_org',other_o);
end; $$;

do $$begin
 assert not has_table_privilege('authenticated','marketing_private.customer_import_jobs','SELECT'),'Import jobs private';
 assert not has_function_privilege('authenticated','marketing_private.customer_import_tick()','EXECUTE'),'Worker private';
 assert not has_function_privilege('anon','public.platform_customer_import_job(uuid,uuid,text,uuid,jsonb)','EXECUTE'),'Anonymous denied';
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');r jsonb;p jsonb;res jsonb;choices jsonb;cid uuid;request uuid:=gen_random_uuid();denied boolean;
begin
 r:='[{"name":"Synthetic POS Member","phone":"0123456789","email":"fixture@example.invalid","gender":"Female","birthday":"04/03/2000","total_visit":"8","avg_spent":"RM 12.34","total_spent":"MYR 123.00","last_visit":"12/10/2026","member_since":"01/01/2025","tags":["VIP"],"brand":"QA Authorized Brand","_source":"QA POS","_snapshot_date":"2026-10-12"}]';
 p:=public.platform_customer_import_preview(o,b,r);assert p->'rows'->0->>'classification'='new','Thirteen fields valid';
 choices:='{"1":{"selected":true,"snapshot":"new","fields":[]}}';res:=public.platform_customer_import_commit(request,o,b,r,choices);assert res->'rows'->0->>'status'='created','Initial create';
 assert public.platform_customer_import_commit(request,o,b,r,choices)=res,'Exact retry';
 p:=public.marketing_customers_read(o,b);cid:=(p->'customers'->0->>'id')::uuid;
 assert p->'customers'->0->>'email'='fixture@example.invalid' and p->'customers'->0->>'birthday'='2000-03-04','Profile persistence and DD/MM semantics';
 p:=public.marketing_customers_read(o,b,jsonb_build_object('detail',cid));assert p->'customers'->0->'detail'->'pos_snapshots'->0->'metrics'->>'avg_spent'='12.34','Average never recalculated';
 p:=public.platform_customer_import_preview(o,b,r);assert p->'rows'->0->>'classification'='unchanged','Identical POS reimport unchanged';
 r:='[{"name":"Synthetic POS Member","phone":"0123456789","email":"","tags":["Regular"],"outlet_id":"","total_visit":"9","avg_spent":"0","total_spent":"123.00","last_visit":"13/10/2026","_source":"QA POS","_snapshot_date":"2026-10-13"}]';
 p:=public.platform_customer_import_preview(o,b,r);assert p->'rows'->0->>'classification'='review','Recurring import reviewed';assert not(p->'rows'->0->'differences' ? 'email') and not(p->'rows'->0->'differences' ? 'outlet_id'),'Blanks preserve';
 assert p->'rows'->0->'values'->'tags' ?& array['Regular','VIP'],'Tags merge';
 choices:=jsonb_build_object('1',jsonb_build_object('selected',true,'snapshot',p->'rows'->0->>'snapshot','fields',jsonb_build_array('tags','total_visit','avg_spent','last_visit')));
 perform public.marketing_outreach_command(gen_random_uuid(),o,b,'suppress',cid,'{"reason":"Synthetic privacy fixture"}');
 res:=public.platform_customer_import_commit(gen_random_uuid(),o,b,r,choices);assert res->'rows'->0->>'status'='conflict','Consent changes invalidate preview';
 p:=public.platform_customer_import_preview(o,b,r);choices:=jsonb_set(choices,'{1,snapshot}',p->'rows'->0->'snapshot');res:=public.platform_customer_import_commit(gen_random_uuid(),o,b,r,choices);assert res->'rows'->0->>'status'='updated','Explicit update';
 p:=public.marketing_customers_read(o,b,jsonb_build_object('detail',cid));assert p->'customers'->0->>'suppressed'='true','Suppression unchanged';assert p->'customers'->0->>'email'='fixture@example.invalid','Blank email preserved';assert p->'customers'->0->'detail'->'pos_snapshots'->0->'metrics'->>'avg_spent'='0','Actual zero preserved';
 r:=jsonb_set(r,'{0,_snapshot_date}','"2026-10-11"');r:=jsonb_set(r,'{0,total_visit}','"10"');p:=public.platform_customer_import_preview(o,b,r);assert p->'rows'->0->>'classification'='conflict','Older snapshot blocked';
 r:=jsonb_set(r,'{0,_snapshot_date}','"2026-10-13"');p:=public.platform_customer_import_preview(o,b,r);assert p->'rows'->0->>'classification'='conflict','Same-date conflicting export blocked';
 p:=public.platform_customer_import_preview(o,b,'[{"name":"Invalid","phone":"01112345678","birthday":"31/02/2000"},{"name":"Invalid","phone":"01112345679","email":"invalid"},{"name":"Invalid","phone":"01112345670","total_visit":"-1","_source":"QA","_snapshot_date":"2026-10-13"},{"name":"Invalid","phone":"01112345671","brand":"Another Brand"},{"name":"Invalid","phone":"01112345672","outlet_id":"11111111-1111-1111-1111-111111111111"},{"name":"Invalid","phone":"01112345673","consent":"granted"}]');
 assert (select bool_and(x->>'classification'='invalid') from jsonb_array_elements(p->'rows')x),'Invalid dates, email, visits, Brand, Outlet, consent';
 perform public.platform_customer_import_job(o,b,'mapping_save',null,'{"source":"QA POS","headers":["Name","Mobile","Points"],"mapping":{"name":"Name","phone":"Mobile"}}');
 assert public.platform_customer_import_job(o,b,'mapping_read',null,'{"source":"QA POS"}')->'mapping'->'mapping'->>'phone'='Mobile','Saved mapping';
 denied:=false;begin perform public.platform_customer_import_job(o,(select id from marketing_qa_ids where key='other_brand'),'history');exception when insufficient_privilege then denied:=true;end;assert denied,'Other Brand history denied';
 insert into marketing_qa_ids values('pos_customer',cid);
end;$$;
reset role;
do $$begin assert (select count(*) from marketing_private.customer_pos_snapshots where customer_id=(select id from marketing_qa_ids where key='pos_customer'))=2,'No duplicate snapshots';end;$$;
rollback;
select 'POS Import V2 profile, metrics, dates, consent, conflicts, scope and saved mapping checks passed; all fixtures rolled back' result;
