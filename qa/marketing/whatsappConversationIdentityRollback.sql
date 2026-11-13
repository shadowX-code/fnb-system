-- Run against canonical Staging. Synthetic events only, no Meta calls.
begin;
set local statement_timeout='20s';
do $qa$
declare
 org uuid:=gen_random_uuid();
 brand uuid:=gen_random_uuid();
 other_brand uuid:=gen_random_uuid();
 conn uuid:=gen_random_uuid();
 other_conn uuid:=gen_random_uuid();
 chat uuid;
 peer constant text:='60110000028';
 event jsonb;
 first_id text:='wamid.qa_'||gen_random_uuid();
 second_id text:='wamid.qa_'||gen_random_uuid();
 result jsonb;
begin
 insert into public.organizations(id,name) values(org,'Disposable conversation identity QA');
 insert into public.brands(id,organization_id,name) values(brand,org,'Disposable WhatsApp identity QA'),(other_brand,org,'Separate QA Brand');
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,whatsapp_waba_id,
  whatsapp_onboarding_mode,account_name,status,credential_generation,expires_at,connected_at)
 values(conn,org,brand,'whatsapp','990000000001','990000000002','cloud_api','QA sender','test_authorized',1,now()+interval '1 hour',now()-interval '3 days');
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id,expires_at)
 values(conn,'rollback-only','{"fixture":true}','100',now()+interval '1 hour');
 insert into marketing_private.inbox_authority(connection_id,generation,receive_verified,webhook_verified,configuration_verified,granted_scopes,signed_inbound_at)
 values(conn,1,true,true,true,array['whatsapp_business_management','whatsapp_business_messaging'],now());
 perform set_config('request.jwt.claim.role','service_role',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 assert marketing_private.whatsapp_receiving(conn),'Synthetic receiver must be authorized';
 event:=jsonb_build_object('channel','whatsapp','account_id','990000000001','waba_id','990000000002',
  'peer_id',peer,'kind','incoming','event_id',first_id,'occurred_at',now()-interval '2 days',
  'medium','dm','body','First synthetic inbound');
 result:=public.marketing_inbox_receive(jsonb_build_array(event,event));
 assert result->>'accepted'='1' and result->>'duplicates'='1','Webhook replay should be idempotent';
 update marketing_private.inbox_events set due_at=now()-interval '100 years' where connection_id=conn;
 perform public.marketing_inbox_process_events(1);
 select id into chat from public.marketing_conversations where connection_id=conn;
 assert chat is not null,'First inbound creates a conversation';
 assert (select last_inbound_at<now()-interval '24 hours' from public.marketing_conversations where id=chat);
 update public.marketing_conversations set status='resolved',status_changed_at=now()-interval '1 day' where id=chat;
 update public.marketing_conversations set status_changed_at=now()-interval '1 day' where id=chat;
 insert into public.marketing_conversation_messages(conversation_id,kind,body,occurred_at,delivery_state)
 values(chat,'note','A retained internal note',now()-interval '1 day','internal');

 update public.marketing_connections set credential_generation=2 where id=conn;
 update marketing_private.inbox_authority set generation=2 where connection_id=conn;
 perform public.marketing_inbox_receive(jsonb_build_array(event));
 update marketing_private.inbox_events set due_at=now()-interval '100 years' where connection_id=conn;
 perform public.marketing_inbox_process_events(1);
 assert (select status='resolved' and connection_generation=1 from public.marketing_conversations where id=chat),
  'Cross-generation replay must neither reopen nor advance the reply window';
 event:=event||jsonb_build_object('event_id',second_id,'occurred_at',now()+interval '1 second','body','New synthetic inbound');
 perform public.marketing_inbox_receive(jsonb_build_array(event,event));
 update marketing_private.inbox_events set due_at=now()-interval '100 years' where connection_id=conn;
 perform public.marketing_inbox_process_events(1);
 assert (select count(*)=1 from public.marketing_conversations where connection_id=conn);
 assert (select status='open' and connection_generation=2 and whatsapp_generations=array[1,2]
  from public.marketing_conversations where id=chat),'New inbound reopens the same thread';
 assert (select count(*)=3 from public.marketing_conversation_messages where conversation_id=chat),
  'Both inbound messages and the note survive once each';
 assert (select array_agg(whatsapp_generation order by occurred_at)=array[1,2]
  from public.marketing_conversation_messages where conversation_id=chat and kind='incoming');

 -- The index arbitrates conflicting inserts, including from independent transactions.
 begin
  insert into public.marketing_conversations(organization_id,brand_id,channel,connection_id,participant_key,title,connection_generation)
  values(org,brand,'whatsapp',conn,peer,'Duplicate should be rejected',1);
  raise exception 'Identity uniqueness missing';
 exception when unique_violation then null;
 end;
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,whatsapp_waba_id,
  whatsapp_onboarding_mode,account_name,status,credential_generation,expires_at,connected_at)
 values(other_conn,org,other_brand,'whatsapp','990000000003','990000000002','cloud_api','Other QA sender','test_authorized',1,now()+interval '1 hour',now());
 insert into public.marketing_conversations(organization_id,brand_id,channel,connection_id,participant_key,title)
 values(org,other_brand,'whatsapp',other_conn,peer,'Separate sender');
 assert (select count(*)=2 from public.marketing_conversations where organization_id=org);
end;
$qa$;
select 'WhatsApp conversation identity passed' result;
rollback;
