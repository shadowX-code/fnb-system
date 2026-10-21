-- Official signup authority; deliberately no readiness evidence or pilot grants are seeded.
create table marketing_private.whatsapp_platform_readiness (
 app_id text primary key check(app_id ~ '^[0-9]{1,32}$'), config_id text not null check(config_id ~ '^[0-9]{1,32}$'),
 graph_version text not null check(graph_version ~ '^v[0-9]+\.0$'), signup_version text not null check(signup_version in ('v4','v5')),
 business_verified boolean not null default false, tech_provider_verified boolean not null default false,
 access_verified boolean not null default false, app_live boolean not null default false,
 permissions_reviewed boolean not null default false, webhook_reviewed boolean not null default false,
 coexistence_enabled boolean not null default false, evidence_reference text not null check(length(evidence_reference) between 1 and 500),
 reviewed_at timestamptz not null, expires_at timestamptz not null,
 check(expires_at>reviewed_at and expires_at<=reviewed_at+interval '7 days')
);
create table marketing_private.whatsapp_pilot_authority (
 brand_id uuid primary key references public.brands(id), app_id text not null unique references marketing_private.whatsapp_platform_readiness(app_id),
 customer_business_id text not null check(customer_business_id ~ '^[0-9]{1,32}$'),
 waba_id text not null check(waba_id ~ '^[0-9]{1,32}$'), phone_id text not null unique check(phone_id ~ '^[0-9]{1,32}$'),
 approval_reference text not null check(length(approval_reference) between 1 and 500), expires_at timestamptz not null
);
create table marketing_private.whatsapp_signup_sessions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null,
 actor_employee_id uuid not null references employees(id), state_hash text not null unique check(state_hash ~ '^[a-f0-9]{64}$'),
 app_id text not null, config_id text not null, graph_version text not null, signup_version text not null,
 connection_id uuid references marketing_connections(id), expected_generation integer not null,
 waba_id text not null, phone_id text not null, customer_business_id text not null,
 expires_at timestamptz not null default now()+interval '10 minutes', consumed_at timestamptz,
 completed_at timestamptz, result jsonb,
 foreign key(organization_id,brand_id) references brands(organization_id,id)
);
create table marketing_private.whatsapp_onboarding (
 connection_id uuid primary key references marketing_connections(id), generation integer not null,
 app_id text not null, customer_business_id text not null, subscribed boolean not null default false,
 token_verified_at timestamptz not null, verified_until timestamptz not null,
 subscription_state text not null default 'pending' check(subscription_state in ('pending','claimed','verified','uncertain')),
 contacts_state text not null default 'pending' check(contacts_state in ('pending','claimed','accepted','uncertain')),
 history_state text not null default 'pending' check(history_state in ('pending','claimed','accepted','uncertain')),
 contacts_request_id text, history_request_id text,
 sync_deadline timestamptz not null default now()+interval '24 hours', sync_observed boolean not null default false,
 sync_progress integer not null default 0, history_declined boolean not null default false,
 issue text, updated_at timestamptz not null default now()
);
-- Hashes/progress only: historical contact identities never become CRM or consent evidence.
create table marketing_private.whatsapp_lifecycle_events (
 event_hash text primary key, connection_id uuid not null references marketing_connections(id), generation integer not null,
 field text not null, provider_event text, occurred_at timestamptz not null, observed_at timestamptz not null default now()
);
do $$declare t text;begin
 foreach t in array array['whatsapp_platform_readiness','whatsapp_pilot_authority','whatsapp_signup_sessions','whatsapp_onboarding','whatsapp_lifecycle_events'] loop
 execute format('alter table marketing_private.%I enable row level security',t);
 execute format('revoke all on marketing_private.%I from public,anon,authenticated',t);
 end loop;
end;$$;

create function marketing_private.whatsapp_gate(p_brand uuid,p_app text,p_config text,p_version text,p_signup text) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from marketing_private.whatsapp_platform_readiness r join marketing_private.whatsapp_pilot_authority a on a.app_id=r.app_id
 where a.brand_id=p_brand and a.expires_at>now() and r.app_id=p_app and r.config_id=p_config and r.graph_version=p_version and r.signup_version=p_signup
 and r.business_verified and r.tech_provider_verified and r.access_verified and r.app_live and r.permissions_reviewed and r.webhook_reviewed and r.coexistence_enabled
 and r.reviewed_at<=now() and r.expires_at>now());
