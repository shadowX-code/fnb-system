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


do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');c uuid;f uuid;r jsonb;req uuid:=gen_random_uuid();denied boolean;
begin
 r:=public.marketing_inbox_command(gen_random_uuid(),o,b,null,0,'create','{"title":"Draft-first FAQ rollback only"}');c:=(r->'conversation'->>'id')::uuid;insert into marketing_qa_ids values('conversation',c);
 r:=public.marketing_inbox_configure(req,b,0,'save_faq','{"question":"Draft-only question","answer":"UNVERIFIED DRAFT ANSWER","language":"EN","reference_keys":[]}');f:=(r->>'id')::uuid;insert into marketing_qa_ids values('faq',f);
 assert r->>'status'='draft' and r->>'knowledge_revision'='0','Draft can exist without knowledge or facts';
 assert public.marketing_inbox_configure(req,b,0,'save_faq','{"question":"Draft-only question","answer":"UNVERIFIED DRAFT ANSWER","language":"EN","reference_keys":[]}')->>'id'=f::text,'Draft save replay';
 r:=public.marketing_inbox_configure(gen_random_uuid(),b,1,'save_faq',jsonb_build_object('id',f,'question','Draft-only question','answer','UNVERIFIED DRAFT ANSWER edited','language','EN','reference_keys','[]'::jsonb));assert r->>'revision'='2','Edit before knowledge';
 denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,2,'approve_faq',jsonb_build_object('id',f));exception when others then denied:=true;end;assert denied,'No knowledge cannot approve';
 denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,2,'request_faq_review',jsonb_build_object('id',f));exception when others then denied:=true;end;assert denied,'No knowledge cannot submit approval';
 assert public.marketing_inbox_faq_preview(c,'Draft-only question')->>'state'='knowledge_unapproved','Unapproved draft is never a reply';
 denied:=false;begin perform public.marketing_inbox_command(gen_random_uuid(),o,b,c,1,'faq_draft',jsonb_build_object('faq_id',f));exception when others then denied:=true;end;assert denied,'Draft FAQ cannot enter customer reply';
 perform public.marketing_save_knowledge(b,0,'{"identity":{"text":"Approved QA identity only.","provenance":"verified_brand_fact"}}');
 r:=public.marketing_inbox_configure(gen_random_uuid(),b,2,'save_faq',jsonb_build_object('id',f,'question','Draft-only question','answer','UNVERIFIED DRAFT ANSWER edited','language','EN','reference_keys',jsonb_build_array('identity')));assert r->>'status'='draft','Can save proposed support before knowledge approval';
 denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,3,'approve_faq',jsonb_build_object('id',f));exception when others then denied:=true;end;assert denied,'Unapproved knowledge cannot approve even with references';
 perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'approve_knowledge');
 assert public.marketing_inbox_faq_preview(c,'Draft-only question')->'faq'='null'::jsonb,'Approved knowledge does not auto-approve drafts';
 req:=gen_random_uuid();perform public.marketing_inbox_configure(gen_random_uuid(),b,0,'policy','{"automation_mode":"suggest","ai_allowed":true}');
 perform public.marketing_inbox_ai_prepare(req,c,1,'reply');insert into marketing_qa_ids values('ai_request',req);
 -- Save a fact-grounded answer and explicitly request review.
 r:=public.marketing_inbox_configure(gen_random_uuid(),b,3,'save_faq',jsonb_build_object('id',f,'question','Draft-only question','answer','Approved QA identity only.','language','EN','reference_keys',jsonb_build_array('identity')));
 r:=public.marketing_inbox_configure(gen_random_uuid(),b,4,'request_faq_review',jsonb_build_object('id',f));assert r->>'status'='review' and r->>'revision'='5','Pending Approval is explicit and versioned';
 assert public.marketing_inbox_faq_preview(c,'Draft-only question')->'faq'='null'::jsonb,'Pending FAQ excluded';
 denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,4,'approve_faq',jsonb_build_object('id',f));exception when others then denied:=true;end;assert denied,'Stale approver revision rejected';
end;$$;
reset role;
do $$declare a jsonb;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 a:=public.marketing_inbox_ai_claim((select id from marketing_qa_ids where key='ai_request'),(select id from marketing_qa_ids where key='employee'));
 assert a->'facts'->'identity'->>'text'='Approved QA identity only.','AI receives approved facts';
 assert a::text not like '%UNVERIFIED%','No unapproved FAQ answer enters AI context';
 delete from public.role_permissions where role_id=(select id from marketing_qa_ids where key='role') and permission_id=(select id from public.permissions where code='marketing_inbox.approve');
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare denied boolean:=false;begin
 begin perform public.marketing_inbox_configure(gen_random_uuid(),(select id from marketing_qa_ids where key='brand'),5,'approve_faq',jsonb_build_object('id',(select id from marketing_qa_ids where key='faq')));exception when insufficient_privilege then denied:=true;end;assert denied,'Draft author without approval permission cannot approve';
end;$$;
reset role;
insert into public.role_permissions(role_id,permission_id) select (select id from marketing_qa_ids where key='role'),id from public.permissions where code='marketing_inbox.approve';
set local role authenticated;
do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');c uuid:=(select id from marketing_qa_ids where key='conversation');f uuid:=(select id from marketing_qa_ids where key='faq');r jsonb;denied boolean;
begin
 r:=public.marketing_inbox_configure(gen_random_uuid(),b,5,'approve_faq',jsonb_build_object('id',f));assert r->>'status'='approved','Existing exact-revision approval succeeds';
 assert public.marketing_inbox_faq_preview(c,'Draft-only question')->'faq'->>'id'=f::text,'Only approved supported FAQ matches';
 perform public.marketing_save_knowledge(b,1,'{"identity":{"text":"New QA fact revision.","provenance":"verified_brand_fact"}}');
 assert public.marketing_inbox_faq_preview(c,'Draft-only question')->>'state'='knowledge_unapproved','Knowledge change immediately blocks use';
 r:=public.marketing_inbox_configure(gen_random_uuid(),b,5,'save_faq',jsonb_build_object('id',f,'question','Draft-only question','answer','Another draft','language','EN','reference_keys',jsonb_build_array('unknown_key')));assert r->>'status'='draft','Can prepare replacement draft while knowledge unapproved';
 perform public.marketing_inbox_configure(gen_random_uuid(),b,2,'approve_knowledge');
 denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,6,'approve_faq',jsonb_build_object('id',f));exception when others then denied:=true;end;assert denied,'Unknown support cannot approve';
 perform public.marketing_inbox_configure(gen_random_uuid(),b,6,'disable_faq',jsonb_build_object('id',f));
 assert public.marketing_inbox_faq_preview(c,'Draft-only question')->'faq'='null'::jsonb,'Disabled FAQ excluded';
end;$$;
reset role;
rollback;
select 'Draft-first FAQ, pending review, exact current approved support, permission denial, matching and AI-context isolation passed; all fixtures rolled back.' as result;
