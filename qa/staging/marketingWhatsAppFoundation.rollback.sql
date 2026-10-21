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
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');req uuid:=gen_random_uuid();r jsonb;denied boolean;begin
 r:=marketing_whatsapp_register(req,o,b,'990001','990002','coexistence','Synthetic WhatsApp');
 assert marketing_whatsapp_register(req,o,b,'990001','990002','coexistence','Synthetic WhatsApp')=r,'Exact registration retry';
 insert into marketing_qa_ids values('connection',(r->>'connection_id')::uuid);
 denied:=false;begin perform marketing_whatsapp_register(gen_random_uuid(),o,(select id from marketing_qa_ids where key='other_brand'),'990001','990002','coexistence','Forbidden');exception when others then denied:=true;end;assert denied,'Wrong Brand cannot reserve phone';
 denied:=false;begin perform marketing_whatsapp_register(gen_random_uuid(),o,b,'990003','990002','coexistence','Duplicate');exception when others then denied:=true;end;assert denied,'Phone has one owner';
 assert marketing_whatsapp_connections(o,b)->>'sending_enabled'='false','Disabled scoped read';
 denied:=false;begin perform marketing_whatsapp_connections((select id from marketing_qa_ids where key='other_org'),null);exception when insufficient_privilege then denied:=true;end;assert denied,'Cross tenant denied';
 denied:=false;begin perform public.marketing_inbox_receive('[]');exception when insufficient_privilege then denied:=true;end;assert denied,'Browser cannot ingest signed events';
end;$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare conn uuid:=(select id from marketing_qa_ids where key='connection');r jsonb;ev jsonb;bad jsonb;c uuid;d uuid:=gen_random_uuid();lease uuid:=gen_random_uuid();u uuid:=(select id from marketing_qa_ids where key='user');denied boolean;n integer;begin
 -- Synthetic authority/credential placeholders exist only inside this rollback transaction.
 update marketing_connections set status='test_authorized',expires_at=now()+interval '1 hour',connected_at=now()-interval '1 minute' where id=conn;
 update marketing_private.inbox_authority set receive_verified=true,configuration_verified=true,granted_scopes=array['whatsapp_business_management','whatsapp_business_messaging'] where connection_id=conn;
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(conn,'synthetic-rollback-only','{"test_only":true}');
 ev:=jsonb_build_object('channel','whatsapp','account_id','990002','waba_id','990001','peer_id','60110000000','kind','incoming','event_id','wamid.fixture','occurred_at',now(),'body','Hello','medium','dm');
 r:=marketing_inbox_receive(jsonb_build_array(ev,ev));assert r->>'accepted'='1' and r->>'duplicates'='1','Exact ID dedup';
 for bad in select ev||x from (values('{"waba_id":"wrong"}'::jsonb),('{"account_id":"990099"}'::jsonb),(jsonb_build_object('brand_id',(select id from marketing_qa_ids where key='other_brand'))),('{"generation":0}'::jsonb)) t(x) loop
  if bad->>'waba_id'='wrong' then bad:=bad||'{"waba_id":"990099"}';end if;
  assert marketing_inbox_receive(jsonb_build_array(bad))->>'accepted'='0','Wrong phone/WABA/Brand/generation rejected';
 end loop;
 update marketing_private.inbox_events set due_at=now()-interval '10 years' where connection_id=conn;
 perform marketing_inbox_process_events(1);
 select id into c from marketing_conversations where connection_id=conn;
 assert c is not null,'Shared worker creates Inbox conversation';
 assert(select takeover from marketing_conversations where id=c),'Human ownership by default';
 assert not exists(select 1 from marketing_private.inbox_automatic_turns where conversation_id=c),'No automatic turn';
 assert not exists(select 1 from platform_customers where organization_id=(select id from marketing_qa_ids where key='org')),'No CRM identity inferred';
 insert into marketing_reply_drafts(id,conversation_id,body,source_version,provenance,created_by,status) select d,c,'Synthetic unsent fixture',version,'human',(select id from marketing_qa_ids where key='employee'),'approved' from marketing_conversations where id=c;
 insert into marketing_reply_outbox(draft_id,state,reason,lease,sent_at) values(d,'reconciling','delivery_receipt_unknown',lease,now());
 denied:=false;begin perform marketing_inbox_send_material(d,u);exception when insufficient_privilege then denied:=true;end;assert denied,'Database send hard disabled';
 -- Receipts arrive before the outbox provider ID, in reverse order and duplicated.
 ev:=ev||'{"kind":"status","event_id":"wamid.outbound","body":"","provider_status":"read"}';
 perform marketing_inbox_receive(jsonb_build_array(ev,ev,ev||'{"provider_status":"sent"}',ev||'{"provider_status":"delivered"}',ev||'{"provider_status":"failed","error_code":"131000"}'));
 update marketing_private.inbox_events set due_at=now()-interval '10 years' where connection_id=conn;
 perform marketing_inbox_process_events(4);
 assert(select state from marketing_reply_outbox where draft_id=d)='reconciling','Unknown receipt never guessed or retried';
 r:=marketing_inbox_send_checkpoint(d,u,lease,'{"receipt":"wamid.outbound"}');assert r->>'state'='read','Checkpoint returns authoritative reconciled result';
 assert(select state from marketing_reply_outbox where draft_id=d)='read','Early exact receipts reconcile monotonically';
 assert(select count(*) from marketing_conversation_messages where conversation_id=c)=1,'Receipts never duplicate chat';
 -- A mobile reply is observed as external and does not open an inbound window.
 ev:=(ev||'{"kind":"echo","event_id":"wamid.mobile","body":"Staff replied"}'::jsonb)-'provider_status';
 perform marketing_inbox_receive(jsonb_build_array(ev));update marketing_private.inbox_events set due_at=now()-interval '10 years' where connection_id=conn;perform marketing_inbox_process_events(1);
 assert(select count(*) from marketing_private.inbox_automatic_turns where conversation_id=c)=0,'Mobile staff cannot trigger AI';
 assert marketing_private.inbox_automation_issue(conn)='automation_owner_not_feedx','Ownership safeguards retained';
 -- A queued old-generation event is never adopted after reconnection.
 ev:=ev||'{"kind":"incoming","event_id":"wamid.stale"}';perform marketing_inbox_receive(jsonb_build_array(ev));
 update marketing_connections set credential_generation=2,connected_at=now() where id=conn;
 update marketing_private.inbox_events set due_at=now()-interval '10 years' where connection_id=conn;perform marketing_inbox_process_events(1);
 assert exists(select 1 from marketing_private.inbox_events where connection_id=conn and payload->>'event_id'='wamid.stale' and state='blocked'),'Stale generation blocked';
 assert(select count(*) from marketing_conversations where connection_id=conn)=1,'No cross-generation conversation';
 assert not exists(select 1 from marketing_consent_evidence where brand_id=(select id from marketing_qa_ids where key='brand')),'No consent inferred';
end;$$;
rollback;
