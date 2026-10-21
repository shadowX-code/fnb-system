-- Disabled WhatsApp foundation. No credentials, subscriptions, sends or AI activation.
alter table public.marketing_connections drop constraint marketing_connections_channel_check;
alter table public.marketing_connections add constraint marketing_connections_channel_check check(channel in ('facebook','instagram','ad_account','whatsapp'));
alter table public.marketing_connections add column whatsapp_waba_id text,
 add column whatsapp_onboarding_mode text,
 add column whatsapp_revision integer not null default 0;
alter table public.marketing_connections add constraint marketing_whatsapp_identity check(
 (channel='whatsapp' and whatsapp_waba_id ~ '^[0-9]{1,32}$' and whatsapp_waba_id is not null
 and provider_account_id ~ '^[0-9]{1,32}$' and provider_account_id is not null
 and whatsapp_onboarding_mode in ('cloud_api','coexistence') and whatsapp_onboarding_mode is not null and credential_generation>0)
 or (channel<>'whatsapp' and whatsapp_waba_id is null and whatsapp_onboarding_mode is null));
-- Existing global (channel,provider_account_id) uniqueness reserves a phone even when disconnected.
-- Reassignment requires an explicit future migration; history must never cross Brands.
alter table public.marketing_conversations drop constraint marketing_conversations_channel_check;
alter table public.marketing_conversations add constraint marketing_conversations_channel_check check(channel in ('internal','facebook','instagram','whatsapp'));
create index marketing_whatsapp_receipt_lookup on marketing_private.inbox_events(connection_id,generation,(payload->>'event_id')) where payload->>'kind'='status';

create function marketing_private.whatsapp_connection_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and old.channel='whatsapp' and (new.organization_id,new.brand_id,new.channel,new.provider_account_id,new.whatsapp_waba_id,new.whatsapp_onboarding_mode) is distinct from (old.organization_id,old.brand_id,old.channel,old.provider_account_id,old.whatsapp_waba_id,old.whatsapp_onboarding_mode) then
  raise exception 'WhatsApp identity is immutable. Register a separate authorized connection.';
 end if;
 if new.channel='whatsapp' then
  if tg_op='UPDATE' and new.credential_generation<old.credential_generation then raise exception 'Credential generation cannot decrease.';end if;
  new.capabilities:='{"whatsapp_foundation":true,"execution_enabled":false,"publishing":false,"sending":false,"ai":false}'::jsonb;
  new.inbox_automation_owner:='unknown';new.inbox_automation_generation:=null;
 end if;
 return new;
end;$$;
create trigger marketing_whatsapp_connection_guard before insert or update on public.marketing_connections for each row execute function marketing_private.whatsapp_connection_guard();

