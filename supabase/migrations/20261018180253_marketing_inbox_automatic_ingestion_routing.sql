-- Automatic modes own semantic matching and escalation after canonical ingestion.
-- Keep legacy FAQ draft behavior for Suggest Only without preempting the shared engine.
do $migration$
declare definition text; old_branch text; new_branch text;
begin
 definition:=pg_get_functiondef('public.marketing_inbox_process_events(integer)'::regprocedure);
 old_branch:=$old$if coalesce(mode,'suggest')<>'off' and not c.takeover then$old$;
 new_branch:=$new$if coalesce(mode,'suggest')<>'off' and not c.takeover
       and not exists(select 1 from public.marketing_inbox_policies p where p.brand_id=c.brand_id and p.ai_reply_mode in ('safe_auto','ai_first')) then$new$;
 if (length(definition)-length(replace(definition,old_branch,'')))/length(old_branch)<>1 then
  raise exception 'Inbox ingestion routing baseline differs';
 end if;
 execute replace(definition,old_branch,new_branch);
end;$migration$;
