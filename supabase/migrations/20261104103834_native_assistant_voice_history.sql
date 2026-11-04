alter table feedx_integrations.native_assistant_requests
 add column voice_lease_id uuid,
 add column voice_input_available boolean not null default true;

-- The canonical history and context remain ordered by the original request sequence.
do $migration$
declare definition text; projection text := 'select id,request_id,seq,prompt,reply,state,error_code,evidence,tool_state';
begin
 definition:=pg_get_functiondef('public.native_assistant_service(uuid,text,jsonb)'::regprocedure);
 if position(projection in definition)=0 then raise exception 'Native Assistant history contract changed'; end if;
 execute replace(definition,projection,projection||',voice_input_available,(voice_lease_id is not null) as voice');
end $migration$;

create function public.native_assistant_voice_history(p_actor uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,feedx_integrations,pg_temp as $$
declare
 sid uuid := (p_payload->>'session_id')::uuid;
 lease uuid := (p_payload->>'request_id')::uuid;
 turn uuid := (p_payload->>'turn_id')::uuid;
 step text := p_payload->>'step';
 chosen_provider text := p_payload->>'provider';
 message text := nullif(btrim(p_payload->>'text'),'');
 item feedx_integrations.native_assistant_requests%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_only' using errcode='42501'; end if;
 perform public.native_assistant_service(p_actor,'history',jsonb_build_object('session_id',sid));
 perform 1 from feedx_integrations.native_assistant_realtime_reservations r
 where r.actor=p_actor and r.session_id=sid and r.request_id=lease and r.provider=chosen_provider
 and r.ended_at is null and r.created_at>now()-interval '4 minutes' for update;
 if not found then raise exception 'session_unavailable' using errcode='42501'; end if;
 select * into item from feedx_integrations.native_assistant_requests where user_id=p_actor and request_id=turn;
 if found and (item.session_id is distinct from sid or item.voice_lease_id is distinct from lease) then
  raise exception 'request_conflict' using errcode='40001';
 end if;
 if step='start' and item.id is null then
  if (select count(*) from feedx_integrations.native_assistant_requests where user_id=p_actor and voice_lease_id=lease)>=12
   or (select count(*) from feedx_integrations.native_assistant_requests where session_id=sid)>=40 then
   raise exception 'conversation_limit' using errcode='54000';
  end if;
  insert into feedx_integrations.native_assistant_requests(user_id,request_id,session_id,kind,prompt,provider_revision,model,reserved_tokens,state,error_code,voice_lease_id,voice_input_available)
  values(p_actor,turn,sid,'turn','Voice transcript unavailable',0,case chosen_provider when 'openai' then 'gpt-realtime-2.1-mini' else 'grok-voice-latest' end,1,'cancelled','voice_unfinished',lease,false)
  returning * into item;
 elsif item.id is null then raise exception 'turn_unavailable' using errcode='42501';
 elsif step='input' and message is not null and not item.voice_input_available then
  update feedx_integrations.native_assistant_requests set prompt=left(message,2000),voice_input_available=true where id=item.id returning * into item;
 elsif step='evidence' and item.error_code='voice_unfinished' then
  update feedx_integrations.native_assistant_requests set evidence=p_payload->'evidence',tool_state='completed' where id=item.id returning * into item;
 elsif step in ('complete','interrupted','unavailable') and item.error_code='voice_unfinished' then
  update feedx_integrations.native_assistant_requests
   set state=case when step='complete' and message is not null then 'completed' else 'cancelled' end,
       reply=case when step='complete' then left(message,3000) end,
       error_code=case when step='interrupted' then 'voice_interrupted' when message is null then 'voice_transcript_unavailable' end,
       finished_at=now()
   where id=item.id returning * into item;
 end if;
 return jsonb_build_object('id',item.id,'seq',item.seq,'request_id',item.request_id,'prompt',item.prompt,'reply',item.reply,'state',item.state,
 'error_code',item.error_code,'evidence',item.evidence,'voice',true,'voice_input_available',item.voice_input_available);
end $$;
revoke all on function public.native_assistant_voice_history(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.native_assistant_voice_history(uuid,jsonb) to service_role;
