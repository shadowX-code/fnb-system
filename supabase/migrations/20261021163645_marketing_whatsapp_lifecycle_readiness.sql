-- Local shutdown is independent from provider offboarding. Identity remains reserved.
alter table marketing_connections add column whatsapp_local_state text not null default 'active' check(whatsapp_local_state in ('active','paused','disconnected'));
alter table marketing_connections add constraint marketing_whatsapp_local_state check(channel='whatsapp' or whatsapp_local_state='active');
-- Asset IDs may be discovered during official signup; the approved number is still exact.
alter table marketing_private.whatsapp_pilot_authority alter column waba_id drop not null,alter column phone_id drop not null,add column approved_phone_hash text;
alter table marketing_private.whatsapp_pilot_authority add constraint whatsapp_pilot_asset_intent check(
 (waba_id is not null and phone_id is not null) or (waba_id is null and phone_id is null and approved_phone_hash ~ '^[a-f0-9]{64}$' and approved_phone_hash is not null));
alter table marketing_private.whatsapp_pilot_authority add constraint whatsapp_pilot_phone_hash check(approved_phone_hash is null or approved_phone_hash ~ '^[a-f0-9]{64}$');
alter table marketing_private.whatsapp_signup_sessions alter column waba_id drop not null,alter column phone_id drop not null,add column approved_phone_hash text;

-- Minimal operational replay protection, not credentials, contacts, history or CRM identity.
create table marketing_private.whatsapp_sync_receipts (
 connection_id uuid not null references marketing_connections(id), step text not null check(step in ('contacts','history')),
 event text not null check(event in ('claimed','accepted','uncertain')), generation integer not null check(generation>0),
 request_id text, observed_at timestamptz not null default clock_timestamp(), primary key(connection_id,step,event),
 check((event='accepted' and request_id is not null and length(request_id) between 1 and 300) or (event<>'accepted' and request_id is null))
);
alter table marketing_private.whatsapp_sync_receipts enable row level security;
revoke all on marketing_private.whatsapp_sync_receipts from public,anon,authenticated,service_role;
insert into marketing_private.whatsapp_sync_receipts(connection_id,step,event,generation,request_id)
select o.connection_id,s.step,e.event,o.generation,case when e.event='accepted' then to_jsonb(o)->>(s.step||'_request_id') end
from marketing_private.whatsapp_onboarding o cross join (values('contacts'),('history')) s(step) cross join (values('claimed'),('accepted'),('uncertain')) e(event)
where (e.event='claimed' and to_jsonb(o)->>(s.step||'_state')<>'pending')
 or (e.event='accepted' and to_jsonb(o)->>(s.step||'_state')='accepted' and to_jsonb(o)->>(s.step||'_request_id') is not null)
 or (e.event='uncertain' and to_jsonb(o)->>(s.step||'_state')='uncertain');
create function marketing_private.whatsapp_receipt_immutable() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'WhatsApp synchronization evidence is immutable.';end;$$;
create trigger whatsapp_receipt_immutable before update or delete on marketing_private.whatsapp_sync_receipts for each row execute function marketing_private.whatsapp_receipt_immutable();
create function marketing_private.whatsapp_restore_sync(p_connection uuid) returns void language plpgsql security definer set search_path=public as $$
declare v_step text;r marketing_private.whatsapp_sync_receipts;begin
 foreach v_step in array array['contacts','history'] loop
 select * into r from marketing_private.whatsapp_sync_receipts x where x.connection_id=p_connection and x.step=v_step and x.event='accepted';
 if found then
 execute format('update marketing_private.whatsapp_onboarding set %I=''accepted'',%I=$1 where connection_id=$2',v_step||'_state',v_step||'_request_id') using r.request_id,p_connection;
 elsif exists(select 1 from marketing_private.whatsapp_sync_receipts x where x.connection_id=p_connection and x.step=v_step) then
 execute format('update marketing_private.whatsapp_onboarding set %I=''uncertain'' where connection_id=$1',v_step||'_state') using p_connection;
 end if;
 end loop;
end;$$;

