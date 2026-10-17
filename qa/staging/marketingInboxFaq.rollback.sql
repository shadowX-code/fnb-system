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

do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');c uuid;f uuid;g uuid;req uuid:=gen_random_uuid();r jsonb;denied boolean;d uuid;
begin
 r:=public.marketing_inbox_command(gen_random_uuid(),o,b,null,0,'create','{"title":"FAQ workflow — rollback only"}');c:=(r->'conversation'->>'id')::uuid;
 insert into marketing_qa_ids values('conversation',c);
 denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"QA question","answer":"QA only","language":"EN","reference_keys":["rules"]}');exception when others then denied:=true;end;assert denied,'Unapproved knowledge cannot create FAQ';
 perform public.marketing_save_knowledge(b,0,'{"rules":{"text":"QA rollback only: the test reference is SAMPLE.","provenance":"verified_brand_fact"},"voice":{"text":"Unapproved QA suggestion","provenance":"ai_suggestion"},"references":{"text":"External research","provenance":"external_research","source_url":"https://example.com"}}');
 perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'approve_knowledge');
 assert public.marketing_inbox_read(o,b)->'knowledge'->>'approved_for_replies'='true','Current knowledge approved';
 perform public.marketing_inbox_configure(gen_random_uuid(),b,0,'policy','{"automation_mode":"suggest","ai_allowed":true,"staff_reply_requires_approval":true}');
 r:=public.marketing_inbox_configure(req,b,0,'save_faq','{"question":"What is the test reference?","alternative_questions":["QA reference please","测试参考是什么？"],"category":"Acceptance","answer":"The QA reference is SAMPLE.","language":"EN","reference_keys":["rules"]}');f:=(r->>'id')::uuid;
 assert public.marketing_inbox_configure(req,b,0,'save_faq','{"question":"What is the test reference?","alternative_questions":["QA reference please","测试参考是什么？"],"category":"Acceptance","answer":"The QA reference is SAMPLE.","language":"EN","reference_keys":["rules"]}')=r,'Exact save retry idempotent';
 assert public.marketing_inbox_faq_preview(c,'QA reference please')->'faq'='null'::jsonb,'Draft never matched';
 perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'approve_faq',jsonb_build_object('id',f));
 assert public.marketing_inbox_faq_preview(c,'  qa   reference PLEASE ')->'faq'->>'id'=f::text,'Approved alternative matches';
 assert public.marketing_inbox_faq_preview(c,'测试参考是什么？')->'faq'->>'id'=f::text,'ZH alternative preserved';
 assert public.marketing_inbox_faq_preview(c,'unverified question')->'faq'='null'::jsonb,'Unknown never guessed';
 r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Second QA question","alternative_questions":["QA reference please"],"category":"Acceptance","answer":"Different approved test answer.","language":"EN","reference_keys":["rules"]}');g:=(r->>'id')::uuid;
 perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'approve_faq',jsonb_build_object('id',g));
 assert public.marketing_inbox_faq_preview(c,'QA reference please')->'faq'='null'::jsonb,'Ambiguous match handed to staff';
 perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'disable_faq',jsonb_build_object('id',g));
 assert public.marketing_inbox_faq_preview(c,'QA reference please')->'faq'->>'id'=f::text,'Disabled alternative excluded';
 denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'disable_faq',jsonb_build_object('id',g));exception when others then denied:=true;end;assert denied,'Stale disable rejected';
 r:=public.marketing_inbox_command(gen_random_uuid(),o,b,c,1,'faq_draft',jsonb_build_object('faq_id',f));d:=(r->'draft'->>'id')::uuid;
 assert r->'draft'->>'status'='draft','Staff reviews draft before send';
 perform public.marketing_inbox_command(gen_random_uuid(),o,b,c,1,'review_reply',jsonb_build_object('draft_id',d));
 perform public.marketing_inbox_command(gen_random_uuid(),o,b,c,1,'approve_reply',jsonb_build_object('draft_id',d));
 assert public.marketing_inbox_detail(c)->'outbox'->0->>'state'='blocked','Approval does not send';
 r:=public.marketing_inbox_detail(c);assert r->'knowledge'->>'approved_for_replies'='true' and r->'policy'->>'ai_allowed'='true','Conversation has current Brand prerequisites even with All Brands';
 r:=public.marketing_inbox_configure(gen_random_uuid(),b,1,'save_faq',jsonb_build_object('id',f,'question','What is the test reference?','answer','Edited QA answer','language','EN','reference_keys',jsonb_build_array('rules'),'category','Updated','alternative_questions',jsonb_build_array('Updated phrasing')));
 assert r->>'status'='draft' and r->>'revision'='2','Edit invalidates approval';
 assert public.marketing_inbox_faq_preview(c,'Updated phrasing')->'faq'='null'::jsonb,'Edited FAQ requires fresh approval';
 denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Invalid alias","answer":"QA","language":"EN","reference_keys":["rules"],"alternative_questions":[123]}');exception when others then denied:=true;end;assert denied,'Non-string alternatives denied';
 denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),(select id from marketing_qa_ids where key='other_brand'),0,'save_faq','{}');exception when insufficient_privilege then denied:=true;end;assert denied,'Cross-Brand configure denied';
 denied:=false;begin execute 'select * from public.marketing_inbox_faqs';exception when insufficient_privilege then denied:=true;end;assert denied,'No direct FAQ access';
 denied:=false;begin perform marketing_private.inbox_match_faq(b,'QA');exception when insufficient_privilege then denied:=true;end;assert denied,'Private matcher not client authority';
 perform public.marketing_inbox_configure(gen_random_uuid(),b,2,'approve_faq',jsonb_build_object('id',f));
 perform public.marketing_save_knowledge(b,1,'{"rules":{"text":"Changed verified QA fact.","provenance":"verified_brand_fact"}}');
 assert public.marketing_inbox_faq_preview(c,'Updated phrasing')->>'state'='knowledge_unapproved','Changed knowledge blocks existing answers';
end;$$;
reset role;
do $$begin assert not exists(select 1 from public.marketing_inbox_knowledge where brand_id=(select id from marketing_qa_ids where key='brand') and (profile ? 'voice' or profile ? 'references')),'Only verified facts enter approved snapshot';end;$$;
rollback;
select 'FAQ lifecycle, approval, alias ambiguity, tenant/Brand authorization, drafts and disabled sending passed; all fixtures rolled back.' as result;
