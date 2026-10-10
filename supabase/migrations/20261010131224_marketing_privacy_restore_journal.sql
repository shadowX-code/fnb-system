-- Private intent/outcome cache is mirrored to an independent encrypted Blob journal BEFORE erasure.
create table marketing_private.privacy_recovery_intents (
 id text primary key check(id ~ '^[a-f0-9]{64}$'), payload jsonb not null,
 created_at timestamptz not null default now(), stored_at timestamptz, object_path text, digest text,
 applied_at timestamptz
);
alter table marketing_private.privacy_recovery_intents enable row level security;
revoke all on marketing_private.privacy_recovery_intents from public,anon,authenticated,service_role;
create function marketing_private.privacy_intent(p_id text,p_case text,p_method text,p_verification text,p_grants jsonb,p_conversations uuid[],p_receipt text default null,p_extra jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 insert into marketing_private.privacy_recovery_intents(id,payload)
 select p_id,jsonb_build_object('version',1,'project','ujkzdaaadnvcfayuldmh','id',p_id,'case_hash',p_case,'verification_hash',p_verification,'method',p_method,'created_at',now(),'receipt',p_receipt,
 'grants',coalesce(p_grants,'[]'),'peers',coalesce((select jsonb_agg(jsonb_build_object('conversation_id',c.id,'connection_id',c.connection_id,'generation',c.connection_generation,
 'peer_hash',encode(extensions.digest(c.participant_key,'sha256'),'hex'),'erased_at',now(),'opted_out',c.opted_out,'hold',
 (select jsonb_build_object('basis',h.legal_basis,'evidence',h.evidence_hash,'review_at',h.review_at,'created_at',h.created_at) from marketing_private.inbox_legal_holds h where h.conversation_id=c.id)))
 from public.marketing_conversations c where c.id=any(p_conversations) and c.channel<>'internal'),'[]'))||p_extra on conflict do nothing;
 select jsonb_build_object('id',id,'payload',payload::text,'stored',stored_at is not null) into result from marketing_private.privacy_recovery_intents where id=p_id;
 return result;
end;$$;
create function public.marketing_privacy_prepare_meta(p_request text,p_user text,p_receipt text,p_issued timestamptz) returns jsonb
language plpgsql security definer set search_path=public as $$
declare case_id text; grants jsonb; conversations uuid[];
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Verified privacy service required.';end if;
 if coalesce(p_request,'') !~ '^[a-f0-9]{64}$' or coalesce(p_user,'') !~ '^[0-9]+$' or coalesce(p_receipt,'') !~ '^[a-f0-9]{64}$' or p_issued is null or p_issued>now()+interval '5 minutes' then raise exception 'Invalid verified Meta removal.';end if;
 select case_hash into case_id from marketing_private.removal_requests where request_hash=p_request;
 case_id:=coalesce(case_id,p_receipt);
 select jsonb_agg(jsonb_build_object('connection_id',s.connection_id,'generation',s.generation)),array_agg(c.id) filter(where c.id is not null)
 into grants,conversations from marketing_private.meta_subjects s left join public.marketing_conversations c on c.connection_id=s.connection_id and c.connection_generation=s.generation
 where s.meta_user_id=p_user and s.connected_at<=p_issued+interval '1 second';
 return marketing_private.privacy_intent(p_receipt,case_id,'meta_signed_request',encode(extensions.digest(p_user||':'||p_issued::text,'sha256'),'hex'),grants,coalesce(conversations,'{}'),p_receipt,jsonb_build_object('oauth_session_ids',coalesce((select jsonb_agg(id) from marketing_private.oauth_sessions where meta_user_id=p_user and consumed_at<=p_issued+interval '1 second'),'[]')));
end;$$;
create function public.marketing_privacy_prepare_customer(p_org uuid,p_brand uuid,p_conversation uuid,p_case text,p_verification text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy operator service required.';end if;
 if coalesce(p_case,'') !~ '^[a-f0-9]{64}$' or coalesce(p_verification,'') !~ '^[a-f0-9]{64}$' then raise exception 'Verified evidence required.';end if;
 if not exists(select 1 from public.marketing_conversations where id=p_conversation and organization_id=p_org and brand_id=p_brand and channel<>'internal')
 and not exists(select 1 from marketing_private.privacy_erasure_journal j join public.marketing_connections x on x.id=j.connection_id where j.case_hash=p_case and j.conversation_id=p_conversation and x.organization_id=p_org and x.brand_id=p_brand)
 then raise exception 'Verified external conversation scope required.';end if;
 return marketing_private.privacy_intent(p_case,p_case,'operator_identity_review',p_verification,'[]',array[p_conversation]);
end;$$;
create function public.marketing_privacy_journal_pending() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy service required.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'payload',payload::text,'stored',stored_at is not null)) from
 (select * from marketing_private.privacy_recovery_intents where stored_at is null order by created_at,id limit 10) q),'[]');
