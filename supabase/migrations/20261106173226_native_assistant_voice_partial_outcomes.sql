-- Preserve actual partial transcripts and bounded outcome provenance, never raw audio.
alter table feedx_integrations.native_assistant_requests add column voice_details jsonb;
do $migration$
declare definition text; old text;
begin
 definition:=pg_get_functiondef('public.native_assistant_voice_history(uuid,jsonb)'::regprocedure);
 old:='reply=case when step=''complete'' then left(message,3000) end,';
 if strpos(definition,old)=0 then raise exception 'Voice outcome contract changed'; end if;
 definition:=replace(definition,old,'reply=left(message,3000), voice_details=case when p_payload->''details''->>''reason'' in (''provider_completed'',''missing_assistant_transcript'',''provider_cancelled'',''provider_incomplete'',''provider_failed'',''max_output_tokens'',''content_filter'',''session_ended'',''session_expired'',''transport_disconnected'',''provider_error'',''lease_failed'',''turn_limit'') then jsonb_build_object(''reason'',p_payload->''details''->>''reason'') end,');
 old:='''voice_input_available'',item.voice_input_available';
 if strpos(definition,old)=0 then raise exception 'Voice result contract changed'; end if;
 execute replace(definition,old,old||',''voice_details'',item.voice_details');
 definition:=pg_get_functiondef('public.native_assistant_service(uuid,text,jsonb)'::regprocedure);
 old:='q.voice_input_available,q.input_tokens';
 if strpos(definition,old)=0 then raise exception 'Private history projection changed'; end if;
 execute replace(definition,old,'q.voice_input_available,q.voice_details,q.input_tokens');
end $migration$;
