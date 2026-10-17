-- Current-generation verified Inbox grants are the authority, not the OAuth discovery snapshot.
create or replace function public.marketing_inbox_record_verification(p_connection uuid,p_auth_user uuid,p_generation integer,p_evidence jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; a marketing_private.inbox_authority; verified boolean; configured boolean; delivered boolean; permissions text[]; grants text[];
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 select * into c from public.marketing_connections where id=p_connection for update;
 if c.credential_generation is distinct from p_generation or c.provider_account_id is distinct from p_evidence->>'account_id' or c.channel is distinct from p_evidence->>'channel' then raise exception 'Connection changed.';end if;
 select * into a from marketing_private.inbox_authority where connection_id=c.id;
 permissions:=case c.channel when 'facebook' then array['pages_messaging','pages_manage_metadata'] else array['instagram_basic','instagram_manage_messages','pages_manage_metadata'] end;
 -- Old service versions supplied required/missing permissions; only a successful
 -- exact-account verification proves that legacy required set was granted.
 if p_evidence ? 'granted_permissions' then
  if jsonb_typeof(p_evidence->'granted_permissions') is distinct from 'array' or jsonb_array_length(p_evidence->'granted_permissions')>3 then raise exception 'Invalid Inbox grants.';end if;
  grants:=array(select jsonb_array_elements_text(p_evidence->'granted_permissions'));
 else
  grants:=case when p_evidence->>'authorization_verified'='true' then permissions else '{}'::text[] end;
 end if;
 if not grants <@ permissions then raise exception 'Invalid Inbox grants.';end if;
 verified:=coalesce((p_evidence->>'authorization_verified')::boolean,false)
  and coalesce((p_evidence->>'token_verified')::boolean,false)
  and coalesce((p_evidence->>'account_verified')::boolean,false)
  and coalesce((p_evidence->>'scope_targets_verified')::boolean,false)
  and permissions <@ grants
  and exists(select 1 from jsonb_array_elements_text(p_evidence->'page_tasks') t(task) where task in ('MESSAGE','MESSAGING','PROFILE_PLUS_MESSAGING'))
  and c.status in ('test_authorized','production_authorized') and c.expires_at>now();
 configured:=verified and coalesce((p_evidence->>'subscriptions_verified')::boolean,false);
 -- Delivery requires a durable genuine signed inbound receipt for this exact account/generation. API recovery cannot supply it.
 delivered:=configured and (coalesce(a.generation=c.credential_generation and a.webhook_verified,false) or exists(
  select 1 from marketing_private.inbox_events e where e.connection_id=c.id and e.generation=c.credential_generation and e.evidence_source='signed_webhook'
  and e.payload->>'kind' in ('incoming','attachment') and coalesce(e.payload->>'medium','dm')='dm'
  and (e.payload->>'occurred_at')::timestamptz>=c.connected_at));
 insert into marketing_private.inbox_authority(connection_id,generation,receive_verified,send_verified,webhook_verified,verified_at,page_id,page_tasks,granted_scopes,configuration_verified)
 values(c.id,c.credential_generation,verified,verified,delivered,now(),p_evidence->>'page_id',array(select jsonb_array_elements_text(p_evidence->'page_tasks')),grants,configured)
 on conflict(connection_id) do update set generation=excluded.generation,receive_verified=excluded.receive_verified,send_verified=excluded.send_verified,webhook_verified=excluded.webhook_verified,verified_at=excluded.verified_at,page_id=excluded.page_id,page_tasks=excluded.page_tasks,granted_scopes=excluded.granted_scopes,configuration_verified=excluded.configuration_verified,
 signed_inbound_at=case when marketing_private.inbox_authority.generation=excluded.generation then marketing_private.inbox_authority.signed_inbound_at end;
 -- Health records readiness; releasing historical blocked events is a separate explicit action.
 return marketing_private.inbox_channel(c.id);
end;$$;


create or replace function marketing_private.inbox_channel(p_connection uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('connection_id',c.id,'brand_id',c.brand_id,'channel',c.channel,'account_name',c.account_name,
 'state',case when c.status not in ('test_authorized','production_authorized') or c.expires_at<=now() then 'connection_unavailable'
 when a.connection_id is null or a.generation<>c.credential_generation then 'authorization_unverified'
 when not coalesce(a.granted_scopes @> (case c.channel when 'facebook' then array['pages_messaging','pages_manage_metadata'] else array['instagram_basic','instagram_manage_messages','pages_manage_metadata'] end),false) then 'permission_unavailable'
 when not a.receive_verified then 'authorization_unverified'
 when not (a.configuration_verified or a.webhook_verified) then 'configuration_unverified' when not a.webhook_verified then 'awaiting_first_delivery' else 'receive_verified' end,
 'receiving_verified',coalesce(a.generation=c.credential_generation and a.receive_verified and (a.configuration_verified or a.webhook_verified) and c.expires_at>now() and c.status in ('test_authorized','production_authorized') and coalesce(a.granted_scopes @> (case c.channel when 'facebook' then array['pages_messaging','pages_manage_metadata'] else array['instagram_basic','instagram_manage_messages','pages_manage_metadata'] end),false),false),
 'configuration_verified',coalesce(a.generation=c.credential_generation and a.configuration_verified,false),'delivery_verified',coalesce(a.generation=c.credential_generation and a.webhook_verified,false),'last_inbound_at',case when a.generation=c.credential_generation then a.signed_inbound_at end,'sending_enabled',false,'events',coalesce((select jsonb_object_agg(state,n) from (select state,count(*) n from marketing_private.inbox_events where connection_id=c.id group by state) counts),'{}'),'standard_window_hours',24,'required_permission',case c.channel when 'facebook' then 'pages_messaging' else 'instagram_manage_messages' end)
 from public.marketing_connections c left join marketing_private.inbox_authority a on a.connection_id=c.id where c.id=p_connection;
$$;

-- Explicit, single-event recovery. Never releases API history or changes delivery proof.
create function public.marketing_inbox_recover_signed_event(p_connection uuid,p_auth_user uuid,p_generation integer,p_event_key text,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; e marketing_private.inbox_events;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 select * into c from public.marketing_connections where id=p_connection for share;
 if c.credential_generation is distinct from p_generation or not coalesce((marketing_private.inbox_channel(c.id)->>'receiving_verified')::boolean,false) then raise exception 'Inbox authority changed.';end if;
 select * into e from marketing_private.inbox_events where event_key=p_event_key for update;
 if e.connection_id is distinct from c.id or e.generation is distinct from p_generation or e.fingerprint is distinct from p_fingerprint
 or e.evidence_source is distinct from 'signed_webhook' or coalesce(e.payload->>'kind','') not in ('incoming','attachment') or coalesce(e.payload->>'medium','dm')<>'dm'
 or e.payload->>'account_id' is distinct from c.provider_account_id or e.payload->>'channel' is distinct from c.channel
 or e.payload->>'peer_id' is null or e.payload->>'occurred_at' is null
 or (e.payload->>'occurred_at')::timestamptz<c.connected_at or (e.payload->>'occurred_at')::timestamptz>now()+interval '5 minutes'
 or exists(select 1 from marketing_private.inbox_erased_peers t where t.connection_id=c.id and t.generation=p_generation and t.peer_hash=encode(extensions.digest(e.payload->>'peer_id','sha256'),'hex') and (e.payload->>'occurred_at')::timestamptz<=t.erased_at)
 then raise exception 'Signed event scope changed.';end if;
 if e.state='blocked' and e.error_code='messaging_authorization_unverified' then
  update marketing_private.inbox_events set state='pending',error_code=null,due_at=now() where event_key=e.event_key;
 elsif e.state not in ('pending','processed') then raise exception 'Event recovery state changed.';end if;
 return jsonb_build_object('state',case when e.state='blocked' then 'pending' else e.state end);
end;$$;
revoke all on function public.marketing_inbox_recover_signed_event(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.marketing_inbox_recover_signed_event(uuid,uuid,integer,text,text) to service_role;
