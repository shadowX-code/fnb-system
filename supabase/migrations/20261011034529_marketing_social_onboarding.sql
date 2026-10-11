-- Social Accounts projects existing connection authority; execution remains separately governed.
alter table marketing_private.oauth_sessions add column selection jsonb, add column selected_at timestamptz, add column reconnect_connection uuid references public.marketing_connections(id), add column reconnect_generation integer;
create table marketing_private.connection_health(connection_id uuid primary key references public.marketing_connections(id), generation integer not null, checked_at timestamptz not null default now(), evidence jsonb not null);
create table marketing_private.subscription_intents(request_id uuid primary key,connection_id uuid not null references public.marketing_connections(id),generation integer not null,actor_employee_id uuid not null references public.employees(id),plan jsonb not null,state text not null default 'prepared' check(state in ('prepared','pending','reconciling','failed','verified')),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
alter table marketing_private.connection_health enable row level security;
alter table marketing_private.subscription_intents enable row level security;
revoke all on marketing_private.connection_health,marketing_private.subscription_intents from public,anon,authenticated;

create or replace function public.marketing_meta_pending(p_org uuid,p_brand uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_settings.configure'); result jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'expires_at',s.expires_at,'reconnect_connection',s.reconnect_connection,'accounts',(
 select coalesce(jsonb_agg(a.value||jsonb_build_object('available',not exists(select 1 from public.marketing_connections x where x.channel=a.value->>'channel' and x.provider_account_id=a.value->>'id' and x.brand_id<>s.brand_id),'current_connection_id',c.id,'current_generation',c.credential_generation,'replacement',c.provider_account_id is not null and c.provider_account_id is distinct from a.value->>'id')),'[]')
 from jsonb_array_elements(s.accounts) a left join public.marketing_connections c on c.brand_id=s.brand_id and c.channel=a.value->>'channel' where s.reconnect_connection is null or (c.id=s.reconnect_connection and c.provider_account_id=a.value->>'id'))) order by s.consumed_at desc),'[]') into result
 from marketing_private.oauth_sessions s where s.organization_id=p_org and s.brand_id=p_brand and s.actor_employee_id=actor and s.expires_at>now() and s.sealed_discovery is not null and s.selected_at is null and s.bindings='{}';
 return result;
end;$$;

