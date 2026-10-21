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
 perform marketing_whatsapp_record_verification(conn,u,1,'{"issue":"coexistence_unsupported"}');
 assert not marketing_private.whatsapp_receiving(conn),'Unsupported closes receive gate';
 perform marketing_whatsapp_record_verification(conn,u,1,proof);
end;$$;

do $$declare c uuid:=(select id from marketing_qa_ids where key='connection');u uuid:=(select id from marketing_qa_ids where key='user');o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');req uuid:=gen_random_uuid();r jsonb;proof jsonb;s uuid;denied boolean;fb uuid;begin
 proof:=jsonb_build_object('app_id','100','waba_id','200','phone_id','201','business_id','202','is_on_biz_app',true,'platform_type','CLOUD_API','subject','999','scopes',jsonb_build_array('whatsapp_business_management','whatsapp_business_messaging'),'expires_at',now()+interval '1 hour');
 insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint,due_at) values('wa.lifecycle.old',c,1,'{}','fixture',now()-interval '100 years');
 r:=marketing_whatsapp_local_command(req,c,1,'pause');
 assert r=marketing_whatsapp_local_command(req,c,1,'pause'),'Exact shutdown retry is idempotent';
 assert (marketing_whatsapp_local_command(req,c,1,'pause'))->>'generation'='2' and r->>'provider_offboarded'='false','Pause is local and fences generation';
 assert not marketing_private.whatsapp_receiving(c),'Paused receiving disabled';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','service_role')::text,true);
 r:=marketing_inbox_receive(jsonb_build_array(jsonb_build_object('channel','whatsapp','account_id','201','waba_id','200','peer_id','60110000000','kind','incoming','event_id','wamid.paused','occurred_at',clock_timestamp(),'body','Do not retain paused content','medium','dm')));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 assert r->>'accepted'='0' and not exists(select 1 from marketing_private.inbox_events where payload->>'event_id'='wamid.paused'),'Paused live content is discarded';
 perform marketing_whatsapp_lifecycle(jsonb_build_array(jsonb_build_object('field','history','waba_id','200','phone_id','201','occurred_at',clock_timestamp(),'hash',repeat('9',64),'progress',100,'sealed_payload','{"version":1}')));
 assert exists(select 1 from marketing_private.whatsapp_lifecycle_events where connection_id=c and generation=2 and sealed_payload is null),'Paused sync retains minimal completion evidence only';

 assert exists(select 1 from marketing_private.credentials where connection_id=c),'Pause retains encrypted authorization';
 assert exists(select 1 from marketing_private.inbox_events where event_key='wa.lifecycle.old' and state='blocked'),'Pause blocks queued events';
 assert(select provider_account_id='201' and whatsapp_waba_id='200' from marketing_connections where id=c),'Pause preserves identity';
 denied:=false;begin perform marketing_whatsapp_record_verification(c,u,1,proof);exception when others then denied:=true;end;assert denied,'Stale verified callback fenced';
 denied:=false;begin perform marketing_whatsapp_record_verification(c,u,2,proof);exception when others then denied:=true;end;assert denied,'Verification cannot silently unpause';
 denied:=false;begin perform marketing_whatsapp_record_verification(c,u,2,proof||jsonb_build_object('resume_receiving',true,'expires_at',now()-interval '1 hour'));exception when others then denied:=true;end;assert denied,'Expired provider proof cannot resume';
 denied:=false;begin update marketing_private.credentials set sealed_token=null where connection_id=c;perform marketing_whatsapp_record_verification(c,u,2,proof||'{"resume_receiving":true}');exception when others then denied:=true;end;assert denied,'Missing retained credential cannot resume';
 perform marketing_whatsapp_record_verification(c,u,2,proof||'{"resume_receiving":true}');
 assert(select whatsapp_local_state='active' and status='test_authorized' from marketing_connections where id=c),'Verified explicit resume';
 perform marketing_whatsapp_step(c,u,2,'subscription');perform marketing_whatsapp_step(c,u,2,'subscription','verified');
 assert marketing_private.whatsapp_receiving(c),'Resumed receive authority reverified';
 update marketing_connections set expires_at=now()-interval '1 minute' where id=c;
 perform marketing_meta_housekeeping();assert(select status='expired' from marketing_connections where id=c),'Existing worker expires verification';
 perform marketing_whatsapp_record_verification(c,u,2,proof);
 assert(select status='test_authorized' and expires_at>now() from marketing_connections where id=c),'Verified expired authorization restored';
 assert marketing_private.whatsapp_receiving(c),'Recovery restores eligible receiving';
 denied:=false;begin update marketing_private.whatsapp_sync_receipts set request_id='changed' where connection_id=c and event='accepted';exception when others then denied:=true;end;assert denied,'Receipt immutable';
 denied:=false;begin delete from marketing_private.whatsapp_sync_receipts where connection_id=c;exception when others then denied:=true;end;assert denied,'Receipt deletion prohibited';
 update marketing_connections set expires_at=now()-interval '2 days' where id=c;
 update marketing_private.credentials set expires_at=now()-interval '2 days' where connection_id=c;
 perform marketing_meta_housekeeping();
 assert not exists(select 1 from marketing_private.credentials where connection_id=c),'Existing worker clears stale credential';
 assert(select count(*)=2 from marketing_private.whatsapp_sync_receipts where connection_id=c and event='accepted'),'Accepted receipts survive cleanup';
 assert exists(select 1 from marketing_private.whatsapp_onboarding where connection_id=c),'Cleanup retains synchronization state';
 denied:=false;begin perform marketing_whatsapp_record_verification(c,u,2,proof);exception when others then denied:=true;end;assert denied,'Removed credential requires fresh authorization';
 r:=marketing_whatsapp_begin(o,b,repeat('c',64),'100','101','v25.0','v4',c,2);s:=(r->>'id')::uuid;
 perform marketing_whatsapp_consume(s,u,repeat('c',64));perform marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof);
 assert(select credential_generation=3 from marketing_connections where id=c),'Cleanup reconnect increments generation';
 assert marketing_whatsapp_step(c,u,3,'contacts')->>'state'='accepted','Contacts never replay after cleanup';
 assert marketing_whatsapp_step(c,u,3,'history')->>'state'='accepted','History never replays after cleanup';
 denied:=false;begin perform marketing_whatsapp_local_command(gen_random_uuid(),c,2,'disconnect');exception when others then denied:=true;end;assert denied,'Stale local disconnect rejected';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_user_id from employees where id=(select id from marketing_qa_ids where key='other_employee')),'role','authenticated')::text,true);
 denied:=false;begin perform marketing_whatsapp_local_command(gen_random_uuid(),c,3,'disconnect');exception when others then denied:=true;end;assert denied,'Unauthorized actor cannot disconnect';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 r:=marketing_whatsapp_local_command(gen_random_uuid(),c,3,'disconnect');
 assert r->>'generation'='4' and r->>'local_state'='disconnected','Canonical local disconnect succeeds';
 assert not exists(select 1 from marketing_private.credentials where connection_id=c),'Disconnect removes authorization';
 assert(select provider_account_id='201' and whatsapp_waba_id='200' and status='not_connected' from marketing_connections where id=c),'Disconnect reserves identity';
 assert(select count(*)=2 from marketing_private.whatsapp_sync_receipts where connection_id=c and event='accepted'),'Disconnect retains immutable receipts';
 r:=marketing_whatsapp_begin(o,b,repeat('d',64),'100','101','v25.0','v4',c,4);s:=(r->>'id')::uuid;
 perform marketing_whatsapp_consume(s,u,repeat('d',64));perform marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof);
 assert(select credential_generation=5 and whatsapp_local_state='active' from marketing_connections where id=c),'Same-number reconnect after disconnect';
 assert not(marketing_whatsapp_step(c,u,5,'history')->>'perform')::boolean,'No second history request';
 -- FB/IG continue to use the original disconnect behavior.
 insert into marketing_connections(organization_id,brand_id,channel,provider_account_id,account_name,status,credential_generation) values(o,b,'facebook','999991','Synthetic Facebook','test_authorized',1) returning id into fb;
 perform marketing_meta_disconnect(fb);
 assert(select status='not_connected' and provider_account_id is null from marketing_connections where id=fb),'FB disconnect unchanged';
 assert not(select capabilities->>'sending'='true' or capabilities->>'ai'='true' from marketing_connections where id=c),'Sending and AI remain disabled';