-- Metadata registration only. Official Signup will later establish provider authority and encrypted credentials.
create function public.marketing_whatsapp_register(p_request uuid,p_org uuid,p_brand uuid,p_waba text,p_phone text,p_mode text,p_label text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid; fp text; prior public.marketing_requests; c public.marketing_connections; result jsonb;
begin
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_settings.configure');
 if p_request is null or p_brand is null or coalesce(p_waba,'') !~ '^[0-9]{1,32}$' or coalesce(p_phone,'') !~ '^[0-9]{1,32}$' or p_mode is null or p_mode not in ('cloud_api','coexistence') or length(trim(coalesce(p_label,''))) not between 1 and 160 then raise exception 'Invalid WhatsApp registration.';end if;
 perform 1 from brands where id=p_brand and organization_id=p_org and is_active for share;
 if not found then raise exception 'An active authorized Brand is required.';end if;
 fp:=encode(extensions.digest(jsonb_build_array('whatsapp_register',p_org,p_brand,p_waba,p_phone,p_mode,trim(p_label))::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from marketing_requests where request_id=p_request;
 if found then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Request identity changed.';end if;return prior.result;end if;
 perform pg_advisory_xact_lock(hashtextextended('whatsapp:'||p_phone,0));
 if exists(select 1 from marketing_connections where channel='whatsapp' and provider_account_id=p_phone) then raise exception 'WhatsApp phone is already reserved.';end if;
 insert into marketing_connections(organization_id,brand_id,channel,provider_account_id,account_name,credential_generation,connected_by,connected_at,whatsapp_waba_id,whatsapp_onboarding_mode,whatsapp_revision)
 values(p_org,p_brand,'whatsapp',p_phone,trim(p_label),1,actor,clock_timestamp(),p_waba,p_mode,1) returning * into c;
 insert into marketing_private.inbox_authority(connection_id,generation) values(c.id,c.credential_generation);
 result:=jsonb_build_object('connection_id',c.id,'generation',c.credential_generation,'revision',c.whatsapp_revision,'state','foundation_disabled');
 insert into marketing_requests values(p_request,actor,fp,result);
 insert into marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(p_org,p_brand,'whatsapp_metadata_registered',actor,result);
 return result;
end;$$;
create function public.marketing_whatsapp_connections(p_org uuid,p_brand uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_settings.view');
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'brand_id',c.brand_id,'account_name',c.account_name,'phone_number_id',c.provider_account_id,'waba_id',c.whatsapp_waba_id,'onboarding_mode',c.whatsapp_onboarding_mode,'credential_generation',c.credential_generation,'revision',c.whatsapp_revision,'state','foundation_disabled','sending_enabled',false,'ai_enabled',false) order by c.id),'[]') into result
 from marketing_connections c where c.channel='whatsapp' and c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(c.organization_id,c.brand_id);
 return jsonb_build_object('connections',result,'onboarding_enabled',false,'sending_enabled',false,'ai_enabled',false);
end;$$;

create function marketing_private.whatsapp_receiving(p_connection uuid) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(c.channel='whatsapp' and c.status='test_authorized' and c.expires_at>now() and c.connected_at is not null
 and a.generation=c.credential_generation and a.receive_verified and a.configuration_verified
 and a.granted_scopes @> array['whatsapp_business_management','whatsapp_business_messaging']
 and not a.execution_enabled and not a.send_verified
 and exists(select 1 from marketing_private.credentials k where k.connection_id=c.id and k.sealed_token is not null),false)
 from marketing_connections c left join marketing_private.inbox_authority a on a.connection_id=c.id where c.id=p_connection;
$$;

create function marketing_private.whatsapp_enqueue(item jsonb) returns text language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; key text;begin
 if coalesce(item->>'account_id','') !~ '^[0-9]{1,32}$' or coalesce(item->>'waba_id','') !~ '^[0-9]{1,32}$' or coalesce(item->>'peer_id','') !~ '^[0-9]{1,32}$'
 or coalesce(item->>'kind','') not in ('incoming','attachment','echo','status') or (length(coalesce(item->>'event_id','')) not between 1 and 300 or coalesce(item->>'event_id','') !~ '^[A-Za-z0-9._=+/\-]+$')
 or coalesce(item->>'medium','dm')<>'dm' or length(coalesce(item->>'body',''))>8000
 or item->>'occurred_at' is null or (item->>'occurred_at')::timestamptz>now()+interval '5 minutes'
 or (item->>'kind'='status' and coalesce(item->>'provider_status','') not in ('sent','delivered','read','failed')) then raise exception 'Invalid WhatsApp event.';end if;
 select * into c from marketing_connections where channel='whatsapp' and provider_account_id=item->>'account_id' and whatsapp_waba_id=item->>'waba_id' for share;
 if c.id is null then return 'unbound';end if;
 -- No event can adopt a different Brand or cross a reconnection cutoff.
 if (item ? 'brand_id' and item->>'brand_id' is distinct from c.brand_id::text) or (item ? 'generation' and item->>'generation' is distinct from c.credential_generation::text) or (item->>'occurred_at')::timestamptz<date_trunc('second',c.connected_at) then return 'unbound';end if;
 if exists(select 1 from marketing_private.inbox_erased_peers t where t.connection_id=c.id and t.generation=c.credential_generation and t.peer_hash=encode(extensions.digest(item->>'peer_id','sha256'),'hex') and (item->>'occurred_at')::timestamptz<=t.erased_at) then return 'unbound';end if;
 if item->>'kind'='echo' and c.whatsapp_onboarding_mode<>'coexistence' then return 'unbound';end if;
 key:=c.id||':'||c.credential_generation||':whatsapp:'||case when item->>'kind'='status' then 'status:'||(item->>'provider_status') else 'message' end||':'||(item->>'event_id');
 insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint,state,error_code)
 values(key,c.id,c.credential_generation,item,encode(extensions.digest(item::text,'sha256'),'hex'),case when marketing_private.whatsapp_receiving(c.id) then 'pending' else 'blocked' end,case when not marketing_private.whatsapp_receiving(c.id) then 'whatsapp_authority_unverified' end) on conflict do nothing;
 return case when found then 'accepted' else 'duplicate' end;
