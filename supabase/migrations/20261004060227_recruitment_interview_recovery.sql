-- Forward correction: preserve active time while explicitly interrupted; never rewrite old attempts.
alter table public.recruitment_interview_attempts add column paused_at timestamptz;
CREATE OR REPLACE FUNCTION public.recruitment_public_begin(p_token text, p_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_attempt public.recruitment_interview_attempts%rowtype; v_config public.recruitment_interview_configs%rowtype; v_expiry timestamptz; v_now timestamptz:=clock_timestamp();
begin
  if p_client_id is null then raise exception using errcode='22023',message='Interview session identifier is required.'; end if;
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  select * into v_attempt from public.recruitment_interview_attempts where id=v_attempt.id for update;
  if v_attempt.status not in ('ready','starting','interviewing','interrupted','finalizing') or not exists(select 1 from public.recruitment_consents where attempt_id=v_attempt.id) then
    raise exception using errcode='55000',message='Interview is not ready to start.';
  end if;
  if v_attempt.lease_expires_at>v_now and v_attempt.lease_owner is distinct from p_client_id then
    raise exception using errcode='55P03',message='Interview is already open on another device.';
  end if;
  select * into v_config from public.recruitment_interview_configs where id=v_attempt.config_version_id;
  select expires_at into v_expiry from public.recruitment_invitations where id=v_attempt.invitation_id;
  if v_attempt.interview_started_at is null then
    if v_expiry < v_now+make_interval(mins=>v_config.max_minutes+10) then
      raise exception using errcode='22023',message='Interview link expires too soon. Ask for a new link.';
    end if;
    update public.recruitment_interview_attempts set status='starting',interview_started_at=v_now,max_ends_at=v_now+make_interval(mins=>v_config.max_minutes),lease_owner=p_client_id,lease_expires_at=v_now+interval '45 seconds',last_heartbeat_at=v_now where id=v_attempt.id;
    insert into public.recruitment_topic_coverage(attempt_id,topic_index,topic)
      select v_attempt.id,(ord-1)::integer,value#>>'{}' from jsonb_array_elements(v_config.required_topics) with ordinality as x(value,ord);
    insert into public.recruitment_scenario_progress(attempt_id,scenario_index,brief)
      select v_attempt.id,(ord-1)::integer,value#>>'{}' from jsonb_array_elements(v_config.scenario_briefs) with ordinality as x(value,ord);
    insert into public.recruitment_events(opening_id,application_id,attempt_id,action) values(v_attempt.opening_id,v_attempt.application_id,v_attempt.id,'interview_started');
  else
    if v_attempt.status<>'finalizing' then
      -- A reload has the same tab-bound client but no surviving provider/capture.
      -- After an abrupt suspension, only time through the last server heartbeat is established.
      if v_attempt.paused_at is null and v_attempt.lease_expires_at<=v_now then
        v_attempt.paused_at:=v_attempt.last_heartbeat_at;
      end if;
      if v_attempt.paused_at is not null and v_attempt.max_ends_at>v_attempt.paused_at then
        v_attempt.max_ends_at:=least(v_attempt.max_ends_at+(v_now-v_attempt.paused_at),v_expiry-interval '1 minute');
      end if;
      update public.recruitment_interview_attempts set max_ends_at=v_attempt.max_ends_at,paused_at=null,provider_requested_at=null where id=v_attempt.id;
      insert into public.recruitment_events(opening_id,application_id,attempt_id,action,details)
      values(v_attempt.opening_id,v_attempt.application_id,v_attempt.id,'recording_gap',jsonb_build_object('reason','resume_requires_new_capture','prior_heartbeat_at',v_attempt.last_heartbeat_at));
    end if;
    if v_attempt.max_ends_at<=v_now then update public.recruitment_interview_attempts set status='finalizing',interview_ended_at=coalesce(interview_ended_at,v_attempt.max_ends_at),completion_reason=coalesce(completion_reason,'max_duration') where id=v_attempt.id; end if;
    update public.recruitment_interview_attempts set status=case when status='finalizing' then status when status<>'finalizing' then 'starting' else status end,lease_owner=p_client_id,lease_expires_at=v_now+interval '45 seconds',last_heartbeat_at=v_now where id=v_attempt.id;
    if v_attempt.status='interrupted' or v_attempt.lease_expires_at<=v_now then
      insert into public.recruitment_events(opening_id,application_id,attempt_id,action,details) values(v_attempt.opening_id,v_attempt.application_id,v_attempt.id,'interview_resumed',jsonb_build_object('prior_heartbeat_at',v_attempt.last_heartbeat_at,'lease_gap',v_attempt.lease_expires_at<=v_now));
    end if;
  end if;
  return jsonb_build_object('status',(select status from public.recruitment_interview_attempts where id=v_attempt.id),'started_at',(select interview_started_at from public.recruitment_interview_attempts where id=v_attempt.id),'max_ends_at',(select max_ends_at from public.recruitment_interview_attempts where id=v_attempt.id),'topics',coalesce((select jsonb_agg(to_jsonb(t) order by topic_index) from recruitment_topic_coverage t where attempt_id=v_attempt.id),'[]'::jsonb),'scenarios',coalesce((select jsonb_agg(to_jsonb(t) order by scenario_index) from recruitment_scenario_progress t where attempt_id=v_attempt.id),'[]'::jsonb));
end $function$
;
CREATE OR REPLACE FUNCTION public.recruitment_public_heartbeat(p_token text, p_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_attempt public.recruitment_interview_attempts%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_client_id is null then raise exception using errcode='22023',message='Interview session identifier is required.'; end if;
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  select * into v_attempt from public.recruitment_interview_attempts where id=v_attempt.id for update;
  if v_attempt.lease_owner is distinct from p_client_id or v_attempt.lease_expires_at<=v_now or v_attempt.status not in ('starting','interviewing','interrupted','finalizing') then
    raise exception using errcode='42501',message='Interview session is unavailable.';
  end if;
  update public.recruitment_interview_attempts set status=case when max_ends_at<=v_now and paused_at is null then 'finalizing' else status end,interview_ended_at=case when max_ends_at<=v_now and paused_at is null then coalesce(interview_ended_at,max_ends_at) else interview_ended_at end,completion_reason=case when max_ends_at<=v_now and paused_at is null then coalesce(completion_reason,'max_duration') else completion_reason end,lease_expires_at=v_now+interval '45 seconds',last_heartbeat_at=v_now where id=v_attempt.id;
  return jsonb_build_object('status',case when v_attempt.max_ends_at<=v_now and v_attempt.paused_at is null then 'finalizing' else v_attempt.status end,'max_ends_at',v_attempt.max_ends_at);
end $function$
;
CREATE OR REPLACE FUNCTION public.recruitment_public_interruption(p_token text, p_client_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.recruitment_interview_attempts%rowtype;
begin
  a:=public.recruitment_session(p_token,p_client_id);
  insert into public.recruitment_events(attempt_id,application_id,opening_id,action,details) values(a.id,a.application_id,a.opening_id,'recording_gap',jsonb_build_object('reason',left(p_reason,80)));
  update public.recruitment_interview_attempts set status='interrupted',paused_at=coalesce(paused_at,clock_timestamp()) where id=a.id and status<>'finalizing';
  return jsonb_build_object('status','interrupted');
end $function$
;
CREATE OR REPLACE FUNCTION public.recruitment_realtime_context(p_token text, p_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_attempt public.recruitment_interview_attempts%rowtype; v_config public.recruitment_interview_configs%rowtype; v_now timestamptz:=clock_timestamp(); v_generation integer;
begin
  if p_client_id is null then raise exception using errcode='22023',message='Interview session identifier is required.'; end if;
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  select * into v_attempt from public.recruitment_interview_attempts where id=v_attempt.id for update;
  if v_attempt.lease_owner is distinct from p_client_id or v_attempt.lease_expires_at<=v_now or v_attempt.max_ends_at<=v_now or v_attempt.status not in ('starting','interviewing','interrupted') then
    raise exception using errcode='42501',message='Interview session is unavailable.';
  end if;
  if v_attempt.provider_generation>=60 or (v_attempt.provider_requested_at is not null and v_attempt.provider_requested_at>v_now-interval '8 seconds') then
    raise exception using errcode='42901',message='Realtime reconnect limit reached. Please wait.';
  end if;
  if not exists(select 1 from public.recruitment_recording_units where attempt_id=v_attempt.id and status='capturing') then raise exception using errcode='55000',message='Recording must start before AI voice.'; end if;
  select * into v_config from public.recruitment_interview_configs where id=v_attempt.config_version_id;
  v_generation:=v_attempt.provider_generation+1;
  update public.recruitment_interview_attempts set provider_generation=v_generation,provider_reconnects=greatest(v_generation-1,0),provider_requested_at=v_now,provider_connected_at=null,status='starting' where id=v_attempt.id;
  if v_generation>1 then insert into public.recruitment_events(opening_id,application_id,attempt_id,action,details) values(v_attempt.opening_id,v_attempt.application_id,v_attempt.id,'provider_reconnect_requested',jsonb_build_object('generation',v_generation)); end if;
  return jsonb_build_object('opening',jsonb_build_object('title',(select opening_title_snapshot from recruitment_applications where id=v_attempt.application_id),'description',(select opening_description_snapshot from recruitment_applications where id=v_attempt.application_id)), 'remaining_seconds',greatest(0,extract(epoch from v_attempt.max_ends_at-v_now)::integer),'attempt_id',v_attempt.id,'generation',v_generation,'started_at',v_attempt.interview_started_at,'max_ends_at',v_attempt.max_ends_at,'target_minutes',v_config.target_minutes,'required_topics',v_config.required_topics,'scenario_briefs',v_config.scenario_briefs,'language_guidance',v_config.language_guidance,'interview_instructions',v_config.interview_instructions,
    'turns',coalesce((select jsonb_agg(jsonb_build_object('speaker',t.speaker,'transcript',t.transcript,'turn_number',t.turn_number) order by t.turn_number) from (select * from public.recruitment_transcript_turns where attempt_id=v_attempt.id and not exists(select 1 from recruitment_transcript_annotations a where a.attempt_id=v_attempt.id and a.provider_generation=recruitment_transcript_turns.provider_generation and a.provider_item_id=recruitment_transcript_turns.provider_item_id and a.kind='truncated') order by turn_number desc limit 40) t),'[]'::jsonb),
    'established_facts',coalesce((select jsonb_agg(jsonb_build_object('topic',c.topic,'statement',left(t.transcript,1500),'turn_number',t.turn_number)) from recruitment_topic_coverage c join recruitment_transcript_turns t on t.id=c.evidence_turn_id where c.attempt_id=v_attempt.id and t.speaker='candidate'),'[]'::jsonb),
    'topics',coalesce((select jsonb_agg(jsonb_build_object('index',topic_index,'topic',topic,'state',state) order by topic_index) from public.recruitment_topic_coverage where attempt_id=v_attempt.id),'[]'::jsonb),
    'scenarios',coalesce((select jsonb_agg(jsonb_build_object('index',scenario_index,'brief',brief,'state',state) order by scenario_index) from public.recruitment_scenario_progress where attempt_id=v_attempt.id),'[]'::jsonb));
end $function$
;

-- Diagnostics are browser-relayed observations, never provider-attested evidence or token material.
create table public.recruitment_realtime_traces (
  attempt_id uuid not null references public.recruitment_interview_attempts(id),
  key text not null,
  provider_generation integer not null,
  record jsonb not null,
  received_at timestamptz not null default clock_timestamp(),
  primary key(attempt_id,key)
);
alter table public.recruitment_realtime_traces enable row level security;
revoke all on public.recruitment_realtime_traces from public,anon,authenticated;
grant select,insert on public.recruitment_realtime_traces to service_role;
create trigger recruitment_trace_immutable before update or delete on public.recruitment_realtime_traces for each row execute function public.recruitment_immutable_evidence();
create function public.recruitment_public_trace(p_token text,p_client_id uuid,p_generation integer,p_key text,p_record jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
  a:=public.recruitment_session(p_token,p_client_id);
  if p_generation not between 1 and a.provider_generation or length(p_key)>200 or jsonb_typeof(p_record)<>'object' or octet_length(p_record::text)>1200
    or exists(select 1 from jsonb_object_keys(p_record) k where k not in ('type','response_id','item_id','owner','status','phase','audio_end_ms','playing','elapsed_ms'))
    or coalesce(p_record->>'type','') !~ '^(input_audio_buffer\.(speech_started|speech_stopped|committed)|response\.(created|done|requested|output_item.added|function_call_arguments.done)|output_audio_buffer\.(started|stopped|cleared)|conversation.item.truncated|error|client\.(response.create|response.cancel|output_audio_buffer.clear)|transport.closed)$'
  then raise exception using errcode='22023',message='Realtime observation is invalid.'; end if;
  if (select count(*) from recruitment_realtime_traces where attempt_id=a.id)>=6000 then return; end if;
  insert into recruitment_realtime_traces(attempt_id,key,provider_generation,record) values(a.id,p_key,p_generation,p_record) on conflict do nothing;
end $$;
revoke all on function public.recruitment_public_trace(text,uuid,integer,text,jsonb) from public,anon,authenticated;


create function public.recruitment_public_traces(p_token text,p_client_id uuid,p_records jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare r jsonb;
begin
  perform public.recruitment_session(p_token,p_client_id);
  if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>40 then raise exception using errcode='22023',message='Realtime batch is invalid.'; end if;
  for r in select value from jsonb_array_elements(p_records) loop
    perform public.recruitment_public_trace(p_token,p_client_id,(r->>'generation')::integer,r->>'key',r->'record');
  end loop;
end $$;
revoke all on function public.recruitment_public_traces(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.recruitment_public_traces(text,uuid,jsonb) to anon,authenticated;
