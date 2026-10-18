-- Keep immediate risk blocking, and record its outcome through the existing handoff authority.
do $migration$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('public.marketing_inbox_process_events(integer)'::regprocedure);
 needle:=$old$     if ev.evidence_source<>'historical_import' and event_medium='dm' and not c.opted_out$old$;
 if position(needle in definition)=0 then raise exception 'Inbox ingestion handoff baseline differs';end if;
 definition:=replace(definition,needle,$new$     if cardinality(risks)>0 and ev.evidence_source='signed_webhook' and event_medium='dm' and item->>'kind' in ('incoming','attachment') then
      perform marketing_private.inbox_auto_handoff(t.id,'safety_or_human_request') from marketing_private.inbox_automatic_turns t where t.message_id=inserted;
     end if;
$new$||needle);
 execute definition;
end;$migration$;
