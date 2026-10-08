-- Optional, future-publication-only rubric contract. No existing rows are rewritten.
alter function public.recruitment_validate_profile(jsonb) rename to recruitment_validate_profile_pre_rubric;
create function public.recruitment_validate_profile(p_definition jsonb) returns void
language plpgsql set search_path=public as $$
declare a jsonb; l jsonb;
begin
 perform recruitment_validate_profile_pre_rubric(p_definition);
 for a in select value from jsonb_array_elements(p_definition->'evidence_areas') loop
  if a ? 'rubric' then
   if jsonb_typeof(a->'rubric') is distinct from 'object' or (a->'rubric')-'levels'<>'{}'::jsonb or jsonb_typeof(a->'rubric'->'levels') is distinct from 'array' then raise exception using errcode='22023',message='Rubric requires four explicit job-related criterion levels.'; end if;
   if jsonb_array_length(a->'rubric'->'levels')<>4 or (select count(distinct value->>'level') from jsonb_array_elements(a->'rubric'->'levels'))<>4 then raise exception using errcode='22023',message='Rubric levels must be distinct, 1 through 4.'; end if;
   for l in select value from jsonb_array_elements(a->'rubric'->'levels') loop
    if jsonb_typeof(l) is distinct from 'object' or l-array['level','criteria']<>'{}'::jsonb or jsonb_typeof(l->'level') is distinct from 'number' or coalesce(l->>'level','') not in ('1','2','3','4') or jsonb_typeof(l->'criteria') is distinct from 'string' or length(btrim(l->>'criteria')) not between 20 and 800 then raise exception using errcode='22023',message='Each rubric level needs explicit role-specific behavioral criteria (20–800 characters).'; end if;
   end loop;
   if (select count(distinct lower(btrim(value->>'criteria'))) from jsonb_array_elements(a->'rubric'->'levels'))<>4 then raise exception using errcode='22023',message='Each level must have distinct criteria.'; end if;
  end if;
 end loop;
end $$;
revoke all on function public.recruitment_validate_profile_pre_rubric(jsonb),public.recruitment_validate_profile(jsonb) from public,anon,authenticated;

-- Extend the established bounded context validator; preserve legacy shared_facts snapshots.
alter function public.recruitment_validate_offerings(jsonb,jsonb) rename to recruitment_validate_offerings_pre_information;
create function public.recruitment_validate_offerings(p_context jsonb,p_offers jsonb) returns void
language plpgsql immutable set search_path=public as $$
declare e jsonb; entries jsonb:=p_context->'additional_information';
begin
 perform recruitment_validate_offerings_pre_information(p_context-'additional_information',p_offers);
 if entries is not null then
  if jsonb_typeof(entries) is distinct from 'array' or pg_column_size(entries)>16000 then raise exception using errcode='22023',message='Additional information is invalid.'; end if;
  if jsonb_array_length(entries)>10 then raise exception using errcode='22023',message='Use at most ten confirmed information topics.'; end if;
  for e in select value from jsonb_array_elements(entries) loop
   if jsonb_typeof(e) is distinct from 'object' or e-array['topic','information']<>'{}'::jsonb or jsonb_typeof(e->'topic') is distinct from 'string' or length(btrim(e->>'topic')) not between 1 and 120 or jsonb_typeof(e->'information') is distinct from 'string' or length(btrim(e->>'information')) not between 1 and 1000 then raise exception using errcode='22023',message='Each entry needs a topic and confirmed information.'; end if;
   if lower(btrim(e->>'topic')) ~ '^(salary|pay|compensation|benefits|working hours|operating days|operating hours|location|job scope|weekend availability|closing shift|start date)$' then raise exception using errcode='22023',message='Use the dedicated offering, job information or requirement field for this topic.'; end if;
  end loop;
  if (select count(distinct lower(btrim(value->>'topic'))) from jsonb_array_elements(entries))<>jsonb_array_length(entries) then raise exception using errcode='22023',message='Additional information topics must be distinct.'; end if;
 end if;
end $$;
revoke all on function public.recruitment_validate_offerings_pre_information(jsonb,jsonb),public.recruitment_validate_offerings(jsonb,jsonb) from public,anon,authenticated;

