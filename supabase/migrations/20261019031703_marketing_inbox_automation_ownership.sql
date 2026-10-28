-- Unknown native automation visibility is not permission for concurrent senders.
alter table public.marketing_connections
 add column inbox_automation_owner text not null default 'unknown' check(inbox_automation_owner in ('unknown','meta','feedx')),
 add column inbox_automation_generation integer,
 add column inbox_automation_revision integer not null default 0,
 add column inbox_automation_confirmed_at timestamptz,
 add column inbox_automation_confirmed_by uuid references public.employees(id);
-- Three bounded strings (1000/32/32 characters) fit within 8 KB even with JSON escaping.
alter table public.marketing_conversation_messages add column provider_context jsonb not null default '{}'::jsonb check(octet_length(provider_context::text)<=8192);
create index marketing_inbox_external_echo on public.marketing_conversation_messages(conversation_id,occurred_at) where kind='echo';

create function marketing_private.inbox_automation_issue(p_connection uuid,p_inbound timestamptz default null) returns text
language plpgsql stable security definer set search_path=public as $$
declare conn public.marketing_connections;
begin
 select * into conn from marketing_connections where id=p_connection;
 if conn.id is null or conn.inbox_automation_owner<>'feedx' or conn.inbox_automation_generation is distinct from conn.credential_generation or conn.inbox_automation_confirmed_at is null then return 'automation_owner_not_feedx';end if;
 if p_inbound is not null and p_inbound<conn.inbox_automation_confirmed_at then return 'automation_ownership_changed';end if;
 -- Any actual unrecognized outbound after confirmation contradicts exclusive ownership.
 -- An echo can precede our receipt checkpoint: pause conservatively until its exact MID reconciles.
 if exists(select 1 from marketing_conversations c join marketing_conversation_messages m on m.conversation_id=c.id
  where c.connection_id=conn.id and c.connection_generation=conn.credential_generation and m.kind='echo' and m.evidence_source in ('signed_webhook','recent_api','historical_import')
  and m.occurred_at>=conn.inbox_automation_confirmed_at and not exists(select 1 from marketing_reply_outbox o join marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.provider_message_id=m.provider_message_id)) then return 'external_outbound_observed';end if;
 return null;
end;$$;
revoke all on function marketing_private.inbox_automation_issue(uuid,timestamptz) from public,anon,authenticated,service_role;

