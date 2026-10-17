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

do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');o uuid:=(select id from marketing_qa_ids where key='org');f uuid;fact uuid;r jsonb;c uuid;req uuid:=gen_random_uuid();denied boolean;payload jsonb;begin
r:=public.marketing_inbox_command(gen_random_uuid(),o,b,null,0,'create','{"title":"FAQ active-library rollback only"}');c:=(r->'conversation'->>'id')::uuid;insert into marketing_qa_ids values('conversation',c);
payload:='{"question":"Hi","answer":"Hey! How may we help you today?","category":"General","alternative_questions":["你好","Hai"],"is_active":true}';
r:=public.marketing_inbox_configure(req,b,0,'save_faq',payload);f:=(r->>'id')::uuid;
assert (r->>'is_active')::boolean and r->>'category'='general','Direct activation without knowledge';
assert public.marketing_inbox_configure(req,b,0,'save_faq',payload)=r,'Idempotent publication replay';
assert public.marketing_inbox_faq_preview(c,'你好')->'faq'->>'id'=f::text,'Chinese alternative';
assert public.marketing_inbox_faq_preview(c,'Hai')->'faq'->>'id'=f::text,'Malay alternative';
r:=public.marketing_inbox_command(gen_random_uuid(),o,b,c,1,'faq_draft',jsonb_build_object('faq_id',f));
assert r->'draft'->>'knowledge_revision' is null,'No duplicate Brand Knowledge dependency';
assert r->'draft'->'source_references'->0->>'faq_id'=f::text,'Published FAQ source pinned';
assert r->>'external_sent'='false','Use Reply never sends';
perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'deactivate_faq',jsonb_build_object('id',f));
assert public.marketing_inbox_faq_preview(c,'Hi')->'faq'='null'::jsonb,'Inactive excluded';
denied:=false;begin perform public.marketing_inbox_command(gen_random_uuid(),o,b,c,1,'faq_draft',jsonb_build_object('faq_id',f));exception when others then denied:=true;end;assert denied,'Inactive cannot create FAQ draft';
perform public.marketing_inbox_configure(gen_random_uuid(),b,2,'activate_faq',jsonb_build_object('id',f));
assert public.marketing_inbox_faq_preview(c,'Hi')->'faq'->>'id'=f::text,'Direct reactivation';
denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'deactivate_faq',jsonb_build_object('id',f));exception when serialization_failure then denied:=true;end;assert denied,'Stale revision denied';
r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Hours?","answer":"We open at 10am every day","category":"Operating Hours","is_active":true}');fact:=(r->>'id')::uuid;
assert (r->>'is_active')::boolean,'Operational answer may be managed active';
assert r->>'use_issue' is not null,'Unknown canonical hours explicitly unavailable';
assert public.marketing_inbox_faq_preview(c,'Hours?')->'faq'='null'::jsonb,'Unsupported facts not suggested';
r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"where is your outlet?","answer":"An invented address","category":"location","is_active":true}');
assert r->>'use_issue' is not null,'Unknown Outlet never inferred';
assert public.marketing_inbox_faq_preview(c,'where is your outlet?')->'faq'='null'::jsonb,'Unknown location excluded';
r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Need assistance?","answer":"Please tell our team how we can help.","category":"services","is_active":false}');
assert not (r->>'is_active')::boolean,'Save Inactive';
assert jsonb_array_length(public.marketing_faq_history(b,f)->'events')=3,'Publication history retained';
assert public.marketing_faq_history(b,f)->'events'->0->'details'->'before' is not null,'Before version retained';
denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),(select id from marketing_qa_ids where key='other_brand'),0,'save_faq',payload);exception when insufficient_privilege then denied:=true;end;assert denied,'Other Brand denied';
denied:=false;begin perform public.marketing_faq_history((select id from marketing_qa_ids where key='other_brand'),f);exception when insufficient_privilege then denied:=true;end;assert denied,'History Brand isolation';
denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Bad category?","answer":"Hello","category":"arbitrary","is_active":true}');exception when others then denied:=true;end;assert denied,'Stable categories enforced server-side';
denied:=false;begin perform public.marketing_inbox_configure(gen_random_uuid(),b,3,'approve_faq',jsonb_build_object('id',f));exception when others then denied:=true;end;assert denied,'Old approval command cannot publish';
end;$$;
-- AI context still requires its independent Brand Intelligence approval; legacy operational notes are excluded.
do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');c uuid;req uuid:=gen_random_uuid();begin
 select id into c from marketing_qa_ids where key='conversation';
 perform public.marketing_save_knowledge(b,0,'{"identity":{"text":"QA brand identity","provenance":"verified_brand_fact"},"services":{"text":"Legacy unowned operational claim","provenance":"verified_brand_fact"}}');
 perform public.marketing_inbox_configure(gen_random_uuid(),b,1,'approve_knowledge');
 perform public.marketing_inbox_configure(gen_random_uuid(),b,0,'policy','{"automation_mode":"suggest","ai_allowed":true,"staff_reply_requires_approval":true}');
 perform public.marketing_inbox_ai_prepare(req,c,1,'reply');
 insert into marketing_qa_ids values('ai_request',req);
end;$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare r jsonb;begin
 r:=public.marketing_inbox_ai_claim((select id from marketing_qa_ids where key='ai_request'),(select id from marketing_qa_ids where key='employee'));
 assert r->'facts' ? 'identity','Approved Brand Intelligence available';
 assert not (r->'facts' ? 'services'),'Legacy operational notes excluded from AI context';
 assert not (r->'facts' ? 'menu'),'No duplicate menu facts';
end;$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
-- Remove configuration permission: client UI is not the authority.
delete from public.role_permissions where role_id=(select id from marketing_qa_ids where key='role') and permission_id=(select id from public.permissions where code='marketing_inbox.configure');
set local role authenticated;
do $$declare denied boolean:=false;begin
 begin perform public.marketing_inbox_configure(gen_random_uuid(),(select id from marketing_qa_ids where key='brand'),0,'save_faq','{"question":"Unauthorized?","answer":"No","is_active":true}');exception when insufficient_privilege then denied:=true;end;assert denied,'Read-only user cannot activate';
end;$$;
reset role;
do $$begin
 assert not has_function_privilege('anon','public.marketing_faq_history(uuid,uuid)','EXECUTE'),'Anonymous history denied';
 assert not has_function_privilege('authenticated','marketing_private.inbox_faq_use_issue(public.marketing_inbox_faqs)','EXECUTE'),'Private guard not callable';
end;$$;
select 'Active FAQ publication, replay, revisions, multilingual matching, inactive exclusion, operational guard, history, scope and unsent drafts passed' result;
rollback;