$$;
create function public.marketing_whatsapp_readiness(p_org uuid,p_brand uuid,p_app text,p_config text,p_version text,p_signup text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid;eligible boolean;begin
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_settings.view');
 eligible:=p_brand is not null and marketing_private.whatsapp_gate(p_brand,p_app,p_config,p_version,p_signup);
 return jsonb_build_object('eligible',eligible,'can_configure',p_brand is not null and marketing_private.actor_allowed(actor,p_org,p_brand,'marketing_settings.configure'),
 'state',case when eligible then 'eligible' else 'verification_required' end,
 'reason',case when eligible then 'ready_for_authorized_pilot' else 'platform_or_pilot_verification_required' end);
end;$$;
create function public.marketing_whatsapp_begin(p_org uuid,p_brand uuid,p_state_hash text,p_app text,p_config text,p_version text,p_signup text,p_connection uuid default null,p_generation integer default 0) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_settings.configure');s marketing_private.whatsapp_signup_sessions;c marketing_connections;a marketing_private.whatsapp_pilot_authority;begin
 if not coalesce(marketing_private.whatsapp_gate(p_brand,p_app,p_config,p_version,p_signup),false) or coalesce(p_state_hash,'') !~ '^[a-f0-9]{64}$'
 or not exists(select 1 from brands where id=p_brand and organization_id=p_org and is_active) then raise exception using errcode='42501',message='WhatsApp platform and pilot verification required.';end if;
 -- Serialize initial/reconnect attempts and capture an exact generation, never a browser-supplied replacement.
 perform pg_advisory_xact_lock(hashtextextended('whatsapp-brand:'||p_brand,0));
 select * into c from marketing_connections where brand_id=p_brand and channel='whatsapp' for update;
 if c.id is distinct from p_connection or coalesce(c.credential_generation,0) is distinct from p_generation then raise exception 'Connection changed. Refresh before reconnecting.';end if;
 select * into a from marketing_private.whatsapp_pilot_authority where brand_id=p_brand;
 if c.id is not null and (c.provider_account_id,c.whatsapp_waba_id,c.whatsapp_onboarding_mode) is distinct from (a.phone_id,a.waba_id,'coexistence'::text) then raise exception 'Reconnect must retain the exact Brand and phone.';end if;
 if (select count(*) from marketing_private.whatsapp_signup_sessions where actor_employee_id=actor and expires_at>now())>=10 then raise exception 'Too many pending connections.';end if;
 insert into marketing_private.whatsapp_signup_sessions(organization_id,brand_id,actor_employee_id,state_hash,app_id,config_id,graph_version,signup_version,connection_id,expected_generation,waba_id,phone_id,customer_business_id)
 values(p_org,p_brand,actor,p_state_hash,p_app,p_config,p_version,p_signup,p_connection,p_generation,a.waba_id,a.phone_id,a.customer_business_id) returning * into s;
 return jsonb_build_object('id',s.id,'expires_at',s.expires_at);
end;$$;
create function public.marketing_whatsapp_consume(p_session uuid,p_auth_user uuid,p_state_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s marketing_private.whatsapp_signup_sessions;begin
 select * into s from marketing_private.whatsapp_signup_sessions where id=p_session for update;
 if not found or s.expires_at<=now() or s.consumed_at is not null or s.state_hash is distinct from p_state_hash
 or not exists(select 1 from employees where id=s.actor_employee_id and auth_user_id=p_auth_user)
 or not marketing_private.actor_allowed(s.actor_employee_id,s.organization_id,s.brand_id,'marketing_settings.configure')
 or not marketing_private.whatsapp_gate(s.brand_id,s.app_id,s.config_id,s.graph_version,s.signup_version) then raise exception using errcode='42501',message='WhatsApp signup expired, used or revoked.';end if;
 update marketing_private.whatsapp_signup_sessions set consumed_at=now() where id=s.id;
 return to_jsonb(s)-'state_hash'-'result';
end;$$;
create function public.marketing_whatsapp_bind(p_session uuid,p_auth_user uuid,p_sealed jsonb,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s marketing_private.whatsapp_signup_sessions;c marketing_connections;expiry timestamptz;v_result jsonb;begin
 select * into s from marketing_private.whatsapp_signup_sessions where id=p_session for update;
 if not found or s.expires_at<=now() or s.consumed_at is null or s.completed_at is not null
 or not exists(select 1 from employees where id=s.actor_employee_id and auth_user_id=p_auth_user)
 or not marketing_private.actor_allowed(s.actor_employee_id,s.organization_id,s.brand_id,'marketing_settings.configure')
 or not marketing_private.whatsapp_gate(s.brand_id,s.app_id,s.config_id,s.graph_version,s.signup_version)
 or not exists(select 1 from brands where id=s.brand_id and organization_id=s.organization_id and is_active)
 or not exists(select 1 from marketing_private.whatsapp_pilot_authority a where a.brand_id=s.brand_id and (a.waba_id,a.phone_id,a.customer_business_id)=(s.waba_id,s.phone_id,s.customer_business_id))
 then raise exception using errcode='42501',message='WhatsApp signup authority changed.';end if;
 if p_sealed->>'version' is distinct from '1' or p_sealed->>'ciphertext' is null or p_evidence->>'app_id' is distinct from s.app_id
 or p_evidence->>'waba_id' is distinct from s.waba_id or p_evidence->>'phone_id' is distinct from s.phone_id
 or p_evidence->>'business_id' is distinct from s.customer_business_id or p_evidence->>'is_on_biz_app' is distinct from 'true'
 or p_evidence->>'platform_type' is distinct from 'CLOUD_API' or coalesce(p_evidence->>'subject','') !~ '^[0-9]{1,32}$'
 or not coalesce(p_evidence->'scopes' @> '["whatsapp_business_management","whatsapp_business_messaging"]',false) then raise exception 'Unverified WhatsApp assets.';end if;
 expiry:=(p_evidence->>'expires_at')::timestamptz;
 if expiry is null or expiry<=now() or expiry>now()+interval '24 hours 1 minute' then raise exception 'Invalid verification lifetime.';end if;
 perform pg_advisory_xact_lock(hashtextextended('whatsapp-brand:'||s.brand_id,0));
 perform pg_advisory_xact_lock(hashtextextended('whatsapp:'||s.phone_id,0));
 select * into c from marketing_connections where brand_id=s.brand_id and channel='whatsapp' for update;
 if c.id is distinct from s.connection_id or coalesce(c.credential_generation,0)<>s.expected_generation then raise exception 'Stale WhatsApp generation.';end if;
 if exists(select 1 from marketing_connections where channel='whatsapp' and provider_account_id=s.phone_id and id is distinct from c.id) then raise exception 'Phone belongs to another connection.';end if;
 if c.id is null then
 insert into marketing_connections(organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,credential_generation,connected_by,connected_at,last_checked_at,whatsapp_waba_id,whatsapp_onboarding_mode,whatsapp_revision)
 values(s.organization_id,s.brand_id,'whatsapp',s.phone_id,'WhatsApp Business App','test_authorized',expiry,1,s.actor_employee_id,clock_timestamp(),now(),s.waba_id,'coexistence',1) returning * into c;
 else
 if (c.provider_account_id,c.whatsapp_waba_id,c.whatsapp_onboarding_mode) is distinct from (s.phone_id,s.waba_id,'coexistence'::text) then raise exception 'WhatsApp identity cannot be replaced.';end if;
 update marketing_connections set status='test_authorized',expires_at=expiry,credential_generation=credential_generation+1,whatsapp_revision=whatsapp_revision+1,connected_by=s.actor_employee_id,connected_at=clock_timestamp(),last_checked_at=now(),error_code=null where id=c.id returning * into c;
 end if;
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id,expires_at)
 values(c.id,'encrypted-meta:'||c.id,p_sealed,p_evidence->>'subject',expiry)
 on conflict(connection_id) do update set sealed_token=excluded.sealed_token,meta_user_id=excluded.meta_user_id,expires_at=excluded.expires_at,credential_reference=excluded.credential_reference;
 insert into marketing_private.meta_subjects(connection_id,generation,meta_user_id) values(c.id,c.credential_generation,p_evidence->>'subject');
 insert into marketing_private.inbox_authority(connection_id,generation) values(c.id,c.credential_generation)
 on conflict(connection_id) do update set generation=excluded.generation,receive_verified=false,send_verified=false,execution_enabled=false,configuration_verified=false,webhook_verified=false,signed_inbound_at=null,granted_scopes='{}';
 insert into marketing_private.whatsapp_onboarding(connection_id,generation,app_id,customer_business_id,token_verified_at,verified_until)
 values(c.id,c.credential_generation,s.app_id,s.customer_business_id,now(),expiry)
 on conflict(connection_id) do update set generation=excluded.generation,app_id=excluded.app_id,customer_business_id=excluded.customer_business_id,token_verified_at=now(),verified_until=expiry,subscribed=false,subscription_state='pending',issue=null,updated_at=now();
 v_result:=jsonb_build_object('connection_id',c.id,'generation',c.credential_generation,'state','action_required');
 update marketing_private.whatsapp_signup_sessions set completed_at=now(),connection_id=c.id,result=v_result where id=s.id;
 insert into marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'whatsapp_coexistence_authorized',s.actor_employee_id,v_result);
 return v_result;
end;$$;

-- Service-only steps retain intent before one-shot provider calls. A claimed step is never replayed.
create function public.marketing_whatsapp_step(p_connection uuid,p_auth_user uuid,p_generation integer,p_step text,p_outcome text default null,p_request_id text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c marketing_connections;o marketing_private.whatsapp_onboarding;st text;begin
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 select * into c from marketing_connections where id=p_connection for update;
 select * into o from marketing_private.whatsapp_onboarding where connection_id=c.id for update;
 if c.channel<>'whatsapp' or c.credential_generation is distinct from p_generation or o.generation is distinct from p_generation or c.expires_at<=now() then raise exception 'WhatsApp generation unavailable.';end if;
 if p_step not in ('subscription','contacts','history') or p_step is null then raise exception 'Invalid onboarding step.';end if;
 st:=to_jsonb(o)->>(p_step||'_state');
 if p_outcome is null then
  if st='pending' then
   if not exists(select 1 from marketing_private.whatsapp_pilot_authority a join marketing_private.whatsapp_platform_readiness r on r.app_id=a.app_id where a.brand_id=c.brand_id and marketing_private.whatsapp_gate(c.brand_id,r.app_id,r.config_id,r.graph_version,r.signup_version)) then raise exception 'Pilot authority expired.';end if;
   if p_step<>'subscription' and (not o.subscribed or o.sync_deadline<=now()) then raise exception 'Synchronization unavailable.';end if;
   st:='claimed';
   execute format('update marketing_private.whatsapp_onboarding set %I=$1,updated_at=now() where connection_id=$2',p_step||'_state') using st,c.id;
   return jsonb_build_object('perform',true,'state',st);
  end if;
  return jsonb_build_object('perform',false,'state',st);
 end if;
 if (st not in ('claimed','uncertain') and not (p_step='subscription' and st='verified' and p_outcome='uncertain')) or p_outcome not in ('verified','accepted','uncertain') or (p_step='subscription' and p_outcome='accepted') or (p_step<>'subscription' and p_outcome='verified') then raise exception 'Invalid onboarding outcome.';end if;
 if p_step<>'subscription' and p_outcome='accepted' and (length(coalesce(p_request_id,'')) not between 1 and 300 or coalesce(p_request_id,'') !~ '^[A-Za-z0-9._-]+$') then raise exception 'Missing synchronization receipt.';end if;
 execute format('update marketing_private.whatsapp_onboarding set %I=$1,updated_at=now() where connection_id=$2',p_step||'_state') using p_outcome,c.id;
 if p_step='subscription' then
  update marketing_private.whatsapp_onboarding set subscribed=p_outcome='verified' where connection_id=c.id;
  update marketing_private.inbox_authority set receive_verified=p_outcome='verified',configuration_verified=p_outcome='verified',granted_scopes=array['whatsapp_business_management','whatsapp_business_messaging'],verified_at=now() where connection_id=c.id and generation=p_generation;
 elsif p_step='contacts' then update marketing_private.whatsapp_onboarding set contacts_request_id=p_request_id where connection_id=c.id;
 else update marketing_private.whatsapp_onboarding set history_request_id=p_request_id where connection_id=c.id;end if;
 return jsonb_build_object('state',p_outcome);
end;$$;

create or replace function public.marketing_whatsapp_connections(p_org uuid,p_brand uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_settings.view');
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'brand_id',c.brand_id,'account_name',c.account_name,'onboarding_mode',c.whatsapp_onboarding_mode,'credential_generation',c.credential_generation,
 'state',case when o.issue='coexistence_unsupported' then 'unsupported' when c.status<>'test_authorized' or c.expires_at<=now() or o.issue is not null or o.verified_until<=now() then 'action_required'
 when o.subscribed and o.contacts_state='accepted' and o.history_state='accepted' and o.sync_observed and (o.sync_progress=100 or o.history_declined) and marketing_private.whatsapp_receiving(c.id) and exists(select 1 from marketing_private.inbox_authority a where a.connection_id=c.id and a.generation=c.credential_generation and a.signed_inbound_at is not null) then 'connected' else 'action_required' end,
 'reason',case when o.issue is not null then o.issue when c.status<>'test_authorized' or c.expires_at<=now() or o.verified_until<=now() then 'reconnect_required' when not coalesce(o.subscribed,false) then 'subscription_verification_required'
 when o.contacts_state in ('claimed','uncertain') or o.history_state in ('claimed','uncertain') then 'sync_outcome_uncertain' when o.sync_deadline<=now() and not (o.sync_observed and (o.sync_progress=100 or o.history_declined)) then 'sync_deadline_exceeded' when not o.sync_observed or not exists(select 1 from marketing_private.inbox_authority a where a.connection_id=c.id and a.generation=c.credential_generation and a.signed_inbound_at is not null) or o.sync_progress<100 and not o.history_declined then 'awaiting_sync' else 'receive_only' end,
 'sending_enabled',false,'ai_enabled',false) order by c.id),'[]') into result
 from marketing_connections c left join marketing_private.whatsapp_onboarding o on o.connection_id=c.id and o.generation=c.credential_generation
 where c.channel='whatsapp' and c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(c.organization_id,c.brand_id);
 return jsonb_build_object('connections',result,'sending_enabled',false,'ai_enabled',false);