do $m$ declare f text;needle text;begin
 f:=pg_get_functiondef('public.marketing_inbox_configure(uuid,uuid,integer,text,jsonb)'::regprocedure);
 f:=replace(f,'active_ boolean;','active_ boolean; conn public.marketing_connections; owner_ text;');
 needle:=' if p_command=''approve_knowledge'' then';
 if position(needle in f)=0 then raise exception 'Configure baseline differs';end if;
 f:=replace(f,needle,$body$ if p_command='automation_owner' then
  select * into conn from marketing_connections where id=(p_payload->>'connection_id')::uuid and organization_id=org and brand_id=p_brand and channel in ('facebook','instagram') for update;
  if conn.id is null or conn.inbox_automation_revision is distinct from p_revision or conn.credential_generation is distinct from (p_payload->>'generation')::integer then raise exception 'Channel changed. Reload before confirming ownership.';end if;
  owner_:=p_payload->>'owner';if owner_ is null or owner_ not in ('unknown','meta','feedx') then raise exception 'Choose an automation owner.';end if;
  if owner_='feedx' then
   perform marketing_private.require_access(org,p_brand,'marketing_inbox.ai');perform marketing_private.require_access(org,p_brand,'marketing_inbox.send');
   if not coalesce((p_payload->>'native_disabled')::boolean,false) then raise exception 'Confirm native and other automatic replies are disabled at source.';end if;
  end if;
  update marketing_connections set inbox_automation_owner=owner_,inbox_automation_generation=credential_generation,inbox_automation_revision=inbox_automation_revision+1,inbox_automation_confirmed_at=clock_timestamp(),inbox_automation_confirmed_by=actor where id=conn.id
   returning jsonb_build_object('connection_id',id,'owner',inbox_automation_owner,'revision',inbox_automation_revision,'generation',inbox_automation_generation) into result;
  insert into marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(org,p_brand,'inbox_automation_ownership',actor,jsonb_build_object('connection_id',conn.id,'previous_owner',conn.inbox_automation_owner,'owner',owner_,'generation',conn.credential_generation,'native_disabled',coalesce((p_payload->>'native_disabled')::boolean,false)));
 elsif p_command='approve_knowledge' then$body$);
 execute f;
 f:=pg_get_functiondef('marketing_private.inbox_auto_issue(public.marketing_conversations,public.marketing_inbox_policies)'::regprocedure);
 needle:=' select * into a from marketing_private.inbox_authority where connection_id=conn.id;';
 if position(needle in f)=0 then raise exception 'Auto issue baseline differs';end if;
 f:=replace(f,needle,$body$ if marketing_private.inbox_automation_issue(conn.id,c.last_inbound_at) is not null then return marketing_private.inbox_automation_issue(conn.id,c.last_inbound_at);end if;
$body$||needle);execute f;
 f:=pg_get_functiondef('marketing_private.inbox_auto_enqueue()'::regprocedure);
 needle:=' select p0.* into p from marketing_inbox_policies';
 if position(needle in f)=0 then raise exception 'Auto enqueue baseline differs';end if;
 f:=replace(f,needle,$body$ if exists(select 1 from marketing_conversations c where c.id=new.conversation_id and marketing_private.inbox_automation_issue(c.connection_id,new.occurred_at) is not null) then return new;end if;
$body$||needle);execute f;
 f:=pg_get_functiondef('marketing_private.inbox_auto_new_conversation()'::regprocedure);
 needle:='and p.ai_enabled_at<=now() then';
 if position(needle in f)=0 then raise exception 'Auto conversation baseline differs';end if;
 execute replace(f,needle,'and p.ai_enabled_at<=now() and marketing_private.inbox_automation_issue(new.connection_id,now()) is null then');
 -- Keep normalized, bounded provider context with the immutable message, never infer sender from text.
 f:=pg_get_functiondef('public.marketing_inbox_process_events(integer)'::regprocedure);
 needle:='delivery_state,evidence_source)';
 if position(needle in f)=0 then raise exception 'Event processing baseline differs';end if;
 f:=replace(f,needle,'delivery_state,evidence_source,provider_context)');
 f:=replace(f,'ev.evidence_source) on conflict do nothing returning id into inserted;', $body$ev.evidence_source,jsonb_strip_nulls(jsonb_build_object('app_id',left(item->>'provider_app_id',32),'interaction_type',left(item->>'interaction_type',32),'interaction_payload',left(item->>'interaction_payload',1000)))) on conflict do nothing returning id into inserted;$body$);
 if position('provider_context)' in f)=0 or position('jsonb_strip_nulls' in f)=0 then raise exception 'Provider context projection differs';end if;execute f;
end;$m$;

create function marketing_private.inbox_automation_status(p_connection uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('owner',c.inbox_automation_owner,'generation',c.inbox_automation_generation,'revision',c.inbox_automation_revision,'confirmed_at',c.inbox_automation_confirmed_at,'issue',marketing_private.inbox_automation_issue(c.id)) from marketing_connections c where c.id=p_connection;
$$;
revoke all on function marketing_private.inbox_automation_status(uuid) from public,anon,authenticated,service_role;
do $m$ declare f text;needle text;begin
 f:=pg_get_functiondef('public.marketing_social_accounts(uuid,uuid)'::regprocedure);
 needle:=$n$'messaging',marketing_private.inbox_channel((c->>'id')::uuid)$n$;
 if position(needle in f)=0 then raise exception 'Social read baseline differs';end if;
 execute replace(f,needle,needle||$n$,'automation',marketing_private.inbox_automation_status((c->>'id')::uuid)$n$);
 f:=pg_get_functiondef('public.marketing_inbox_auto_claim()'::regprocedure);
 needle:=$n$if issue in ('conversation_response_limit','previous_delivery_uncertain','response_deadline')$n$;
 if position(needle in f)=0 then raise exception 'Auto claim baseline differs';end if;
 execute replace(f,needle,$n$if issue in ('conversation_response_limit','previous_delivery_uncertain','response_deadline','external_outbound_observed')$n$);
 -- Receipt linkage identifies our AI/staff sends; native automation versus external human remains unknown.
 f:=pg_get_functiondef('public.marketing_inbox_detail(uuid,integer,integer)'::regprocedure);
 needle:=$n$'message_origin',case when m.kind='echo' and o.state is null then 'meta' when m.kind='echo' then 'feedx' end$n$;
 if position(needle in f)=0 then raise exception 'Timeline baseline differs';end if;
 f:=replace(f,needle,needle||$n$,'sender_type',case when m.kind='echo' and o.state is null then 'external_unknown' when m.kind='echo' and exists(select 1 from marketing_reply_outbox ob join marketing_reply_drafts dr on dr.id=ob.draft_id where dr.conversation_id=c.id and ob.provider_message_id=m.provider_message_id and ob.automatic_turn_id is not null) then 'feedx_ai' when m.kind='echo' then 'feedx_staff' end$n$);
 execute f;
end;$m$;