end;$$;

-- Provider receipts never create conversations or infer CRM identity. Exact IDs only.
create function marketing_private.whatsapp_reconcile(p_connection uuid,p_generation integer) returns void language plpgsql security definer set search_path=public as $$
declare o record; rank integer; failure text; target text;begin
 for o in select x.draft_id,x.provider_message_id,x.state,c.participant_key from marketing_reply_outbox x join marketing_reply_drafts d on d.id=x.draft_id join marketing_conversations c on c.id=d.conversation_id
 where c.connection_id=p_connection and c.connection_generation=p_generation and c.channel='whatsapp' and x.provider_message_id is not null and x.state in ('sent','delivered','read','failed') for update of x loop
  select max(case e.payload->>'provider_status' when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 else 0 end),max(case when e.payload->>'provider_status'='failed' then coalesce(e.payload->>'error_code','provider_failed') end) into rank,failure
  from marketing_private.inbox_events e where e.connection_id=p_connection and e.generation=p_generation and e.state='processed' and e.evidence_source='signed_webhook' and e.payload->>'kind'='status' and e.payload->>'event_id'=o.provider_message_id and e.payload->>'peer_id'=o.participant_key;
  target:=case when o.state='read' or rank=3 then 'read' when o.state='delivered' or rank=2 then 'delivered' when failure is not null or o.state='failed' then 'failed' else o.state end;
  update marketing_reply_outbox set state=target,reason=case target when 'read' then 'provider_read_observed' when 'delivered' then 'provider_delivery_observed' when 'failed' then 'whatsapp_provider_failed' else reason end where draft_id=o.draft_id and state is distinct from target;
 end loop;
end;$$;
alter table marketing_reply_outbox drop constraint marketing_reply_outbox_receipt_state;
alter table marketing_reply_outbox add constraint marketing_reply_outbox_receipt_state check(
 (state in ('sent','delivered','read') and provider_message_id is not null) or state='failed' or (state not in ('sent','delivered','read','failed') and provider_message_id is null));
create function marketing_private.whatsapp_outbox_receipt() returns trigger language plpgsql security definer set search_path=public as $$
declare c public.marketing_conversations;begin
 if new.provider_message_id is not null and new.provider_message_id is distinct from old.provider_message_id then
  select c0.* into c from marketing_conversations c0 join marketing_reply_drafts d on d.conversation_id=c0.id where d.id=new.draft_id and c0.channel='whatsapp';
  if found then perform marketing_private.whatsapp_reconcile(c.connection_id,c.connection_generation);end if;
 end if;return new;
end;$$;
create trigger marketing_whatsapp_outbox_receipt after update of provider_message_id on marketing_reply_outbox for each row execute function marketing_private.whatsapp_outbox_receipt();

