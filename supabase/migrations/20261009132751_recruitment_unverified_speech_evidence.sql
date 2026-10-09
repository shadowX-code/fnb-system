-- Append-only provenance classification. Original text/media/report snapshots stay immutable.
alter table public.recruitment_transcript_annotations drop constraint recruitment_transcript_annotations_kind_check;
alter table public.recruitment_transcript_annotations add constraint recruitment_transcript_annotations_kind_check
 check (kind in ('truncated','transcription_failed','unverified_candidate'));

create function public.recruitment_turn_eligible(p_attempt uuid,p_turn bigint) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from recruitment_transcript_turns t where t.id=p_turn and t.attempt_id=p_attempt
 and not exists(select 1 from recruitment_transcript_annotations a where a.attempt_id=t.attempt_id
 and a.provider_generation=t.provider_generation and a.provider_item_id=t.provider_item_id
 and a.kind in ('unverified_candidate','transcription_failed','truncated')));
$$;
revoke all on function public.recruitment_turn_eligible(uuid,bigint) from public,anon,authenticated;

create function public.recruitment_eligible_context(p_source jsonb,p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb:=p_source; key text;
begin
 if result is null then return null; end if;
 result:=jsonb_set(result,'{turns}',coalesce((select jsonb_agg(t order by (t->>'turn_number')::int)
 from jsonb_array_elements(result->'turns') t where recruitment_turn_eligible(p_attempt,(t->>'id')::bigint)),'[]'));
 for key in select unnest(array['topics','scenarios']) loop
  result:=jsonb_set(result,array[key],coalesce((select jsonb_agg(
    case when (t->>'evidence_turn_id' is not null and not recruitment_turn_eligible(p_attempt,(t->>'evidence_turn_id')::bigint))
      or (t->>'asked_turn_id' is not null and not recruitment_turn_eligible(p_attempt,(t->>'asked_turn_id')::bigint))
      or (t->>'equivalent_turn_id' is not null and not recruitment_turn_eligible(p_attempt,(t->>'equivalent_turn_id')::bigint))
    then t||jsonb_build_object('state',case when key='topics' then 'unresolved' else 'pending' end,'evidence_turn_id',null,'asked_turn_id',null,'equivalent_turn_id',null)
    else t end)
    from jsonb_array_elements(coalesce(result->key,'[]')) t),'[]'));
 end loop;
 if result ? 'current_findings' then result:=jsonb_set(result,'{current_findings}',coalesce((select jsonb_agg(f)
  from jsonb_array_elements(result->'current_findings') f where recruitment_turn_eligible(p_attempt,(f->>'evidence_turn_id')::bigint)),'[]')); end if;
 return result;
end $$;
revoke all on function public.recruitment_eligible_context(jsonb,uuid) from public,anon,authenticated;

alter function public.recruitment_assessment_context(text,uuid,boolean) rename to recruitment_assessment_context_pre_provenance;
create function public.recruitment_assessment_context(p_token text,p_client_id uuid,p_for_coverage boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s jsonb:=recruitment_assessment_context_pre_provenance(p_token,p_client_id,p_for_coverage);
begin return recruitment_eligible_context(s,(s->>'attempt_id')::uuid); end $$;
revoke all on function public.recruitment_assessment_context_pre_provenance(text,uuid,boolean),public.recruitment_assessment_context(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.recruitment_assessment_context(text,uuid,boolean) to service_role;

alter function public.recruitment_report_source(uuid) rename to recruitment_report_source_pre_provenance;
create function public.recruitment_report_source(p_attempt_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select recruitment_eligible_context(recruitment_report_source_pre_provenance(p_attempt_id),p_attempt_id);
$$;
revoke all on function public.recruitment_report_source_pre_provenance(uuid),public.recruitment_report_source(uuid) from public,anon,authenticated;
grant execute on function public.recruitment_report_source(uuid) to service_role;

alter function public.recruitment_apply_coverage(text,uuid,jsonb) rename to recruitment_apply_coverage_pre_provenance;
create function public.recruitment_apply_coverage(p_token text,p_client_id uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a recruitment_interview_attempts%rowtype; x jsonb;
begin
 a:=recruitment_session(p_token,p_client_id);
 for x in select value from jsonb_array_elements(coalesce(p_result->'topics','[]')||coalesce(p_result->'scenarios','[]')||coalesce(p_result->'equivalent_scenarios','[]')) loop
  if not exists(select 1 from recruitment_transcript_turns t where t.attempt_id=a.id and t.turn_number=(x->>'turn_number')::int and recruitment_turn_eligible(a.id,t.id)) then
   raise exception using errcode='22023',message='Unverified transcript cannot support coverage.';
  end if;
 end loop;
 return recruitment_apply_coverage_pre_provenance(p_token,p_client_id,p_result);
end $$;
revoke all on function public.recruitment_apply_coverage_pre_provenance(text,uuid,jsonb),public.recruitment_apply_coverage(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.recruitment_apply_coverage(text,uuid,jsonb) to service_role;

alter function public.recruitment_coverage_complete(uuid) rename to recruitment_coverage_complete_pre_provenance;
create function public.recruitment_coverage_complete(p_attempt_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select recruitment_coverage_complete_pre_provenance(p_attempt_id)
 and not exists(select 1 from recruitment_topic_coverage c where c.attempt_id=p_attempt_id and c.evidence_turn_id is not null and not recruitment_turn_eligible(p_attempt_id,c.evidence_turn_id))
 and not exists(select 1 from recruitment_scenario_progress s where s.attempt_id=p_attempt_id and
 ((s.evidence_turn_id is not null and not recruitment_turn_eligible(p_attempt_id,s.evidence_turn_id))
 or (s.asked_turn_id is not null and not recruitment_turn_eligible(p_attempt_id,s.asked_turn_id))
 or (s.equivalent_turn_id is not null and not recruitment_turn_eligible(p_attempt_id,s.equivalent_turn_id))));
$$;
revoke all on function public.recruitment_coverage_complete_pre_provenance(uuid),public.recruitment_coverage_complete(uuid) from public,anon,authenticated;


-- Manager-controlled append-only dispute, reusing Recruitment actor/outlet scope.
create function public.recruitment_dispute_transcript(p_turn_id bigint,p_reason text) returns void
language plpgsql security definer set search_path=public as $$
declare actor uuid:=recruitment_actor('recruitment.manage'); t recruitment_transcript_turns%rowtype; a recruitment_interview_attempts%rowtype; added int;
begin
 if length(btrim(coalesce(p_reason,''))) not between 10 and 500 then raise exception using errcode='22023',message='Provide a concise reason for disputed attribution.'; end if;
 select * into t from recruitment_transcript_turns where id=p_turn_id and speaker='candidate';
 select * into a from recruitment_interview_attempts where id=t.attempt_id;
 if a.id is null or not exists(select 1 from recruitment_openings o where o.id=a.opening_id and recruitment_opening_in_scope(o.outlet_id)) then raise exception using errcode='42501',message='Interview unavailable.'; end if;
 insert into recruitment_transcript_annotations(attempt_id,provider_generation,provider_item_id,kind,elapsed_ms)
 values(t.attempt_id,t.provider_generation,t.provider_item_id,'unverified_candidate',coalesce(t.elapsed_end_ms,0)) on conflict do nothing;
 get diagnostics added=row_count;
 if added>0 then insert into recruitment_events(attempt_id,application_id,opening_id,actor_employee_id,action,details)
 values(a.id,a.application_id,a.opening_id,actor,'transcript_provenance_disputed',jsonb_build_object('turn_id',t.id,'reason',btrim(p_reason))); end if;
end $$;
revoke all on function public.recruitment_dispute_transcript(bigint,text) from public,anon,authenticated;
grant execute on function public.recruitment_dispute_transcript(bigint,text) to authenticated;

alter function public.recruitment_observe_preference(text,uuid,text,integer,text) rename to recruitment_observe_preference_pre_provenance;
create function public.recruitment_observe_preference(p_token text,p_client_id uuid,p_preference text,p_turn_number integer,p_quote text) returns void
language plpgsql security definer set search_path=public as $$
declare a recruitment_interview_attempts%rowtype:=recruitment_session(p_token,p_client_id);
begin
 if not exists(select 1 from recruitment_transcript_turns t where t.attempt_id=a.id and t.turn_number=p_turn_number and t.speaker='candidate' and recruitment_turn_eligible(a.id,t.id)) then raise exception using errcode='22023',message='Unverified transcript cannot establish preference.'; end if;
 perform recruitment_observe_preference_pre_provenance(p_token,p_client_id,p_preference,p_turn_number,p_quote);
end $$;
revoke all on function public.recruitment_observe_preference_pre_provenance(text,uuid,text,integer,text),public.recruitment_observe_preference(text,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.recruitment_observe_preference(text,uuid,text,integer,text) to service_role;

-- A dispute that arrives during generation must also fence report persistence.
-- Finished historical reports are never touched.
alter function public.recruitment_report_finish(uuid,uuid,jsonb,text,text) rename to recruitment_report_finish_pre_provenance;
create function public.recruitment_report_finish(p_report_id uuid,p_generation_id uuid,p_body jsonb,p_response_id text,p_error_code text default null) returns void
language plpgsql security definer set search_path=public as $$
declare r recruitment_reports%rowtype; citation jsonb;
begin
 select * into r from recruitment_reports where id=p_report_id for update;
 if p_error_code is null then
  for citation in select jsonb_path_query(p_body,'$.**.turn_id') loop
   if not recruitment_turn_eligible(r.attempt_id,(citation#>>'{}')::bigint) then raise exception using errcode='22023',message='Unverified transcript cannot support report findings.'; end if;
  end loop;
 end if;
 perform recruitment_report_finish_pre_provenance(p_report_id,p_generation_id,p_body,p_response_id,p_error_code);
end $$;
revoke all on function public.recruitment_report_finish_pre_provenance(uuid,uuid,jsonb,text,text),public.recruitment_report_finish(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.recruitment_report_finish(uuid,uuid,jsonb,text,text) to service_role;
