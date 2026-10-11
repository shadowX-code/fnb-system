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
 insert into auth.users(id,email,aud,role) values(other_u,'marketing-scope-'||other_u::text||'@example.invalid','authenticated','authenticated');
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(other_e,other_u,'QA Out of People Scope','marketing-scope-'||other_u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into marketing_qa_ids values('other_employee',other_e);
 insert into marketing_qa_ids values('user',u),('employee',e),('role',r),('org',o),('brand',b),('other_brand',other_b),('other_org',other_o);
end; $$;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');p jsonb;res jsonb;rows jsonb;choices jsonb;cust uuid;req uuid;first_result jsonb;denied boolean;
begin
 assert not has_table_privilege('authenticated','public.platform_customers','SELECT'),'No direct customer access';
 assert not has_function_privilege('anon','public.platform_customer_import_commit(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE'),'No anonymous import';
 rows:='[{"name":"QA Import New","phone":"0123456789","tags":["VIP"]},{"name":"QA Duplicate","phone":"01112345678"},{"name":"QA Duplicate Other","phone":"+601112345678"},{"name":"QA Invalid","phone":"abc"}]';
 p:=public.platform_customer_import_preview(o,b,rows);
 assert p->'rows'->0->>'classification'='new','New row';assert p->'rows'->1->>'classification'='conflict' and p->'rows'->2->>'classification'='conflict','All file duplicates blocked';assert p->'rows'->3->>'classification'='invalid','Invalid phone';
 req:=gen_random_uuid();choices:='{"1":{"selected":true,"snapshot":"new","fields":[]}}';
 res:=public.platform_customer_import_commit(req,o,b,rows,choices);first_result:=res;
 assert res->'rows'->0->>'status'='created','Created';assert res->'rows'->1->>'status'='conflict','No duplicate write';
 assert public.platform_customer_import_commit(req,o,b,rows,choices)=res,'Retry returns identical committed result';
 p:=public.marketing_customers_read(o,b);cust:=(p->'customers'->0->>'id')::uuid;assert p->>'total'='1','Only one customer';assert p->'customers'->0->>'eligible'='false','Phone does not imply consent';
 p:=public.platform_customer_import_preview(o,b,jsonb_build_array(rows->0));assert p->'rows'->0->>'classification'='unchanged','Repeated file unchanged';
 res:=public.platform_customer_import_commit(gen_random_uuid(),o,b,jsonb_build_array(rows->0),choices);assert res->'rows'->0->>'status'='unchanged','No unnecessary customer write';
 rows:='[{"name":"QA Changed Name","phone":"0123456789","tags":["VIP","Regular"]}]';p:=public.platform_customer_import_preview(o,b,rows);
 assert p->'rows'->0->>'classification'='review','Existing differences require review';assert p->'rows'->0->'differences' ? 'name' and p->'rows'->0->'differences' ? 'tags','Field differences';
 choices:=jsonb_build_object('1',jsonb_build_object('selected',true,'snapshot',p->'rows'->0->>'snapshot','fields',jsonb_build_array('tags')));
 res:=public.platform_customer_import_commit(gen_random_uuid(),o,b,rows,choices);assert res->'rows'->0->>'status'='updated','Explicit selected field updated';
 p:=public.marketing_customers_read(o,b);assert p->'customers'->0->>'display_name'='QA Import New','Unselected name unchanged';
 -- Replaying stale preview under a fresh request cannot overwrite changes.
 res:=public.platform_customer_import_commit(gen_random_uuid(),o,b,rows,choices);assert res->'rows'->0->>'status'='conflict','Stale snapshot blocked';
 -- Existing suppression and latest consent are never imported or cleared.
 perform public.marketing_outreach_command(gen_random_uuid(),o,b,'suppress',cust,'{"reason":"Disposable suppression"}');
 p:=public.platform_customer_import_preview(o,b,rows);choices:=jsonb_build_object('1',jsonb_build_object('selected',true,'snapshot',p->'rows'->0->>'snapshot','fields',jsonb_build_array('name')));
 res:=public.platform_customer_import_commit(gen_random_uuid(),o,b,rows,choices);assert res->'rows'->0->>'status'='updated','Explicit name review';
 p:=public.marketing_customers_read(o,b,'{"consent":"suppressed"}');assert p->>'total'='1' and p->'customers'->0->>'suppressed'='true','Suppression preserved';
 denied:=false;begin perform public.platform_customer_import_preview(o,(select id from marketing_qa_ids where key='other_brand'),rows);exception when insufficient_privilege then denied:=true;end;assert denied,'Cross-brand import denied';
 denied:=false;begin perform public.marketing_customers_read((select id from marketing_qa_ids where key='other_org'),b);exception when insufficient_privilege then denied:=true;end;assert denied,'Cross-tenant read denied';
 insert into marketing_qa_ids values('customer',cust);
end;$$;
reset role;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');other uuid:=(select id from marketing_qa_ids where key='other_brand');cust uuid:=(select id from marketing_qa_ids where key='customer');res jsonb;
begin
 insert into public.platform_customer_brands(organization_id,brand_id,customer_id) values(o,other,cust);
 res:=public.platform_customer_import_preview(o,b,'[{"name":"Hidden Brand Name Change","phone":"0123456789"}]');
 assert res->'rows'->0->>'classification'='conflict' and not (res->'rows'->0 ? 'customer_id'),'Cross-brand identity withheld';
end;$$;
rollback;
select 'Customer import scope, duplicates, matching, no-change, exact updates, stale preview, consent/suppression and retry checks passed; all disposable records rolled back' result;
