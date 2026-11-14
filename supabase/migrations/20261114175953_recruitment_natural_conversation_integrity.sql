-- Preserve existing ACLs and historical rows.
CREATE OR REPLACE FUNCTION public.recruitment_recording_access(p_token text, p_client_id uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.recruitment_interview_attempts%rowtype; u public.recruitment_recording_units%rowtype; n bigint;
begin
 if p_action in ('invalid','recover_acknowledged') then
   a:=recruitment_session(p_token,p_client_id);
   select * into u from recruitment_recording_units where id=(p_payload->>'unit_id')::uuid and attempt_id=a.id for update;
   if not found then raise exception using errcode='42501',message='Recording unavailable.'; end if;
   if p_action='invalid' then
     if u.status not in ('verified','invalid') then
       update recruitment_recording_units set status='invalid',ended_at=coalesce(ended_at,clock_timestamp()),
         end_reason=case when p_payload->>'reason' in ('missing_media','invalid_encoding','recorder_stop_unconfirmed')
           then p_payload->>'reason' else 'invalid_media' end where id=u.id returning * into u;
     end if;
   elsif u.expected_bytes is null and u.status='interrupted' then
     select sum(expected_bytes) into n from recruitment_recording_chunks where unit_id=u.id
       having count(*)>0 and count(*)=count(acknowledged_at) and min(chunk_index)=0 and max(chunk_index)=count(*)-1;
     if n is null then raise exception using errcode='55000',message='Recording chunks are incomplete.'; end if;
     update recruitment_recording_units set status='pending',expected_bytes=n,
       end_reason='acknowledged_chunks_recovered' where id=u.id returning * into u;
   end if;
   return to_jsonb(u);
 end if;
 if p_action='open' and p_payload ? 'recovery_id' then
   a:=recruitment_public_attempt(p_token);
   select * into a from recruitment_interview_attempts where id=a.id for update;
   if a.recovery_id is distinct from (p_payload->>'recovery_id')::uuid or a.paused_at is not null then raise exception using errcode='40001',message='Recovery was replaced.'; end if;
 end if;
 return recruitment_recording_access_before_recovery(p_token,p_client_id,p_action,p_payload);
end $function$;
CREATE OR REPLACE FUNCTION public.recruitment_report_enqueue(p_attempt_id uuid, p_request_id uuid, p_new_version boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a recruitment_interview_attempts%rowtype; r recruitment_reports%rowtype; source jsonb; rid uuid;
begin
 if p_request_id is null then raise exception 'Request ID required.'; end if;
 select * into a from recruitment_interview_attempts where id=p_attempt_id for update;
 source:=recruitment_report_source(a.id);
 if source is null then raise exception using errcode='55000',message='Finalize the interview before generating a report.'; end if;
 select * into r from recruitment_reports where request_id=p_request_id;
 if found then if r.attempt_id<>a.id then raise exception 'Conflicting report retry.'; end if; return r.id; end if;
 select * into r from recruitment_reports where attempt_id=a.id order by version desc limit 1;
 if found and not p_new_version then return r.id; end if;
 insert into recruitment_reports(attempt_id,version,request_id,source_snapshot,source_hash,status,body,finished_at)
 values(a.id,coalesce(r.version,0)+1,p_request_id,source,encode(extensions.digest(source::text,'sha256'),'hex'),
 case when not exists(select 1 from jsonb_array_elements(source->'turns') t where t->>'speaker'='candidate') then 'unusable' else 'queued' end,
 case when not exists(select 1 from jsonb_array_elements(source->'turns') t where t->>'speaker'='candidate') then jsonb_build_object('unusable_reason','Insufficient evidence. No eligible candidate turns are available for assessment. Review the available recording.') end,
 case when not exists(select 1 from jsonb_array_elements(source->'turns') t where t->>'speaker'='candidate') then clock_timestamp() end) returning id into rid;
 return rid;
end $function$;

-- Appended by a scoped HR reviewer after listening to source media.
create unique index recruitment_natural_voice_review_turn
 on public.recruitment_events(attempt_id,(details->>'turn_id'))
 where action='natural_voice_turn_reviewed';

create function public.recruitment_review_natural_turn(p_turn_id bigint, p_recording_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=recruitment_actor('recruitment.manage');
 t recruitment_transcript_turns%rowtype;
 a recruitment_interview_attempts%rowtype;
 u recruitment_recording_units%rowtype;
begin
 select * into t from recruitment_transcript_turns where id=p_turn_id;
 select * into a from recruitment_interview_attempts where id=t.attempt_id for update;
 if a.id is null or a.status not in ('partial','completed') or not exists(
   select 1 from recruitment_openings o where o.id=a.opening_id and o.test_profile_id is not null
   and recruitment_opening_in_scope(o.outlet_id)
 ) or not exists(select 1 from recruitment_events where attempt_id=a.id and action='natural_voice_qa'
   and details->>'evidence_review'='v1') then
   raise exception using errcode='42501',message='Interview evidence review unavailable.';
 end if;
 select * into u from recruitment_recording_units where id=p_recording_id and attempt_id=a.id and status='verified'
   and elapsed_end_ms>elapsed_start_ms
   and (case when t.speaker='candidate' then t.elapsed_start_ms else t.elapsed_end_ms end)>=elapsed_start_ms
   and t.elapsed_end_ms<=elapsed_end_ms;
 if u.id is null or not exists (
   select 1 from recruitment_realtime_traces r where r.attempt_id=a.id and r.provider_generation=t.provider_generation
    and r.record->>'type'='transport.connected' and r.record->>'item_id'=u.id::text
 ) or exists (
   select 1 from recruitment_transcript_annotations x where x.attempt_id=a.id
    and x.provider_generation=t.provider_generation and x.provider_item_id=t.provider_item_id
    and x.kind in ('truncated','transcription_failed','unverified_candidate')
 ) or not (
   t.speaker='candidate' and exists(
     select 1 from recruitment_realtime_traces r where r.attempt_id=a.id and r.provider_generation=t.provider_generation
       and r.record->>'item_id'=t.provider_item_id and r.record->>'phase'='natural_candidate_reviewable'
   ) or t.speaker='ai' and exists(
     select 1 from recruitment_realtime_traces r where r.attempt_id=a.id and r.provider_generation=t.provider_generation
       and r.record->>'item_id'=t.provider_item_id and r.record->>'phase'='dialogue_committed'
   )
 ) then raise exception using errcode='22023',message='Turn cannot be corroborated by the linked recording.'; end if;
 insert into recruitment_events(attempt_id,application_id,opening_id,actor_employee_id,action,details)
 values(a.id,a.application_id,a.opening_id,actor,'natural_voice_turn_reviewed',
   jsonb_build_object('turn_id',t.id,'unit_id',u.id,'generation',t.provider_generation,'item_id',t.provider_item_id))
 on conflict do nothing;
end $$;
revoke all on function public.recruitment_review_natural_turn(bigint,uuid) from public,anon,authenticated;
grant execute on function public.recruitment_review_natural_turn(bigint,uuid) to authenticated;

create or replace function public.recruitment_turn_eligible(p_attempt uuid,p_turn bigint) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
   select 1 from recruitment_transcript_turns t
   where t.id=p_turn and t.attempt_id=p_attempt
   and not exists(
     select 1 from recruitment_transcript_annotations a
     where a.attempt_id=t.attempt_id and a.provider_generation=t.provider_generation
       and a.provider_item_id=t.provider_item_id
       and a.kind in ('unverified_candidate','transcription_failed','truncated')
   )
   and (
     not exists(select 1 from recruitment_events where attempt_id=t.attempt_id and action='natural_voice_qa')
     or exists(select 1 from recruitment_events where attempt_id=t.attempt_id
       and action='natural_voice_turn_reviewed' and details->>'turn_id'=t.id::text)
   )
 );
$$;
-- Both live and post-interview coverage use the same rule and citation checks.
CREATE OR REPLACE FUNCTION public.recruitment_apply_coverage_for_attempt(p_attempt_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.recruitment_interview_attempts%rowtype; x jsonb; t public.recruitment_transcript_turns%rowtype; v_ready boolean; v_state text;
begin
  select * into strict a from public.recruitment_interview_attempts where id=p_attempt_id for update;
  for x in select * from jsonb_array_elements(p_result->'topics') loop
    select * into t from public.recruitment_transcript_turns where attempt_id=a.id and turn_number=(x->>'turn_number')::integer and speaker='candidate' and recruitment_turn_eligible(a.id,id);
    v_state:=coalesce(x->>'state','covered');
    if v_state not in ('partial','covered') or length(coalesce(x->>'reason','Supported candidate evidence')) not between 1 and 1000 then raise exception using errcode='22023',message='Coverage finding is invalid.'; end if;
    if t.id is not null then
     insert into recruitment_coverage_findings(attempt_id,topic_index,state,evidence_turn_id,reason)
     select a.id,c.topic_index,v_state,t.id,coalesce(x->>'reason','Supported candidate evidence') from recruitment_topic_coverage c
     where c.attempt_id=a.id and c.topic_index=(x->>'index')::integer and (c.state<>'covered' or v_state='covered') on conflict do nothing;
     update public.recruitment_topic_coverage set state=v_state,evidence_turn_id=t.id,updated_at=clock_timestamp()
     where attempt_id=a.id and topic_index=(x->>'index')::integer and (state='unresolved' or (state='partial' and v_state='covered') or (state=v_state and t.turn_number>(select prior.turn_number from recruitment_transcript_turns prior where prior.id=recruitment_topic_coverage.evidence_turn_id)));
    end if;
  end loop;
  for x in select * from jsonb_array_elements(p_result->'scenarios') loop
    select * into t from public.recruitment_transcript_turns where attempt_id=a.id and turn_number=(x->>'turn_number')::integer and speaker=case when x->>'state'='asked' then 'ai' else 'candidate' end and recruitment_turn_eligible(a.id,id);
    if x->>'state' not in ('asked','answered') then continue; end if;
    if t.id is not null and x->>'state'='asked' then
      update public.recruitment_scenario_progress set state='asked',asked_turn_id=t.id,evidence_turn_id=t.id,updated_at=clock_timestamp() where attempt_id=a.id and scenario_index=(x->>'index')::integer and state='pending';
    elsif t.id is not null and x->>'state'='answered' then
      update public.recruitment_scenario_progress s set state='answered',evidence_turn_id=t.id,updated_at=clock_timestamp() where s.attempt_id=a.id and s.scenario_index=(x->>'index')::integer and exists(select 1 from public.recruitment_transcript_turns asked where asked.id=s.asked_turn_id and asked.speaker='ai' and asked.turn_number<t.turn_number and recruitment_turn_eligible(a.id,asked.id));
    end if;
  end loop;
  for x in select value from jsonb_array_elements(coalesce(p_result->'equivalent_scenarios','[]'::jsonb)) loop
    select * into t from recruitment_transcript_turns where attempt_id=a.id and speaker='candidate' and turn_number=(x->>'turn_number')::integer and recruitment_turn_eligible(a.id,id);
    if t.id is not null then
      update recruitment_scenario_progress s set equivalent_turn_id=t.id,updated_at=clock_timestamp()
      from recruitment_interview_configs c join recruitment_interview_profiles p on p.id=c.interview_profile_id
      where c.id=a.config_version_id and s.attempt_id=a.id and s.scenario_index=(x->>'index')::integer and p.definition->'scenarios'->s.scenario_index->>'required'='false';
    end if;
  end loop;
  v_ready:=recruitment_coverage_complete(a.id);
  return jsonb_build_object('can_finish',v_ready or a.max_ends_at<=clock_timestamp(),'coverage_complete',v_ready,'max_reached',a.max_ends_at<=clock_timestamp(),'unresolved_topics',coalesce((select jsonb_agg(topic order by topic_index) from public.recruitment_topic_coverage where attempt_id=a.id and state<>'covered'),'[]'::jsonb),'pending_scenarios',coalesce((select jsonb_agg(brief order by scenario_index) from public.recruitment_scenario_progress where attempt_id=a.id and state<>'answered' and equivalent_turn_id is null),'[]'::jsonb));
end $function$;
revoke all on function public.recruitment_apply_coverage_for_attempt(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.recruitment_apply_coverage_for_attempt(uuid,jsonb) to service_role;

create or replace function public.recruitment_apply_coverage_pre_provenance(p_token text,p_client_id uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a recruitment_interview_attempts%rowtype;
begin
 a:=recruitment_session(p_token,p_client_id);
 return recruitment_apply_coverage_for_attempt(a.id,p_result);
end $$;
