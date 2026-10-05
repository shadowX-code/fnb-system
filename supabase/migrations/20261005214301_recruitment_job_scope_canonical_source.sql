-- Job scope keeps the existing opening description snapshot; no duplicated fact field.
create or replace function public.recruitment_save_opening(p_opening jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.recruitment_actor('recruitment.manage'); v_id uuid:=nullif(p_opening->>'id','')::uuid; v_old public.recruitment_openings%rowtype; v_position public.job_positions%rowtype; v_entity public.legal_entities%rowtype; v_outlet public.outlets%rowtype; v_status text:=coalesce(p_opening->>'status','draft'); v_workplace text; v_outlet_id uuid:=nullif(p_opening->>'outlet_id','')::uuid; v_facts jsonb:=coalesce(p_opening->'config'->'job_facts','{}'::jsonb); v_config jsonb:=coalesce(p_opening->'config','{}'::jsonb); v_version integer; v_profile recruitment_interview_profiles%rowtype; v_requirements jsonb:=coalesce(p_opening->'config'->'opening_requirements','{}'::jsonb);
begin
  if jsonb_typeof(v_facts) is distinct from 'object' or pg_column_size(v_facts)>8000 or exists(select 1 from jsonb_each(v_facts) x where x.key not in ('employment_type','offered_salary','working_hours','shift_arrangement','public_holidays','benefits','additional_facts') or jsonb_typeof(x.value)<>'string' or length(btrim(x.value#>>'{}')) not between 1 and 1000) then raise exception using errcode='22023',message='Confirmed job information is invalid.'; end if;
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


