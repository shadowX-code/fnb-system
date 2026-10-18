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
do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');r jsonb;req uuid:=gen_random_uuid();begin
 r:=marketing_inbox_configure(req,b,0,'policy','{"automation_mode":"suggest","ai_allowed":true,"ai_reply_mode":"safe_auto"}');
 assert r->>'ai_reply_mode'='safe_auto','Explicit mode';assert marketing_inbox_configure(req,b,0,'policy','{"automation_mode":"suggest","ai_allowed":true,"ai_reply_mode":"safe_auto"}')=r,'Policy retry idempotent';
 r:=marketing_inbox_configure(gen_random_uuid(),b,0,'save_faq','{"question":"Can you help?","answer":"Please tell our team how we can help.","category":"general","is_active":true}');insert into marketing_qa_ids values('faq',(r->>'id')::uuid);
end;$$;
reset role;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');conn uuid:=gen_random_uuid();c uuid:=gen_random_uuid();m uuid:=gen_random_uuid();begin
 insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,credential_generation) values(conn,o,b,'facebook','999999999998','QA isolated automatic delivery','test_authorized',now()+interval '1 day','{"granted_scopes":["pages_messaging","pages_manage_metadata"],"execution_enabled":false}',1);
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id,expires_at) values(conn,'qa-rolled-back','{}','888',now()+interval '1 day');
 insert into marketing_private.inbox_authority(connection_id,generation,receive_verified,send_verified,webhook_verified,verified_at,page_id,page_tasks,granted_scopes) values(conn,1,true,true,true,now(),'999999999998',array['MESSAGING'],array['pages_messaging','pages_manage_metadata']);
 insert into marketing_conversations(id,organization_id,brand_id,channel,connection_id,participant_key,title,last_inbound_at,connection_generation) values(c,o,b,'facebook',conn,'777','QA automatic fixture',now(),1);
 assert not(select takeover from marketing_conversations where id=c),'New enabled Brand conversation routes to AI';
 insert into marketing_conversation_messages(id,conversation_id,kind,body,provider_message_id,occurred_at,evidence_source) values(m,c,'incoming','Can you help?','qa-automatic-1',now(),'signed_webhook');
 insert into marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,evidence_source) values(c,'incoming','Can you help?','qa-automatic-1',now(),'signed_webhook') on conflict do nothing;
 assert(select count(*) from marketing_private.inbox_automatic_turns where conversation_id=c)=1,'Webhook replay has one turn';
 insert into marketing_qa_ids values('connection',conn),('conversation',c),('message',m);
end;$$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare c uuid:=(select id from marketing_qa_ids where key='conversation');f uuid:=(select id from marketing_qa_ids where key='faq');r jsonb;done jsonb;d uuid;lease uuid;u uuid:=(select id from marketing_qa_ids where key='user');denied boolean;begin
 r:=marketing_inbox_auto_claim();assert r->>'deterministic_faq_id'=f::text,'Same deterministic matcher';
 assert marketing_inbox_auto_claim() is null,'Competing claim cannot generate twice';
 done:=marketing_inbox_auto_finish((r->>'turn_id')::uuid,(r->>'lease')::uuid,jsonb_build_object('text','UNTRUSTED MODEL TEXT','language','EN','intent','unknown','human_required',false,'reference_keys',jsonb_build_array('faq:'||f||':1'),'matched_faq_ids',jsonb_build_array(f::text),'unresolved_questions','[]'::jsonb,'handoff_reasons','[]'::jsonb,'classification','suggestion_available','match_source','deterministic','latency_ms',0),'deterministic-faq',0,0);
 assert done->>'state'='prepared','Safe automatic authorization';d:=(done->>'draft_id')::uuid;
 assert (select body from marketing_reply_drafts where id=d)='Please tell our team how we can help.','Only source-rendered text, never model prose';
 assert marketing_inbox_auto_finish((r->>'turn_id')::uuid,(r->>'lease')::uuid,'{}','',null,null)->>'state'='prepared','Finish retry cannot duplicate outbox';
 assert marketing_inbox_send_material(d,u)->>'text'='Please tell our team how we can help.','Shared send authority';
 -- Fresh knowledge and takeover are checked at delivery, not only generation.
 update marketing_inbox_faqs set is_active=false where id=f;
 denied:=false;begin perform marketing_inbox_send_material(d,u);exception when others then denied:=true;end;assert denied,'Stale knowledge blocks sending';
 update marketing_inbox_faqs set is_active=true where id=f;
 done:=marketing_inbox_send_checkpoint(d,u,null,'{"pending":true}');lease:=(done->>'lease')::uuid;
 denied:=false;begin perform marketing_inbox_send_checkpoint(d,u,null,'{"pending":true}');exception when others then denied:=true;end;assert denied,'One write-ahead lease';
 update marketing_conversations set takeover=true,version=version+1 where id=c;
 denied:=false;begin perform marketing_inbox_send_material(d,u);exception when others then denied:=true;end;assert denied,'Takeover blocks in-progress authorization';
 assert (select state from marketing_reply_outbox where draft_id=d)='reconciling','Uncertain intent preserved, never reset';
 assert marketing_inbox_auto_claim() is null,'No automatic retry after takeover';
 done:=marketing_inbox_send_checkpoint(d,u,lease,'{"receipt":"qa-controlled-receipt"}');assert done->>'state'='sent','Already in-flight receipt may still reconcile after takeover';
 assert(select state from marketing_private.inbox_automatic_turns where id=(r->>'turn_id')::uuid)='sent','Queue consumes canonical receipt';
 assert(select count(*) from marketing_reply_outbox where automatic_turn_id=(r->>'turn_id')::uuid)=1,'One durable delivery';
 insert into marketing_qa_ids values('turn',(r->>'turn_id')::uuid),('draft',d);
