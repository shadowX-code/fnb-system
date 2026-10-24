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
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');denied boolean:=false;begin
 assert not (marketing_whatsapp_readiness(o,b,'100','101','v25.0','v4')->>'eligible')::boolean,'No platform evidence fails closed';
 begin perform marketing_whatsapp_begin(o,b,repeat('a',64),'100','101','v25.0','v4');exception when insufficient_privilege then denied:=true;end;assert denied,'No unapproved live signup';
 begin perform marketing_whatsapp_consume(gen_random_uuid(),(select id from marketing_qa_ids where key='user'),repeat('a',64));raise exception 'Browser reached service consume';exception when insufficient_privilege then null;end;
end;$$;
reset role;
insert into marketing_private.whatsapp_platform_readiness(app_id,config_id,graph_version,signup_version,business_verified,tech_provider_verified,access_verified,app_live,permissions_reviewed,webhook_reviewed,coexistence_enabled,evidence_reference,reviewed_at,expires_at)
values('100','101','v25.0','v4',true,true,true,true,true,true,true,'rollback-fixture-only',now(),now()+interval '1 hour');
insert into marketing_private.whatsapp_pilot_authority(brand_id,app_id,customer_business_id,waba_id,phone_id,approval_reference,expires_at)
select id,'100','202','200','201','rollback-fixture-only',now()+interval '1 hour' from marketing_qa_ids where key='brand';
set local role authenticated;
do $$declare s jsonb;begin
 assert (marketing_whatsapp_readiness((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),'100','101','v25.0','v4')->>'eligible')::boolean,'Approved exact platform and Brand eligible';
 s:=marketing_whatsapp_begin((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),repeat('a',64),'100','101','v25.0','v4');
 insert into marketing_qa_ids values('session',(s->>'id')::uuid);
end;$$;
reset role;
do $$declare s uuid:=(select id from marketing_qa_ids where key='session');u uuid:=(select id from marketing_qa_ids where key='user');r jsonb;proof jsonb;conn uuid;denied boolean;begin
 denied:=false;begin perform marketing_whatsapp_consume(s,gen_random_uuid(),repeat('a',64));exception when insufficient_privilege then denied:=true;end;assert denied,'Wrong callback actor denied';
 r:=marketing_whatsapp_consume(s,u,repeat('a',64));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 assert marketing_whatsapp_connections((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'))->>'signup_state'='action_required','Consumed unconfirmed exchange is visible';
 denied:=false;begin perform marketing_whatsapp_consume(s,u,repeat('a',64));exception when insufficient_privilege then denied:=true;end;assert denied,'Code session consumed once';
 proof:=jsonb_build_object('app_id','100','waba_id','200','phone_id','201','business_id','202','is_on_biz_app',true,'platform_type','CLOUD_API','subject','999','scopes',jsonb_build_array('whatsapp_business_management','whatsapp_business_messaging'),'expires_at',now()+interval '1 hour');
 denied:=false;begin perform marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof||'{"phone_id":"666"}');exception when others then denied:=true;end;assert denied,'Wrong exact phone rejected';
 denied:=false;begin perform marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof-'scopes');exception when others then denied:=true;end;assert denied,'Missing permission proof rejected';
 r:=marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof);conn:=(r->>'connection_id')::uuid;
 insert into marketing_qa_ids values('connection',conn);
 assert not marketing_private.whatsapp_receiving(conn),'OAuth alone cannot receive';
 assert (marketing_whatsapp_step(conn,u,1,'subscription')->>'perform')::boolean,'Durable first subscription intent';
 assert not (marketing_whatsapp_step(conn,u,1,'subscription')->>'perform')::boolean,'No duplicate subscription mutation';
 perform marketing_whatsapp_step(conn,u,1,'subscription','verified');
 assert marketing_private.whatsapp_receiving(conn),'Verified receive authority';
 perform marketing_whatsapp_step(conn,u,1,'contacts');perform marketing_whatsapp_step(conn,u,1,'contacts','uncertain');
 assert not (marketing_whatsapp_step(conn,u,1,'contacts')->>'perform')::boolean,'Uncertain sync never retried';
 perform marketing_whatsapp_step(conn,u,1,'contacts','accepted','support-readback-fixture');
 perform marketing_whatsapp_step(conn,u,1,'history');perform marketing_whatsapp_step(conn,u,1,'history','accepted','history-fixture');
 perform marketing_whatsapp_lifecycle(jsonb_build_array(jsonb_build_object('field','history','waba_id','200','phone_id','666','occurred_at',clock_timestamp(),'hash',repeat('b',64),'progress',100,'sealed_payload','{"version":1}')));
 assert not(select sync_observed from marketing_private.whatsapp_onboarding where connection_id=conn),'Wrong sync phone ignored';
 perform marketing_whatsapp_lifecycle(jsonb_build_array(jsonb_build_object('field','history','waba_id','200','phone_id','201','occurred_at',clock_timestamp(),'hash',repeat('b',64),'progress',100,'sealed_payload','{"version":1}')));
 assert(select sync_progress=100 from marketing_private.whatsapp_onboarding where connection_id=conn),'History completion is generation-bound evidence';
 assert not exists(select 1 from platform_customers where organization_id=(select id from marketing_qa_ids where key='org')),'No CRM identity inferred';
 assert not exists(select 1 from marketing_consent_evidence where brand_id=(select id from marketing_qa_ids where key='brand')),'No consent inferred';
 assert (select not send_verified and not execution_enabled from marketing_private.inbox_authority where connection_id=conn),'Sending remains disabled';
