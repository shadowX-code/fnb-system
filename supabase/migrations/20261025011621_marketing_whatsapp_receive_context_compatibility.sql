-- Production lacks Staging's provider-context column; do not import its AI ownership lifecycle.
-- Execute before 20261024185401_marketing_whatsapp_message_lifecycle.sql, despite timestamp order.
alter table public.marketing_conversation_messages
 add column provider_context jsonb not null default '{}'::jsonb
 check(octet_length(provider_context::text)<=8192);

-- Whole-row serialization must not expose this internal field or change existing social payloads.
do $patch$ declare f text;needle text;begin
 f:=pg_get_functiondef('public.marketing_inbox_detail(uuid,integer,integer)'::regprocedure);
 needle:='to_jsonb(m)||jsonb_build_object';
 if (length(f)-length(replace(f,needle,'')))/length(needle)<>2 then raise exception 'Inbox detail serialization baseline changed';end if;
 f:=replace(f,needle,'(to_jsonb(m)-''provider_context'')||jsonb_build_object');
 needle:='jsonb_agg(to_jsonb(x) order by x.occurred_at,x.id)';
 if (length(f)-length(replace(f,needle,'')))/length(needle)<>1 then raise exception 'Inbox audit serialization baseline changed';end if;
 f:=replace(f,needle,'jsonb_agg(to_jsonb(x)-''provider_context'' order by x.occurred_at,x.id)');
 execute f;
end;$patch$;
