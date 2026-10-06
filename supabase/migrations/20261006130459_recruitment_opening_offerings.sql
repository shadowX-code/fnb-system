-- Recruitment explanation facts, immutable with the existing invitation config pin.
alter table public.recruitment_interview_configs
 add column job_context jsonb not null default '{}'::jsonb,
 add column employment_offerings jsonb not null default '[]'::jsonb;

create function public.recruitment_validate_offerings(p_context jsonb,p_offers jsonb)
returns void language plpgsql immutable set search_path=public as $$
declare o jsonb; k text; v jsonb; n numeric;
begin
 if jsonb_typeof(p_context) is distinct from 'object' or pg_column_size(p_context)>6000 then raise exception using errcode='22023',message='Job / workplace context is invalid.'; end if;
 for k,v in select key,value from jsonb_each(p_context) loop
  if k='operating_days' then
   if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)>7 or exists(select 1 from jsonb_array_elements_text(v) d where d not in ('mon','tue','wed','thu','fri','sat','sun')) or (select count(*) from jsonb_array_elements_text(v))<>(select count(distinct d) from jsonb_array_elements_text(v) d) then raise exception using errcode='22023',message='Operating days are invalid.'; end if;
  elsif k in ('operating_start','operating_end') then
   if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception using errcode='22023',message='Operating time is invalid.'; end if;
  elsif k in ('location','shared_facts') then
   if jsonb_typeof(v)<>'string' or length(btrim(v#>>'{}')) not between 1 and 2000 then raise exception using errcode='22023',message='Confirmed context must be concise text.'; end if;
  else raise exception using errcode='22023',message='Unsupported job context field.'; end if;
 end loop;
 if jsonb_typeof(p_offers) is distinct from 'array' or jsonb_array_length(p_offers)>6 or pg_column_size(p_offers)>30000 then raise exception using errcode='22023',message='Employment offerings are invalid.'; end if;
 if (select count(*) from jsonb_array_elements(p_offers))<>(select count(distinct x->>'id') from jsonb_array_elements(p_offers) x) then raise exception using errcode='22023',message='Each offering needs a unique identity.'; end if;
 for o in select value from jsonb_array_elements(p_offers) loop
  if jsonb_typeof(o)<>'object' or coalesce(o->>'id','') !~ '^[a-zA-Z0-9_-]{1,64}$' or coalesce(o->>'employment_type','') not in ('full_time','part_time','contract','temporary','internship') then raise exception using errcode='22023',message='Choose an employment type.'; end if;
  for k,v in select key,value from jsonb_each(o) loop
   if k in ('id','employment_type') then if jsonb_typeof(v)<>'string' then raise exception using errcode='22023',message='Offering identity is invalid.'; end if;
   elsif k in ('schedule','break_guidance','post_confirmation_terms','public_holiday_details','other_facts','salary_confirmation') then
    if jsonb_typeof(v)<>'string' or length(btrim(v#>>'{}')) not between 1 and 2000 then raise exception using errcode='22023',message='Confirmed offering facts must be concise text.'; end if;
   elsif k in ('working_start','working_end') then
    if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception using errcode='22023',message='Working time is invalid.'; end if;
   elsif k in ('break_paid','uniform_provided') then
    if jsonb_typeof(v)<>'boolean' then raise exception using errcode='22023',message='Choose a confirmed yes/no value.'; end if;
   elsif k='currency' then if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^[A-Z]{3}$' then raise exception using errcode='22023',message='Currency is invalid.'; end if;
   elsif k='compensation_type' then if v#>>'{}' not in ('hourly','monthly') then raise exception using errcode='22023',message='Compensation type is invalid.'; end if;
   elsif k='public_holiday_rule' then if v#>>'{}' not in ('double_pay','custom') then raise exception using errcode='22023',message='Public holiday rule is invalid.'; end if;
   elsif k='payment_method' then if v#>>'{}' not in ('bank','cash','other') then raise exception using errcode='22023',message='Payment method is invalid.'; end if;
   elsif k in ('amount_min','amount_max','minimum_commitment_months','minimum_hours_per_shift','minimum_days_per_week','break_threshold_hours','break_minutes','staff_meal_threshold_hours','staff_meals_per_workday','rest_days_per_week','probation_min_months','probation_max_months','payday_day') then
    if jsonb_typeof(v)<>'number' then raise exception using errcode='22023',message='Offering number is invalid.'; end if;
    n:=(v#>>'{}')::numeric;
    if n<0 or n>1000000 or (k in ('minimum_days_per_week','rest_days_per_week') and n>7) or (k in ('break_threshold_hours','staff_meal_threshold_hours','minimum_hours_per_shift') and n>24) or (k='break_minutes' and (n>240 or n<>trunc(n))) or (k='payday_day' and (n not between 1 and 31 or n<>trunc(n))) or (k in ('probation_min_months','probation_max_months','minimum_commitment_months') and n>120) or (k='staff_meals_per_workday' and (n>5 or n<>trunc(n))) or (k in ('amount_min','amount_max') and n<>round(n,2)) then raise exception using errcode='22023',message='Offering number is outside its supported range.'; end if;
   else raise exception using errcode='22023',message='Unsupported offering field.'; end if;
  end loop;
  if (o ? 'amount_min' or o ? 'amount_max') and (not o ? 'compensation_type' or not o ? 'currency') then raise exception using errcode='22023',message='Confirmed compensation needs type and currency.'; end if;
  if o ? 'amount_max' and (not o ? 'amount_min' or (o->>'amount_max')::numeric<(o->>'amount_min')::numeric) then raise exception using errcode='22023',message='Compensation range is invalid.'; end if;
  if o ? 'probation_max_months' and o ? 'probation_min_months' and (o->>'probation_max_months')::numeric<(o->>'probation_min_months')::numeric then raise exception using errcode='22023',message='Probation range is invalid.'; end if;
 end loop;
end $$;
revoke all on function public.recruitment_validate_offerings(jsonb,jsonb) from public,anon,authenticated;
-- Job scope keeps the existing opening description snapshot; no duplicated fact field.
create or replace function public.recruitment_save_opening(p_opening jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.recruitment_actor('recruitment.manage'); v_id uuid:=nullif(p_opening->>'id','')::uuid; v_old public.recruitment_openings%rowtype; v_position public.job_positions%rowtype; v_entity public.legal_entities%rowtype; v_outlet public.outlets%rowtype; v_status text:=coalesce(p_opening->>'status','draft'); v_workplace text; v_outlet_id uuid:=nullif(p_opening->>'outlet_id','')::uuid; v_facts jsonb:=coalesce(p_opening->'config'->'job_facts','{}'::jsonb); v_config jsonb:=coalesce(p_opening->'config','{}'::jsonb); v_version integer; v_profile recruitment_interview_profiles%rowtype; v_requirements jsonb:=coalesce(p_opening->'config'->'opening_requirements','{}'::jsonb);
begin
  perform public.recruitment_validate_offerings(coalesce(v_config->'job_context','{}'::jsonb),coalesce(v_config->'employment_offerings','[]'::jsonb));
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
  insert into public.recruitment_interview_configs(opening_id,version,required_topics,scenario_briefs,language_guidance,target_minutes,max_minutes,candidate_instructions,interview_instructions,created_by,interview_profile_id,opening_requirements,job_facts,job_context,employment_offerings)
  values(v_id,v_version,v_config->'required_topics',v_config->'scenario_briefs',coalesce(v_config->>'language_guidance',''),(v_config->>'target_minutes')::integer,(v_config->>'max_minutes')::integer,coalesce(v_config->>'candidate_instructions',''),coalesce(v_config->>'interview_instructions',''),v_actor,v_profile.id,v_requirements,v_facts,coalesce(v_config->'job_context','{}'::jsonb),coalesce(v_config->'employment_offerings','[]'::jsonb));
  insert into public.recruitment_events(opening_id,action,actor_employee_id,details) values(v_id,'opening_saved',v_actor,jsonb_build_object('status',v_status,'config_version',v_version));
  return v_id;
end $$;



-- Private fixed comparison samples only; candidate evidence remains in its own bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('recruitment-voice-samples','recruitment-voice-samples',false,2000000,array['audio/wav']) on conflict(id) do nothing;
create table public.recruitment_voice_sample_jobs(
 sample_key text primary key check(sample_key ~ '^[a-f0-9]{64}$'),
 owner uuid not null, expires_at timestamptz not null
);
alter table public.recruitment_voice_sample_jobs enable row level security;
revoke all on public.recruitment_voice_sample_jobs from public,anon,authenticated;
grant all on public.recruitment_voice_sample_jobs to service_role;
create function public.recruitment_claim_voice_sample(p_key text,p_owner uuid) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 insert into recruitment_voice_sample_jobs(sample_key,owner,expires_at) values(p_key,p_owner,clock_timestamp()+interval '90 seconds')
 on conflict(sample_key) do update set owner=excluded.owner,expires_at=excluded.expires_at where recruitment_voice_sample_jobs.expires_at<clock_timestamp();
 return found;
end $$;
revoke all on function public.recruitment_claim_voice_sample(text,uuid) from public,anon,authenticated;
grant execute on function public.recruitment_claim_voice_sample(text,uuid) to service_role;

-- Only canonical scoped location is projected as a safe prefill; no operational outlet data.
create or replace function public.recruitment_workspace(p_opening_id uuid default null,p_stage text default 'all',p_page integer default 1,p_include_qa boolean default false)
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
 d:=d||jsonb_build_object('outlets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'candidate_location',coalesce(nullif(address,''),nullif(location,''))) order by name) from outlets where recruitment_opening_in_scope(id)),'[]'::jsonb));
 return (d-'openings'-'applications'-'applications_total'-'page'-'page_size')||result;
end $$;
