-- Separate authorized configuration from observed end-to-end delivery.
-- Staging provider workers remain guarded by the fixed Staging project and scheduler secret.
alter table marketing_private.inbox_authority add column configuration_verified boolean not null default false;
alter table marketing_private.inbox_events add column evidence_source text not null default 'signed_webhook' check(evidence_source in ('signed_webhook','recent_api'));
create table marketing_private.connection_checks(
 connection_id uuid primary key references public.marketing_connections(id) on delete cascade,
 generation integer not null, due_at timestamptz not null default now(),
 lease uuid, lease_until timestamptz, lease_started_at timestamptz, requested_at timestamptz, attempts integer not null default 0,
 checked_at timestamptz, successful_at timestamptz, error_code text,
 subscription_request uuid, subscription_plan jsonb
);
create index marketing_connection_checks_due on marketing_private.connection_checks(due_at,connection_id);
alter table marketing_private.connection_checks enable row level security;
revoke all on marketing_private.connection_checks from public,anon,authenticated;

create function marketing_private.schedule_connection_check() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.channel in ('facebook','instagram') and new.status in ('test_authorized','production_authorized') then
  insert into marketing_private.connection_checks(connection_id,generation) values(new.id,new.credential_generation)
  on conflict(connection_id) do update set generation=excluded.generation,due_at=now(),attempts=0,lease=null,lease_until=null,checked_at=null,successful_at=null,error_code=null,subscription_request=null,subscription_plan=null
  where marketing_private.connection_checks.generation<>excluded.generation;
 end if;
 return new;
end;$$;
revoke all on function marketing_private.schedule_connection_check() from public,anon,authenticated;
create trigger marketing_connection_check_schedule after insert or update of credential_generation,status on public.marketing_connections for each row execute function marketing_private.schedule_connection_check();
insert into marketing_private.connection_checks(connection_id,generation)
select id,credential_generation from public.marketing_connections where channel in ('facebook','instagram') and status in ('test_authorized','production_authorized');

