-- Staging-only L3 rehearsal. Every fixture and mutation is rolled back.
-- Run only against verified ujkzdaaadnvcfayuldmh; no provider call is made.
begin;
create temporary table marketing_qa_ids(key text primary key,id uuid);
grant select,insert,update on marketing_qa_ids to authenticated;
do $$
declare u uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); other_o uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); other_e uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,aud,role) values(u,'marketing-rollback-'||u::text||'@example.invalid','authenticated','authenticated');
 insert into public.roles(id,name,is_active,outlet_access_type) values(r,'qa_marketing_'||r::text,true,'none');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code like 'marketing_%' or code='platform_organizations.manage' or code in ('roles.create','roles.edit','roles.view','employees.view');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace)
 values(e,u,'QA Marketing Rollback','marketing-rollback-'||u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into public.organizations(id,name) values(o,'QA Marketing Organization'),(other_o,'QA Other Tenant');
 insert into public.organization_memberships values(o,e);
 insert into public.brands(id,organization_id,name) values(b,o,'QA Authorized Brand'),(other_b,o,'QA Restricted Brand');
 insert into public.marketing_role_scopes values(o,r,false);
 insert into public.marketing_role_brands values(o,r,b);
 insert into public.platform_member_brands(organization_id,employee_id,brand_id) values(o,e,b);
 insert into auth.users(id,email,aud,role) values(other_u,'marketing-scope-'||other_u::text||'@example.invalid','authenticated','authenticated');
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(other_e,other_u,'QA Out of People Scope','marketing-scope-'||other_u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into marketing_qa_ids values('other_employee',other_e);
 insert into marketing_qa_ids values('user',u),('employee',e),('role',r),('org',o),('brand',b),('other_brand',other_b),('other_org',other_o);
end; $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);


do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');o uuid:=(select id from marketing_qa_ids where key='org');c uuid;f uuid;f2 uuid;r jsonb;denied boolean;begin
r:=public.marketing_inbox_command(gen_random_uuid(),o,b,null,0,'create','{"title":"FAQ management rollback only"}');c:=(r->'conversation'->>'id')::uuid;
r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Hi","answer":"Hello! How can we help you?","language":"EN","answer_kind":"general","template_key":"greeting","match_intent":"greeting","reference_keys":[]}');f:=(r->>'id')::uuid;
assert public.marketing_inbox_faq_preview(c,'Hi')->'faq'='null'::jsonb,'Unapproved general excluded';
perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'approve_faq',jsonb_build_object('id',f,'review_confirmation','fact_free'));
assert public.marketing_inbox_faq_preview(c,'你好')->'faq'->>'id'=f::text,'Chinese topic match';
assert public.marketing_inbox_faq_preview(c,'hai')->'faq'->>'id'=f::text,'Malay topic match';
assert public.marketing_inbox_faq_preview(c,'hello!')->'faq'->>'id'=f::text,'Normalized English match';
assert public.marketing_inbox_faq_preview(c,'Hi')->>'sending_enabled'='false','Never sends';
assert public.marketing_inbox_faq_preview(c,'What time do you open?')->'faq'='null'::jsonb,'No invented operational facts';
assert public.marketing_inbox_faq_preview(c,'!!!')->'faq'='null'::jsonb,'No empty normalization match';
r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Hours","answer":"Open 24 hours","language":"EN","answer_kind":"general","template_key":"greeting","reference_keys":[]}');assert r->>'answer_kind'='factual','Cannot smuggle facts through general';
r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Custom facts","answer":"Unverified","language":"EN","reference_keys":[]}');f2:=(r->>'id')::uuid;
denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'approve_faq',jsonb_build_object('id',f2,'review_confirmation','fact_free'));exception when others then denied:=true;end;assert denied,'Independent factual approval still needs approved support';
r:=public.marketing_inbox_command(gen_random_uuid(),o,b,c,1,'faq_draft',jsonb_build_object('faq_id',f));assert r->'draft'->>'knowledge_revision' is null,'General draft does not borrow factual revision';
assert jsonb_array_length(public.marketing_faq_settings_read(b)->'general_templates')=3,'Authorized catalog';
denied:=false;begin perform public.marketing_faq_settings_read((select id from marketing_qa_ids where key='other_brand'));exception when insufficient_privilege then denied:=true;end;assert denied,'Brand isolation';
r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Hey","answer":"Hello! How can we help you?","language":"EN","answer_kind":"general","template_key":"greeting","match_intent":"greeting","reference_keys":[]}');f2:=(r->>'id')::uuid;perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'approve_faq',jsonb_build_object('id',f2,'review_confirmation','fact_free'));
assert public.marketing_inbox_faq_preview(c,'你好')->'faq'='null'::jsonb,'Ambiguous topic refused';
assert public.marketing_inbox_faq_preview(c,'Hi')->'faq'->>'id'=f::text,'Exact reviewed phrase takes priority';
perform public.marketing_save_knowledge(b,0,'{"identity":{"text":"Verified test brand","provenance":"verified_brand_fact"}}');
assert public.marketing_inbox_faq_preview(c,'Hi')->'faq'->>'id'=f::text,'General independent of knowledge approval';
end;$$;
reset role;
select 'FAQ management authority and multilingual matching passed; fixtures rolled back' result;
rollback;
