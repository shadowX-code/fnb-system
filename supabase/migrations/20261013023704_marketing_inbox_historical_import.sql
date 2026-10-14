-- Disabled until a privacy operator records approval for this exact current grant.
create table marketing_private.inbox_history_approvals(
 connection_id uuid primary key references public.marketing_connections(id) on delete cascade,
 generation integer not null,approval_id uuid not null default gen_random_uuid(),evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),
 approved_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '1 day');
create table marketing_private.inbox_history_jobs(
 id uuid primary key default gen_random_uuid(),connection_id uuid not null references public.marketing_connections(id) on delete cascade,
 generation integer not null,approval_id uuid not null unique,actor uuid not null references public.employees(id),
 window_from timestamptz not null,window_to timestamptz not null,checkpoint jsonb not null default '{}',
 state text not null default 'queued' check(state in ('queued','retry','leased','finished','bounded_gap','failed','cancelled')),
 lease uuid,lease_until timestamptz,attempts integer not null default 0,pages integer not null default 0,
 scanned integer not null default 0,accepted integer not null default 0,omitted integer not null default 0,
 due_at timestamptz not null default now(),reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(window_to>=window_from and window_to-window_from<=interval '30 days'));
alter table marketing_private.inbox_history_approvals enable row level security;
alter table marketing_private.inbox_history_jobs enable row level security;
revoke all on marketing_private.inbox_history_approvals,marketing_private.inbox_history_jobs from public,anon,authenticated;
create index marketing_history_due on marketing_private.inbox_history_jobs(due_at) where state in ('queued','retry','leased');
create function public.marketing_inbox_history_authorize(p_connection uuid,p_generation integer,p_evidence_hash text) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy operator authority required.';end if;
 if p_evidence_hash !~ '^[a-f0-9]{64}$' or not exists(select 1 from public.marketing_connections where id=p_connection and credential_generation=p_generation and status in ('test_authorized','production_authorized') and channel in ('facebook','instagram')) then raise exception 'Current approved grant required.';end if;
 if exists(select 1 from marketing_private.inbox_history_jobs where connection_id=p_connection and state in ('queued','retry','leased')) then raise exception 'Finish or cancel the current import first.';end if;
 insert into marketing_private.inbox_history_approvals(connection_id,generation,evidence_hash) values(p_connection,p_generation,p_evidence_hash)
 on conflict(connection_id) do update set generation=excluded.generation,evidence_hash=excluded.evidence_hash,approval_id=gen_random_uuid(),approved_at=now(),expires_at=now()+interval '1 day';
end;$$;
create function public.marketing_inbox_history_request(p_connection uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;a marketing_private.inbox_history_approvals;actor uuid;result uuid;begin
 select * into c from public.marketing_connections where id=p_connection for share;
 if c.id is null then raise exception 'Connection unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.configure');
 select * into a from marketing_private.inbox_history_approvals where connection_id=c.id and generation=c.credential_generation and expires_at>now() for update;
 if not found then raise exception 'Privacy approval is required before importing customer messages.';end if;
 if not (coalesce((marketing_private.inbox_channel(c.id)->>'configuration_verified')::boolean,false) and coalesce((marketing_private.inbox_channel(c.id)->>'receiving_verified')::boolean,false)) or c.expires_at<=now() or c.status not in ('test_authorized','production_authorized') then raise exception 'Eligible Inbox configuration required.';end if;
 insert into marketing_private.inbox_history_jobs(connection_id,generation,approval_id,actor,window_from,window_to)
 values(c.id,c.credential_generation,a.approval_id,actor,greatest(now()-interval '30 days',c.connected_at),now()) on conflict(approval_id) do nothing returning id into result;
 if result is null then select id into result from marketing_private.inbox_history_jobs where approval_id=a.approval_id;end if;
 return result;
end;$$;
create function public.marketing_inbox_history_guard(p_job uuid,p_lease uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from marketing_private.inbox_history_jobs j join public.marketing_connections c on c.id=j.connection_id and c.credential_generation=j.generation
 join marketing_private.inbox_history_approvals a on a.connection_id=c.id and a.generation=j.generation and a.approval_id=j.approval_id and a.expires_at>now()
 join marketing_private.credentials k on k.connection_id=c.id
 where j.id=p_job and j.lease=p_lease and j.lease_until>now() and j.state='leased' and c.status in ('test_authorized','production_authorized') and c.expires_at>now()
 and marketing_private.actor_allowed(j.actor,c.organization_id,c.brand_id,'marketing_inbox.configure')
 and coalesce((marketing_private.inbox_channel(c.id)->>'configuration_verified')::boolean,false) and coalesce((marketing_private.inbox_channel(c.id)->>'receiving_verified')::boolean,false));
