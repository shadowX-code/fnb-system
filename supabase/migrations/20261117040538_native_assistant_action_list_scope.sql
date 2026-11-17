-- Qualify record columns; a local PL/pgSQL variable is not a function parameter.
do $migration$
declare d text:=pg_get_functiondef('public.native_assistant_action(text,jsonb)'::regprocedure);
 old text:='select id,operation,arguments,fingerprint,state,expires_at,created_at,result from feedx_integrations.native_assistant_action_intents where native_assistant_action_intents.actor=native_assistant_action.actor and session_id=sid order by created_at desc limit 20';
begin
 if strpos(d,old)=0 then raise exception 'action_list_contract_changed';end if;
 d:=replace(d,old,'select t.id,t.operation,t.arguments,t.fingerprint,t.state,t.expires_at,t.created_at,t.result from feedx_integrations.native_assistant_action_intents t where t.actor=auth.uid() and t.session_id=sid order by t.created_at desc limit 20');
 execute d;
end $migration$;