end;$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','service_role')::text,true);
do $$declare conn uuid:=(select id from marketing_qa_ids where key='connection');c uuid;ev jsonb;edit jsonb;rev jsonb;r jsonb;original jsonb;before_window timestamptz;t timestamptz:=clock_timestamp()+interval '1 second';u uuid:=(select id from marketing_qa_ids where key='user');begin
 assert marketing_private.whatsapp_receiving(conn),'Synthetic receive authority remains verified';
 ev:=jsonb_build_object('channel','whatsapp','account_id','201','waba_id','200','peer_id','60110000000','kind','incoming','event_id','wamid.original','occurred_at',t,'body','Immutable original','medium','dm');
 edit:=ev||jsonb_build_object('kind','edit','event_id','wamid.edit','target_message_id','wamid.original','target_direction','incoming','body','Edited content','occurred_at',t+interval '2 seconds');
 -- Correction before original: acknowledge durable evidence, no manufactured conversation.
 perform marketing_inbox_receive(jsonb_build_array(edit,edit));
 update marketing_private.inbox_events set due_at=now()-interval '100 years' where connection_id=conn;
 perform marketing_inbox_process_events(1);
 assert not exists(select 1 from marketing_conversations where connection_id=conn),'Orphan correction creates no conversation';
 r:=marketing_inbox_receive(jsonb_build_array(ev,ev||'{}',edit||'{"event_id":"wamid.bad","occurred_at":"invalid"}'));
 assert r->>'accepted'='1' and r->>'duplicates'='1' and r->>'unbound'='1','Malformed normalized sibling cannot reject valid/duplicate messages';
 update marketing_private.inbox_events set due_at=now()-interval '100 years' where connection_id=conn;
 perform marketing_inbox_process_events(1);
 select id,last_inbound_at into c,before_window from marketing_conversations where connection_id=conn;
 assert c is not null,'Canonical worker creates original conversation';
 select to_jsonb(m) into original from marketing_conversation_messages m where conversation_id=c and kind='incoming';
 assert (marketing_private.whatsapp_message_state((select m from marketing_conversation_messages m where conversation_id=c and kind='incoming'))->>'body')='Edited content','Early edit reconciles on original';
 assert (select count(*) from marketing_conversation_messages where conversation_id=c and kind='edit')=1,'One append-only edit';
 -- Earlier edits cannot regress current content; a cross-peer/direction target cannot apply.
 perform marketing_inbox_receive(jsonb_build_array(edit||jsonb_build_object('event_id','wamid.earlier','body','Earlier edit','occurred_at',t+interval '1 second'),edit||'{"event_id":"wamid.peer","peer_id":"60119999999"}',edit||'{"event_id":"wamid.direction","target_direction":"outgoing"}',edit||jsonb_build_object('event_id','wamid.brand','brand_id',(select id from marketing_qa_ids where key='other_brand')),edit||'{"event_id":"wamid.stale","generation":0}',edit||'{"event_id":"wamid.phone","account_id":"999"}'));
 update marketing_private.inbox_events set due_at=now()-interval '100 years' where connection_id=conn;
 perform marketing_inbox_process_events(3);
 assert (marketing_private.whatsapp_message_state((select m from marketing_conversation_messages m where conversation_id=c and kind='incoming'))->>'body')='Edited content','Timestamp/direction/peer scope retained';
 assert (select count(*) from marketing_conversations where connection_id=conn)=1,'Wrong peer cannot create a conversation';
 rev:=edit||jsonb_build_object('kind','revoke','event_id','wamid.revoke','body','','occurred_at',t+interval '3 seconds');
 perform marketing_inbox_receive(jsonb_build_array(rev,rev,edit||jsonb_build_object('event_id','wamid.late','body','Must stay deleted','occurred_at',t+interval '4 seconds')));
 update marketing_private.inbox_events set due_at=now()-interval '100 years' where connection_id=conn;
 perform marketing_inbox_process_events(2);
 assert original=(select to_jsonb(m) from marketing_conversation_messages m where conversation_id=c and kind='incoming'),'Original evidence unchanged';
 assert (select last_inbound_at from marketing_conversations where id=c)=before_window,'Corrections never reopen reply window';
 assert (marketing_private.whatsapp_message_state((select m from marketing_conversation_messages m where conversation_id=c and kind='incoming'))->>'provider_lifecycle') is not null,'Lifecycle projection present';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 r:=marketing_inbox_detail(c);
 assert r->>'total'='1' and r->'messages'->0->>'body'='Message deleted on WhatsApp','Stable timeline identity/count with revoke precedence';
 assert (r->'messages'->0->>'occurred_at')::timestamptz=(ev->>'occurred_at')::timestamptz,'Original chronology retained';
 assert marketing_inbox_read((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),'','whatsapp','Immutable original')->>'total'='0','Search cannot match superseded original';
 assert marketing_inbox_read((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),'','whatsapp')->'rows'->0->>'latest_message'='Message deleted on WhatsApp','Preview uses canonical current state';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','service_role')::text,true);
 -- A revoke preceding its mobile echo reconciles without rewriting the mobile evidence.
 rev:=rev||'{"event_id":"wamid.mobile-revoke","target_message_id":"wamid.mobile","target_direction":"outgoing"}';
 perform marketing_inbox_receive(jsonb_build_array(rev));
 update marketing_private.inbox_events set due_at=now()-interval '100 years' where connection_id=conn;perform marketing_inbox_process_events(1);
 assert not exists(select 1 from marketing_conversation_messages where provider_message_id='wamid.mobile-revoke'),'Orphan revoke not rendered as a new message';
 perform marketing_inbox_receive(jsonb_build_array(ev||'{"kind":"echo","event_id":"wamid.mobile","body":"Mobile original"}'));
 update marketing_private.inbox_events set due_at=now()-interval '100 years' where connection_id=conn;perform marketing_inbox_process_events(1);
 assert (select body from marketing_conversation_messages where conversation_id=c and provider_message_id='wamid.mobile')='Mobile original','Mobile evidence immutable';
 assert (marketing_private.whatsapp_message_state((select m from marketing_conversation_messages m where conversation_id=c and provider_message_id='wamid.mobile'))->'provider_lifecycle'->>'kind')='revoke','Early mobile revoke reconciled';
 assert (select last_inbound_at from marketing_conversations where id=c)=before_window,'Mobile corrections never open window';
 assert not has_function_privilege('authenticated','marketing_private.whatsapp_reconcile_changes(uuid,integer)','execute'),'No client lifecycle writer';
 assert not has_function_privilege('anon','marketing_private.whatsapp_message_state(public.marketing_conversation_messages)','execute'),'No anonymous lifecycle reader';
 -- Queued current-generation correction is fenced before worker drain after reconnect.
 perform marketing_inbox_receive(jsonb_build_array(edit||'{"event_id":"wamid.old-generation"}'));
 update marketing_connections set credential_generation=credential_generation+1 where id=conn;
 update marketing_private.inbox_events set due_at=now()-interval '100 years' where connection_id=conn;
 perform marketing_inbox_process_events(1);
 assert exists(select 1 from marketing_private.inbox_events where connection_id=conn and payload->>'event_id'='wamid.old-generation' and state='blocked'),'Stale queued correction blocked';
 assert not exists(select 1 from marketing_conversation_messages where provider_message_id='wamid.old-generation'),'No stale lifecycle evidence';
 assert not exists(select 1 from marketing_private.inbox_automatic_turns where conversation_id=c),'No automation';
 assert not exists(select 1 from platform_customers where organization_id=(select id from marketing_qa_ids where key='org')),'No inferred CRM identity';
 assert not exists(select 1 from marketing_consent_evidence where brand_id=(select id from marketing_qa_ids where key='brand')),'No inferred consent';
end;$$;
rollback;
