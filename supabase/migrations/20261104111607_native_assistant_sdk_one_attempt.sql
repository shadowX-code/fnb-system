alter table feedx_integrations.native_assistant_realtime_reservations
 add column sdk_baseline boolean not null default false;

do $migration$
declare
 definition text;
begin
 definition := pg_get_functiondef('public.native_assistant_reserve_realtime(uuid,uuid,uuid,text,text)'::regprocedure);
 if strpos(definition, 'p_action is distinct from ''start''')=0
  or strpos(definition, ')>=8 or exists(')=0
  or strpos(definition, 'and tool_reads<6')=0 then
  raise exception 'Realtime reservation contract changed';
 end if;
 definition := replace(definition, 'p_action is distinct from ''start''',
  'p_action not in (''start'',''sdk_baseline'') or p_action is null or (p_action=''sdk_baseline'' and p_provider is distinct from ''openai'')');
 definition := replace(definition, ')>=8 or exists(', ')>=(case when p_action=''sdk_baseline'' then 9 else 8 end) or exists(');
 definition := replace(definition, 'and tool_reads<6', 'and tool_reads<6 and not sdk_baseline');
 definition := replace(definition, '(actor,request_id,session_id,provider) values(p_actor,p_request,p_session,p_provider)',
  '(actor,request_id,session_id,provider,sdk_baseline) values(p_actor,p_request,p_session,p_provider,p_action=''sdk_baseline'')');
 execute definition;
end $migration$;
