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

do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');c uuid;v integer;f uuid;hours uuid;r jsonb;req uuid:=gen_random_uuid();begin
 r:=public.marketing_inbox_command(gen_random_uuid(),o,b,null,0,'create','{"title":"Assistant rollback-only case"}');c:=(r->'conversation'->>'id')::uuid;
 r:=public.marketing_inbox_command(gen_random_uuid(),o,b,c,1,'note','{"body":"Can you help?"}');v:=(r->'conversation'->>'version')::integer;
 insert into marketing_qa_ids values('conversation',c),('ai_request',req);
 r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Can you help?","answer":"Please tell our team how we can help.","category":"general","is_active":true}');f:=(r->>'id')::uuid;insert into marketing_qa_ids values('faq',f);
 r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Operating hours?","answer":"UNVERIFIED 24 HOURS","category":"operating_hours","is_active":true}');hours:=(r->>'id')::uuid;
 r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Inactive secret?","answer":"INACTIVE MUST NOT LEAK","category":"general","is_active":false}');
 perform public.marketing_inbox_configure(gen_random_uuid(),b,0,'policy','{"automation_mode":"suggest","ai_allowed":true,"staff_reply_requires_approval":true}');
 r:=public.marketing_inbox_ai_prepare(req,c,v,'reply');assert r->>'state'='prepared','Active FAQs work without duplicate Brand Knowledge';
 assert public.marketing_inbox_ai_prepare(gen_random_uuid(),c,v,'reply')->>'state'='generating','Different UUID cannot overlap';
end;$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare r jsonb;result jsonb;c uuid:=(select id from marketing_qa_ids where key='conversation');f uuid:=(select id from marketing_qa_ids where key='faq');req uuid:=(select id from marketing_qa_ids where key='ai_request');before_c jsonb;begin
 r:=public.marketing_inbox_ai_claim(req,(select id from marketing_qa_ids where key='employee'));
 assert r->>'deterministic_faq_id'=f::text,'Canonical matcher first';
 assert r::text not like '%INACTIVE MUST NOT LEAK%','Inactive FAQs excluded';
 assert r::text not like '%UNVERIFIED 24 HOURS%','Blocked operational answer excluded, only question and issue retained';
 assert r->'facts'='{}'::jsonb,'Unapproved intelligence not borrowed';
 select to_jsonb(x)-'intent'-'language'-'classification_source' into before_c from public.marketing_conversations x where id=c;
 result:=public.marketing_inbox_ai_finish(req,(r->>'lease')::uuid,jsonb_build_object('text','Please tell our team how we can help.','question','','language','EN','intent','unknown','human_required',false,'reference_keys',jsonb_build_array('faq:'||f::text||':1'),'matched_faq_ids',jsonb_build_array(f::text),'unresolved_questions','[]'::jsonb,'handoff_reasons','[]'::jsonb,'classification','suggestion_available','match_source','deterministic','latency_ms',0),'deterministic-faq',0,0);
 assert result->>'state'='completed','Finish success';
 assert (select cost from marketing_private.inbox_ai_runs where request_id=req)=0,'Deterministic usage cost is verified zero';
 assert not (select evidence ? 'history' from marketing_private.inbox_ai_runs where request_id=req),'No duplicate private message history in cache';insert into marketing_qa_ids values('artifact',(result->>'artifact_id')::uuid);
 assert before_c=(select to_jsonb(x)-'intent'-'language'-'classification_source' from public.marketing_conversations x where id=c),'AI never changes assignment/status/takeover/priority';
 assert public.marketing_inbox_ai_finish(req,(r->>'lease')::uuid,'{}','',0,0)->>'artifact_id'=result->>'artifact_id','Idempotent finish';
end;$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare r jsonb;c uuid:=(select id from marketing_qa_ids where key='conversation');f uuid:=(select id from marketing_qa_ids where key='faq');a uuid:=(select id from marketing_qa_ids where key='artifact');v integer;denied boolean:=false;begin
 v:=(public.marketing_inbox_detail(c)->'conversation'->>'version')::integer;
 assert public.marketing_inbox_ai_prepare(gen_random_uuid(),c,v,'reply')->>'cached'='true','Completed source/version cache';
 r:=public.marketing_inbox_command(gen_random_uuid(),(select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),c,v,'draft',jsonb_build_object('body','Edited staff reply','source_artifact',a));
 assert r->'draft'->>'status'='draft','Use Reply never approves or sends';
 assert r->'draft'->'source_references'->0->>'artifact_id'=a::text,'Edited suggestion retains source provenance';
 perform public.marketing_inbox_configure(gen_random_uuid(),(select id from marketing_qa_ids where key='brand'),1,'deactivate_faq',jsonb_build_object('id',f));
 begin perform public.marketing_inbox_command(gen_random_uuid(),(select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),c,v,'draft',jsonb_build_object('body','Stale answer','source_artifact',a));exception when others then denied:=true;end;assert denied,'Deactivated/stale source cannot be used';
 assert exists(select 1 from jsonb_array_elements(public.marketing_inbox_detail(c)->'artifacts') x where x->>'id'=a::text and x->>'state'='superseded'),'Read model hides stale source as usable suggestion';
 perform public.marketing_inbox_review_ai(a,false);
end;$$;
-- A later advisory handoff must not perform workflow mutations.
do $$declare r jsonb;c uuid:=(select id from marketing_qa_ids where key='conversation');v integer;req uuid:=gen_random_uuid();begin
 v:=(public.marketing_inbox_detail(c)->'conversation'->>'version')::integer;
 r:=public.marketing_inbox_command(gen_random_uuid(),(select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),c,v,'note','{"body":"I would like a real person"}');
 v:=(r->'conversation'->>'version')::integer;
 perform public.marketing_inbox_ai_prepare(req,c,v,'reply');insert into marketing_qa_ids values('handoff_request',req);
end;$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare req uuid:=(select id from marketing_qa_ids where key='handoff_request');c uuid:=(select id from marketing_qa_ids where key='conversation');r jsonb;before_c jsonb;begin
 r:=public.marketing_inbox_ai_claim(req,(select id from marketing_qa_ids where key='employee'));
 select to_jsonb(x)-'intent'-'language'-'classification_source' into before_c from public.marketing_conversations x where id=c;
 perform public.marketing_inbox_ai_finish(req,(r->>'lease')::uuid,'{"text":"A staff member needs to review this request.","language":"EN","intent":"sensitive","human_required":true,"reference_keys":[],"matched_faq_ids":[],"unresolved_questions":["Speak to a person"],"handoff_reasons":["human_request"],"classification":"needs_human_attention","match_source":"deterministic","latency_ms":0}','deterministic-faq',0,0);
 assert before_c=(select to_jsonb(x)-'intent'-'language'-'classification_source' from public.marketing_conversations x where id=c),'Handoff is advisory and never changes ownership/status/priority';
end;$$;
reset role;
do $$begin
 assert not has_function_privilege('anon','public.marketing_inbox_ai_prepare(uuid,uuid,integer,text)','EXECUTE'),'Anonymous preparation denied';
 assert not has_function_privilege('authenticated','public.marketing_inbox_ai_finish(uuid,uuid,jsonb,text,integer,integer,boolean)','EXECUTE'),'Client cannot forge provider evidence';
 assert not has_function_privilege('authenticated','marketing_private.inbox_assistant_material(uuid)','EXECUTE'),'Private context cannot be read directly';
end;$$;
select 'Assistant scope, active sources, operational guard, overlap/cache, exact receipts, editable drafts and stale evidence passed' result;
rollback;