create function public.marketing_meta_health_claim(p_connection uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare j marketing_private.connection_checks; u uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 select x.* into j from marketing_private.connection_checks x join public.marketing_connections c on c.id=x.connection_id
 where (p_connection is null or x.connection_id=p_connection) and x.generation=c.credential_generation and x.due_at<=now()
 and (x.lease_until is null or x.lease_until<now()) and c.expires_at>now() and c.status in ('test_authorized','production_authorized')
 and exists(select 1 from marketing_private.credentials s where s.connection_id=c.id)
 and marketing_private.actor_allowed(c.connected_by,c.organization_id,c.brand_id,'marketing_settings.configure')
 order by x.due_at,x.connection_id for update of x skip locked limit 1;
 if not found then return null;end if;
 select e.auth_user_id into u from public.marketing_connections c join public.employees e on e.id=c.connected_by where c.id=j.connection_id;
 if u is null then return null;end if;
 update marketing_private.connection_checks set lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',lease_started_at=now(),attempts=attempts+1 where connection_id=j.connection_id returning * into j;
 return to_jsonb(j)||jsonb_build_object('auth_user_id',u);
end;$$;
create function public.marketing_meta_health_guard(p_connection uuid,p_generation integer,p_lease uuid) returns boolean language sql stable security definer set search_path=public as $$
 select auth.role()='service_role' and exists(select 1 from marketing_private.connection_checks j join public.marketing_connections c on c.id=j.connection_id join marketing_private.credentials s on s.connection_id=c.id
 where c.id=p_connection and j.generation=p_generation and c.credential_generation=p_generation and j.lease=p_lease and j.lease_until>now()
 and c.expires_at>now() and c.status in ('test_authorized','production_authorized') and marketing_private.actor_allowed(c.connected_by,c.organization_id,c.brand_id,'marketing_settings.configure'));
$$;
create function public.marketing_meta_health_finish(p_connection uuid,p_generation integer,p_lease uuid,p_error text default null) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.marketing_meta_health_guard(p_connection,p_generation,p_lease) then raise exception using errcode='42501',message='Connection check authority changed.';end if;
 update marketing_private.connection_checks set checked_at=now(),successful_at=case when p_error is null then now() else successful_at end,
 error_code=left(p_error,100),lease_until=null,attempts=case when p_error is null or attempts>=5 then 0 else attempts end,
 due_at=case when requested_at>lease_started_at then greatest(now(),now()+interval '1 minute') else now()+case when p_error is null or attempts>=5 then interval '6 hours' else make_interval(secs=>60*power(2,least(attempts-1,4))::integer) end end where connection_id=p_connection;
end;$$;
create function public.marketing_meta_health_subscription_request(p_connection uuid,p_generation integer,p_lease uuid,p_plan jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare request uuid;
begin
 if not public.marketing_meta_health_guard(p_connection,p_generation,p_lease) then raise exception using errcode='42501',message='Connection check authority changed.';end if;
 -- Same plan/generation keeps its write-ahead request. An uncertain write is never repeated.
 update marketing_private.connection_checks set subscription_request=case when subscription_plan is distinct from p_plan or subscription_request is null then gen_random_uuid() else subscription_request end,subscription_plan=p_plan where connection_id=p_connection returning subscription_request into request;
 return request;
end;$$;
revoke all on function public.marketing_meta_health_claim(uuid),public.marketing_meta_health_guard(uuid,integer,uuid),public.marketing_meta_health_finish(uuid,integer,uuid,text),public.marketing_meta_health_subscription_request(uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_meta_health_claim(uuid),public.marketing_meta_health_guard(uuid,integer,uuid),public.marketing_meta_health_finish(uuid,integer,uuid,text),public.marketing_meta_health_subscription_request(uuid,integer,uuid,jsonb) to service_role;

create or replace function public.marketing_inbox_record_verification(p_connection uuid,p_auth_user uuid,p_generation integer,p_evidence jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; a marketing_private.inbox_authority; verified boolean; configured boolean; delivered boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 select * into c from public.marketing_connections where id=p_connection for update;
 if c.credential_generation is distinct from p_generation or c.provider_account_id is distinct from p_evidence->>'account_id' or c.channel is distinct from p_evidence->>'channel' then raise exception 'Connection changed.';end if;
 select * into a from marketing_private.inbox_authority where connection_id=c.id;
 verified:=coalesce((p_evidence->>'authorization_verified')::boolean,false);
 configured:=verified and coalesce((p_evidence->>'subscriptions_verified')::boolean,false);
 -- Delivery requires a durable genuine signed inbound receipt for this exact account/generation. API recovery cannot supply it.
 delivered:=configured and (coalesce(a.generation=c.credential_generation and a.webhook_verified,false) or exists(
  select 1 from marketing_private.inbox_events e where e.connection_id=c.id and e.generation=c.credential_generation and e.evidence_source='signed_webhook'
  and e.payload->>'kind' in ('incoming','attachment') and coalesce(e.payload->>'medium','dm')='dm'
  and (e.payload->>'occurred_at')::timestamptz>=c.connected_at));
 insert into marketing_private.inbox_authority(connection_id,generation,receive_verified,send_verified,webhook_verified,verified_at,page_id,page_tasks,granted_scopes,configuration_verified)
 values(c.id,c.credential_generation,verified,verified,delivered,now(),p_evidence->>'page_id',array(select jsonb_array_elements_text(p_evidence->'page_tasks')),array(select jsonb_array_elements_text(p_evidence->'required_permissions')),configured)
 on conflict(connection_id) do update set generation=excluded.generation,receive_verified=excluded.receive_verified,send_verified=excluded.send_verified,webhook_verified=excluded.webhook_verified,verified_at=excluded.verified_at,page_id=excluded.page_id,page_tasks=excluded.page_tasks,granted_scopes=excluded.granted_scopes,configuration_verified=excluded.configuration_verified,
 signed_inbound_at=case when marketing_private.inbox_authority.generation=excluded.generation then marketing_private.inbox_authority.signed_inbound_at end;
 if configured then
  update marketing_private.inbox_events set state='pending',error_code=null,due_at=now() where connection_id=c.id and generation=c.credential_generation and state='blocked' and error_code='messaging_authorization_unverified' and coalesce(payload->>'medium','dm')='dm';
 end if;
 return marketing_private.inbox_channel(c.id);
end;$$;

-- Receiving readiness must not depend on having received the first message already.
-- Sending still uses send_verified + webhook_verified + explicit staff approval and execution gates.
do $$declare body text;begin
 body:=pg_get_functiondef('marketing_private.inbox_channel(uuid)'::regprocedure);
 body:=replace(body,'a.receive_verified and a.webhook_verified and c.expires_at','a.receive_verified and (a.configuration_verified or a.webhook_verified) and c.expires_at');
 body:=replace(body,'''sending_enabled'',false', '''configuration_verified'',coalesce(a.generation=c.credential_generation and a.configuration_verified,false),''delivery_verified'',coalesce(a.generation=c.credential_generation and a.webhook_verified,false),''last_inbound_at'',case when a.generation=c.credential_generation then a.signed_inbound_at end,''sending_enabled'',false');
 body:=replace(body,$find$when not a.webhook_verified then 'webhook_unverified'$find$,$new$when not (a.configuration_verified or a.webhook_verified) then 'configuration_unverified' when not a.webhook_verified then 'awaiting_first_delivery'$new$);
 if position('configuration_verified' in body)=0 then raise exception 'Inbox channel contract changed.';end if;
 execute body;
end;$$;

create or replace function public.marketing_inbox_signed_events(p_events jsonb) returns void language plpgsql security definer set search_path=public as $$
declare item jsonb; c public.marketing_connections;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>1000 then raise exception 'Invalid event batch.';end if;
 for item in select value from jsonb_array_elements(p_events) loop
  if item->>'kind' not in ('incoming','attachment') or coalesce(item->>'medium','dm')<>'dm' then continue;end if;
  select * into c from public.marketing_connections where channel=item->>'channel' and provider_account_id=item->>'account_id';
  -- Only events committed by the signed webhook path are eligible; no API recovery promotion.
  if not exists(select 1 from marketing_private.inbox_events e where e.connection_id=c.id and e.generation=c.credential_generation and e.evidence_source='signed_webhook' and e.event_key=c.id::text||':'||c.credential_generation::text||':'||(item->>'kind')||':'||(item->>'event_id') and e.payload->>'peer_id'=item->>'peer_id') then continue;end if;
  update marketing_private.inbox_authority set signed_inbound_at=greatest(signed_inbound_at,(item->>'occurred_at')::timestamptz),webhook_verified=webhook_verified or (configuration_verified and receive_verified and (item->>'occurred_at')::timestamptz>=c.connected_at and (item->>'occurred_at')::timestamptz<=now()+interval '5 minutes' and c.expires_at>now() and c.status in ('test_authorized','production_authorized')) where connection_id=c.id and generation=c.credential_generation;
  update marketing_private.connection_checks j set requested_at=now(),due_at=least(due_at,greatest(now(),coalesce(j.checked_at+interval '1 minute',now()))) where j.connection_id=c.id and j.generation=c.credential_generation and not exists(select 1 from marketing_private.inbox_authority a where a.connection_id=c.id and a.generation=c.credential_generation and a.webhook_verified);
 end loop;
end;$$;

create function public.marketing_inbox_receive(p_events jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; item jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 result:=public.marketing_inbox_enqueue(p_events);
 for item in select value from jsonb_array_elements(p_events) loop
  update marketing_private.inbox_events set evidence_source='signed_webhook' where evidence_source='recent_api' and payload->>'peer_id'=item->>'peer_id' and exists(select 1 from public.marketing_connections c where c.id=connection_id and c.credential_generation=generation and c.channel=item->>'channel' and c.provider_account_id=item->>'account_id' and event_key=c.id::text||':'||c.credential_generation::text||':'||(item->>'kind')||':'||(item->>'event_id'));
 end loop;
 perform public.marketing_inbox_signed_events(p_events);
 return result;
end;$$;

create function public.marketing_inbox_reconcile(p_connection uuid,p_generation integer,p_lease uuid,p_events jsonb) returns void language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; item jsonb; accepted jsonb;begin
 if not public.marketing_meta_health_guard(p_connection,p_generation,p_lease) then raise exception using errcode='42501',message='Connection check authority changed.';end if;
 select * into c from public.marketing_connections where id=p_connection for share;
 if not (marketing_private.inbox_channel(c.id)->>'configuration_verified')::boolean or jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>100 then raise exception 'Recent reconciliation unavailable.';end if;
 for item in select value from jsonb_array_elements(p_events) loop
  if item->>'channel' is distinct from c.channel or item->>'account_id' is distinct from c.provider_account_id or item->>'kind' is distinct from 'incoming' or item->>'medium' is distinct from 'dm'
  or item->>'occurred_at' is null or (item->>'occurred_at')::timestamptz<greatest(c.connected_at,now()-interval '24 hours') or (item->>'occurred_at')::timestamptz>now() then raise exception 'Recent message scope denied.';end if;
  -- Never turn a recovered event into signed evidence or overwrite an existing event.
  if not exists(select 1 from marketing_private.inbox_events e where event_key=c.id::text||':'||p_generation::text||':incoming:'||(item->>'event_id')) then
   accepted:=public.marketing_inbox_enqueue(jsonb_build_array(item));
   if (accepted->>'accepted')::integer>0 then
    update marketing_private.inbox_events set evidence_source='recent_api' where event_key=c.id::text||':'||p_generation::text||':incoming:'||(item->>'event_id');
   end if;
  end if;
 end loop;
end;$$;
revoke all on function public.marketing_inbox_receive(jsonb),public.marketing_inbox_reconcile(uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_inbox_receive(jsonb),public.marketing_inbox_reconcile(uuid,integer,uuid,jsonb) to service_role;

-- Only safe health summaries are added to the existing brand-scoped read model.
create or replace function public.marketing_social_accounts(p_org uuid,p_brand uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare base jsonb; rows jsonb;begin
 base:=public.marketing_integrations(p_org,p_brand,'settings',1);
 select coalesce(jsonb_agg(c||jsonb_build_object('health',case when h.generation=(c->>'credential_generation')::integer then h.evidence||jsonb_build_object('checked_at',h.checked_at) else null end,'checks',case when j.generation=(c->>'credential_generation')::integer then jsonb_build_object('checked_at',j.checked_at,'successful_at',j.successful_at,'next_check_at',j.due_at,'error_code',j.error_code) else null end,'messaging',marketing_private.inbox_channel((c->>'id')::uuid))),'[]') into rows from jsonb_array_elements(base->'connections') c left join marketing_private.connection_health h on h.connection_id=(c->>'id')::uuid left join marketing_private.connection_checks j on j.connection_id=(c->>'id')::uuid;
 return base||jsonb_build_object('connections',rows);
end;$$;

-- API recovery is visible evidence, never a signed webhook receipt.
alter table public.marketing_conversation_messages add column evidence_source text not null default 'internal' check(evidence_source in ('internal','signed_webhook','recent_api'));
do $$declare body text;begin
 body:=pg_get_functiondef('public.marketing_inbox_process_events(integer)'::regprocedure);
 body:=replace(body,'provider_message_id,occurred_at,delivery_state)','provider_message_id,occurred_at,delivery_state,evidence_source)');
 body:=replace(body,$find$else 'observed' end) on conflict$find$,$new$else 'observed' end,ev.evidence_source) on conflict$new$);
 execute body;
end;$$;