$$;
create function public.marketing_inbox_history_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare j marketing_private.inbox_history_jobs; c public.marketing_connections;begin
 update marketing_private.inbox_history_jobs x set state='cancelled',checkpoint='{}',reason='approval_or_grant_expired',lease_until=null,updated_at=now()
 where state in ('queued','retry','leased') and not exists(select 1 from marketing_private.inbox_history_approvals a join public.marketing_connections c on c.id=a.connection_id and c.credential_generation=a.generation and c.status in ('test_authorized','production_authorized') where a.connection_id=x.connection_id and a.approval_id=x.approval_id and a.generation=x.generation and a.expires_at>now());
 update marketing_private.inbox_history_jobs set state='failed',reason='lease_retry_limit',lease_until=null,updated_at=now() where state='leased' and lease_until<now() and attempts>=5;
 select x.* into j from marketing_private.inbox_history_jobs x join public.marketing_connections c on c.id=x.connection_id and c.credential_generation=x.generation
 where x.state in ('queued','retry','leased') and x.due_at<=now() and (x.lease_until is null or x.lease_until<now()) and x.attempts<5 and x.pages<250
 and c.expires_at>now() and c.status in ('test_authorized','production_authorized') and coalesce((marketing_private.inbox_channel(c.id)->>'configuration_verified')::boolean,false) and coalesce((marketing_private.inbox_channel(c.id)->>'receiving_verified')::boolean,false)
 and marketing_private.actor_allowed(x.actor,c.organization_id,c.brand_id,'marketing_inbox.configure')
 order by x.due_at,x.id for update of x skip locked limit 1;
 if not found then return null;end if;
 update marketing_private.inbox_history_jobs set state='leased',lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=attempts+1,updated_at=now() where id=j.id returning * into j;
 select * into c from public.marketing_connections where id=j.connection_id;
 return to_jsonb(j)||jsonb_build_object('connection',to_jsonb(c),'page_id',(select page_id from marketing_private.inbox_authority where connection_id=c.id and generation=j.generation));
end;$$;
create function public.marketing_inbox_history_finish(p_job uuid,p_lease uuid,p_result jsonb,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare j marketing_private.inbox_history_jobs;c public.marketing_connections;item jsonb;accepted jsonb;n integer:=0;begin
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
 accepted:=public.marketing_inbox_enqueue(jsonb_build_array(item));
 if (accepted->>'accepted')::integer>0 then
 update marketing_private.inbox_events set evidence_source='historical_import' where event_key=c.id::text||':'||j.generation::text||':incoming:'||(item->>'event_id');n:=n+1;
 end if;end if;
 end loop;
 update marketing_private.inbox_history_jobs set pages=pages+1,scanned=scanned+(p_result->>'scanned')::integer,omitted=omitted+(p_result->>'omitted')::integer,accepted=accepted+n,
 state=case when (p_result->>'done')::boolean then 'finished' when pages>=249 then 'bounded_gap' else 'queued' end,
 checkpoint=case when (p_result->>'done')::boolean or pages>=249 then '{}' else p_result->'checkpoint' end,
 reason=case when pages>=249 and not (p_result->>'done')::boolean then '250_page_limit' when omitted+(p_result->>'omitted')::integer>0 then 'incoming_text_only_gap' else 'provider_history_not_guaranteed' end,
 attempts=0,due_at=now()+interval '2 minutes',lease_until=null,updated_at=now() where id=j.id;
end;$$;
create function public.marketing_inbox_history_status(p_connection uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c public.marketing_connections;a marketing_private.inbox_history_approvals;j marketing_private.inbox_history_jobs;begin
 select * into c from public.marketing_connections where id=p_connection;
 if c.id is null then raise exception 'Connection unavailable.';end if;
 perform marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.view');
 select * into a from marketing_private.inbox_history_approvals where connection_id=c.id and generation=c.credential_generation and expires_at>now();
 select * into j from marketing_private.inbox_history_jobs where connection_id=c.id and generation=c.credential_generation order by created_at desc limit 1;
 return jsonb_build_object('approval_required',a.connection_id is null,'can_start',a.connection_id is not null and a.approval_id is distinct from j.approval_id,'state',coalesce(j.state,'not_started'),'reason',j.reason,'window_from',j.window_from,'window_to',j.window_to,'pages',j.pages,'accepted',j.accepted,'omitted',j.omitted,'updated_at',j.updated_at,'historical_completeness',false,'lookback_days',30,'source','historical_import');
end;$$;
-- Imported history can never count as signed delivery evidence. A later real webhook may upgrade the queue evidence only.
alter table marketing_private.inbox_events drop constraint inbox_events_evidence_source_check;
alter table marketing_private.inbox_events add constraint inbox_events_evidence_source_check check(evidence_source in ('signed_webhook','recent_api','historical_import'));
alter table public.marketing_conversation_messages drop constraint marketing_conversation_messages_evidence_source_check;
alter table public.marketing_conversation_messages add constraint marketing_conversation_messages_evidence_source_check check(evidence_source in ('internal','signed_webhook','recent_api','historical_import'));
do $$declare body text;begin
 body:=pg_get_functiondef('public.marketing_inbox_receive(jsonb)'::regprocedure);
 body:=replace(body,'evidence_source=''recent_api''','evidence_source in (''recent_api'',''historical_import'')');execute body;
 body:=pg_get_functiondef('public.marketing_inbox_process_events(integer)'::regprocedure);
 -- Historical ingestion must not reopen handled conversations or start FAQ proposals.
 body:=replace(body,'status=case when item->>''kind'' in','status=case when ev.evidence_source<>''historical_import'' and item->>''kind'' in');
 body:=replace(body,'if event_medium=''dm'' and not c.opted_out','if ev.evidence_source<>''historical_import'' and event_medium=''dm'' and not c.opted_out');
 if position('ev.evidence_source<>''historical_import''' in body)=0 then raise exception 'Inbox processor contract changed.';end if;execute body;
end;$$;
revoke all on function public.marketing_inbox_history_authorize(uuid,integer,text),public.marketing_inbox_history_claim(),public.marketing_inbox_history_guard(uuid,uuid),public.marketing_inbox_history_finish(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.marketing_inbox_history_authorize(uuid,integer,text),public.marketing_inbox_history_claim(),public.marketing_inbox_history_guard(uuid,uuid),public.marketing_inbox_history_finish(uuid,uuid,jsonb,text) to service_role;
revoke all on function public.marketing_inbox_history_request(uuid),public.marketing_inbox_history_status(uuid) from public,anon;
grant execute on function public.marketing_inbox_history_request(uuid),public.marketing_inbox_history_status(uuid) to authenticated;
