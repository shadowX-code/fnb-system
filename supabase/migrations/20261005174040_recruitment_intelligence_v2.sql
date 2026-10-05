-- Additive V2 contracts. No existing profile/configuration/evidence is rewritten.
alter table public.recruitment_interview_configs add column job_facts jsonb not null default '{}'::jsonb check(jsonb_typeof(job_facts)='object');

alter function public.recruitment_validate_profile(jsonb) rename to recruitment_validate_profile_v1;
create function public.recruitment_validate_profile(p_definition jsonb) returns void language plpgsql set search_path=public as $$
declare normalized jsonb:=p_definition; x jsonb; k text;
begin
 if p_definition ? 'intelligence_version' then
  if p_definition->>'intelligence_version' is distinct from '2' then raise exception 'Unsupported profile intelligence version.'; end if;
  for x in select value from jsonb_array_elements(p_definition->'evidence_areas') loop
   foreach k in array array['goal','evidence_guidance','follow_up_signals','stop_condition'] loop
    if jsonb_typeof(x->k) is distinct from 'string' or length(btrim(x->>k)) not between 10 and 1000 then raise exception 'Evidence guidance is incomplete.'; end if;
   end loop;
  end loop;
  for x in select value from jsonb_array_elements(p_definition->'scenarios') loop
   foreach k in array array['brief','purpose','when_to_use','follow_up_guidance','stop_condition'] loop
    if jsonb_typeof(x->k) is distinct from 'string' or length(btrim(x->>k)) not between 10 and 1000 then raise exception 'Scenario guidance is incomplete.'; end if;
   end loop;
   if jsonb_typeof(x->'required') is distinct from 'boolean' or jsonb_typeof(x->'evidence_areas') is distinct from 'array' or jsonb_array_length(x->'evidence_areas')=0 or exists(select 1 from jsonb_array_elements_text(x->'evidence_areas') n where not exists(select 1 from jsonb_array_elements(p_definition->'evidence_areas') a where a->>'name'=n)) then raise exception 'Scenario evidence references are invalid.'; end if;
  end loop;
  normalized:=p_definition||jsonb_build_object('evidence_areas',(select jsonb_agg(value||jsonb_build_object('intent',value->>'goal') order by ordinality) from jsonb_array_elements(p_definition->'evidence_areas') with ordinality),'scenarios',coalesce((select jsonb_agg(value->>'brief' order by ordinality) from jsonb_array_elements(p_definition->'scenarios') with ordinality),'[]'::jsonb));
 end if;
 perform recruitment_validate_profile_v1(normalized);
end $$;
revoke all on function public.recruitment_validate_profile(jsonb) from public,anon,authenticated;

