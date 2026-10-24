-- Append provider corrections to canonical messages; original evidence and timeline identity stay intact.
alter table public.marketing_conversation_messages drop constraint marketing_conversation_messages_kind_check;
alter table public.marketing_conversation_messages add constraint marketing_conversation_messages_kind_check check(kind in ('incoming','echo','note','attachment','delivery','read','edit','revoke'));
create index marketing_whatsapp_message_changes on public.marketing_conversation_messages(conversation_id,(provider_context->>'target_message_id'),occurred_at desc,provider_message_id desc) where kind in ('edit','revoke');
create index marketing_whatsapp_change_events on marketing_private.inbox_events(connection_id,generation) where state='processed' and evidence_source='signed_webhook' and payload->>'kind' in ('edit','revoke');

create or replace function marketing_private.whatsapp_enqueue(item jsonb) returns text language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; key text; happened timestamptz;begin
 if jsonb_typeof(item) is distinct from 'object' then return 'invalid';end if;
 begin happened:=(item->>'occurred_at')::timestamptz;exception when invalid_datetime_format or datetime_field_overflow then return 'invalid';end;
 if coalesce(item->>'account_id','') !~ '^[0-9]{1,32}$' or coalesce(item->>'waba_id','') !~ '^[0-9]{1,32}$' or coalesce(item->>'peer_id','') !~ '^[0-9]{1,32}$'
 or coalesce(item->>'kind','') not in ('incoming','attachment','echo','status','edit','revoke') or (length(coalesce(item->>'event_id','')) not between 1 and 300 or coalesce(item->>'event_id','') !~ '^[A-Za-z0-9._=+/\-]+$')
 or coalesce(item->>'medium','dm')<>'dm' or jsonb_typeof(item->'body') is distinct from 'string' or length(item->>'body')>8000
 or happened is null or happened<=to_timestamp(0) or happened>now()+interval '5 minutes'
 or (item->>'kind'='status' and coalesce(item->>'provider_status','') not in ('sent','delivered','read','failed'))
 or (item->>'kind' in ('edit','revoke') and (length(coalesce(item->>'target_message_id','')) not between 1 and 300 or coalesce(item->>'target_message_id','') !~ '^[A-Za-z0-9._=+/\-]+$' or coalesce(item->>'target_direction','') not in ('incoming','outgoing'))) then return 'invalid';end if;
 select * into c from marketing_connections where channel='whatsapp' and provider_account_id=item->>'account_id' and whatsapp_waba_id=item->>'waba_id' for share;
 if c.id is null or c.whatsapp_local_state<>'active' then return 'unbound';end if;
 if (item ? 'brand_id' and item->>'brand_id' is distinct from c.brand_id::text) or (item ? 'generation' and item->>'generation' is distinct from c.credential_generation::text) or happened<date_trunc('second',c.connected_at) then return 'unbound';end if;
 if exists(select 1 from marketing_private.inbox_erased_peers t where t.connection_id=c.id and t.generation=c.credential_generation and t.peer_hash=encode(extensions.digest(item->>'peer_id','sha256'),'hex') and happened<=t.erased_at) then return 'unbound';end if;
 if (item->>'kind'='echo' or item->>'target_direction'='outgoing') and c.whatsapp_onboarding_mode<>'coexistence' then return 'unbound';end if;
 key:=c.id||':'||c.credential_generation||':whatsapp:'||case when item->>'kind'='status' then 'status:'||(item->>'provider_status') when item->>'kind' in ('edit','revoke') then item->>'kind' else 'message' end||':'||(item->>'event_id');
 insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint,state,error_code)
 values(key,c.id,c.credential_generation,item,encode(extensions.digest(item::text,'sha256'),'hex'),case when marketing_private.whatsapp_receiving(c.id) then 'pending' else 'blocked' end,case when not marketing_private.whatsapp_receiving(c.id) then 'whatsapp_authority_unverified' end) on conflict do nothing;
 return case when found then 'accepted' else 'duplicate' end;
end;$$;

-- Like early receipts, an unmatched correction remains durable and creates no conversation.
create function marketing_private.whatsapp_reconcile_changes(p_connection uuid,p_generation integer) returns void language plpgsql security definer set search_path=public as $$
begin
 if not coalesce(marketing_private.whatsapp_receiving(p_connection),false) or not exists(select 1 from marketing_connections where id=p_connection and credential_generation=p_generation) then return;end if;
 with added as (
 insert into marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,evidence_source,provider_context)
 select c.id,e.payload->>'kind',e.payload->>'body',e.payload->>'event_id',(e.payload->>'occurred_at')::timestamptz,'signed_webhook',
 jsonb_build_object('target_message_id',m.provider_message_id,'target_direction',e.payload->>'target_direction')
 from marketing_private.inbox_events e join marketing_conversations c on c.connection_id=e.connection_id and c.connection_generation=e.generation and c.channel='whatsapp' and c.participant_key=e.payload->>'peer_id'
 join marketing_conversation_messages m on m.conversation_id=c.id and m.provider_message_id=e.payload->>'target_message_id'
 and ((e.payload->>'target_direction'='outgoing' and m.kind='echo') or (e.payload->>'target_direction'='incoming' and m.kind in ('incoming','attachment')))
 where e.connection_id=p_connection and e.generation=p_generation and e.state='processed' and e.evidence_source='signed_webhook' and e.payload->>'kind' in ('edit','revoke')
 and (e.payload->>'occurred_at')::timestamptz>=m.occurred_at
 on conflict do nothing returning conversation_id
 ) update marketing_conversations c set version=version+n.changes from (select conversation_id,count(*)::integer changes from added group by conversation_id)n where c.id=n.conversation_id;
