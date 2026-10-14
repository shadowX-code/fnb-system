-- Qualify the queue result variable, retaining canonical accepted counters.
create or replace function public.marketing_inbox_history_finish(p_job uuid,p_lease uuid,p_result jsonb,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare j marketing_private.inbox_history_jobs;c public.marketing_connections;item jsonb;enqueue_result jsonb;n integer:=0;begin
 select * into j from marketing_private.inbox_history_jobs where id=p_job and lease=p_lease and state='leased' for update;
 if not found then raise exception 'Import lease changed.';end if;
 if not public.marketing_inbox_history_guard(p_job,p_lease) then
 update marketing_private.inbox_history_jobs set state='cancelled',checkpoint='{}',reason='import_authority_changed',lease_until=null,updated_at=now() where id=j.id;return;end if;
 if p_error is not null then
 update marketing_private.inbox_history_jobs set state=case when attempts>=5 or p_error in ('history_cursor_unavailable','history_identity_unverified','history_response_invalid','meta_permission_or_token_invalid') then 'failed' else 'retry' end,reason=left(p_error,100),due_at=now()+make_interval(secs=>least(3600,60*power(2,attempts)::integer)),lease_until=null,updated_at=now() where id=j.id;return;end if;
 if jsonb_typeof(p_result->'events') is distinct from 'array' or jsonb_array_length(p_result->'events')>20 or octet_length(p_result::text)>200000 or jsonb_typeof(p_result->'checkpoint') is distinct from 'object' or octet_length((p_result->'checkpoint')::text)>10000 or (p_result->>'scanned')::integer not between 0 and 20 or (p_result->>'omitted')::integer not between 0 and 20 then raise exception 'Invalid historical evidence.';end if;
 select * into c from public.marketing_connections where id=j.connection_id for share;
 for item in select value from jsonb_array_elements(p_result->'events') loop
 if item->>'channel' is distinct from c.channel or item->>'account_id' is distinct from c.provider_account_id or item->>'kind' is distinct from 'incoming' or item->>'medium' is distinct from 'dm' or item->>'occurred_at' is null or (item->>'occurred_at')::timestamptz not between j.window_from and j.window_to then raise exception 'Historical message scope denied.';end if;
 -- Existing queue validates identity/shape and its privacy tombstone scrubs erased bodies.
 if not exists(select 1 from marketing_private.inbox_events where event_key=c.id::text||':'||j.generation::text||':incoming:'||(item->>'event_id')) then
 enqueue_result:=public.marketing_inbox_enqueue(jsonb_build_array(item));
 if (enqueue_result->>'accepted')::integer>0 then
 update marketing_private.inbox_events set evidence_source='historical_import' where event_key=c.id::text||':'||j.generation::text||':incoming:'||(item->>'event_id');n:=n+1;
 end if;end if;
 end loop;
 update marketing_private.inbox_history_jobs set pages=pages+1,scanned=scanned+(p_result->>'scanned')::integer,omitted=omitted+(p_result->>'omitted')::integer,accepted=accepted+n,
 state=case when (p_result->>'done')::boolean then 'finished' when pages>=249 then 'bounded_gap' else 'queued' end,
 checkpoint=case when (p_result->>'done')::boolean or pages>=249 then '{}' else p_result->'checkpoint' end,
 reason=case when pages>=249 and not (p_result->>'done')::boolean then '250_page_limit' when omitted+(p_result->>'omitted')::integer>0 then 'incoming_text_only_gap' else 'provider_history_not_guaranteed' end,
 attempts=0,due_at=now()+interval '2 minutes',lease_until=null,updated_at=now() where id=j.id;
end;$$;