end;$$;
-- Multi-turn AI First: clarify, persist exact Outlet, then answer current canonical hours.
do $$declare c uuid:=(select id from marketing_qa_ids where key='conversation');b uuid:=(select id from marketing_qa_ids where key='brand');o uuid:=(select id from marketing_qa_ids where key='org');e uuid:=(select id from marketing_qa_ids where key='employee');u uuid:=(select id from marketing_qa_ids where key='user');x uuid:=gen_random_uuid();y uuid:=gen_random_uuid();r jsonb;done jsonb;ref text;d uuid;lease uuid;begin
 update marketing_inbox_policies set ai_reply_mode='ai_first',revision=revision+1 where brand_id=b;
 insert into outlets(id,name,code,location,is_active) values(x,'QA North Branch','QA-NORTH','QA North',true),(y,'QA South Branch','QA-SOUTH','QA South',true);
 insert into organization_outlets values(o,x),(o,y);insert into brand_outlets(organization_id,brand_id,outlet_id) values(o,b,x),(o,b,y);
 insert into outlet_service_profiles(outlet_id,revision,data,updated_by) values(x,1,jsonb_build_object('timezone','Asia/Kuala_Lumpur','phone','','email','','website','','service_policies','','weekly_hours',(select jsonb_agg(jsonb_build_object('day',n,'status','open','periods','[{"opens":"09:00","closes":"22:00","overnight":false}]'::jsonb)) from generate_series(0,6)n),'special_hours','[]'::jsonb),e);
 update marketing_conversations set takeover=false,version=version+1 where id=c;
 insert into marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,evidence_source) values(c,'incoming','Tonight still open ah?','qa-clarify',now(),'signed_webhook');
 update marketing_conversations set version=version+1,last_inbound_at=now() where id=c;
 r:=marketing_inbox_auto_claim();assert r->'outlet_context'->>'known'='false','Multi-Outlet unknown';
 done:=marketing_inbox_auto_finish((r->>'turn_id')::uuid,(r->>'lease')::uuid,'{"text":"Which outlet?","language":"EN","intent":"operating_hours","human_required":true,"reference_keys":[],"matched_faq_ids":[],"unresolved_questions":["Outlet?"],"handoff_reasons":[],"classification":"insufficient_knowledge","match_source":"deterministic","latency_ms":0}','deterministic-faq',0,0);
 assert done->>'state'='prepared','AI First clarifies safely';d:=(done->>'draft_id')::uuid;
 assert(select body from marketing_reply_drafts where id=d)='Which outlet do you mean?','Fixed clarification, no invented hours';
 assert marketing_inbox_auto_claim() is null,'A live delivery owner excludes a competing worker without handoff';
 assert(select state from marketing_private.inbox_automatic_turns where id=(r->>'turn_id')::uuid)='prepared','Competing worker cannot mark the active send uncertain';
 update marketing_private.inbox_automatic_turns set delivery_claimed_at=now()-interval '121 seconds' where id=(r->>'turn_id')::uuid;
 assert marketing_inbox_auto_claim()->>'delivery_only'='true','Expired delivery claim recovers the same prepared outbox without generation';
 assert marketing_inbox_auto_claim() is null,'Recovered delivery has one owner';
 done:=marketing_inbox_send_checkpoint(d,u,null,'{"pending":true}');lease:=(done->>'lease')::uuid;perform marketing_inbox_send_checkpoint(d,u,lease,'{"receipt":"qa-clarification-receipt"}');
 insert into marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,evidence_source) values(c,'incoming','QA North Branch, what are today hours?','qa-follow-up',now(),'signed_webhook');
 update marketing_conversations set version=version+1,last_inbound_at=now() where id=c;
 r:=marketing_inbox_auto_claim();assert r->'outlet_context'->>'outlet_id'=x::text,'Explicit customer Outlet reference survives follow-up';ref:='outlet:'||x;
 assert r->'history'->-1->>'text'='QA North Branch, what are today hours?','Equal timestamp chronology uses canonical sequence';
 done:=marketing_inbox_auto_finish((r->>'turn_id')::uuid,(r->>'lease')::uuid,jsonb_build_object('text','UNTRUSTED OPEN 24 HOURS','language','EN','intent','operating_hours','human_required',false,'reference_keys',jsonb_build_array(ref),'matched_faq_ids','[]'::jsonb,'unresolved_questions','[]'::jsonb,'handoff_reasons','[]'::jsonb,'classification','suggestion_available','match_source','deterministic','latency_ms',0),'deterministic-faq',0,0);
 assert done->>'state'='prepared','Supported multi-turn answer';d:=(done->>'draft_id')::uuid;
 assert(select body from marketing_reply_drafts where id=d) like '%09:00–22:00%','Canonical hours rendered';assert(select body from marketing_reply_drafts where id=d) not like '%24 HOURS%','Model prose cannot override source';
 update marketing_conversations set takeover=true,version=version+1 where id=c;
 assert(select state from marketing_reply_outbox where draft_id=d)='blocked','Takeover cancels queued delivery before write-ahead';