end;$$;
-- A staged pilot pins business and approved phone hash before Meta returns asset IDs.
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='other_brand');e uuid:=(select id from marketing_qa_ids where key='employee');u uuid:=(select id from marketing_qa_ids where key='user');s uuid;s2 uuid;c uuid;r jsonb;proof jsonb;denied boolean;begin
 insert into platform_member_brands(organization_id,employee_id,brand_id) values(o,e,b);
 insert into marketing_private.whatsapp_platform_readiness select '110','111',graph_version,signup_version,business_verified,tech_provider_verified,access_verified,app_live,permissions_reviewed,webhook_reviewed,coexistence_enabled,evidence_reference,reviewed_at,expires_at from marketing_private.whatsapp_platform_readiness where app_id='100';
 insert into marketing_private.whatsapp_pilot_authority(brand_id,app_id,customer_business_id,approved_phone_hash,approval_reference,expires_at) values(b,'110','212',repeat('e',64),'rollback-only',now()+interval '1 hour');
 r:=marketing_whatsapp_begin(o,b,repeat('e',64),'110','111','v25.0','v4');s:=(r->>'id')::uuid;
 r:=marketing_whatsapp_begin(o,b,repeat('f',64),'110','111','v25.0','v4');s2:=(r->>'id')::uuid;
 perform marketing_whatsapp_consume(s,u,repeat('e',64));
 proof:=jsonb_build_object('app_id','110','waba_id','210','phone_id','211','business_id','212','approved_phone_hash',repeat('e',64),'is_on_biz_app',true,'platform_type','CLOUD_API','subject','999','scopes',jsonb_build_array('whatsapp_business_management','whatsapp_business_messaging'),'expires_at',now()+interval '1 hour');
 denied:=false;begin perform marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof||jsonb_build_object('approved_phone_hash',repeat('a',64)));exception when others then denied:=true;end;assert denied,'Different number cannot consume staged approval';
 denied:=false;begin perform marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof||'{"business_id":"666"}');exception when others then denied:=true;end;assert denied,'Wrong business rejected';
 denied:=false;begin perform marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof||'{"phone_id":"201"}');exception when others then denied:=true;end;assert denied,'An already owned phone cannot cross Brands';
 assert(select phone_id is null from marketing_private.whatsapp_pilot_authority where brand_id=b),'Rejected bind leaves intent unresolved';
 r:=marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof);
 assert(select phone_id='211' and waba_id='210' from marketing_private.whatsapp_pilot_authority where brand_id=b),'Verified provider IDs atomically resolve staged intent';
 perform marketing_whatsapp_consume(s2,u,repeat('f',64));
 denied:=false;begin perform marketing_whatsapp_bind(s2,u,'{"version":1,"ciphertext":"synthetic-only"}',proof);exception when others then denied:=true;end;assert denied,'Concurrent stale staged callback rejected';
 assert(select count(*)=1 from marketing_connections where brand_id=b and channel='whatsapp'),'One canonical staged binding';
 select id into c from marketing_connections where brand_id=b and channel='whatsapp';
 perform marketing_whatsapp_step(c,u,1,'subscription');perform marketing_whatsapp_step(c,u,1,'subscription','verified');
 perform marketing_whatsapp_step(c,u,1,'contacts');perform marketing_whatsapp_step(c,u,1,'contacts','uncertain');
 perform marketing_whatsapp_local_command(gen_random_uuid(),c,1,'disconnect');
 r:=marketing_whatsapp_begin(o,b,repeat('7',64),'110','111','v25.0','v4',c,2);s:=(r->>'id')::uuid;
 perform marketing_whatsapp_consume(s,u,repeat('7',64));perform marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof);
 assert marketing_whatsapp_step(c,u,3,'contacts')->>'state'='uncertain','Uncertain one-shot result survives credential removal and reconnect';
 assert not(marketing_whatsapp_step(c,u,3,'contacts')->>'perform')::boolean,'Uncertain synchronization is never replayed';

end;$$;
rollback;
