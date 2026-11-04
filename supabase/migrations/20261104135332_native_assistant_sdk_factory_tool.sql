-- SDK tool reads use the same actor, lease, session and read budget as legacy voice.
do $migration$
declare
 definition text := pg_get_functiondef('public.native_assistant_reserve_realtime(uuid,uuid,uuid,text,text)'::regprocedure);
 old_guard text := 'and tool_reads<6 and not sdk_baseline';
begin
 if strpos(definition, old_guard)=0 then
  raise exception 'Native Assistant Realtime tool reservation contract changed';
 end if;
 execute replace(definition, old_guard, 'and tool_reads<6 and (not sdk_baseline or sdk_connected_at is not null)');
end $migration$;