end;$$;
-- Explicit resume is the only ownership release; current authority and uncertain writes fail closed.
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare c public.marketing_conversations;r jsonb;req uuid:=gen_random_uuid();denied boolean:=false;begin
 select * into c from jsonb_populate_record(null::public.marketing_conversations,marketing_inbox_detail((select id from marketing_qa_ids where key='conversation'))->'conversation');
 begin perform marketing_inbox_command(gen_random_uuid(),c.organization_id,c.brand_id,c.id,c.version,'update','{"takeover":false}');exception when others then denied:=true;end;assert denied,'Generic update cannot bypass Resume AI';
 r:=marketing_inbox_ai_resume(req,c.id,c.version);assert r->>'resumed'='true','Explicit fresh resume';assert marketing_inbox_ai_resume(req,c.id,c.version)=r,'Resume replay idempotent';
end;$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare c public.marketing_conversations;p public.marketing_inbox_policies;r jsonb;t uuid;begin
 select * into c from marketing_conversations where id=(select id from marketing_qa_ids where key='conversation');select * into p from marketing_inbox_policies where brand_id=c.brand_id;
 assert marketing_private.inbox_auto_issue(c,p) is null,'Fresh resume eligible';
 c.connection_generation:=2;assert marketing_private.inbox_auto_issue(c,p)='channel_authority_unavailable','Generation drift';c.connection_generation:=1;
 c.last_inbound_at:=now()-interval '25 hours';assert marketing_private.inbox_auto_issue(c,p)='messaging_window_closed','Expired channel window';c.last_inbound_at:=now();
 p.ai_allowed:=false;assert marketing_private.inbox_auto_issue(c,p)='automatic_mode_disabled','Consent revocation';p.ai_allowed:=true;p.ai_reply_mode:='suggest_only';assert marketing_private.inbox_auto_issue(c,p)='automatic_mode_disabled','Mode revocation';
 insert into marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,evidence_source) values(c.id,'incoming','I need a human, refund please','qa-human-request',now(),'signed_webhook');
 r:=marketing_inbox_auto_claim();assert r is null,'Sensitive intent never calls provider';assert(select takeover from marketing_conversations where id=c.id),'Human request hands off';
 assert exists(select 1 from marketing_private.inbox_automatic_turns where conversation_id=c.id and reason='safety_or_human_request' and summary is not null),'Handoff retains concise context';
 -- New safe turn, followed by takeover while generation is in flight.
 update marketing_conversations set takeover=false,version=version+1 where id=c.id;
 insert into marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,evidence_source) values(c.id,'incoming','Can you help?','qa-late-generation',now(),'signed_webhook');
 r:=marketing_inbox_auto_claim();assert r->>'turn_id' is not null,'Next supported turn claimed';t:=(r->>'turn_id')::uuid;
 update marketing_conversations set takeover=true,version=version+1 where id=c.id;
 perform marketing_inbox_auto_finish(t,(r->>'lease')::uuid,'{"text":"Late answer","language":"EN","intent":"unknown","human_required":false,"reference_keys":[],"matched_faq_ids":[],"unresolved_questions":[],"handoff_reasons":[],"classification":"suggestion_available","match_source":"semantic","latency_ms":1}','gpt-5-mini',1,1);
 assert not exists(select 1 from marketing_reply_outbox where automatic_turn_id=t),'Late model result after takeover cannot send';
 assert not has_table_privilege('authenticated','marketing_private.inbox_automatic_turns','INSERT'),'No browser queue writes';
