-- Refresh the current citation projection for newer equally sufficient evidence.
-- Findings stay immutable; no progress regression or historical transcript rewrite.
create or replace function public.recruitment_apply_coverage(p_token text,p_client_id uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype; x jsonb; t public.recruitment_transcript_turns%rowtype; v_ready boolean; v_state text;
begin
  a:=public.recruitment_session(p_token,p_client_id);
  for x in select * from jsonb_array_elements(p_result->'topics') loop
    select * into t from public.recruitment_transcript_turns where attempt_id=a.id and turn_number=(x->>'turn_number')::integer and speaker='candidate';
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
    select * into t from public.recruitment_transcript_turns where attempt_id=a.id and turn_number=(x->>'turn_number')::integer and speaker=case when x->>'state'='asked' then 'ai' else 'candidate' end;
    if x->>'state' not in ('asked','answered') then continue; end if;
    if t.id is not null and x->>'state'='asked' then
      update public.recruitment_scenario_progress set state='asked',asked_turn_id=t.id,evidence_turn_id=t.id,updated_at=clock_timestamp() where attempt_id=a.id and scenario_index=(x->>'index')::integer and state='pending';
    elsif t.id is not null and x->>'state'='answered' then
      update public.recruitment_scenario_progress s set state='answered',evidence_turn_id=t.id,updated_at=clock_timestamp() where s.attempt_id=a.id and s.scenario_index=(x->>'index')::integer and exists(select 1 from public.recruitment_transcript_turns asked where asked.id=s.asked_turn_id and asked.speaker='ai' and asked.turn_number<t.turn_number);
    end if;
  end loop;
  v_ready:=recruitment_coverage_complete(a.id);
  return jsonb_build_object('can_finish',v_ready or a.max_ends_at<=clock_timestamp(),'coverage_complete',v_ready,'max_reached',a.max_ends_at<=clock_timestamp(),'unresolved_topics',coalesce((select jsonb_agg(topic order by topic_index) from public.recruitment_topic_coverage where attempt_id=a.id and state<>'covered'),'[]'::jsonb),'pending_scenarios',coalesce((select jsonb_agg(brief order by scenario_index) from public.recruitment_scenario_progress where attempt_id=a.id and state<>'answered'),'[]'::jsonb));
end $$;