create function public.marketing_whatsapp_local_command(p_request uuid,p_connection uuid,p_generation integer,p_action text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c marketing_connections;actor uuid;fp text;prior marketing_requests;result jsonb;begin
 select * into c from marketing_connections where id=p_connection for update;
 if not found or c.channel<>'whatsapp' then raise exception 'WhatsApp connection unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_settings.configure');
 if p_request is null or p_action is null or p_action not in ('pause','disconnect') or p_generation is null then raise exception 'Invalid WhatsApp shutdown.';end if;
 fp:=encode(extensions.digest(jsonb_build_array('whatsapp_local_command',p_connection,p_generation,p_action)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from marketing_requests where request_id=p_request;
 if found then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Request identity changed.';end if;return prior.result;end if;
 if c.credential_generation<>p_generation then raise exception 'WhatsApp connection changed. Refresh before continuing.';end if;
 if c.whatsapp_local_state='disconnected' and p_action='pause' then raise exception 'Reconnect a disconnected account.';end if;
 update marketing_connections set whatsapp_local_state=case p_action when 'pause' then 'paused' else 'disconnected' end,
 credential_generation=credential_generation+1,whatsapp_revision=whatsapp_revision+1,connected_at=clock_timestamp(),
 status=case p_action when 'disconnect' then 'not_connected' else status end,
 expires_at=case p_action when 'disconnect' then null else expires_at end,error_code=case p_action when 'pause' then 'locally_paused' else 'locally_disconnected' end where id=c.id returning * into c;
 if p_action='disconnect' then delete from marketing_private.credentials where connection_id=c.id;end if;
 update marketing_private.whatsapp_onboarding set generation=c.credential_generation,subscribed=false,subscription_state='pending',updated_at=now() where connection_id=c.id;
 update marketing_private.inbox_authority set generation=c.credential_generation,receive_verified=false,configuration_verified=false,webhook_verified=false,signed_inbound_at=null,send_verified=false,execution_enabled=false where connection_id=c.id;
 update marketing_private.inbox_events set state='blocked',error_code='whatsapp_local_shutdown' where connection_id=c.id and state in ('pending','retry');
 insert into marketing_private.meta_subjects(connection_id,generation,meta_user_id) select c.id,c.credential_generation,meta_user_id from marketing_private.credentials where connection_id=c.id and meta_user_id is not null on conflict do nothing;
 result:=jsonb_build_object('connection_id',c.id,'generation',c.credential_generation,'local_state',c.whatsapp_local_state,'provider_offboarded',false);
 insert into marketing_requests values(p_request,actor,fp,result);
 insert into marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'whatsapp_local_'||p_action,actor,result);
 return result;
end;$$;

-- Credential disposal removes private payloads but cannot reset provider one-shot history.
create or replace function marketing_private.whatsapp_credential_erased() returns trigger language plpgsql security definer set search_path=public as $$
begin
 delete from marketing_private.whatsapp_lifecycle_events where connection_id=old.connection_id;
 delete from marketing_private.whatsapp_signup_sessions where connection_id=old.connection_id;
 update marketing_private.whatsapp_onboarding set subscribed=false,subscription_state='pending',verified_until=least(verified_until,now()),issue=case when issue='provider_disconnected' then issue else 'credential_unavailable' end,updated_at=now() where connection_id=old.connection_id;
 return old;
end;$$;

-- Keep canonical signatures/callers and FB/IG behavior; assert every baseline patch.
do $migration$ declare f text;needle text;begin
 f:=pg_get_functiondef('public.marketing_meta_disconnect(uuid)'::regprocedure);
 needle:=' delete from marketing_private.credentials where connection_id=c.id;';
 if strpos(f,needle)=0 then raise exception 'Disconnect baseline changed';end if;
 f:=replace(f,needle,$patch$ if c.channel='whatsapp' then raise exception 'Use the generation-checked WhatsApp Disconnect control.';end if;
$patch$||needle);execute f;
 f:=pg_get_functiondef('marketing_private.whatsapp_receiving(uuid)'::regprocedure);
 needle:=$patch$c.channel='whatsapp' and c.status$patch$;
 if strpos(f,needle)=0 then raise exception 'Receiving baseline changed';end if;
 f:=replace(f,needle,$patch$c.channel='whatsapp' and c.whatsapp_local_state='active' and c.status$patch$);execute f;
 f:=pg_get_functiondef('public.marketing_whatsapp_connections(uuid,uuid)'::regprocedure);
 needle:=$patch$'credential_generation',c.credential_generation,$patch$;
 if strpos(f,needle)=0 then raise exception 'Connection read baseline changed';end if;
 f:=replace(f,needle,needle||$patch$'local_state',c.whatsapp_local_state,$patch$);
 f:=replace(f,$patch$'state',case when o.issue$patch$,$patch$'state',case when c.whatsapp_local_state='disconnected' then 'not_connected' when c.whatsapp_local_state='paused' then 'action_required' when o.issue$patch$);
 f:=replace(f,$patch$'reason',case when o.issue$patch$,$patch$'reason',case when c.whatsapp_local_state='disconnected' then 'locally_disconnected' when c.whatsapp_local_state='paused' then 'locally_paused' when o.issue$patch$);execute f;
 f:=pg_get_functiondef('public.marketing_whatsapp_begin(uuid,uuid,text,text,text,text,text,uuid,integer)'::regprocedure);
 needle:=$patch$ if c.id is not null and (c.provider_account_id,c.whatsapp_waba_id,c.whatsapp_onboarding_mode) is distinct from (a.phone_id,a.waba_id,'coexistence'::text)$patch$;
 if strpos(f,needle)=0 then raise exception 'Signup begin baseline changed';end if;
 f:=replace(f,needle,$patch$ if c.id is not null and (a.phone_id is null or a.waba_id is null or (c.provider_account_id,c.whatsapp_waba_id,c.whatsapp_onboarding_mode) is distinct from (a.phone_id,a.waba_id,'coexistence'::text))$patch$);
 f:=replace(f,'expected_generation,waba_id,phone_id,customer_business_id)','expected_generation,waba_id,phone_id,customer_business_id,approved_phone_hash)');
 f:=replace(f,'p_generation,a.waba_id,a.phone_id,a.customer_business_id)','p_generation,a.waba_id,a.phone_id,a.customer_business_id,a.approved_phone_hash)');execute f;
 f:=pg_get_functiondef('public.marketing_whatsapp_bind(uuid,uuid,jsonb,jsonb)'::regprocedure);
 needle:=' select * into s from marketing_private.whatsapp_signup_sessions where id=p_session for update;';
 if strpos(f,needle)=0 then raise exception 'Signup bind baseline changed';end if;
 f:=replace(f,needle,needle||$patch$
 if not found then raise exception 'Signup session unavailable.';end if;
 perform pg_advisory_xact_lock(hashtextextended('whatsapp-brand:'||s.brand_id,0));
 -- The browser's asset IDs are candidates only. This proof is supplied by the verified server exchange.
 if s.waba_id is null then
  if s.approved_phone_hash is null or p_evidence->>'approved_phone_hash' is distinct from s.approved_phone_hash
  or coalesce(p_evidence->>'waba_id','') !~ '^[0-9]{1,32}$' or coalesce(p_evidence->>'phone_id','') !~ '^[0-9]{1,32}$' then raise exception 'Approved phone could not be verified.';end if;
  update marketing_private.whatsapp_pilot_authority set waba_id=p_evidence->>'waba_id',phone_id=p_evidence->>'phone_id'
  where brand_id=s.brand_id and app_id=s.app_id and waba_id is null and phone_id is null and customer_business_id=s.customer_business_id and approved_phone_hash=s.approved_phone_hash and expires_at>now();
  if not found then raise exception 'Pilot asset intent changed.';end if;
  s.waba_id:=p_evidence->>'waba_id';s.phone_id:=p_evidence->>'phone_id';
 end if;
 if s.approved_phone_hash is not null and p_evidence->>'approved_phone_hash' is distinct from s.approved_phone_hash then raise exception 'Approved phone changed.';end if;
$patch$);
 f:=replace(f,$patch$update marketing_connections set status='test_authorized',expires_at=expiry,$patch$, $patch$update marketing_connections set whatsapp_local_state='active',status='test_authorized',expires_at=expiry,$patch$);
 f:=replace(f,' v_result:=jsonb_build_object(',' perform marketing_private.whatsapp_restore_sync(c.id);'||chr(10)||' v_result:=jsonb_build_object(');
 f:=replace(f,'set completed_at=now(),connection_id=c.id,result=v_result','set completed_at=now(),connection_id=c.id,waba_id=s.waba_id,phone_id=s.phone_id,result=v_result');execute f;
 f:=pg_get_functiondef('public.marketing_whatsapp_verification_material(uuid,uuid,integer)'::regprocedure);
 needle:=$patch$'customer_business_id',o.customer_business_id)$patch$;
 if strpos(f,needle)=0 then raise exception 'Verification material baseline changed';end if;
 f:=replace(f,needle,$patch$'customer_business_id',o.customer_business_id,'approved_phone_hash',(select a.approved_phone_hash from marketing_private.whatsapp_pilot_authority a where a.brand_id=c.brand_id))$patch$);execute f;
 f:=pg_get_functiondef('public.marketing_whatsapp_record_verification(uuid,uuid,integer,jsonb)'::regprocedure);
 needle:=' update marketing_connections set expires_at=expiry,last_checked_at=now() where id=c.id;';
 if strpos(f,needle)=0 then raise exception 'Verification recovery baseline changed';end if;
 f:=replace(f,needle,$patch$ if m->>'approved_phone_hash' is not null and p_evidence->>'approved_phone_hash' is distinct from m->>'approved_phone_hash' then raise exception 'Approved phone verification required.';end if;
 if c.whatsapp_local_state='disconnected' or c.status not in ('test_authorized','expired') then raise exception 'Reconnect to renew authorization.';end if;
 if c.whatsapp_local_state='paused' and coalesce((p_evidence->>'resume_receiving')::boolean,false) is not true then raise exception 'Explicit Resume receiving confirmation required.';end if;
 update marketing_connections set whatsapp_local_state='active',status='test_authorized',error_code=null,expires_at=expiry,last_checked_at=now(),connected_at=case when c.whatsapp_local_state='paused' or c.status='expired' then clock_timestamp() else connected_at end where id=c.id;
$patch$);execute f;
 -- A shutdown must fence both provider operations and late verification callbacks.
 f:=pg_get_functiondef('public.marketing_whatsapp_step(uuid,uuid,integer,text,text,text)'::regprocedure);
 f:=replace(f,'public.marketing_whatsapp_step(', 'marketing_private.whatsapp_step_base(');execute f;