-- Extend established authorities in place; preserve FB/IG implementation and grants.
do $patch$ declare f text;needle text;begin
 f:=pg_get_functiondef('public.marketing_inbox_enqueue(jsonb)'::regprocedure);
 needle:=' for item in select value from jsonb_array_elements(p_events) loop';
 if position(needle in f)=0 then raise exception 'Inbox enqueue baseline changed';end if;
 f:=replace(f,'receiving boolean;','receiving boolean; wa_result text;');
 f:=replace(f,needle,needle||$body$
  if item->>'channel'='whatsapp' then
   wa_result:=marketing_private.whatsapp_enqueue(item);
   if wa_result='accepted' then n:=n+1;elsif wa_result='duplicate' then duplicates:=duplicates+1;else unknown:=unknown+1;end if;
   continue;
  end if;$body$);execute f;
 f:=pg_get_functiondef('marketing_private.inbox_channel(uuid)'::regprocedure);
 -- The existing social contract keeps its Page/Instagram permission rules.
 f:=replace(f,' select jsonb_build_object(', $body$ select case when c.channel='whatsapp' then jsonb_build_object('connection_id',c.id,'brand_id',c.brand_id,'channel',c.channel,'state','foundation_disabled','receiving_verified',marketing_private.whatsapp_receiving(c.id),'sending_enabled',false,'ai_enabled',false,'standard_window_hours',24) else jsonb_build_object($body$);
 f:=replace(f,' from public.marketing_connections c left join',' end from public.marketing_connections c left join');execute f;
 f:=pg_get_functiondef('public.marketing_inbox_process_events(integer)'::regprocedure);
 needle:='   item:=ev.payload;';
 if position(needle in f)=0 then raise exception 'Inbox drain baseline changed';end if;
 f:=replace(f,needle,$body$   if conn.channel='whatsapp' then
    if conn.credential_generation is distinct from ev.generation or ev.payload->>'account_id' is distinct from conn.provider_account_id or ev.payload->>'waba_id' is distinct from conn.whatsapp_waba_id or not coalesce(marketing_private.whatsapp_receiving(conn.id),false) then
     update marketing_private.inbox_events set state='blocked',error_code='whatsapp_authority_changed' where event_key=ev.event_key;blocked:=blocked+1;continue;
    end if;
    if ev.payload->>'kind'='status' then
     update marketing_private.inbox_events set state='processed',attempts=attempts+1,error_code=null where event_key=ev.event_key;
     perform marketing_private.whatsapp_reconcile(conn.id,ev.generation);processed:=processed+1;continue;
    end if;
   end if;
$body$||needle);execute f;
 f:=pg_get_functiondef('public.marketing_inbox_send_checkpoint(uuid,uuid,uuid,jsonb)'::regprocedure);
 needle:=' return jsonb_build_object(''state'',o.state';
 if position(needle in f)=0 then raise exception 'Receipt checkpoint baseline changed';end if;
 f:=replace(f,needle,' select * into o from public.marketing_reply_outbox where draft_id=p_draft;'||chr(10)||needle);execute f;
 f:=pg_get_functiondef('public.marketing_inbox_signed_events(jsonb)'::regprocedure);
 needle:=' for item in select value from jsonb_array_elements(p_events) loop';
 if position(needle in f)=0 then raise exception 'Signed evidence baseline changed';end if;
 f:=replace(f,needle,needle||$body$
  if item->>'channel'='whatsapp' then
   select * into c from marketing_connections where channel='whatsapp' and provider_account_id=item->>'account_id' and whatsapp_waba_id=item->>'waba_id';
   if item->>'kind' in ('incoming','attachment') and coalesce(marketing_private.whatsapp_receiving(c.id),false) and exists(select 1 from marketing_private.inbox_events e where e.connection_id=c.id and e.generation=c.credential_generation and e.evidence_source='signed_webhook' and e.state in ('pending','processed') and e.payload=item) then
    update marketing_private.inbox_authority set signed_inbound_at=greatest(signed_inbound_at,(item->>'occurred_at')::timestamptz),webhook_verified=true where connection_id=c.id and generation=c.credential_generation;
   end if;
   continue;
  end if;$body$);execute f;
 -- Both staff and AI delivery share this hard disabled boundary.
 f:=pg_get_functiondef('public.marketing_inbox_send_material(uuid,uuid)'::regprocedure);
 needle:=' r:=public.marketing_inbox_staff_send_material(p_draft,p_auth_user);';
 if position(needle in f)=0 then raise exception 'Shared send baseline changed';end if;
 f:=replace(f,needle,$body$ if exists(select 1 from marketing_conversations wa_conversation join marketing_reply_drafts wa_draft on wa_draft.conversation_id=wa_conversation.id where wa_draft.id=p_draft and wa_conversation.channel='whatsapp') then raise exception using errcode='42501',message='WhatsApp sending is disabled.';end if;
$body$||needle);execute f;
 f:=pg_get_functiondef('public.marketing_inbox_ai_prepare(uuid,uuid,integer,text)'::regprocedure);
 needle:=' return marketing_private.inbox_ai_prepare_as(actor,p_request,p_conversation,p_version,p_kind);';
 if position(needle in f)=0 then raise exception 'AI preparation baseline changed';end if;
 f:=replace(f,needle,$body$ if c.channel='whatsapp' then raise exception using errcode='42501',message='WhatsApp AI is disabled.';end if;
$body$||needle);execute f;
 -- Whitelist additions are read-only; do not enable any draft/send or AI command.
 f:=pg_get_functiondef('public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean)'::regprocedure);
 f:=replace(f,$n$('','social','internal','facebook','instagram')$n$,$n$('','social','internal','facebook','instagram','whatsapp')$n$);execute f;
end;$patch$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='marketing_private' and p.proname like 'whatsapp_%') or (n.nspname='public' and p.proname in ('marketing_whatsapp_register','marketing_whatsapp_connections')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end;$$;
grant execute on function public.marketing_whatsapp_register(uuid,uuid,uuid,text,text,text,text),public.marketing_whatsapp_connections(uuid,uuid) to authenticated;