end;$$;
-- Per-conversation response cap is enforced before another model request.
do $$declare c uuid:=(select id from marketing_qa_ids where key='conversation');r jsonb;i int;begin
 update marketing_conversations set takeover=false,version=version+1 where id=c;
 for i in 1..8 loop
  insert into marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,evidence_source) values(c,'incoming','Can you help?','qa-cap-'||i,now(),'signed_webhook');
 end loop;
 update marketing_private.inbox_automatic_turns set state='sent' where message_id in(select id from marketing_conversation_messages where conversation_id=c and provider_message_id like 'qa-cap-%');
 insert into marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,evidence_source) values(c,'incoming','Can you help?','qa-cap-final',now(),'signed_webhook');
 r:=marketing_inbox_auto_claim();assert r is null,'Response cap avoids provider call';assert exists(select 1 from marketing_private.inbox_automatic_turns where conversation_id=c and reason='conversation_response_limit'),'Response cap hands off';
end;$$;
-- AI First uses the same renderer for safe clarification and never sends a business decision.
do $$declare a public.marketing_inbox_ai_artifacts;material jsonb;r jsonb;p public.marketing_inbox_policies;begin
 a.body:='{"language":"ZH","intent":"operating_hours","classification":"insufficient_knowledge","human_required":true,"reference_keys":[],"handoff_reasons":[],"unresolved_questions":["Outlet?"]}';
 material:='{"history":[{"kind":"incoming","text":"今晚几点关门？"}],"outlet_context":{"known":false,"eligible_count":2},"facts":{},"faqs":[]}';
 r:=marketing_private.inbox_auto_answer(a,material,'ai_first');assert r->>'kind'='clarify' and r->>'text'='请问你指的是哪一家分店？','Safe multilingual clarification';
 assert marketing_private.inbox_auto_answer(a,material,'safe_auto')->>'kind'='handoff','Safe Auto does not answer uncertainty';
 a.body:=jsonb_set(a.body,'{handoff_reasons}','["human_request"]');assert marketing_private.inbox_auto_answer(a,material,'ai_first')->>'kind'='handoff','Human request overrides clarification';
 select * into p from marketing_inbox_policies where brand_id=(select id from marketing_qa_ids where key='brand');
 assert marketing_private.inbox_ai_available(p),'Always available policy';p.ai_availability:='scheduled';p.ai_schedule:='{"days":[],"start":"09:00","end":"22:00"}';assert not marketing_private.inbox_ai_available(p),'Invalid days fail closed';
 assert not marketing_private.inbox_ai_schedule_valid('Invalid/Timezone','{"days":[1],"start":"09:00","end":"22:00"}'),'Invalid timezone';
 assert not marketing_private.inbox_ai_schedule_valid('Asia/Kuala_Lumpur','{"days":[1],"start":"10:00","end":"10:00"}'),'Equal times rejected';
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare r jsonb;denied boolean:=false;begin
 r:=marketing_inbox_ai_performance((select id from marketing_qa_ids where key='brand'));assert r->'delivery'->>'provider_accepted'='2','Generation and real receipt counters separate';assert r->'delivery'->>'delivered'='0','API acceptance is not signed delivery';
 begin perform marketing_inbox_ai_performance((select id from marketing_qa_ids where key='other_brand'));exception when others then denied:=true;end;assert denied,'Brand report isolation';
 assert not has_function_privilege('authenticated','marketing_inbox_auto_claim()','EXECUTE'),'Browser cannot claim';assert not has_function_privilege('authenticated','marketing_inbox_auto_finish(uuid,uuid,jsonb,text,integer,integer,uuid)','EXECUTE'),'Browser cannot forge automatic authorization';