end;$$;

create function marketing_private.whatsapp_message_state(m public.marketing_conversation_messages) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare correction public.marketing_conversation_messages;begin
 if m.kind not in ('incoming','attachment','echo') or not exists(select 1 from marketing_conversations c where c.id=m.conversation_id and c.channel='whatsapp') then return '{}';end if;
 select * into correction from marketing_conversation_messages x where x.conversation_id=m.conversation_id and x.kind in ('edit','revoke') and x.evidence_source='signed_webhook' and x.provider_context->>'target_message_id'=m.provider_message_id
 order by (x.kind='revoke') desc,x.occurred_at desc,x.provider_message_id desc limit 1;
 if not found then return '{}';end if;
 return jsonb_build_object('body',case correction.kind when 'revoke' then 'Message deleted on WhatsApp' else correction.body end,
 'provider_lifecycle',jsonb_build_object('kind',correction.kind,'event_id',correction.provider_message_id,'occurred_at',correction.occurred_at,'evidence_source',correction.evidence_source));
end;$$;
revoke all on function marketing_private.whatsapp_reconcile_changes(uuid,integer),marketing_private.whatsapp_message_state(public.marketing_conversation_messages) from public,anon,authenticated,service_role;

-- Patch the existing worker and projections; social authorities and signatures stay unchanged.
do $patch$ declare f text;needle text;begin
 f:=pg_get_functiondef('public.marketing_inbox_process_events(integer)'::regprocedure);
 needle:=$n$    if ev.payload->>'kind'='status' then$n$;
 if position(needle in f)=0 then raise exception 'Inbox drain baseline changed';end if;
 f:=replace(f,needle,$n$    -- Serialize original/correction reconciliation without waiting on another worker's row locks.
    if not pg_try_advisory_xact_lock(hashtextextended('whatsapp-message:'||conn.id||':'||ev.generation,0)) then continue;end if;
    if ev.payload->>'kind' in ('edit','revoke') then
     update marketing_private.inbox_events set state='processed',attempts=attempts+1,error_code=null where event_key=ev.event_key;
     perform marketing_private.whatsapp_reconcile_changes(conn.id,ev.generation);processed:=processed+1;continue;
    end if;
$n$||needle);
 needle:=$n$   update marketing_private.inbox_events set state='processed',attempts=attempts+1,error_code=null where event_key=ev.event_key;processed:=processed+1;$n$;
 if position(needle in f)=0 then raise exception 'Inbox completion baseline changed';end if;
 f:=replace(f,needle,$n$   if conn.channel='whatsapp' then perform marketing_private.whatsapp_reconcile_changes(conn.id,ev.generation);end if;
$n$||needle);execute f;
 f:=pg_get_functiondef('public.marketing_inbox_detail(uuid,integer,integer)'::regprocedure);
 needle:=$n$) val,m.occurred_at,m.id$n$;
 if position(needle in f)=0 then raise exception 'Inbox detail baseline changed';end if;
 f:=replace(f,needle,$n$)||(case when c.channel='whatsapp' then marketing_private.whatsapp_message_state(m) else '{}'::jsonb end) val,m.occurred_at,m.id$n$);execute f;
 f:=pg_get_functiondef('public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean)'::regprocedure);
 needle:=$n$select m.body,m.kind,m.occurred_at,m.id from$n$;
 if position(needle in f)=0 then raise exception 'Inbox preview baseline changed';end if;
 f:=replace(f,needle,$n$select case when c.channel='whatsapp' then coalesce(marketing_private.whatsapp_message_state(m)->>'body',m.body) else m.body end body,m.kind,m.occurred_at,m.id from$n$);
 needle:=$n$position(lower(p_search) in lower(m.body))$n$;
 if position(needle in f)=0 then raise exception 'Inbox search baseline changed';end if;
 f:=replace(f,needle,$n$position(lower(p_search) in lower(case when c.channel='whatsapp' then coalesce(marketing_private.whatsapp_message_state(m)->>'body',m.body) else m.body end))$n$);execute f;
end;$patch$;
