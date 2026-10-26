-- Canonical Staging only (ujkzdaaadnvcfayuldmh). No provider calls or durable delivery proof.
-- One server statement self-rolls back its fixture subtransaction; do not rely on query-wrapper BEGIN/ROLLBACK handling.
do $notification_qa$
begin
 begin
  execute $fixture_sql$
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true),set_config('request.jwt.claim.role','authenticated',true);
do $$
declare org uuid:='ec42a08a-0f59-4b7b-a48e-b2faacf9eaf1'; actor uuid:='9f44daf9-9f87-4129-bc71-55c082cf8782';
 brand uuid:=gen_random_uuid();other_brand uuid:=gen_random_uuid();connection uuid:=gen_random_uuid();other_connection uuid:=gen_random_uuid();cid uuid:=gen_random_uuid();other uuid:=gen_random_uuid();
 auto_cid uuid:=gen_random_uuid();auto_message uuid:=gen_random_uuid();m uuid:=gen_random_uuid();attachment uuid:=gen_random_uuid();turn_ uuid:=gen_random_uuid();v jsonb;f jsonb;event_id bigint;
begin
 insert into brands(id,organization_id,name) values(brand,org,'QA Inbox sounds — rollback only'),(other_brand,org,'QA other sound scope — rollback only');
 insert into marketing_inbox_policies(brand_id,ai_allowed,automation_mode,ai_reply_mode,updated_by) values(brand,true,'suggest','suggest_only',actor);
 insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id,credential_generation) values(connection,org,brand,'facebook','qa-'||connection,1),(other_connection,org,other_brand,'facebook','qa-'||other_connection,1);
 insert into marketing_conversations(id,organization_id,brand_id,channel,connection_id,connection_generation,participant_key,title,created_by)
 values(cid,org,brand,'facebook',connection,1,'qa-'||cid,'QA notification source',actor),(other,org,other_brand,'facebook',other_connection,1,'qa-'||other,'QA unrelated scope',actor);
 insert into marketing_conversation_messages(id,conversation_id,kind,body,evidence_source,provider_message_id,occurred_at)
 values(m,cid,'incoming','Synthetic fresh question','signed_webhook','qa-'||m,now()),(attachment,cid,'attachment','Synthetic attachment','signed_webhook','qa-'||attachment,now());
 insert into marketing_conversation_messages(conversation_id,kind,body,evidence_source,provider_message_id,occurred_at) values(other,'incoming','Other Brand synthetic question','signed_webhook','qa-other',now());
 insert into marketing_conversation_messages(conversation_id,kind,body,evidence_source,provider_message_id,occurred_at) values
 (cid,'incoming','Synthetic recovered question','recent_api','qa-recovery',now()),
 (cid,'incoming','Synthetic delayed history','signed_webhook','qa-old',now()-interval '1 day'),
 (cid,'echo','Synthetic staff outbound','signed_webhook','qa-own-send',now()-interval '2 seconds'),
 (cid,'read','Synthetic read receipt','signed_webhook','qa-read',now());
 v:=marketing_inbox_reply_count(org,brand);
 assert v->>'needs_reply'='1','Attention count changed';
 assert jsonb_array_length(v->'sound_events')=2,'History, outbound or receipt became audible';
 assert not exists(select 1 from jsonb_array_elements(v->'sound_events') x where x ? 'body' or x ? 'participant_key'),'Notification exposed message content';
 assert not exists(select 1 from jsonb_array_elements(v->'sound_events') x where x->>'conversation_id'<>cid::text),'Brand scope leaked';
 assert (marketing_inbox_reply_count(org,other_brand)->>'needs_reply')='1','Other scope count';
 assert jsonb_array_length(marketing_inbox_reply_count(org,other_brand)->'sound_events')=1,'Other Brand received notifications';
 insert into marketing_conversation_messages(conversation_id,kind,body,evidence_source,provider_message_id,occurred_at)
 values(cid,'incoming','Synthetic webhook replay','signed_webhook','qa-'||m,now()) on conflict do nothing;
 assert jsonb_array_length(marketing_inbox_reply_count(org,brand)->'sound_events')=2,'Webhook replay created another notification identity';
 insert into marketing_private.inbox_automatic_turns(id,message_id,conversation_id,policy_revision,actor_employee_id) values(turn_,m,cid,0,actor);
 perform marketing_private.inbox_auto_handoff(turn_,'human_request');
 select id into event_id from marketing_events where action='inbox_ai_handoff' and details->>'turn_id'=turn_::text;
 assert event_id is not null,'Canonical handoff has no stable audit event';
 v:=marketing_inbox_reply_count(org,brand);
 assert exists(select 1 from jsonb_array_elements(v->'sound_events') x where x->>'id'='handoff:'||event_id and x->>'kind'='handoff'),'Handoff not projected';
 perform marketing_private.inbox_auto_handoff(turn_,'human_request');
 update marketing_private.inbox_automatic_turns set updated_at=now(),state='delivered' where id=turn_;
 assert (select count(*)=1 from marketing_events where action='inbox_ai_handoff' and details->>'turn_id'=turn_::text),'Retry or receipt replayed handoff audit identity';
 insert into marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(org,brand,'inbox_resume_ai',actor,jsonb_build_object('conversation_id',cid));
 assert not exists(select 1 from jsonb_array_elements(marketing_inbox_reply_count(org,brand)->'sound_events') x where x->>'kind'='handoff'),'Resumed handoff remained audible';
 update marketing_conversations set status='resolved' where id=cid;
 assert jsonb_array_length(marketing_inbox_reply_count(org,brand)->'sound_events')=0,'Resolved work remained actionable';
 -- An eligible queued AI turn stays silent; takeover and newer attachments cease AI ownership.
 update marketing_connections set status='test_authorized',expires_at=now()+interval '1 day',inbox_automation_owner='feedx',inbox_automation_generation=credential_generation,inbox_automation_confirmed_at=now()-interval '1 second',inbox_automation_confirmed_by=actor where id=connection;
 insert into marketing_private.inbox_authority(connection_id,generation,send_verified,webhook_verified,verified_at) values(connection,1,true,true,now())
 on conflict(connection_id) do update set generation=1,send_verified=true,webhook_verified=true,verified_at=now();
 update marketing_inbox_policies set ai_reply_mode='safe_auto',ai_authorized_by=actor,ai_enabled_at=now()-interval '1 minute',ai_conversation_ids=array[auto_cid],ai_availability='always' where brand_id=brand;
 insert into marketing_conversations(id,organization_id,brand_id,channel,connection_id,connection_generation,participant_key,title,takeover,last_inbound_at,created_by)
 values(auto_cid,org,brand,'facebook',connection,1,'qa-'||auto_cid,'QA automatic ownership',false,now(),actor);
 insert into marketing_conversation_messages(id,conversation_id,kind,body,evidence_source,provider_message_id,occurred_at) values(auto_message,auto_cid,'incoming','What is your brand name?','signed_webhook','qa-'||auto_message,now());
 v:=marketing_inbox_reply_count(org,brand);
 assert exists(select 1 from jsonb_array_elements(v->'sound_events') x where x->>'id'='message:'||auto_message and (x->>'automatic_candidate')::boolean),'Eligible automatic turn was not projected: '||(select marketing_private.inbox_auto_issue(c,p) from marketing_conversations c join marketing_inbox_policies p on p.brand_id=c.brand_id where c.id=auto_cid);
 insert into marketing_conversation_messages(conversation_id,kind,body,evidence_source,provider_message_id,occurred_at) values(auto_cid,'attachment','Newer attachment','signed_webhook','qa-newer-attachment',now());
 assert not exists(select 1 from jsonb_array_elements(marketing_inbox_reply_count(org,brand)->'sound_events') x where x->>'id'='message:'||auto_message and (x->>'automatic_candidate')::boolean),'Stale AI turn silenced newer staff work';
 update marketing_conversations set takeover=true,version=version+1 where id=auto_cid;
 assert not exists(select 1 from jsonb_array_elements(marketing_inbox_reply_count(org,brand)->'sound_events') x where x->>'conversation_id'=auto_cid::text and (x->>'automatic_candidate')::boolean),'Human takeover remained AI-owned';
 assert not has_function_privilege('anon','marketing_inbox_reply_count(uuid,uuid)','execute'),'Anonymous projection exposed';
 assert not has_function_privilege('authenticated','marketing_private.inbox_handoff_observed()','execute'),'Private handoff trigger exposed';
 begin perform marketing_inbox_reply_count(org,gen_random_uuid());raise exception 'Unknown Brand accepted';exception when others then if sqlerrm='Unknown Brand accepted' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform marketing_inbox_reply_count();raise exception 'Unauthenticated identity accepted';exception when others then if sqlerrm='Unauthenticated identity accepted' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
end;$$;
  $fixture_sql$;
  raise exception using errcode='P3999',message='notification fixture rollback complete';
 exception when sqlstate 'P3999' then
  if sqlerrm<>'notification fixture rollback complete' then raise;end if;
 end;
 if exists(select 1 from brands where name in ('QA Inbox sounds — rollback only','QA other sound scope — rollback only')) then raise exception 'Notification fixtures persisted';end if;
end;$notification_qa$;
select 'passed: exact event identities, fresh signed inbound, replay/history/outbound exclusion, handoff audit/retry/resume, automatic ownership, scope and grants; no fixtures retained' result;