end;$$;
reset role;

-- Exact test scope excludes other conversations before ownership and generation.
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');c uuid:=(select id from marketing_qa_ids where key='conversation');r jsonb;rev int;begin
 r:=marketing_faq_settings_read(b);rev:=(r->'policy'->>'revision')::int;
 r:=marketing_inbox_configure(gen_random_uuid(),b,rev,'policy',jsonb_build_object('automation_mode','suggest','ai_allowed',true,'ai_reply_mode','ai_first','ai_conversation_ids',jsonb_build_array(c)));
 assert r->'ai_conversation_ids'=jsonb_build_array(c),'Canonical exact conversation policy';
end;$$;
reset role;
do $$declare c public.marketing_conversations;p public.marketing_inbox_policies;x uuid:=gen_random_uuid();before_ int;begin
 select * into c from marketing_conversations where id=(select id from marketing_qa_ids where key='conversation');select * into p from marketing_inbox_policies where brand_id=c.brand_id;
 c.id:=x;assert marketing_private.inbox_auto_issue(c,p)='outside_automatic_scope','Other conversation fails before generation';
 insert into marketing_conversations(id,organization_id,brand_id,channel,connection_id,participant_key,title,last_inbound_at,connection_generation) values(x,c.organization_id,c.brand_id,'facebook',c.connection_id,'778','QA excluded customer',now(),1);
 assert(select takeover from marketing_conversations where id=x),'New excluded conversation stays human-owned';
 select count(*) into before_ from marketing_private.inbox_automatic_turns;
 insert into marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,evidence_source) values(x,'incoming','Can you help?','qa-excluded-signed',now(),'signed_webhook');
 assert(select count(*) from marketing_private.inbox_automatic_turns)=before_,'Excluded conversation never enqueues';
 assert marketing_private.inbox_auto_translation('Our brand name is QA Brand.','ZH')='我们的品牌是QA Brand。','Chinese preserves exact source entity';
 assert marketing_private.inbox_auto_translation('Our brand name is QA Brand.','BM')='Nama jenama kami ialah QA Brand.','Malay preserves exact source entity';
 assert marketing_private.inbox_auto_translation('Our brand name is QA Brand.','EN')='Our brand name is QA Brand.','English and Manglish source';
 assert marketing_private.inbox_auto_translation('Unverified translation of opening hours.','ZH') is null,'No model-certified free translation';
 assert marketing_private.inbox_auto_translation('欢迎光临。','EN') is null,'Unsupported reverse translation hands off';
end;$$;