-- The immutable published profile is read through the attempt's pinned config, never latest profile.
alter function public.recruitment_report_source(uuid) rename to recruitment_report_source_pre_assessment;
create function public.recruitment_report_source(p_attempt_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare source jsonb:=recruitment_report_source_pre_assessment(p_attempt_id); plan jsonb;
begin
 if source is null then return null; end if;
 select jsonb_build_object('profile_id',p.id,'version',p.version,'areas',jsonb_agg(jsonb_build_object('index',x.ordinality-1,'name',x.value->>'name','rubric',x.value->'rubric') order by x.ordinality)) into plan
 from recruitment_interview_profiles p cross join lateral jsonb_array_elements(p.definition->'evidence_areas') with ordinality x
 where p.id=(source->'config'->>'interview_profile_id')::uuid and x.value ? 'rubric' group by p.id,p.version;
 if plan is not null then source:=source||jsonb_build_object('assessment_plan',plan); end if;
 return source;
end $$;
revoke all on function public.recruitment_report_source_pre_assessment(uuid),public.recruitment_report_source(uuid) from public,anon,authenticated;
grant execute on function public.recruitment_report_source(uuid) to service_role;
create function public.recruitment_report_assessment_pin() returns trigger language plpgsql set search_path=public as $$
begin
 if new.source_snapshot ? 'assessment_plan' then new.prompt_version:='recruitment-report-v4'; end if;
 return new;
end $$;
revoke all on function public.recruitment_report_assessment_pin() from public,anon,authenticated;
create trigger recruitment_report_assessment_pin before insert on public.recruitment_reports for each row execute function public.recruitment_report_assessment_pin();

-- Trusted completion enforces pinned criteria and candidate citations in addition to Edge validation.
alter function public.recruitment_report_finish(uuid,uuid,jsonb,text,text) rename to recruitment_report_finish_pre_assessment;
create function public.recruitment_report_finish(p_report_id uuid,p_generation_id uuid,p_body jsonb,p_response_id text,p_error_code text default null) returns void
language plpgsql security definer set search_path=public as $$
declare r recruitment_reports%rowtype; a jsonb; area jsonb; citation jsonb; expected jsonb;
begin
 select * into r from recruitment_reports where id=p_report_id for update;
 if r.id is null or r.status<>'generating' or r.generation_id is distinct from p_generation_id then raise exception using errcode='40001',message='Generation no longer owns this report.'; end if;
 if p_error_code is null then
  if r.prompt_version='recruitment-report-v4' then
   expected:=r.source_snapshot->'assessment_plan';
   if p_body->'assessment_profile' is distinct from jsonb_build_object('id',expected->'profile_id','version',expected->'version') or jsonb_typeof(p_body->'assessments') is distinct from 'array' then raise exception using errcode='22023',message='Assessment profile must match the pinned report source.'; end if;
   if jsonb_array_length(p_body->'assessments')<>jsonb_array_length(expected->'areas') or (select count(distinct value->>'index') from jsonb_array_elements(p_body->'assessments'))<>jsonb_array_length(expected->'areas') then raise exception using errcode='22023',message='Pinned assessment areas incomplete.'; end if;
   for a in select value from jsonb_array_elements(p_body->'assessments') loop
    select value into area from jsonb_array_elements(expected->'areas') where value->'index'=a->'index';
    if area is null or a->>'area' is distinct from area->>'name' or jsonb_typeof(a->'finding'->'evidence') is distinct from 'array' or length(btrim(coalesce(a->'finding'->>'text',''))) not between 1 and 700 then raise exception using errcode='22023',message='Assessment finding is invalid.'; end if;
    if a->>'status'='assessed' then
     if a->'finding'->>'kind' is distinct from 'interpretation' or jsonb_array_length(a->'finding'->'evidence')=0 or not exists(select 1 from jsonb_array_elements(area->'rubric'->'levels') l where l->'level'=a->'level' and l->'criteria'=a->'criterion') then raise exception using errcode='22023',message='Assessment requires a pinned criterion and cited evidence.'; end if;
    elsif a->>'status'='insufficient_evidence' then
     if a->'level' is distinct from 'null'::jsonb or a->'criterion' is distinct from 'null'::jsonb or a->'finding'->>'kind' is distinct from 'unresolved' then raise exception using errcode='22023',message='Insufficient evidence must remain unscored.'; end if;
    else raise exception using errcode='22023',message='Unknown assessment state.'; end if;
    for citation in select value from jsonb_array_elements(a->'finding'->'evidence') loop
     if not exists(select 1 from jsonb_array_elements(r.source_snapshot->'turns') t where t->'id'=citation->'turn_id' and t->>'speaker'='candidate') then raise exception using errcode='22023',message='Assessment citation is foreign or not candidate evidence.'; end if;
    end loop;
   end loop;
  elsif p_body ? 'assessments' or p_body ? 'assessment_profile' then raise exception using errcode='22023',message='Historical profile reports cannot acquire assessments.';
  end if;
 end if;
 perform recruitment_report_finish_pre_assessment(p_report_id,p_generation_id,p_body,p_response_id,p_error_code);
end $$;
revoke all on function public.recruitment_report_finish_pre_assessment(uuid,uuid,jsonb,text,text),public.recruitment_report_finish(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.recruitment_report_finish(uuid,uuid,jsonb,text,text) to service_role;
