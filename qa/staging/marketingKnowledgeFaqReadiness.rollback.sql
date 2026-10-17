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


do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');o uuid:=(select id from marketing_qa_ids where key='org');f uuid;fact uuid;r jsonb;denied boolean;c uuid;req uuid:=gen_random_uuid();begin
r:=public.marketing_inbox_command(gen_random_uuid(),o,b,null,0,'create','{"title":"Knowledge FAQ readiness rollback only"}');c:=(r->'conversation'->>'id')::uuid;
r:=public.marketing_inbox_configure(req,b,0,'save_faq','{"question":"Hi","answer":"Hey there! Thanks so much for reaching out. How may we help you today?","language":"EN","reference_keys":[],"answer_kind":"factual","alternative_questions":["你好","Hai"],"match_intent":"greeting"}');f:=(r->>'id')::uuid;
assert r->>'answer_kind'='general','Server classifies natural conversational answer, ignoring client kind';
assert public.marketing_inbox_faq_preview(c,'Hi')->'faq'='null'::jsonb,'Draft excluded';
denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'approve_faq',jsonb_build_object('id',f));exception when others then denied:=true;end;assert denied,'Custom conversational approval needs review confirmation';
perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'request_faq_review',jsonb_build_object('id',f));
perform public.marketing_inbox_configure(gen_random_uuid(),b,2,'approve_faq',jsonb_build_object('id',f,'review_confirmation','fact_free'));
assert public.marketing_inbox_faq_preview(c,'你好')->'faq'->>'id'=f::text,'Reviewed conversational Chinese alternate matches';
assert public.marketing_inbox_faq_preview(c,'Hai')->'faq'->>'id'=f::text,'Reviewed conversational Malay alternate matches';
r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Hours?","answer":"We open at 10am every day","language":"EN","reference_keys":[],"answer_kind":"general","template_key":"greeting"}');fact:=(r->>'id')::uuid;assert r->>'answer_kind'='factual','Cannot relabel hours as general';
denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'approve_faq',jsonb_build_object('id',fact,'review_confirmation','fact_free'));exception when others then denied:=true;end;assert denied,'Factual reply cannot bypass approved knowledge';
r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Unknown?","answer":"A bespoke zorbak assurance","language":"EN","reference_keys":[],"answer_kind":"general"}');assert r->>'answer_kind'='factual','Uncertain vocabulary fails closed';
perform public.marketing_save_knowledge(b,0,'{"identity":{"text":"Verified QA identity only","provenance":"verified_brand_fact"},"services":{"text":"Pending supplemental policy","provenance":"pending_verification"},"promotions":{"text":"External offer not a fact","provenance":"external_research","source_url":"https://example.invalid"}}');
perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'approve_knowledge');
r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Brand name?","answer":"Verified QA identity only","language":"EN","reference_keys":[]}');fact:=(r->>'id')::uuid;assert r->'reference_keys'='["identity"]','Exact current approved quote automatically links support';
denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'approve_faq',jsonb_build_object('id',fact));exception when others then denied:=true;end;assert denied,'Uncertain wording requires reviewer supported confirmation';
perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'approve_faq',jsonb_build_object('id',fact,'review_confirmation','supported'));
assert public.marketing_inbox_faq_preview(c,'Brand name?')->'faq'->>'id'=fact::text,'Supported approved factual reply works';
perform public.marketing_save_knowledge(b,1,'{"identity":{"text":"Superseding QA identity","provenance":"verified_brand_fact"}}');
assert public.marketing_inbox_faq_preview(c,'Brand name?')->'faq'='null'::jsonb,'Stale fact immediately excluded';
assert public.marketing_inbox_faq_preview(c,'Hi')->'faq'->>'id'=f::text,'Conversational approval independent of fact revision';
r:=public.marketing_knowledge_workspace(b);assert r->>'knowledge_approval_revision'='1','Readiness retains prior approval history';assert r->'canonical_outlets'='[]'::jsonb,'No fabricated Outlet mappings';
denied:=false;begin perform public.marketing_knowledge_workspace((select id from marketing_qa_ids where key='other_brand'));exception when insufficient_privilege then denied:=true;end;assert denied,'Canonical operational projection enforces Brand scope';
assert jsonb_array_length(public.marketing_faq_settings_read(b)->'faqs')=4,'Existing records reused in management projection';
-- Editing always clears conversational approval and attestation.
r:=public.marketing_inbox_configure(gen_random_uuid(),b,2,'save_faq',jsonb_build_object('id',f,'question','Hi','answer','Hello! Happy to help.','language','EN','reference_keys','[]'::jsonb));assert r->>'status'='draft' and r->>'review_confirmation' is null,'Edit clears exact-revision confirmation';
assert public.marketing_inbox_faq_preview(c,'Hi')->'faq'='null'::jsonb,'Edited answer never matches until new approval';
end;$$;
reset role;
do $$begin
 assert marketing_private.inbox_answer_requirement('您好，谢谢您的留言。有什么可以帮您？')='conversational','Chinese conversational classifier';
 assert marketing_private.inbox_answer_requirement('Hai! Terima kasih atas mesej anda.')='conversational','Malay conversational classifier';
 assert marketing_private.inbox_answer_requirement('Open for you')='factual','Operational claim guarded';
 assert not has_function_privilege('anon','public.marketing_knowledge_workspace(uuid)','EXECUTE'),'Anonymous facade denied';
 assert not has_function_privilege('authenticated','marketing_private.inbox_answer_requirement(text)','EXECUTE'),'Classifier is server-only';
end;$$;
select 'Knowledge/FAQ authority, natural-language review, stale support, multilingual matching and scope passed; fixtures rolled back' result;
rollback;
