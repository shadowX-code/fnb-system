do $$
declare d text:=pg_get_functiondef('public.native_assistant_action(text,jsonb)'::regprocedure);
begin
 if strpos(d,'on conflict on constraint native_assistant_action_intents_actor_session_id_fingerprint_key')=0 then raise exception 'action_contract_changed';end if;
 -- Only generated primary ID and actor/session/fingerprint are unique. Do not
 -- bind to a PostgreSQL-truncated constraint identifier or a shadowed variable.
 execute replace(d,'on conflict on constraint native_assistant_action_intents_actor_session_id_fingerprint_key','on conflict');
end $$;