end;$migration$;

create or replace function public.marketing_whatsapp_step(p_connection uuid,p_auth_user uuid,p_generation integer,p_step text,p_outcome text default null,p_request_id text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c marketing_connections;r jsonb;receipt marketing_private.whatsapp_sync_receipts;begin
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 select * into c from marketing_connections where id=p_connection for update;
 if c.channel<>'whatsapp' or c.whatsapp_local_state<>'active' or c.status<>'test_authorized' or c.credential_generation<>p_generation or c.expires_at<=now() then raise exception 'WhatsApp receiving authority changed.';end if;
 if p_step in ('contacts','history') then
  perform marketing_private.whatsapp_restore_sync(c.id);
  select * into receipt from marketing_private.whatsapp_sync_receipts where connection_id=c.id and step=p_step and event='accepted';
  if found and p_outcome='accepted' then
   if receipt.request_id is distinct from p_request_id then raise exception 'Synchronization receipt cannot change.';end if;
   return jsonb_build_object('state','accepted');
  end if;
 end if;
 r:=marketing_private.whatsapp_step_base(p_connection,p_auth_user,p_generation,p_step,p_outcome,p_request_id);
 if p_step in ('contacts','history') then
  if (r->>'perform')::boolean is true then
   insert into marketing_private.whatsapp_sync_receipts(connection_id,step,event,generation) values(c.id,p_step,'claimed',p_generation);
  elsif p_outcome in ('accepted','uncertain') then
   insert into marketing_private.whatsapp_sync_receipts(connection_id,step,event,generation,request_id) values(c.id,p_step,p_outcome,p_generation,case when p_outcome='accepted' then p_request_id end) on conflict do nothing;
  end if;
 end if;
 return r;
end;$$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='marketing_private' and p.proname in ('whatsapp_receipt_immutable','whatsapp_restore_sync','whatsapp_step_base')) or (n.nspname='public' and p.proname='marketing_whatsapp_local_command') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname='marketing_whatsapp_local_command' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end;$$;
