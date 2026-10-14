-- Verified independent replay restores the local receipt cache, not its authority.
create or replace function public.marketing_privacy_replay(p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare case_id text:=p_payload->>'case_hash'; peer jsonb; grant_item jsonb; c record; connection public.marketing_connections; restored integer:=0; hold_data jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy restore service required.';end if;
 if coalesce(p_payload->>'id','') !~ '^[a-f0-9]{64}$' or p_payload->>'project' is distinct from 'ujkzdaaadnvcfayuldmh' or p_payload->>'version' is distinct from '1' then raise exception 'Invalid recovery receipt.';end if;
 insert into marketing_private.privacy_recovery_intents(id,payload,stored_at,digest,object_path)
 values(p_payload->>'id',p_payload,now(),encode(extensions.digest(p_payload::text,'sha256'),'hex'),'feedx/ujkzdaaadnvcfayuldmh/erasure/v1/'||(p_payload->>'id')||'.json') on conflict do nothing;
 if p_payload->>'method'='hold_release' then
  if p_payload->>'project'<>'ujkzdaaadnvcfayuldmh' or p_payload->>'version'<>'1' or coalesce(p_payload->>'evidence','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid legal release evidence.';end if;
  if exists(select 1 from marketing_private.inbox_legal_holds where conversation_id=(p_payload->>'conversation_id')::uuid and archive is not null) then perform marketing_private.marketing_privacy_release_local((p_payload->>'conversation_id')::uuid,p_payload->>'evidence');end if;
  update marketing_private.privacy_recovery_intents set applied_at=now() where id=p_payload->>'id';
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
 update marketing_private.privacy_recovery_intents set applied_at=now() where id=p_payload->>'id';
 return jsonb_build_object('status','replayed','erased_conversations',restored);
end;$$;
