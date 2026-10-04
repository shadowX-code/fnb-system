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
    or exists(select 1 from jsonb_object_keys(p_record) k where k not in ('type','response_id','item_id','owner','status','phase','audio_end_ms','playing','elapsed_ms'))
    or coalesce(p_record->>'type','') !~ '^(input_audio_buffer\.(speech_started|speech_stopped|committed)|response\.(created|done|requested|output_item.added|function_call_arguments.done)|output_audio_buffer\.(started|stopped|cleared)|conversation.item.truncated|error|client\.(response.create|response.cancel|output_audio_buffer.clear)|transport\.(closed|connected|disconnected)|playback\.(playing|pause|waiting|stalled|ended|blocked))$'
  then raise exception using errcode='22023',message='Realtime observation is invalid.'; end if;
  if (select count(*) from recruitment_realtime_traces where attempt_id=a.id)>=6000 then return; end if;
  insert into recruitment_realtime_traces(attempt_id,key,provider_generation,record) values(a.id,p_key,p_generation,p_record) on conflict do nothing;
end $function$;