end;$$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='marketing_private' and p.proname='whatsapp_gate') or (n.nspname='public' and p.proname in ('marketing_whatsapp_readiness','marketing_whatsapp_begin','marketing_whatsapp_consume','marketing_whatsapp_bind','marketing_whatsapp_step')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.nspname='public' then execute format('grant execute on function %s to %I',f.signature,case when f.proname in ('marketing_whatsapp_readiness','marketing_whatsapp_begin') then 'authenticated' else 'service_role' end);end if;
 end loop;
end;$$;

create function public.marketing_whatsapp_verification_material(p_connection uuid,p_auth_user uuid,p_generation integer) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c marketing_connections;o marketing_private.whatsapp_onboarding;begin
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 select * into c from marketing_connections where id=p_connection;
 select * into o from marketing_private.whatsapp_onboarding where connection_id=c.id;
 if c.channel<>'whatsapp' or c.credential_generation is distinct from p_generation or o.generation is distinct from p_generation
 or not exists(select 1 from brands where id=c.brand_id and is_active)
 or not exists(select 1 from marketing_private.whatsapp_pilot_authority a join marketing_private.whatsapp_platform_readiness r on r.app_id=a.app_id
 where a.brand_id=c.brand_id and a.app_id=o.app_id and a.phone_id=c.provider_account_id and a.waba_id=c.whatsapp_waba_id and a.customer_business_id=o.customer_business_id and marketing_private.whatsapp_gate(c.brand_id,r.app_id,r.config_id,r.graph_version,r.signup_version)) then raise exception using errcode='42501',message='WhatsApp connection authority changed.';end if;
 return jsonb_build_object('brand_id',c.brand_id,'waba_id',c.whatsapp_waba_id,'phone_id',c.provider_account_id,'customer_business_id',o.customer_business_id);
end;$$;
create function public.marketing_whatsapp_record_verification(p_connection uuid,p_auth_user uuid,p_generation integer,p_evidence jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare m jsonb;c marketing_connections;expiry timestamptz;begin
 m:=public.marketing_whatsapp_verification_material(p_connection,p_auth_user,p_generation);
 select * into c from marketing_connections where id=p_connection for update;
 if c.credential_generation is distinct from p_generation then raise exception 'Stale generation.';end if;
 if p_evidence->>'issue' in ('provider_verification_required','coexistence_unsupported') then
 update marketing_private.whatsapp_onboarding set issue=p_evidence->>'issue',updated_at=now() where connection_id=c.id;
 update marketing_private.inbox_authority set receive_verified=false,configuration_verified=false where connection_id=c.id;
 else
 if (p_evidence->>'waba_id',p_evidence->>'phone_id',p_evidence->>'business_id') is distinct from (m->>'waba_id',m->>'phone_id',m->>'customer_business_id')
 or p_evidence->>'is_on_biz_app' is distinct from 'true' or p_evidence->>'platform_type' is distinct from 'CLOUD_API'
 or not coalesce(p_evidence->'scopes' @> '["whatsapp_business_management","whatsapp_business_messaging"]',false)
 or not exists(select 1 from marketing_private.whatsapp_onboarding where connection_id=c.id and app_id=p_evidence->>'app_id')
 or not exists(select 1 from marketing_private.credentials where connection_id=c.id and meta_user_id=p_evidence->>'subject') then raise exception 'Unverified provider result.';end if;
 expiry:=(p_evidence->>'expires_at')::timestamptz;
 if expiry is null or expiry<=now() or expiry>now()+interval '24 hours 1 minute' then raise exception 'Verification expired.';end if;
 update marketing_connections set expires_at=expiry,last_checked_at=now() where id=c.id;
 update marketing_private.credentials set expires_at=expiry where connection_id=c.id;
 update marketing_private.whatsapp_onboarding set token_verified_at=now(),verified_until=expiry,issue=null,updated_at=now() where connection_id=c.id;
 end if;
end;$$;
-- Lifecycle data is sealed before persistence. Only selected progress and events affect authority.
alter table marketing_private.whatsapp_lifecycle_events add column sealed_payload jsonb,add column purge_after timestamptz not null default now()+interval '24 hours';
create function public.marketing_whatsapp_lifecycle(p_events jsonb) returns void language plpgsql security definer set search_path=public as $$
declare item jsonb;c marketing_connections;ts timestamptz;fp text;begin
 if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>1000 then raise exception 'Invalid lifecycle batch.';end if;
 delete from marketing_private.whatsapp_lifecycle_events where purge_after<=now();
 for item in select value from jsonb_array_elements(p_events) loop
 if item->>'field' not in ('account_update','history','smb_app_state_sync') or item->>'waba_id' !~ '^[0-9]{1,32}$' or item->>'hash' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid lifecycle evidence.';end if;
 ts:=(item->>'occurred_at')::timestamptz;if ts is null or ts>now()+interval '5 minutes' then raise exception 'Invalid lifecycle timestamp.';end if;
 -- WABA-only lifecycle events fail closed for every current phone on that WABA; never re-enable from an event.
 for c in select c0.* from marketing_connections c0 join marketing_private.whatsapp_onboarding o on o.connection_id=c0.id and o.generation=c0.credential_generation
 where c0.channel='whatsapp' and c0.whatsapp_waba_id=item->>'waba_id' and (item->>'phone_id' is null or c0.provider_account_id=item->>'phone_id') for update of c0 loop
 if ts<date_trunc('second',c.connected_at) then continue;end if;
 if item->>'field'<>'account_update' and (item->>'phone_id' is null or item->'sealed_payload' is null) then raise exception 'Sync phone and sealed evidence required.';end if;
 fp:=encode(extensions.digest(c.id||':'||c.credential_generation||':'||(item->>'hash'),'sha256'),'hex');
 insert into marketing_private.whatsapp_lifecycle_events(event_hash,connection_id,generation,field,provider_event,occurred_at,sealed_payload)
 values(fp,c.id,c.credential_generation,item->>'field',item->>'event',ts,item->'sealed_payload') on conflict do nothing;
 if not found then continue;end if;
 if item->>'field'='account_update' and item->>'event' in ('PARTNER_REMOVED','ACCOUNT_OFFBOARDED') then
 update marketing_private.whatsapp_onboarding set issue='provider_disconnected',updated_at=now() where connection_id=c.id;
 update marketing_private.inbox_authority set receive_verified=false,configuration_verified=false where connection_id=c.id;
 elsif item->>'field'='history' then
 if item->>'progress' is not null and (item->>'progress')::integer not between 0 and 100 then raise exception 'Invalid sync progress.';end if;
 update marketing_private.whatsapp_onboarding set sync_observed=true,sync_progress=greatest(sync_progress,coalesce((item->>'progress')::integer,0)),history_declined=history_declined or coalesce((item->>'declined')::boolean,false),updated_at=now() where connection_id=c.id and history_state in ('claimed','accepted','uncertain');
 end if;
 end loop;
 end loop;
end;$$;
-- Credential removal/privacy erasure also removes quarantined history and expired signup state.
create function marketing_private.whatsapp_credential_erased() returns trigger language plpgsql security definer set search_path=public as $$
begin
 delete from marketing_private.whatsapp_lifecycle_events where connection_id=old.connection_id;
 delete from marketing_private.whatsapp_onboarding where connection_id=old.connection_id;
 delete from marketing_private.whatsapp_signup_sessions where connection_id=old.connection_id;
 return old;
end;$$;
create trigger marketing_whatsapp_credential_erased after delete on marketing_private.credentials for each row execute function marketing_private.whatsapp_credential_erased();
revoke all on function marketing_private.whatsapp_credential_erased() from public,anon,authenticated,service_role;
revoke all on function public.marketing_whatsapp_verification_material(uuid,uuid,integer),public.marketing_whatsapp_record_verification(uuid,uuid,integer,jsonb),public.marketing_whatsapp_lifecycle(jsonb) from public,anon,authenticated;
grant execute on function public.marketing_whatsapp_verification_material(uuid,uuid,integer),public.marketing_whatsapp_record_verification(uuid,uuid,integer,jsonb),public.marketing_whatsapp_lifecycle(jsonb) to service_role;

-- Current provider revocation/verification evidence gates the shared worker as well as the UI.
do $$declare f text;begin
 f:=pg_get_functiondef('marketing_private.whatsapp_receiving(uuid)'::regprocedure);
 if strpos(f,'and a.generation=c.credential_generation')=0 then raise exception 'WhatsApp receive baseline changed';end if;
 f:=replace(f,$part$and a.generation=c.credential_generation$part$, $part$and not exists(select 1 from marketing_private.whatsapp_onboarding o where o.connection_id=c.id and (o.generation<>c.credential_generation or o.issue is not null or o.verified_until<=now() or not exists(select 1 from brands b where b.id=c.brand_id and b.is_active) or not exists(select 1 from marketing_private.whatsapp_pilot_authority p where p.brand_id=c.brand_id and p.app_id=o.app_id and p.phone_id=c.provider_account_id and p.waba_id=c.whatsapp_waba_id and p.expires_at>now()))) and a.generation=c.credential_generation$part$);execute f;
end;$$;

-- Reuse the existing Inbox worker tick for retention; no separate queue or scheduler.
do $$declare f text;pos integer;begin
 f:=pg_get_functiondef('public.marketing_inbox_process_events(integer)'::regprocedure);
 pos:=strpos(f,E'\nbegin\n');if pos=0 then raise exception 'Inbox worker baseline changed';end if;
 f:=overlay(f placing E'\nbegin\n delete from marketing_private.whatsapp_lifecycle_events where purge_after<=now();\n delete from marketing_private.whatsapp_signup_sessions where expires_at<=now();\n' from pos for length(E'\nbegin\n'));execute f;
end;$$;
create function marketing_private.whatsapp_subject_erased() returns trigger language plpgsql security definer set search_path=public as $$
begin
 delete from marketing_private.whatsapp_lifecycle_events where connection_id=old.connection_id and generation=old.generation;
 return old;
end;$$;
create trigger marketing_whatsapp_subject_erased after delete on marketing_private.meta_subjects for each row execute function marketing_private.whatsapp_subject_erased();
revoke all on function marketing_private.whatsapp_subject_erased() from public,anon,authenticated,service_role;