end;$$;
create function public.marketing_privacy_journal_ack(p_id text,p_digest text,p_path text) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy service required.';end if;
 if p_digest !~ '^[a-f0-9]{64}$' or p_path<>('feedx/ujkzdaaadnvcfayuldmh/erasure/v1/'||p_id||'.json') then raise exception 'Invalid journal receipt.';end if;
 update marketing_private.privacy_recovery_intents set stored_at=coalesce(stored_at,now()),digest=p_digest,object_path=p_path
 where id=p_id and encode(extensions.digest(payload::text,'sha256'),'hex')=p_digest;
 if not found then raise exception 'Journal content changed.';end if;
end;$$;
create function marketing_private.privacy_require_stored(p_case text) returns void language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from marketing_private.privacy_recovery_intents where payload->>'case_hash'=p_case and stored_at is not null) then raise exception 'Independent erasure journal receipt required.';end if;
end;$$;
-- Preserve canonical erasure logic behind a guarded entry point.
alter function public.marketing_meta_revoke(text,boolean,text,timestamptz) rename to marketing_meta_revoke_local;
alter function public.marketing_meta_revoke_local(text,boolean,text,timestamptz) set schema marketing_private;
create function public.marketing_meta_revoke(p_user_id text,p_deletion boolean,p_confirmation_hash text,p_issued_at timestamptz) returns void
language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Verified privacy service required.';end if;
 perform marketing_private.privacy_require_stored(coalesce(p_confirmation_hash,encode(extensions.digest(p_user_id||':'||p_issued_at::text,'sha256'),'hex')));
 perform marketing_private.marketing_meta_revoke_local(p_user_id,p_deletion,p_confirmation_hash,p_issued_at);
