-- PL/pgSQL actor variable must not shadow the index column in ON CONFLICT.
do $$
declare d text:=pg_get_functiondef('public.native_assistant_action(text,jsonb)'::regprocedure);
begin
 if strpos(d,'on conflict(actor,session_id,fingerprint)')=0 then raise exception 'action_contract_changed';end if;
 execute replace(d,'on conflict(actor,session_id,fingerprint)','on conflict on constraint native_assistant_action_intents_actor_session_id_fingerprint_key');
end $$;
