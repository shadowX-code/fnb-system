create unique index recruitment_natural_voice_qa_attempt
 on public.recruitment_events(attempt_id) where action='natural_voice_qa';

-- A server-pinned Natural Conversation QA attempt can retain source evidence,
-- but its dialogue must never enter assessment, preference, or scoring.
create or replace function public.recruitment_turn_eligible(p_attempt uuid,p_turn bigint) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
   select 1 from recruitment_transcript_turns t
   where t.id=p_turn and t.attempt_id=p_attempt
   and not exists(
     select 1 from recruitment_events e
     where e.attempt_id=t.attempt_id and e.action='natural_voice_qa'
   )
   and not exists(
     select 1 from recruitment_transcript_annotations a
     where a.attempt_id=t.attempt_id and a.provider_generation=t.provider_generation
       and a.provider_item_id=t.provider_item_id
       and a.kind in ('unverified_candidate','transcription_failed','truncated')
   )
 );
$$;

-- Record the provider input-buffer offset without changing the candidate trace RPC signature.
CREATE OR REPLACE FUNCTION public.recruitment_public_trace(p_token text, p_client_id uuid, p_generation integer, p_key text, p_record jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.recruitment_interview_attempts%rowtype;
begin
  a:=public.recruitment_session(p_token,p_client_id);
  if p_generation not between 1 and a.provider_generation or length(p_key)>200 or jsonb_typeof(p_record)<>'object' or octet_length(p_record::text)>1200
    or exists(select 1 from jsonb_object_keys(p_record) k where k not in ('type','response_id','item_id','owner','status','phase','audio_end_ms','audio_start_ms','playing','elapsed_ms'))
    or coalesce(p_record->>'type','') !~ '^(input_audio_buffer\.(speech_started|speech_stopped|committed)|response\.(created|done|requested|output_item.added|function_call_arguments.done)|output_audio_buffer\.(started|stopped|cleared)|conversation.item.truncated|error|client\.(response.create|response.cancel|output_audio_buffer.clear)|transport\.(closed|connected|disconnected)|playback\.(playing|pause|waiting|stalled|ended|blocked))$'
  then raise exception using errcode='22023',message='Realtime observation is invalid.'; end if;
  if (select count(*) from recruitment_realtime_traces where attempt_id=a.id)>=6000 then return; end if;
  insert into recruitment_realtime_traces(attempt_id,key,provider_generation,record) values(a.id,p_key,p_generation,p_record) on conflict do nothing;
end $function$;
