-- Canonical Staging only. No worker tick or Meta API call. All fixtures roll back.
begin;
set local statement_timeout='15s';

do $qa$
declare
 conn public.marketing_connections;
 chat public.marketing_conversations;
 probe public.marketing_conversations;
 sender_probe public.marketing_connections;
 campaign public.marketing_campaigns;
 recipient public.marketing_campaign_recipients;
 historical marketing_private.whatsapp_campaign_runs;
 auth_user uuid;
 actor uuid;
 result jsonb;
 claim jsonb;
 request_id uuid:=gen_random_uuid();
 draft_id uuid;
 test_run uuid:=gen_random_uuid();
 rejected_run uuid:=gen_random_uuid();
 payload jsonb;
begin
 select * into historical from marketing_private.whatsapp_campaign_runs where id='db88f28f-591d-43ab-96e7-c9936310fc3a';
 select * into conn from public.marketing_connections where id=historical.connection_id;
 select * into chat from public.marketing_conversations where connection_id=conn.id
  and marketing_private.whatsapp_test_recipient(participant_key) order by connection_generation desc limit 1;
 if conn.id is null or chat.id is null or historical.state<>'complete' then raise exception 'Missing current Staging QA anchor';end if;
 if (select count(*) from marketing_private.whatsapp_test_recipients)<>1 then raise exception 'Unexpected QA allowlist size';end if;
 if not marketing_private.whatsapp_test_staff_ready(chat,conn) then raise exception 'Current signed staff-reply fixture is unavailable';end if;
 if not marketing_private.whatsapp_test_template_ready(chat,conn) then raise exception 'Current template consent fixture is unavailable';end if;

 probe:=chat;
 probe.participant_key:='10000008678';
 if marketing_private.whatsapp_test_staff_ready(probe,conn) or marketing_private.whatsapp_test_template_ready(probe,conn)
 then raise exception 'Unapproved peer with matching suffix was allowed';end if;
 probe:=chat;
 probe.opted_out:=true;
 if marketing_private.whatsapp_test_staff_ready(probe,conn) or marketing_private.whatsapp_test_template_ready(probe,conn)
 then raise exception 'Opted-out recipient was allowed';end if;
 probe:=chat;
 probe.connection_generation:=chat.connection_generation-1;
 if marketing_private.whatsapp_test_staff_ready(probe,conn) or marketing_private.whatsapp_test_template_ready(probe,conn)
 then raise exception 'Superseded conversation was allowed';end if;
 sender_probe:=conn;
 sender_probe.whatsapp_waba_id:='10000000001';
 if marketing_private.whatsapp_test_staff_ready(chat,sender_probe) or marketing_private.whatsapp_campaign_connection(sender_probe)
 then raise exception 'Different WABA was allowed';end if;
 sender_probe:=conn;
 sender_probe.provider_account_id:='10000000002';
 if marketing_private.whatsapp_test_template_ready(chat,sender_probe) or marketing_private.whatsapp_campaign_connection(sender_probe)
 then raise exception 'Different sender was allowed';end if;
 if has_function_privilege('authenticated','public.marketing_campaign_whatsapp_worker(uuid,text,uuid,uuid,text,text,text[])','EXECUTE')
 or has_table_privilege('authenticated','marketing_private.whatsapp_test_recipients','SELECT')
 or has_table_privilege('service_role','marketing_private.whatsapp_test_recipients','INSERT')
 then raise exception 'Private execution or allowlist grants were exposed';end if;

 select e.id,e.auth_user_id into actor,auth_user from public.employees e
 where e.auth_user_id is not null
  and marketing_private.actor_allowed(e.id,chat.organization_id,chat.brand_id,'marketing_inbox.view')
  and marketing_private.actor_allowed(e.id,chat.organization_id,chat.brand_id,'marketing_inbox.reply')
  and marketing_private.actor_allowed(e.id,chat.organization_id,chat.brand_id,'marketing_inbox.send')
  and marketing_private.actor_allowed(e.id,chat.organization_id,chat.brand_id,'marketing_campaigns.execute')
  and marketing_private.actor_allowed(e.id,chat.organization_id,chat.brand_id,'marketing_campaigns.approve')
 limit 1;
 if actor is null then raise exception 'No authorized Staging staff fixture';end if;
 perform set_config('request.jwt.claim.sub',auth_user::text,true);
 perform set_config('request.jwt.claim.role','service_role',true);
 if (public.marketing_inbox_staff_send_scope(chat.id,auth_user)->>'whatsapp_test_ready') is distinct from 'true'
 or public.marketing_inbox_whatsapp_template_material(chat.id,auth_user)->>'peer' is distinct from chat.participant_key
 then raise exception 'Staff send read scope was denied';end if;
 begin
  perform public.marketing_inbox_whatsapp_template_material(chat.id,gen_random_uuid());
  raise exception 'Unauthorized actor was allowed';
 exception when insufficient_privilege then null;
 end;

 perform set_config('request.jwt.claim.role','authenticated',true);
 begin
  result:=public.marketing_inbox_prepare_whatsapp_template(request_id,chat.id,chat.version,
   'Rollback-only approved utility template preview.',historical.template,conn.credential_generation);
  draft_id:=(result->>'draft_id')::uuid;
  if draft_id is null or public.marketing_inbox_prepare_whatsapp_template(request_id,chat.id,chat.version,
   'Rollback-only approved utility template preview.',historical.template,conn.credential_generation) is distinct from result
  then raise exception 'Template intent was not idempotent';end if;
  perform set_config('request.jwt.claim.role','service_role',true);
  if public.marketing_inbox_send_material(draft_id,auth_user)->>'state' is distinct from 'prepared'
  then raise exception 'Prepared template did not reach the delivery boundary';end if;
  raise exception using errcode='ZX001',message='Rollback template fixture';
 exception when sqlstate 'ZX001' then null;
 end;

 begin
  result:=public.marketing_inbox_prepare_staff_reply(request_id,chat.id,chat.version,'Rollback-only staff reply.',null);
  draft_id:=(result->>'draft_id')::uuid;
  if draft_id is null or public.marketing_inbox_prepare_staff_reply(request_id,chat.id,chat.version,'Rollback-only staff reply.',null) is distinct from result
  then raise exception 'Staff reply intent was not idempotent';end if;
  begin
   perform public.marketing_inbox_prepare_staff_reply(gen_random_uuid(),chat.id,chat.version,'Rollback-only staff reply.',null);
   raise exception 'Duplicate intent was allowed';
  exception when raise_exception then
   if sqlerrm not like 'A reply is already in progress or recorded.%' then raise;end if;
  end;
  perform set_config('request.jwt.claim.role','service_role',true);
  if public.marketing_inbox_send_material(draft_id,auth_user)->>'state' is distinct from 'prepared'
  then raise exception 'Prepared staff reply did not reach the delivery boundary';end if;
  raise exception using errcode='ZX001',message='Rollback reply fixture';
 exception when sqlstate 'ZX001' then null;
 end;

 select * into campaign from public.marketing_campaigns where id=historical.campaign_id;
 select r.* into recipient from public.marketing_campaign_recipients r
 join marketing_private.whatsapp_campaign_deliveries d on d.recipient_id=r.id where d.run_id=historical.id;
 campaign.id:=gen_random_uuid();
 campaign.title:='Rollback-only WhatsApp schedule';
 insert into public.marketing_campaigns select (campaign).*;
 recipient.id:=gen_random_uuid();
 recipient.campaign_id:=campaign.id;
 insert into public.marketing_campaign_recipients select (recipient).*;

 payload:=jsonb_build_object('revision',campaign.revision,'generation',conn.credential_generation,
  'scheduled_at',now()+interval '1 minute','batch_size',1,'template',historical.template);
 begin
  perform public.marketing_campaign_whatsapp_command(campaign.organization_id,campaign.brand_id,campaign.id,rejected_run,'schedule',payload);
  raise exception 'Unconfirmed schedule was allowed';
 exception when raise_exception then
  if sqlerrm<>'Confirm the WhatsApp test send schedule.' then raise;end if;
 end;
 payload:=payload||'{"dispatch_confirmed":true}'::jsonb;
 result:=public.marketing_campaign_whatsapp_command(campaign.organization_id,campaign.brand_id,campaign.id,test_run,'schedule',payload);
 if result->>'state' is distinct from 'scheduled' or public.marketing_campaign_whatsapp_command(
  campaign.organization_id,campaign.brand_id,campaign.id,test_run,'schedule',payload) is distinct from result
 then raise exception 'Confirmed schedule was not idempotent';end if;
 update marketing_private.whatsapp_campaign_deliveries set due_at=now()-interval '1 second' where run_id=test_run;

 perform set_config('request.jwt.claim.role','service_role',true);
 claim:=public.marketing_campaign_whatsapp_worker(null,'claim');
 if claim->>'run_id' is distinct from test_run::text or claim->>'peer' is distinct from chat.participant_key
 then raise exception 'Worker did not claim the allowed due delivery';end if;
 if public.marketing_campaign_whatsapp_worker(test_run,'begin',(claim->>'id')::uuid,(claim->>'lease')::uuid) is null
 then raise exception 'Worker did not begin the allowed delivery';end if;

 delete from marketing_private.whatsapp_test_recipients where peer=chat.participant_key;
 if public.marketing_campaign_whatsapp_worker(test_run,'guard',(claim->>'id')::uuid,(claim->>'lease')::uuid,
  p_allowed_peers=>array[chat.participant_key]) is not null
 then raise exception 'A supplied peer overrode the allowlist';end if;
 insert into marketing_private.whatsapp_test_recipients values(chat.participant_key);
 result:=public.marketing_campaign_whatsapp_worker(test_run,'unknown',(claim->>'id')::uuid,(claim->>'lease')::uuid);
 if result is null or not exists(select 1 from marketing_private.whatsapp_campaign_deliveries where run_id=test_run and state='unknown')
 then raise exception 'Unknown outcome was not retained';end if;
 if public.marketing_campaign_whatsapp_worker(null,'claim') is not null
 then raise exception 'Unknown outcome became claimable';end if;
end;
$qa$;

select 'WhatsApp Staging send authority passed without dispatch' as result;
rollback;
