-- Versioned learning plans; existing pinned configuration/evidence is never rewritten.
create table public.recruitment_interview_profiles (
 id uuid primary key default gen_random_uuid(),
 profile_key text not null check(profile_key='service_crew'),
 name text not null default 'Service Crew',
 version integer not null check(version>0),
 definition jsonb not null,
 created_by uuid references public.employees(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(profile_key,version)
);
alter table public.recruitment_interview_profiles enable row level security;
revoke all on public.recruitment_interview_profiles from public,anon,authenticated;
grant select on public.recruitment_interview_profiles to service_role;
create trigger recruitment_profile_immutable before update or delete on public.recruitment_interview_profiles for each row execute function public.recruitment_immutable_evidence();

create function public.recruitment_validate_profile(p_definition jsonb) returns void language plpgsql set search_path=public as $$
declare x jsonb;
begin
 if jsonb_typeof(p_definition) is distinct from 'object' or length(coalesce(p_definition->>'role_context','')) not between 10 and 2000 or length(coalesce(p_definition->>'follow_up_guidance','')) not between 10 and 4000
 or jsonb_typeof(p_definition->'evidence_areas') is distinct from 'array' or jsonb_typeof(p_definition->'scenarios') is distinct from 'array' then raise exception using errcode='22023',message='Profile context, guidance, evidence areas and scenarios are required.'; end if;
 if jsonb_array_length(p_definition->'evidence_areas') not between 1 and 30 or jsonb_array_length(p_definition->'scenarios')>20 then raise exception using errcode='22023',message='Profile evidence or scenarios exceed supported limits.'; end if;
 for x in select value from jsonb_array_elements(p_definition->'evidence_areas') loop
  if jsonb_typeof(x) is distinct from 'object' or length(btrim(coalesce(x->>'name',''))) not between 3 and 240 or length(coalesce(x->>'intent','')) not between 10 and 1000 or coalesce(x->>'priority','') not in ('Core','Important','Optional') then raise exception using errcode='22023',message='Each evidence area needs a name, intent and priority.'; end if;
 end loop;
 if (select count(distinct value->>'name') from jsonb_array_elements(p_definition->'evidence_areas'))<>jsonb_array_length(p_definition->'evidence_areas') or not exists(select 1 from jsonb_array_elements(p_definition->'evidence_areas') where value->>'priority'='Core') then raise exception using errcode='22023',message='Evidence names must be distinct and include a Core area.'; end if;
 if exists(select 1 from jsonb_array_elements(p_definition->'scenarios') scenario(value) where jsonb_typeof(scenario.value)<>'string' or length(btrim(scenario.value#>>'{}')) not between 3 and 1000) then raise exception using errcode='22023',message='Scenario briefs must be concise text.'; end if;
 if jsonb_typeof(p_definition->'completion_criteria') is distinct from 'object' or p_definition->'completion_criteria'->>'scenarios' is distinct from 'answered' or p_definition->'completion_criteria'->>'Core' is distinct from 'covered' or coalesce(p_definition->'completion_criteria'->>'Important','') not in ('partial','covered') or coalesce(p_definition->'completion_criteria'->>'Optional','') not in ('unresolved','partial','covered') then raise exception using errcode='22023',message='Core requires Covered; choose explicit Important and Optional completion requirements.'; end if;
 if coalesce(p_definition->>'target_minutes','') !~ '^[0-9]{1,3}$' or coalesce(p_definition->>'max_minutes','') !~ '^[0-9]{1,3}$' then raise exception using errcode='22023',message='Profile duration is required.'; end if;
 if (p_definition->>'target_minutes')::integer not between 5 and 90 or (p_definition->>'max_minutes')::integer not between (p_definition->>'target_minutes')::integer and 120 then raise exception using errcode='22023',message='Profile duration is invalid.'; end if;
 if pg_column_size(p_definition)>30000 then raise exception using errcode='22023',message='Profile is too large.'; end if;
end $$;
revoke all on function public.recruitment_validate_profile(jsonb) from public,anon,authenticated;
insert into public.recruitment_interview_profiles(profile_key,version,definition) values('service_crew',1,'{"role_context": "Service Crew in a Malaysian F&B outlet: welcome guests, communicate clearly, handle customer needs and work reliably with the team.", "evidence_areas": [{"name": "Customer Handling", "priority": "Core", "intent": "How the candidate listens, explains and responds constructively to customer needs or complaints."}, {"name": "Availability / Start Date", "priority": "Core", "intent": "Concrete earliest start date and known availability constraints."}, {"name": "Shift Flexibility", "priority": "Core", "intent": "Actual availability for the opening’s shifts, weekends and closing requirements; clarify constraints without judging personal circumstances."}, {"name": "Relevant Work Experience", "priority": "Important", "intent": "Concrete F&B or transferable customer/team responsibilities and examples. No F&B experience is not itself a weakness."}, {"name": "Teamwork", "priority": "Important", "intent": "A concrete example of coordination, helping colleagues or resolving a work disagreement; transferable or scenario evidence is acceptable."}], "follow_up_guidance": "Prefer concrete examples. Clarify vague answers only when useful. Evidence may satisfy multiple areas naturally; never require a dedicated question for an already evidenced area. Avoid repeating established facts/questions. Accept transferable customer/team experience or scenario evidence when there is no F&B experience. Prioritize unresolved Core areas as time runs down. Move on when evidence is sufficient.", "scenarios": ["A customer complains that their food is taking too long. How would you respond and work with your team?"], "completion_criteria": {"Core": "covered", "Important": "partial", "Optional": "unresolved", "scenarios": "answered"}, "target_minutes": 10, "max_minutes": 15}'::jsonb);

create function public.recruitment_publish_profile(p_definition jsonb,p_expected_version integer) returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=recruitment_actor('recruitment.manage'); current_version integer; result uuid;
begin
 perform recruitment_validate_profile(p_definition);
 perform pg_advisory_xact_lock(hashtextextended('recruitment_profile:service_crew',0));
 select max(version) into current_version from recruitment_interview_profiles where profile_key='service_crew';
 if current_version is distinct from p_expected_version then raise exception using errcode='40001',message='Profile has changed. Reload before publishing.'; end if;
 insert into recruitment_interview_profiles(profile_key,version,definition,created_by) values('service_crew',current_version+1,p_definition,actor) returning id into result;
 insert into recruitment_events(action,actor_employee_id,details) values('interview_profile_published',actor,jsonb_build_object('profile_id',result,'version',current_version+1));
 return result;
end $$;
revoke all on function public.recruitment_publish_profile(jsonb,integer) from public,anon,authenticated;
grant execute on function public.recruitment_publish_profile(jsonb,integer) to authenticated;

alter table public.recruitment_interview_configs add column interview_profile_id uuid references public.recruitment_interview_profiles(id) on delete restrict,
 add column opening_requirements jsonb not null default '{}'::jsonb check(jsonb_typeof(opening_requirements)='object');
create or replace function public.recruitment_save_opening(p_opening jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.recruitment_actor('recruitment.manage'); v_id uuid:=nullif(p_opening->>'id','')::uuid; v_old public.recruitment_openings%rowtype; v_position public.job_positions%rowtype; v_entity public.legal_entities%rowtype; v_outlet public.outlets%rowtype; v_status text:=coalesce(p_opening->>'status','draft'); v_workplace text; v_outlet_id uuid:=nullif(p_opening->>'outlet_id','')::uuid; v_config jsonb:=coalesce(p_opening->'config','{}'::jsonb); v_version integer; v_profile recruitment_interview_profiles%rowtype; v_requirements jsonb:=coalesce(p_opening->'config'->'opening_requirements','{}'::jsonb);
begin
  if jsonb_typeof(v_requirements) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_requirements) k where k not in ('weekend_required','closing_shift','preferred_start')) or (v_requirements ? 'weekend_required' and jsonb_typeof(v_requirements->'weekend_required')<>'boolean') or (v_requirements ? 'closing_shift' and (jsonb_typeof(v_requirements->'closing_shift')<>'string' or length(v_requirements->>'closing_shift')>240)) or (v_requirements ? 'preferred_start' and (jsonb_typeof(v_requirements->'preferred_start')<>'string' or length(v_requirements->>'preferred_start')>240)) then raise exception using errcode='22023',message='Opening requirements are invalid.'; end if;
  if nullif(v_config->>'interview_profile_id','') is not null then
   select * into v_profile from recruitment_interview_profiles where id=(v_config->>'interview_profile_id')::uuid;
   if v_profile.id is null then raise exception using errcode='22023',message='Choose a published Interview Profile version.'; end if;
   -- Profile owns evidence, guidance and durations; client-supplied copies are ignored.
   v_config:=v_config||jsonb_build_object('required_topics',(select jsonb_agg(value->>'name' order by ordinality) from jsonb_array_elements(v_profile.definition->'evidence_areas') with ordinality), 'scenario_briefs',v_profile.definition->'scenarios','target_minutes',v_profile.definition->'target_minutes','max_minutes',v_profile.definition->'max_minutes','interview_instructions',v_profile.definition->>'follow_up_guidance');
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
  insert into public.recruitment_interview_configs(opening_id,version,required_topics,scenario_briefs,language_guidance,target_minutes,max_minutes,candidate_instructions,interview_instructions,created_by,interview_profile_id,opening_requirements)
  values(v_id,v_version,v_config->'required_topics',v_config->'scenario_briefs',coalesce(v_config->>'language_guidance',''),(v_config->>'target_minutes')::integer,(v_config->>'max_minutes')::integer,coalesce(v_config->>'candidate_instructions',''),coalesce(v_config->>'interview_instructions',''),v_actor,v_profile.id,v_requirements);
  insert into public.recruitment_events(opening_id,action,actor_employee_id,details) values(v_id,'opening_saved',v_actor,jsonb_build_object('status',v_status,'config_version',v_version));
  return v_id;
end $$;

-- Progress is monotonic; material partial/covered findings retain their own citations.
alter table public.recruitment_topic_coverage drop constraint recruitment_topic_coverage_state_check, drop constraint recruitment_topic_coverage_check;
alter table public.recruitment_topic_coverage add constraint recruitment_topic_coverage_check check((state='unresolved' and evidence_turn_id is null) or (state in ('partial','covered') and evidence_turn_id is not null));
alter table public.recruitment_topic_coverage add constraint recruitment_topic_coverage_state_check check(state in ('unresolved','partial','covered'));
create table public.recruitment_coverage_findings (
 id bigint generated always as identity primary key,
 attempt_id uuid not null references public.recruitment_interview_attempts(id),
 topic_index integer not null,
 state text not null check(state in ('partial','covered')),
 evidence_turn_id bigint not null references public.recruitment_transcript_turns(id),
 reason text not null check(length(reason) between 1 and 1000),
 created_at timestamptz not null default clock_timestamp(),
 unique(attempt_id,topic_index,state,evidence_turn_id),
 foreign key(attempt_id,topic_index) references public.recruitment_topic_coverage(attempt_id,topic_index)
);
alter table public.recruitment_coverage_findings enable row level security;
revoke all on public.recruitment_coverage_findings from public,anon,authenticated;
grant select on public.recruitment_coverage_findings to service_role;
revoke all on sequence public.recruitment_coverage_findings_id_seq from public,anon,authenticated;
create index recruitment_coverage_findings_attempt_idx on public.recruitment_coverage_findings(attempt_id,created_at);
create trigger recruitment_coverage_finding_immutable before update or delete on public.recruitment_coverage_findings for each row execute function public.recruitment_immutable_evidence();

create function public.recruitment_coverage_complete(p_attempt_id uuid) returns boolean language sql stable security definer set search_path=public as $$
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
 ) and not exists(select 1 from recruitment_scenario_progress where attempt_id=p_attempt_id and state<>'answered')
 and exists(select 1 from recruitment_interview_attempts where id=p_attempt_id);
$$;
revoke all on function public.recruitment_coverage_complete(uuid) from public,anon,authenticated;
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
     where attempt_id=a.id and topic_index=(x->>'index')::integer and (state='unresolved' or (state='partial' and v_state='covered'));
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

create or replace function public.recruitment_public_finish(p_token text,p_client_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
  a:=public.recruitment_session(p_token,p_client_id);
  if p_reason is null or p_reason not in ('coverage','max_duration','candidate_stop') then raise exception using errcode='22023',message='Completion reason is invalid.'; end if;
  if p_reason='coverage' and not recruitment_coverage_complete(a.id) then raise exception using errcode='55000',message='Required interview topics remain.'; end if;
  if p_reason='max_duration' and a.max_ends_at>clock_timestamp() then raise exception using errcode='55000',message='Maximum duration has not ended.'; end if;
  update public.recruitment_interview_attempts set status='finalizing',interview_ended_at=coalesce(interview_ended_at,clock_timestamp()),completion_reason=coalesce(completion_reason,p_reason),recording_state='pending' where id=a.id;
  return jsonb_build_object('status','finalizing');
end $$;


alter function public.recruitment_assessment_context(text,uuid,boolean) rename to recruitment_assessment_context_before_profiles;
revoke all on function public.recruitment_assessment_context_before_profiles(text,uuid,boolean) from public,anon,authenticated;
create function public.recruitment_assessment_context(p_token text,p_client_id uuid,p_for_coverage boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare d jsonb:=recruitment_assessment_context_before_profiles(p_token,p_client_id,p_for_coverage); plan jsonb;
begin
 select jsonb_build_object('interview_profile',case when p.id is not null then jsonb_build_object('id',p.id,'name',p.name,'version',p.version,'definition',p.definition) else null end,'opening_requirements',c.opening_requirements)
 into plan from recruitment_interview_attempts a join recruitment_interview_configs c on c.id=a.config_version_id left join recruitment_interview_profiles p on p.id=c.interview_profile_id where a.id=(d->>'attempt_id')::uuid;
 return d||plan;
end $$;
revoke all on function public.recruitment_assessment_context(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.recruitment_assessment_context(text,uuid,boolean) to service_role;

create function public.recruitment_workspace(p_opening_id uuid default null,p_stage text default 'all',p_page integer default 1,p_include_qa boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d jsonb:=recruitment_admin_data(1,1); result jsonb; v_page integer:=greatest(1,least(coalesce(p_page,1),100000));
begin
 if p_stage is null or p_stage not in ('all','invited','interviewing','needs_review','shortlisted','rejected') then raise exception using errcode='22023',message='Candidate filter is invalid.'; end if;
 if p_opening_id is not null and not exists(select 1 from recruitment_openings where id=p_opening_id and recruitment_opening_in_scope(outlet_id)) then raise exception using errcode='42501',message='Opening is unavailable.'; end if;
 with scoped as (
  select o.* from recruitment_openings o where recruitment_opening_in_scope(o.outlet_id) and (coalesce(p_include_qa,false) or o.title !~* '^QA([ :_-]|$)')
 ), candidates as (
  select a.id,a.opening_id,a.created_at,case when a.decision_state<>'review' then a.decision_state when t.status in ('completed','partial','failed') then 'needs_review' when t.status in ('starting','interviewing','interrupted','finalizing') then 'interviewing' when i.id is not null then 'invited' else 'registered' end stage,
  jsonb_build_object('id',a.id,'opening_id',a.opening_id,'applicant_id',a.applicant_id,'name',coalesce(t.profile_name,p.full_name),'contact',coalesce(t.profile_contact,p.contact),'email',p.email,'opening_title',a.opening_title_snapshot,'workplace',a.workplace_snapshot,'status',a.status,'decision_state',a.decision_state,'employee_id',a.employee_id,'attempt_status',t.status,'recording_state',t.recording_state,'issued_at',i.issued_at,'expires_at',i.expires_at,'revoked_at',i.revoked_at) row
  from recruitment_applications a join scoped o on o.id=a.opening_id join recruitment_applicants p on p.id=a.applicant_id
  left join lateral(select * from recruitment_invitations where application_id=a.id order by issued_at desc,id desc limit 1) i on true
  left join recruitment_interview_attempts t on t.invitation_id=i.id
 ), filtered as (select * from candidates where (p_opening_id is null or opening_id=p_opening_id) and (p_stage='all' or stage=p_stage)), paged as (select * from filtered order by created_at desc,id limit 20 offset (v_page-1)*20),
 opening_rows as (
  select o.id,o.created_at,to_jsonb(o)-'created_by'-'updated_by'||jsonb_build_object('position_name',(select name from job_positions where id=o.position_id),'employer_name',(select coalesce(display_name,legal_company_name) from legal_entities where id=o.legal_entity_id),'config',to_jsonb(c)-'created_by'-'opening_id','profile',case when p.id is null then null else jsonb_build_object('id',p.id,'name',p.name,'version',p.version) end,'pipeline',jsonb_build_object('total',(select count(*) from candidates where opening_id=o.id),'invited',(select count(*) from candidates where opening_id=o.id and stage='invited'),'interviewing',(select count(*) from candidates where opening_id=o.id and stage='interviewing'),'needs_review',(select count(*) from candidates where opening_id=o.id and stage='needs_review'),'shortlisted',(select count(*) from candidates where opening_id=o.id and stage='shortlisted'),'rejected',(select count(*) from candidates where opening_id=o.id and stage='rejected'))) row
  from scoped o join recruitment_interview_configs c on c.opening_id=o.id and c.version=o.config_version left join recruitment_interview_profiles p on p.id=c.interview_profile_id
 )
 select jsonb_build_object('openings',coalesce((select jsonb_agg(row order by created_at desc,id) from opening_rows),'[]'::jsonb),'applications',coalesce((select jsonb_agg(row||jsonb_build_object('stage',stage) order by created_at desc,id) from paged),'[]'::jsonb),'applications_total',(select count(*) from filtered),'page',v_page,'page_size',20,
 'summary',jsonb_build_object('open_roles',(select count(*) from scoped where status='open'),'interviewing',(select count(*) from candidates where stage='interviewing'),'needs_review',(select count(*) from candidates where stage='needs_review'),'shortlisted',(select count(*) from candidates where stage='shortlisted')),
 'activity',coalesce((select jsonb_agg(jsonb_build_object('action',action,'occurred_at',occurred_at,'candidate',candidate) order by occurred_at desc) from (select e.action,e.occurred_at,p.full_name candidate from recruitment_events e join scoped o on o.id=e.opening_id left join recruitment_applications a on a.id=e.application_id left join recruitment_applicants p on p.id=a.applicant_id where e.opening_id=p_opening_id and e.action in ('application_registered','invitation_issued','invitation_revoked','interview_finalized','opening_saved','manager_decision') order by e.occurred_at desc,e.id desc limit 8) recent),'[]'::jsonb),
 'profiles',coalesce((select jsonb_agg(to_jsonb(p)-'created_by' order by version desc) from recruitment_interview_profiles p),'[]'::jsonb)) into result;
 return (d-'openings'-'applications'-'applications_total'-'page'-'page_size')||result;
end $$;
revoke all on function public.recruitment_workspace(uuid,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.recruitment_workspace(uuid,text,integer,boolean) to authenticated;

-- The existing permission/scope check runs before any additional evidence is projected.
alter function public.recruitment_admin_evidence(uuid,uuid) rename to recruitment_admin_evidence_before_profiles;
revoke all on function public.recruitment_admin_evidence_before_profiles(uuid,uuid) from public,anon,authenticated;
create function public.recruitment_admin_evidence(p_application_id uuid,p_attempt_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d jsonb:=recruitment_admin_evidence_before_profiles(p_application_id,p_attempt_id); plan jsonb;
begin
 select jsonb_build_object('interview_profile',case when p.id is not null then jsonb_build_object('name',p.name,'version',p.version,'definition',p.definition) else null end,'opening_requirements',c.opening_requirements) into plan
 from recruitment_interview_attempts a join recruitment_interview_configs c on c.id=a.config_version_id left join recruitment_interview_profiles p on p.id=c.interview_profile_id where a.id=(d->'attempt'->>'id')::uuid;
 return d||coalesce(plan,'{}'::jsonb)||jsonb_build_object('coverage_findings',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at,f.id) from recruitment_coverage_findings f where f.attempt_id=(d->'attempt'->>'id')::uuid),'[]'::jsonb));
end $$;
revoke all on function public.recruitment_admin_evidence(uuid,uuid) from public,anon,authenticated;
grant execute on function public.recruitment_admin_evidence(uuid,uuid) to authenticated;