create or replace function public.recruitment_save_opening(p_opening jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.recruitment_actor('recruitment.manage'); v_id uuid:=nullif(p_opening->>'id','')::uuid; v_old public.recruitment_openings%rowtype; v_position public.job_positions%rowtype; v_entity public.legal_entities%rowtype; v_outlet public.outlets%rowtype; v_status text:=coalesce(p_opening->>'status','draft'); v_workplace text; v_outlet_id uuid:=nullif(p_opening->>'outlet_id','')::uuid; v_facts jsonb:=coalesce(p_opening->'config'->'job_facts','{}'::jsonb); v_config jsonb:=coalesce(p_opening->'config','{}'::jsonb); v_version integer; v_profile recruitment_interview_profiles%rowtype; v_requirements jsonb:=coalesce(p_opening->'config'->'opening_requirements','{}'::jsonb);
begin
  if jsonb_typeof(v_facts) is distinct from 'object' or pg_column_size(v_facts)>8000 or exists(select 1 from jsonb_each(v_facts) x where x.key not in ('employment_type','job_scope','offered_salary','working_hours','shift_arrangement','public_holidays','benefits','additional_facts') or jsonb_typeof(x.value)<>'string' or length(btrim(x.value#>>'{}')) not between 1 and 1000) then raise exception using errcode='22023',message='Confirmed job information is invalid.'; end if;
  if jsonb_typeof(v_requirements) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_requirements) k where k not in ('weekend_required','closing_shift','preferred_start')) or (v_requirements ? 'weekend_required' and jsonb_typeof(v_requirements->'weekend_required')<>'boolean') or (v_requirements ? 'closing_shift' and (jsonb_typeof(v_requirements->'closing_shift')<>'string' or length(v_requirements->>'closing_shift')>240)) or (v_requirements ? 'preferred_start' and (jsonb_typeof(v_requirements->'preferred_start')<>'string' or length(v_requirements->>'preferred_start')>240)) then raise exception using errcode='22023',message='Opening requirements are invalid.'; end if;
  if nullif(v_config->>'interview_profile_id','') is not null then
   select * into v_profile from recruitment_interview_profiles where id=(v_config->>'interview_profile_id')::uuid;
   if v_profile.id is null then raise exception using errcode='22023',message='Choose a published Interview Profile version.'; end if;
   -- Profile owns evidence, guidance and durations; client-supplied copies are ignored.
   v_config:=v_config||jsonb_build_object('required_topics',(select jsonb_agg(value->>'name' order by ordinality) from jsonb_array_elements(v_profile.definition->'evidence_areas') with ordinality), 'scenario_briefs',coalesce((select jsonb_agg(case when jsonb_typeof(value)='string' then value#>>'{}' else value->>'brief' end order by ordinality) from jsonb_array_elements(v_profile.definition->'scenarios') with ordinality),'[]'::jsonb),'target_minutes',v_profile.definition->'target_minutes','max_minutes',v_profile.definition->'max_minutes','interview_instructions',v_profile.definition->>'follow_up_guidance');
  elsif v_id is null or exists(select 1 from recruitment_interview_configs c join recruitment_openings o on o.id=c.opening_id and o.config_version=c.version where o.id=v_id and c.interview_profile_id is not null) then
   raise exception using errcode='22023',message='Choose an Interview Profile version.';
  end if;
  select * into v_position from public.job_positions where id=(p_opening->>'position_id')::uuid;
  select * into v_entity from public.legal_entities where id=(p_opening->>'legal_entity_id')::uuid;
  if v_position.id is null or v_entity.id is null or (v_status<>'closed' and (v_position.status<>'active' or not v_entity.is_active)) then raise exception using errcode='22023',message='Choose an active Position and Legal Entity.'; end if;
  if v_outlet_id is not null then
    select * into v_outlet from public.outlets where id=v_outlet_id;
    if v_outlet.id is null or not public.recruitment_opening_in_scope(v_outlet_id) then raise exception using errcode='42501',message='Workplace is unavailable.'; end if;
    v_workplace:=v_outlet.name;
  else
    v_workplace:=p_opening->>'workplace';
    if v_workplace not in ('Factory','Management') then raise exception using errcode='22023',message='Choose a canonical workplace.'; end if;
  end if;
  if v_status not in ('draft','open','closed') or length(btrim(coalesce(p_opening->>'title',''))) not between 3 and 160 then raise exception using errcode='22023',message='Opening title or status is invalid.'; end if;
  if jsonb_typeof(v_config->'required_topics') is distinct from 'array' or jsonb_array_length(v_config->'required_topics')<1 or jsonb_array_length(v_config->'required_topics')>30 or jsonb_typeof(v_config->'scenario_briefs') is distinct from 'array' or jsonb_array_length(v_config->'scenario_briefs')>20 or length(coalesce(v_config->>'interview_instructions',''))>4000 or length(coalesce(v_config->>'candidate_instructions',''))>2000 or length(coalesce(v_config->>'language_guidance',''))>1000 then raise exception using errcode='22023',message='Interview configuration is invalid.'; end if;
  if exists(select 1 from jsonb_array_elements(v_config->'required_topics') x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 3 and 240)
    or exists(select 1 from jsonb_array_elements(v_config->'scenario_briefs') x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 3 and 1000) then raise exception using errcode='22023',message='Topics and scenarios must be concise text.'; end if;
  if (v_config->>'target_minutes')::integer not between 5 and 90 or (v_config->>'max_minutes')::integer not between (v_config->>'target_minutes')::integer and 120 then raise exception using errcode='22023',message='Interview duration is invalid.'; end if;
  if v_id is null then
    insert into public.recruitment_openings(title,position_id,outlet_id,workplace,legal_entity_id,description,status,created_by,updated_by)
    values(btrim(p_opening->>'title'),v_position.id,v_outlet_id,v_workplace,v_entity.id,coalesce(p_opening->>'description',''),v_status,v_actor,v_actor) returning id into v_id;
    v_version:=1;
  else
    select * into v_old from public.recruitment_openings where id=v_id for update;
    if v_old.id is null or not public.recruitment_opening_in_scope(v_old.outlet_id) then raise exception using errcode='42501',message='Opening is unavailable.'; end if;
    if v_old.status='closed' and v_status<>'closed' then raise exception using errcode='55000',message='Closed openings cannot be reopened.'; end if;
    if exists(select 1 from public.recruitment_applications where opening_id=v_id) and (v_old.position_id,v_old.outlet_id,v_old.workplace,v_old.legal_entity_id) is distinct from (v_position.id,v_outlet_id,v_workplace,v_entity.id) then raise exception using errcode='55000',message='Position, workplace and legal employer are fixed after applications exist.'; end if;
    v_version:=v_old.config_version+1;
    update public.recruitment_openings set title=btrim(p_opening->>'title'),position_id=v_position.id,outlet_id=v_outlet_id,workplace=v_workplace,legal_entity_id=v_entity.id,description=coalesce(p_opening->>'description',''),status=v_status,config_version=v_version,updated_by=v_actor,updated_at=clock_timestamp() where id=v_id;
  end if;
  insert into public.recruitment_interview_configs(opening_id,version,required_topics,scenario_briefs,language_guidance,target_minutes,max_minutes,candidate_instructions,interview_instructions,created_by,interview_profile_id,opening_requirements,job_facts)
  values(v_id,v_version,v_config->'required_topics',v_config->'scenario_briefs',coalesce(v_config->>'language_guidance',''),(v_config->>'target_minutes')::integer,(v_config->>'max_minutes')::integer,coalesce(v_config->>'candidate_instructions',''),coalesce(v_config->>'interview_instructions',''),v_actor,v_profile.id,v_requirements,v_facts);
  insert into public.recruitment_events(opening_id,action,actor_employee_id,details) values(v_id,'opening_saved',v_actor,jsonb_build_object('status',v_status,'config_version',v_version));
  return v_id;
end $$;


-- Optional V2 scenarios can be satisfied by cited equivalent real evidence.
-- Existing V1 still requires a presented hypothetical followed by an answer.
alter table public.recruitment_scenario_progress add column equivalent_turn_id bigint references public.recruitment_transcript_turns(id);
create or replace function public.recruitment_coverage_complete(p_attempt_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select not exists(
  select 1 from recruitment_interview_attempts a join recruitment_interview_configs c on c.id=a.config_version_id
  left join recruitment_interview_profiles p on p.id=c.interview_profile_id
  cross join lateral jsonb_array_elements(c.required_topics) with ordinality target(topic,n)
  left join recruitment_topic_coverage t on t.attempt_id=a.id and t.topic_index=target.n-1
  where a.id=p_attempt_id and case
   when p.id is null then coalesce(t.state,'unresolved')<>'covered'
   when p.definition->'completion_criteria'->>(p.definition->'evidence_areas'->(target.n::integer-1)->>'priority')='covered' then coalesce(t.state,'unresolved')<>'covered'
   when p.definition->'completion_criteria'->>(p.definition->'evidence_areas'->(target.n::integer-1)->>'priority')='partial' then coalesce(t.state,'unresolved')='unresolved'
   else false end
 ) and not exists(select 1 from recruitment_scenario_progress s join recruitment_interview_attempts a on a.id=s.attempt_id join recruitment_interview_configs c on c.id=a.config_version_id left join recruitment_interview_profiles p on p.id=c.interview_profile_id where s.attempt_id=p_attempt_id and s.state<>'answered' and not (coalesce(p.definition->'scenarios'->s.scenario_index->>'required','true')='false' and s.equivalent_turn_id is not null))
 and exists(select 1 from recruitment_interview_attempts where id=p_attempt_id);
$$;
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
  for x in select value from jsonb_array_elements(coalesce(p_result->'equivalent_scenarios','[]'::jsonb)) loop
    select * into t from recruitment_transcript_turns where attempt_id=a.id and speaker='candidate' and turn_number=(x->>'turn_number')::integer;
    if t.id is not null then
      update recruitment_scenario_progress s set equivalent_turn_id=t.id,updated_at=clock_timestamp()
      from recruitment_interview_configs c join recruitment_interview_profiles p on p.id=c.interview_profile_id
      where c.id=a.config_version_id and s.attempt_id=a.id and s.scenario_index=(x->>'index')::integer and p.definition->'scenarios'->s.scenario_index->>'required'='false';
    end if;
  end loop;
  v_ready:=recruitment_coverage_complete(a.id);
  return jsonb_build_object('can_finish',v_ready or a.max_ends_at<=clock_timestamp(),'coverage_complete',v_ready,'max_reached',a.max_ends_at<=clock_timestamp(),'unresolved_topics',coalesce((select jsonb_agg(topic order by topic_index) from public.recruitment_topic_coverage where attempt_id=a.id and state<>'covered'),'[]'::jsonb),'pending_scenarios',coalesce((select jsonb_agg(brief order by scenario_index) from public.recruitment_scenario_progress where attempt_id=a.id and state<>'answered' and equivalent_turn_id is null),'[]'::jsonb));
end $$;


alter function public.recruitment_assessment_context(text,uuid,boolean) rename to recruitment_assessment_context_v1;
create function public.recruitment_assessment_context(p_token text,p_client_id uuid,p_for_coverage boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb:=recruitment_assessment_context_v1(p_token,p_client_id,p_for_coverage); a recruitment_interview_attempts%rowtype;
begin
 select * into a from recruitment_interview_attempts where id=(result->>'attempt_id')::uuid;
 return result||jsonb_build_object('job_facts',(select job_facts from recruitment_interview_configs where id=a.config_version_id),'current_findings',coalesce((select jsonb_agg(to_jsonb(f)) from (select distinct on (topic_index) topic_index,state,reason,evidence_turn_id from recruitment_coverage_findings where attempt_id=a.id order by topic_index,created_at desc,id desc) f),'[]'::jsonb));
end $$;
revoke all on function public.recruitment_assessment_context_v1(text,uuid,boolean),public.recruitment_assessment_context(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.recruitment_assessment_context(text,uuid,boolean) to service_role;

-- Observations only; immutable provenance, no write path into job facts/profile.
create table public.recruitment_learning_observations (
 id bigint generated always as identity primary key,
 attempt_id uuid not null references public.recruitment_interview_attempts(id),
 config_version_id uuid not null references public.recruitment_interview_configs(id),
 kind text not null check(kind in ('candidate_question','unconfirmed_question','knowledge_gap','repeated_clarification','scenario_usage','unresolved_item','contradiction_verification')),
 observation text not null check(length(observation) between 1 and 1000),
 turn_ids bigint[] not null default '{}',
 source_key text not null,
 captured_at timestamptz not null default clock_timestamp(),
 unique(attempt_id,source_key)
);
alter table public.recruitment_learning_observations enable row level security;
revoke all on public.recruitment_learning_observations from public,anon,authenticated;
revoke all on sequence public.recruitment_learning_observations_id_seq from public,anon,authenticated;
grant select on public.recruitment_learning_observations to service_role;
create trigger recruitment_learning_immutable before update or delete on public.recruitment_learning_observations for each row execute function public.recruitment_immutable_evidence();

create function public.recruitment_capture_learning(p_attempt_id uuid,p_observations jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare a recruitment_interview_attempts%rowtype; x jsonb; ids bigint[]; n integer:=0; added integer;
begin
 select * into a from recruitment_interview_attempts where id=p_attempt_id;
 if a.status not in ('completed','partial','failed') then raise exception 'Learning requires a terminal interview.'; end if;
 if jsonb_typeof(p_observations) is distinct from 'array' or jsonb_array_length(p_observations)>50 then raise exception 'Invalid learning observations.'; end if;
 for x in select value from jsonb_array_elements(p_observations) loop
  ids:=array(select value::bigint from jsonb_array_elements_text(x->'turn_ids'));
  if cardinality(ids)=0 or exists(select 1 from unnest(ids) id where not exists(select 1 from recruitment_transcript_turns t where t.id=id and t.attempt_id=a.id)) then raise exception 'Learning citation is invalid.'; end if;
  if x->>'kind' in ('candidate_question','unconfirmed_question') and not exists(select 1 from recruitment_transcript_turns where id=any(ids) and attempt_id=a.id and speaker='candidate') then raise exception 'Candidate question needs candidate evidence.'; end if;
  insert into recruitment_learning_observations(attempt_id,config_version_id,kind,observation,turn_ids,source_key)
   values(a.id,a.config_version_id,x->>'kind',x->>'observation',ids,encode(extensions.digest((x->>'kind')||':'||array_to_string(ids,','),'sha256'),'hex')) on conflict do nothing;
  get diagnostics added=row_count; n:=n+added;
 end loop;
 return n;
end $$;
revoke all on function public.recruitment_capture_learning(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.recruitment_capture_learning(uuid,jsonb) to service_role;

create function public.recruitment_learning_completion() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status in ('completed','partial','failed') and old.status not in ('completed','partial','failed') then
  insert into recruitment_learning_observations(attempt_id,config_version_id,kind,observation,turn_ids,source_key)
   select new.id,new.config_version_id,'unresolved_item',topic||': '||state,case when evidence_turn_id is null then '{}'::bigint[] else array[evidence_turn_id] end,'topic:'||topic_index from recruitment_topic_coverage where attempt_id=new.id and state<>'covered' on conflict do nothing;
  insert into recruitment_learning_observations(attempt_id,config_version_id,kind,observation,turn_ids,source_key)
   select new.id,new.config_version_id,'scenario_usage',brief||': '||case when equivalent_turn_id is not null then 'equivalent real-world evidence' else state end,array_remove(array[asked_turn_id,evidence_turn_id,equivalent_turn_id],null),'scenario:'||scenario_index from recruitment_scenario_progress where attempt_id=new.id on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function public.recruitment_learning_completion() from public,anon,authenticated;
create trigger recruitment_capture_completion_learning after update of status on public.recruitment_interview_attempts for each row execute function public.recruitment_learning_completion();