-- Exercise the real ingestion authority, not only the after-insert queue trigger.
-- Isolated fixture events are synthetic; they do not establish provider delivery evidence.
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');conn uuid:=(select id from marketing_qa_ids where key='connection');c uuid:=gen_random_uuid();m uuid;result jsonb;mode_ text;before_ int;begin
 update marketing_inbox_policies set ai_conversation_ids=null,ai_reply_mode='safe_auto',ai_enabled_at=now(),revision=revision+1 where brand_id=b;
 insert into marketing_conversations(id,organization_id,brand_id,channel,connection_id,participant_key,title,last_inbound_at,connection_generation)
 select c,organization_id,brand_id,'facebook',id,'qa-semantic-peer','QA ingestion semantic regression',now(),credential_generation from marketing_connections where id=conn;
 foreach mode_ in array array['safe_auto','ai_first'] loop
  update marketing_inbox_policies set ai_reply_mode=mode_ where brand_id=b;
  insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint,evidence_source,due_at)
  values('qa-ingestion-'||mode_,conn,1,jsonb_build_object('kind','incoming','peer_id','qa-semantic-peer','event_id','qa-ingestion-'||mode_,'body','你们是什么品牌？','occurred_at',now()),'qa-isolated-'||mode_,'signed_webhook','2000-01-01');
  result:=marketing_inbox_process_events(1);assert result->>'processed'='1','Canonical ingestion succeeds';
  assert not(select takeover from marketing_conversations where id=c),'Legacy FAQ miss cannot preempt automatic semantic matching';
  assert(select cardinality(escalation_reasons) from marketing_conversations where id=c)=0,'No invented uncertainty before semantic matching';
  select id into m from marketing_conversation_messages where conversation_id=c and provider_message_id='qa-ingestion-'||mode_;
  assert(select state from marketing_private.inbox_automatic_turns where message_id=m)='queued','Semantic question remains queued for shared engine';
  assert not exists(select 1 from marketing_reply_drafts where conversation_id=c),'No parallel legacy draft';
 end loop;
 insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint,evidence_source,due_at)
 values('qa-ingestion-risk',conn,1,jsonb_build_object('kind','incoming','peer_id','qa-semantic-peer','event_id','qa-ingestion-risk','body','I need a refund','occurred_at',now()),'qa-isolated-risk','signed_webhook','2000-01-01');
 perform marketing_inbox_process_events(1);
 assert(select takeover and cardinality(escalation_reasons)>0 from marketing_conversations where id=c),'Ingestion safety escalation remains mandatory';
 assert not exists(select 1 from marketing_private.inbox_automatic_turns where conversation_id=c and state='queued'),'Risk cancels all queued work';
 assert exists(select 1 from marketing_private.inbox_automatic_turns t join marketing_conversation_messages m on m.id=t.message_id where t.conversation_id=c and m.provider_message_id='qa-ingestion-risk' and t.state='handoff' and t.reason='safety_or_human_request' and t.summary like '%refund%'),'Ingestion risk retains canonical handoff reason and context';
 update marketing_inbox_policies set ai_reply_mode='suggest_only' where brand_id=b;
 update marketing_conversations set takeover=false,escalation_reasons='{}' where id=c;
 insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint,evidence_source,due_at)
 values('qa-ingestion-suggest',conn,1,jsonb_build_object('kind','incoming','peer_id','qa-semantic-peer','event_id','qa-ingestion-suggest','body','unmatched legacy question','occurred_at',now()),'qa-isolated-suggest','signed_webhook','2000-01-01');
 perform marketing_inbox_process_events(1);
 assert(select takeover from marketing_conversations where id=c),'Suggest Only legacy handling preserved';
end;$$;

-- Multiple citations may support the same sentence; keep provenance without repeated prose.
do $$declare a public.marketing_inbox_ai_artifacts;material jsonb;r jsonb;f uuid:=gen_random_uuid();begin
 a.body:=jsonb_build_object('language','ZH','intent','brand_identity','classification','suggestion_available','human_required',false,'reference_keys',jsonb_build_array('identity','faq:'||f||':1'),'unresolved_questions','[]'::jsonb,'handoff_reasons','[]'::jsonb);
 material:=jsonb_build_object('history',jsonb_build_array(jsonb_build_object('kind','incoming','text','你们是什么品牌？')),'facts',jsonb_build_object('identity',jsonb_build_object('text','Our brand name is QA Brand.')),'faqs',jsonb_build_array(jsonb_build_object('id',f,'revision',1,'question','What is your brand name?','answer','Our brand name is QA Brand.','category','general')));
 r:=marketing_private.inbox_auto_answer(a,material,'safe_auto');
 assert r->>'text'='我们的品牌是QA Brand。','Identical translated identity and FAQ appear once';
 assert jsonb_array_length(r->'keys')=2,'Both provenance keys retained';
 material:=jsonb_set(material,'{facts,identity,text}','"A verified brand story."');
 material:=jsonb_set(material,'{history,0,text}','"What is your brand name?"');a.body:=jsonb_set(a.body,'{language}','"EN"');
 r:=marketing_private.inbox_auto_answer(a,material,'ai_first');
 assert r->>'text'='A verified brand story.'||chr(10)||'Our brand name is QA Brand.','Different facts use a real newline';
 assert position(chr(92)||'n' in r->>'text')=0,'No visible escaped separator';
end;$$;

select 'Automatic policy, shared generation, canonical text, replay, takeover, stale sources, receipts, clarification and Brand isolation passed' result;
rollback;