-- Atomic selection delegates each credential binding to the existing canonical authority.
create function public.marketing_meta_bind_selection(p_session uuid,p_auth_user uuid,p_brand uuid,p_assets jsonb,p_expiry timestamptz,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s marketing_private.oauth_sessions; a jsonb; c public.marketing_connections; result jsonb:='[]'; fingerprint jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 perform public.marketing_meta_session_material(p_session,p_auth_user);
 select * into s from marketing_private.oauth_sessions where id=p_session for update;
 if p_brand is distinct from s.brand_id or p_confirm is distinct from true or p_assets is null or jsonb_typeof(p_assets)<>'array' or jsonb_array_length(p_assets) not between 1 and 2 then raise exception 'Confirm the exact brand and account selection.';end if;
 fingerprint:=(select jsonb_agg(value-array['sealed_token'] order by value->>'channel') from jsonb_array_elements(p_assets));
 if s.selected_at is not null then
  if s.selection is distinct from fingerprint then raise exception 'Account selection already confirmed.';end if;
  for a in select value from jsonb_array_elements(p_assets) loop result:=result||jsonb_build_array(public.marketing_meta_bind(p_session,p_auth_user,a->>'id',a->>'channel',a->'sealed_token',p_expiry,'test'));end loop;
  return result;
 end if;
 if s.bindings<>'{}' then raise exception 'Reconnect before changing a completed selection.';end if;
 if s.reconnect_connection is not null and (jsonb_array_length(p_assets)<>1 or not exists(select 1 from public.marketing_connections x join jsonb_array_elements(p_assets) chosen on x.channel=chosen->>'channel' and x.provider_account_id=chosen->>'id' where x.id=s.reconnect_connection and x.credential_generation=s.reconnect_generation)) then raise exception 'Reconnect must preserve the existing account.';end if;
 perform 1 from public.brands where id=s.brand_id for update;
 if (select count(distinct value->>'channel') from jsonb_array_elements(p_assets))<>jsonb_array_length(p_assets) then raise exception 'Select one account per channel.';end if;
 for a in select value from jsonb_array_elements(p_assets) order by value->>'channel' loop
  if a->>'channel' not in ('facebook','instagram') or not exists(select 1 from jsonb_array_elements(s.accounts) x where x->>'id'=a->>'id' and x->>'channel'=a->>'channel') then raise exception 'Choose a discovered account.';end if;
  if exists(select 1 from public.marketing_connections x where x.channel=a->>'channel' and x.provider_account_id=a->>'id' and x.brand_id<>s.brand_id) then raise exception 'This account is already assigned to another brand.';end if;
  select * into c from public.marketing_connections where brand_id=s.brand_id and channel=a->>'channel' for update;
  if c.id::text is distinct from a->>'expectedConnectionId' or c.credential_generation is distinct from (a->>'expectedGeneration')::integer then raise exception 'Connection changed. Reload account selection.';end if;
  if c.id is not null and exists(select 1 from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id join public.marketing_conversations cv on cv.id=d.conversation_id where cv.connection_id=c.id and o.state in ('prepared','pending','reconciling')) then raise exception 'Resolve a pending reply before reconnecting.';end if;
 end loop;
 -- A selected pair must be the provider-verified Page/Instagram relationship.
 if jsonb_array_length(p_assets)=2 and not exists(select 1 from jsonb_array_elements(s.accounts) ig where ig->>'channel'='instagram' and ig->>'id'=(select x->>'id' from jsonb_array_elements(p_assets) x where x->>'channel'='instagram') and ig->>'page_id'=(select x->>'id' from jsonb_array_elements(p_assets) x where x->>'channel'='facebook')) then raise exception 'Select the Page linked to this Instagram account.';end if;
 if jsonb_array_length(p_assets)=1 and p_assets->0->>'channel'='instagram' and exists(select 1 from public.marketing_connections fb join jsonb_array_elements(s.accounts) ig on ig->>'id'=p_assets->0->>'id' and ig->>'channel'='instagram' where fb.brand_id=s.brand_id and fb.channel='facebook' and fb.status<>'disconnected' and fb.provider_account_id is distinct from ig->>'page_id') then raise exception 'Select the linked Facebook Page together with this Instagram account.';end if;
 for a in select value from jsonb_array_elements(p_assets) order by value->>'channel' loop
  result:=result||jsonb_build_array(public.marketing_meta_bind(p_session,p_auth_user,a->>'id',a->>'channel',a->'sealed_token',p_expiry,'test'));
 end loop;
 -- Discovery signals are provisional until the independent operation resolver passes.
 update public.marketing_connections set capabilities=capabilities||jsonb_build_object('publishing',false,'execution_enabled',false) where id in (select (x->>'id')::uuid from jsonb_array_elements(result) x);
 result:=(select jsonb_agg(to_jsonb(bound)) from public.marketing_connections bound where id in (select (x->>'id')::uuid from jsonb_array_elements(result) x));
 update marketing_private.oauth_sessions set selection=fingerprint,selected_at=now() where id=s.id;
 return result;
end;$$;

create function public.marketing_social_accounts(p_org uuid,p_brand uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare base jsonb; rows jsonb;
begin
 base:=public.marketing_integrations(p_org,p_brand,'settings',1);
 select coalesce(jsonb_agg(c||jsonb_build_object('health',case when h.generation=(c->>'credential_generation')::integer then h.evidence||jsonb_build_object('checked_at',h.checked_at) else null end,'messaging',marketing_private.inbox_channel((c->>'id')::uuid))),'[]') into rows from jsonb_array_elements(base->'connections') c left join marketing_private.connection_health h on h.connection_id=(c->>'id')::uuid;
 return base||jsonb_build_object('connections',rows);
end;$$;
create function public.marketing_meta_record_health(p_connection uuid,p_auth_user uuid,p_generation integer,p_health jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 select * into c from public.marketing_connections where id=p_connection for update;
 if c.credential_generation<>p_generation then raise exception 'Connection changed.';end if;
 if p_health is null or jsonb_typeof(p_health)<>'object' or length(p_health::text)>8000 then raise exception 'Invalid health evidence.';end if;
 insert into marketing_private.connection_health values(c.id,p_generation,now(),p_health) on conflict(connection_id) do update set generation=excluded.generation,checked_at=excluded.checked_at,evidence=excluded.evidence;
 update public.marketing_connections set last_checked_at=now() where id=c.id;
end;$$;

create function public.marketing_meta_subscription_intent(p_request uuid,p_connection uuid,p_auth_user uuid,p_generation integer,p_plan jsonb,p_state text default null) returns text
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; actor uuid; prior marketing_private.subscription_intents;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 select * into c from public.marketing_connections where id=p_connection for update;
 select id into actor from public.employees where auth_user_id=p_auth_user;
 if c.credential_generation<>p_generation or c.expires_at<=now() or c.status not in ('test_authorized','production_authorized') or p_request is null or p_plan is null or jsonb_typeof(p_plan)<>'object' or length(p_plan::text)>8000 then raise exception 'Subscription authority changed.';end if;
 insert into marketing_private.subscription_intents(request_id,connection_id,generation,actor_employee_id,plan) values(p_request,c.id,p_generation,actor,p_plan) on conflict(request_id) do nothing;
 select * into prior from marketing_private.subscription_intents where request_id=p_request for update;
 if prior.connection_id<>c.id or prior.generation<>p_generation or prior.actor_employee_id<>actor or prior.plan is distinct from p_plan then raise exception 'Subscription request changed.';end if;
 if p_state is not null then
  if p_state not in ('pending','failed','verified','reconciling') or (prior.state<>'prepared' and p_state='pending') then raise exception 'Subscription write cannot be repeated.';end if;
  update marketing_private.subscription_intents set state=p_state,updated_at=now() where request_id=p_request;
 end if;
 return coalesce(p_state,prior.state);
end;$$;
revoke all on function public.marketing_social_accounts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_social_accounts(uuid,uuid) to authenticated;
revoke all on function public.marketing_meta_bind_selection(uuid,uuid,uuid,jsonb,timestamptz,boolean),public.marketing_meta_record_health(uuid,uuid,integer,jsonb),public.marketing_meta_subscription_intent(uuid,uuid,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.marketing_meta_bind_selection(uuid,uuid,uuid,jsonb,timestamptz,boolean),public.marketing_meta_record_health(uuid,uuid,integer,jsonb),public.marketing_meta_subscription_intent(uuid,uuid,uuid,integer,jsonb,text) to service_role;

-- A quiet period never erases prior end-to-end evidence for the same verified grant.
create or replace function public.marketing_inbox_record_verification(p_connection uuid,p_auth_user uuid,p_generation integer,p_evidence jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; a marketing_private.inbox_authority; verified boolean;
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 select * into c from public.marketing_connections where id=p_connection for update;
 if c.credential_generation<>p_generation or c.provider_account_id<>p_evidence->>'account_id' or c.channel<>p_evidence->>'channel' then raise exception 'Connection changed.';end if;
 select * into a from marketing_private.inbox_authority where connection_id=c.id;
 verified:=coalesce((p_evidence->>'authorization_verified')::boolean,false);
 insert into marketing_private.inbox_authority(connection_id,generation,receive_verified,send_verified,webhook_verified,verified_at,page_id,page_tasks,granted_scopes)
 values(c.id,c.credential_generation,verified,verified,verified and (coalesce((p_evidence->>'real_inbound_verified')::boolean,false) or coalesce(a.generation=c.credential_generation and a.webhook_verified,false)) and coalesce((p_evidence->>'subscriptions_verified')::boolean,false),now(),p_evidence->>'page_id',array(select jsonb_array_elements_text(p_evidence->'page_tasks')),array(select jsonb_array_elements_text(p_evidence->'required_permissions')))
 on conflict(connection_id) do update set generation=excluded.generation,receive_verified=excluded.receive_verified,send_verified=excluded.send_verified,verified_at=now(),page_id=excluded.page_id,page_tasks=excluded.page_tasks,granted_scopes=excluded.granted_scopes,
 webhook_verified=excluded.webhook_verified;
 if verified and (coalesce((p_evidence->>'real_inbound_verified')::boolean,false) or coalesce(a.generation=c.credential_generation and a.webhook_verified,false)) and coalesce((p_evidence->>'subscriptions_verified')::boolean,false) then
  update marketing_private.inbox_events set state='pending',error_code=null where connection_id=c.id and generation=c.credential_generation and state='blocked' and payload->>'event_id' in (select jsonb_array_elements_text(p_evidence->'verified_inbound_ids'));
 end if;
 return marketing_private.inbox_channel(c.id);
end;$$;


create function public.marketing_meta_reconnect_intent(p_session uuid,p_auth_user uuid,p_connection uuid) returns void
language plpgsql security definer set search_path=public as $$
declare s marketing_private.oauth_sessions; c public.marketing_connections;actor uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 select id into actor from public.employees where auth_user_id=p_auth_user;
 select * into s from marketing_private.oauth_sessions where id=p_session for update;
 select * into c from public.marketing_connections where id=p_connection;
 if s.id is null or s.actor_employee_id is distinct from actor or s.consumed_at is not null or s.expires_at<=now() or c.brand_id is distinct from s.brand_id or not marketing_private.actor_allowed(actor,s.organization_id,s.brand_id,'marketing_settings.configure') then raise exception using errcode='42501',message='Reconnect scope denied.';end if;
 update marketing_private.oauth_sessions set reconnect_connection=c.id,reconnect_generation=c.credential_generation where id=s.id;
end;$$;
revoke all on function public.marketing_meta_reconnect_intent(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_meta_reconnect_intent(uuid,uuid,uuid) to service_role;
