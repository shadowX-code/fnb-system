-- The authenticated Edge runtime may immediately reconcile only its caller's ended lease.
-- Provider credentials remain in the existing pinned server-only cleanup authority.
do $migration$
declare definition text; old text := 'if p_action=''claim'' then';
begin
 definition:=pg_get_functiondef('public.native_assistant_voice_connection(text,jsonb)'::regprocedure);
 if strpos(definition,old)=0 then raise exception 'Voice connection authority changed'; end if;
 execute replace(definition,old,$body$if p_action='owned_cleanup' then
  select * into l from feedx_integrations.assistant_voice_leases
   where actor=(p_payload->>'actor')::uuid and request_id=(p_payload->>'request_id')::uuid
    and session_id=(p_payload->>'session_id')::uuid for update;
  if not found then raise exception 'session_unavailable' using errcode='42501'; end if;
  if l.state='closing' and l.call_id is not null and l.cleanup_after<=now() then
   update feedx_integrations.assistant_voice_leases set cleanup_after=now()+interval '30 seconds',cleanup_attempts=cleanup_attempts+1
    where actor=l.actor and request_id=l.request_id;
   select jsonb_build_object('state',l.state,'call_id',l.call_id,'credential',v.decrypted_secret) into result
    from feedx_integrations.native_assistant_providers p join vault.decrypted_secrets v on v.id=p.secret_id
    where p.provider='openai' and p.credential_revision=l.provider_revision;
   if result is not null then return result; end if;
  end if;
  return jsonb_build_object('state',l.state);
 elsif p_action='claim' then$body$);
end $migration$;
do $migration$
declare definition text; old text := 'reason=coalesce(reason,''user_ended''),cleanup_after=now()';
begin
 definition:=pg_get_functiondef('public.native_assistant_voice_lease(uuid,text,jsonb)'::regprocedure);
 if strpos(definition,old)=0 then raise exception 'Voice End authority changed'; end if;
 execute replace(definition,old,'reason=coalesce(reason,''user_ended''),cleanup_after=case when state=''closing'' then cleanup_after else now() end');
end $migration$;
