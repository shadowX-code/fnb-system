-- Scenario evidence must follow a recorded AI scenario question. Existing evidence is retained.
alter table public.recruitment_scenario_progress add column asked_turn_id bigint references public.recruitment_transcript_turns(id) on delete restrict;
create index recruitment_events_attempt_time_idx on public.recruitment_events(attempt_id,occurred_at);
create or replace function public.recruitment_apply_coverage(p_token text,p_client_id uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype; x jsonb; t public.recruitment_transcript_turns%rowtype; v_ready boolean;
begin
  a:=public.recruitment_session(p_token,p_client_id);
  for x in select * from jsonb_array_elements(p_result->'topics') loop
    select * into t from public.recruitment_transcript_turns where attempt_id=a.id and turn_number=(x->>'turn_number')::integer and speaker='candidate';
    if t.id is not null then update public.recruitment_topic_coverage set state='covered',evidence_turn_id=t.id,updated_at=clock_timestamp() where attempt_id=a.id and topic_index=(x->>'index')::integer and state='unresolved'; end if;
  end loop;
  for x in select * from jsonb_array_elements(p_result->'scenarios') loop
    select * into t from public.recruitment_transcript_turns where attempt_id=a.id and turn_number=(x->>'turn_number')::integer and speaker=case when x->>'state'='asked' then 'ai' else 'candidate' end;
    if x->>'state' not in ('asked','answered') then continue; end if;
    if t.id is not null and x->>'state'='asked' then
      update public.recruitment_scenario_progress set state='asked',asked_turn_id=t.id,evidence_turn_id=t.id,updated_at=clock_timestamp() where attempt_id=a.id and scenario_index=(x->>'index')::integer and state='pending';
    elsif t.id is not null and x->>'state'='answered' then
      update public.recruitment_scenario_progress s set state='answered',evidence_turn_id=t.id,updated_at=clock_timestamp() where s.attempt_id=a.id and s.scenario_index=(x->>'index')::integer and exists(select 1 from public.recruitment_transcript_turns asked where asked.id=s.asked_turn_id and asked.speaker='ai' and asked.turn_number<t.turn_number);
    end if;
  end loop;
  v_ready:=not exists(select 1 from public.recruitment_topic_coverage where attempt_id=a.id and state<>'covered') and not exists(select 1 from public.recruitment_scenario_progress where attempt_id=a.id and state<>'answered');
  return jsonb_build_object('can_finish',v_ready or a.max_ends_at<=clock_timestamp(),'coverage_complete',v_ready,'max_reached',a.max_ends_at<=clock_timestamp(),'unresolved_topics',coalesce((select jsonb_agg(topic order by topic_index) from public.recruitment_topic_coverage where attempt_id=a.id and state='unresolved'),'[]'::jsonb),'pending_scenarios',coalesce((select jsonb_agg(brief order by scenario_index) from public.recruitment_scenario_progress where attempt_id=a.id and state<>'answered'),'[]'::jsonb));
end $$;

create or replace function public.recruitment_public_heartbeat(p_token text,p_client_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_attempt public.recruitment_interview_attempts%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_client_id is null then raise exception using errcode='22023',message='Interview session identifier is required.'; end if;
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  select * into v_attempt from public.recruitment_interview_attempts where id=v_attempt.id for update;
  if v_attempt.lease_owner is distinct from p_client_id or v_attempt.lease_expires_at<=v_now or v_attempt.status not in ('starting','interviewing','interrupted','finalizing') then
    raise exception using errcode='42501',message='Interview session is unavailable.';
  end if;
  update public.recruitment_interview_attempts set status=case when max_ends_at<=v_now then 'finalizing' else status end,interview_ended_at=case when max_ends_at<=v_now then coalesce(interview_ended_at,max_ends_at) else interview_ended_at end,completion_reason=case when max_ends_at<=v_now then coalesce(completion_reason,'max_duration') else completion_reason end,lease_expires_at=v_now+interval '45 seconds',last_heartbeat_at=v_now where id=v_attempt.id;
  return jsonb_build_object('status',case when v_attempt.max_ends_at<=v_now then 'finalizing' else v_attempt.status end,'max_ends_at',v_attempt.max_ends_at);
end $$;