end;$$;
alter function public.marketing_inbox_privacy_erase_verified(uuid,uuid,uuid,text,text) rename to marketing_inbox_privacy_erase_local;
alter function public.marketing_inbox_privacy_erase_local(uuid,uuid,uuid,text,text) set schema marketing_private;
create function public.marketing_inbox_privacy_erase_verified(p_org uuid,p_brand uuid,p_conversation uuid,p_case_hash text,p_verification_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy operator service required.';end if;
 perform marketing_private.privacy_require_stored(p_case_hash);
 if not exists(select 1 from marketing_private.privacy_recovery_intents i where i.payload->>'case_hash'=p_case_hash and i.payload->>'verification_hash'=p_verification_hash and exists(select 1 from jsonb_array_elements(i.payload->'peers') p where p->>'conversation_id'=p_conversation::text)) then raise exception 'Journal scope changed.';end if;
 return marketing_private.marketing_inbox_privacy_erase_local(p_org,p_brand,p_conversation,p_case_hash,p_verification_hash);
end;$$;
-- A restore operator supplies ONLY authenticated/decrypted records from the independent store.
-- This function does not accept arbitrary customer identity assertions from staff/browser clients.
create function public.marketing_privacy_replay(p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare case_id text:=p_payload->>'case_hash'; peer jsonb; grant_item jsonb; c record; connection public.marketing_connections; restored integer:=0; hold_data jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy restore service required.';end if;
 if p_payload->>'method'='hold_release' then
  if p_payload->>'project'<>'ujkzdaaadnvcfayuldmh' or p_payload->>'version'<>'1' or coalesce(p_payload->>'evidence','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid legal release evidence.';end if;
  if exists(select 1 from marketing_private.inbox_legal_holds where conversation_id=(p_payload->>'conversation_id')::uuid and archive is not null) then perform marketing_private.marketing_privacy_release_local((p_payload->>'conversation_id')::uuid,p_payload->>'evidence');end if;
  return jsonb_build_object('status','replayed','erased_conversations',0);
 end if;
 if p_payload->>'project'<>'ujkzdaaadnvcfayuldmh' or p_payload->>'version'<>'1' or coalesce(case_id,'') !~ '^[a-f0-9]{64}$' or coalesce(p_payload->>'verification_hash','') !~ '^[a-f0-9]{64}$' or p_payload->>'method' not in ('meta_signed_request','operator_identity_review') then raise exception 'Invalid recovery evidence.';end if;
 perform pg_advisory_xact_lock(hashtextextended(case_id,0));
 insert into marketing_private.privacy_cases(case_hash,verification_hash,method,created_at) values(case_id,p_payload->>'verification_hash',p_payload->>'method',(p_payload->>'created_at')::timestamptz) on conflict do nothing;
 for peer in select value from jsonb_array_elements(p_payload->'peers') loop
  insert into marketing_private.inbox_erased_peers(connection_id,generation,peer_hash,erased_at,opted_out)
  values((peer->>'connection_id')::uuid,(peer->>'generation')::int,peer->>'peer_hash',(peer->>'erased_at')::timestamptz,(peer->>'opted_out')::boolean)
  on conflict(connection_id,generation,peer_hash) do update set erased_at=greatest(inbox_erased_peers.erased_at,excluded.erased_at),opted_out=inbox_erased_peers.opted_out or excluded.opted_out;
  for c in select * from public.marketing_conversations where connection_id=(peer->>'connection_id')::uuid and connection_generation=(peer->>'generation')::int
   and encode(extensions.digest(participant_key,'sha256'),'hex')=peer->>'peer_hash' and (id=(peer->>'conversation_id')::uuid or created_at<=(peer->>'erased_at')::timestamptz) loop
   hold_data:=peer->'hold';
   if hold_data is not null and hold_data<>'null'::jsonb then
    insert into marketing_private.inbox_legal_holds(conversation_id,legal_basis,evidence_hash,created_at,review_at)
    values(c.id,hold_data->>'basis',hold_data->>'evidence',(hold_data->>'created_at')::timestamptz,(hold_data->>'review_at')::timestamptz) on conflict do nothing;
   end if;
   perform marketing_private.inbox_erase_conversation(c.id,case_id);restored:=restored+1;
  end loop;
  -- Orphaned pending payloads have no conversation to erase.
  update marketing_private.inbox_events set payload='{}',state='blocked',error_code='privacy_erased'
  where connection_id=(peer->>'connection_id')::uuid and generation=(peer->>'generation')::int
  and encode(extensions.digest(case when coalesce(payload->>'medium','dm')='comment' then 'comment:'||(payload->>'thread_id')||':'||(payload->>'peer_id') else payload->>'peer_id' end,'sha256'),'hex')=peer->>'peer_hash'
  and coalesce((payload->>'occurred_at')::timestamptz,created_at)<=(peer->>'erased_at')::timestamptz;
 end loop;
 for grant_item in select value from jsonb_array_elements(p_payload->'grants') loop
  select * into connection from public.marketing_connections where id=(grant_item->>'connection_id')::uuid for update;
  for c in select id from public.marketing_conversations where connection_id=connection.id and connection_generation=(grant_item->>'generation')::int loop
   perform marketing_private.inbox_erase_conversation(c.id,case_id);restored:=restored+1;
  end loop;
  update marketing_private.inbox_events set payload='{}',state='blocked',error_code='privacy_erased' where connection_id=connection.id and generation=(grant_item->>'generation')::int;
  delete from marketing_private.inbox_authority where connection_id=connection.id and generation=(grant_item->>'generation')::int;
  delete from marketing_private.inbox_comment_authority where connection_id=connection.id and generation=(grant_item->>'generation')::int;
  update public.marketing_events set details=details-'provider_post_id' where details->>'job_id' in(select id::text from public.marketing_jobs where connection_id=connection.id and connection_generation=(grant_item->>'generation')::int);
  update public.marketing_jobs set provider_post_id=null,provider_state='{}',state='cancelled',error_code='meta_data_erased',external_authorized_at=null where connection_id=connection.id and connection_generation=(grant_item->>'generation')::int;
  delete from public.marketing_social_posts where connection_id=connection.id and connection_generation=(grant_item->>'generation')::int;
  if connection.credential_generation=(grant_item->>'generation')::int then
   delete from marketing_private.credentials where connection_id=connection.id;
   update public.marketing_connections set provider_account_id=null,account_name=null,status='not_connected',capabilities='{}',expires_at=null,error_code='meta_authorization_removed',credential_generation=credential_generation+1 where id=connection.id;
  end if;
  delete from marketing_private.meta_subjects where connection_id=connection.id and generation=(grant_item->>'generation')::int;
 end loop;
 delete from marketing_private.oauth_sessions where id in(select value::text::uuid from jsonb_array_elements_text(coalesce(p_payload->'oauth_session_ids','[]')));
 if p_payload->>'receipt' is not null then insert into marketing_private.privacy_case_receipts values(p_payload->>'receipt',case_id) on conflict do nothing;end if;
 update marketing_private.privacy_cases set local_completed_at=coalesce(local_completed_at,now()),completed_at=null,backup_state='pending' where case_hash=case_id;
 return jsonb_build_object('status','replayed','erased_conversations',restored);
end;$$;
revoke all on function marketing_private.privacy_intent(text,text,text,text,jsonb,uuid[],text,jsonb),marketing_private.privacy_require_stored(text),marketing_private.marketing_meta_revoke_local(text,boolean,text,timestamptz),marketing_private.marketing_inbox_privacy_erase_local(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.marketing_privacy_prepare_meta(text,text,text,timestamptz),public.marketing_privacy_prepare_customer(uuid,uuid,uuid,text,text),public.marketing_privacy_journal_pending(),public.marketing_privacy_journal_ack(text,text,text),public.marketing_privacy_replay(jsonb),public.marketing_meta_revoke(text,boolean,text,timestamptz),public.marketing_inbox_privacy_erase_verified(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.marketing_privacy_prepare_meta(text,text,text,timestamptz),public.marketing_privacy_prepare_customer(uuid,uuid,uuid,text,text),public.marketing_privacy_journal_pending(),public.marketing_privacy_journal_ack(text,text,text),public.marketing_privacy_replay(jsonb),public.marketing_meta_revoke(text,boolean,text,timestamptz),public.marketing_inbox_privacy_erase_verified(uuid,uuid,uuid,text,text) to service_role;

-- Hold release is also a durable recovery event; replay cannot resurrect a released archive.
alter function public.marketing_privacy_release_hold(uuid,text) rename to marketing_privacy_release_local;
alter function public.marketing_privacy_release_local(uuid,text) set schema marketing_private;
create function public.marketing_privacy_prepare_release(p_conversation uuid,p_evidence text) returns jsonb language plpgsql security definer set search_path=public as $$
declare event_id text; result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy operator service required.';end if;
 if coalesce(p_evidence,'') !~ '^[a-f0-9]{64}$' or not exists(select 1 from marketing_private.inbox_legal_holds where conversation_id=p_conversation and archive is not null) then raise exception 'Verified retained legal case required.';end if;
 event_id:=encode(extensions.digest('hold_release:'||p_conversation::text||':'||p_evidence,'sha256'),'hex');
 insert into marketing_private.privacy_recovery_intents(id,payload) values(event_id,jsonb_build_object('id',event_id,'version',1,'project','ujkzdaaadnvcfayuldmh','method','hold_release','conversation_id',p_conversation,'evidence',p_evidence,'created_at',clock_timestamp())) on conflict do nothing;
 select jsonb_build_object('id',id,'payload',payload::text,'stored',stored_at is not null) into result from marketing_private.privacy_recovery_intents where id=event_id;return result;
end;$$;
create function public.marketing_privacy_release_hold(p_conversation uuid,p_evidence text) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy operator service required.';end if;
 if not exists(select 1 from marketing_private.privacy_recovery_intents where id=encode(extensions.digest('hold_release:'||p_conversation::text||':'||p_evidence,'sha256'),'hex') and stored_at is not null) then raise exception 'Independent legal-release journal receipt required.';end if;
 perform marketing_private.marketing_privacy_release_local(p_conversation,p_evidence);
end;$$;
revoke all on function marketing_private.marketing_privacy_release_local(uuid,text),public.marketing_privacy_prepare_release(uuid,text),public.marketing_privacy_release_hold(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.marketing_privacy_prepare_release(uuid,text),public.marketing_privacy_release_hold(uuid,text) to service_role;

alter function public.marketing_privacy_complete_followup(text,text,text,text) rename to marketing_privacy_complete_local;
alter function public.marketing_privacy_complete_local(text,text,text,text) set schema marketing_private;
create function public.marketing_privacy_complete_followup(p_case text,p_backup text,p_processor text,p_evidence text) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy operator service required.';end if;
 perform marketing_private.privacy_require_stored(p_case);
 perform marketing_private.marketing_privacy_complete_local(p_case,p_backup,p_processor,p_evidence);
end;$$;
revoke all on function marketing_private.marketing_privacy_complete_local(text,text,text,text),public.marketing_privacy_complete_followup(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.marketing_privacy_complete_followup(text,text,text,text) to service_role;
