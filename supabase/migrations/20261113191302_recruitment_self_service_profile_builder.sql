-- Extend Recruitment's existing version and invitation pins. Existing definitions and evidence stay untouched.
create table public.recruitment_interview_templates (
  template_key text primary key,
  name text not null,
  definition jsonb not null check (jsonb_typeof(definition)='object')
);
alter table public.recruitment_interview_templates enable row level security;
revoke all on public.recruitment_interview_templates from public,anon,authenticated,service_role;
create trigger recruitment_template_immutable before update or delete on public.recruitment_interview_templates
for each row execute function public.recruitment_immutable_evidence();

insert into public.recruitment_interview_templates values ('behavioral_v1','Behavioral Interview', '{
  "intelligence_version":2, "role_context":"",
  "follow_up_guidance":"Ask one question at a time. Start with a relevant real example, clarify the candidate’s own actions and results, and move on once enough evidence is available.",
  "target_minutes":10, "max_minutes":15,
  "completion_criteria":{"Core":"covered","Important":"partial","Optional":"unresolved","scenarios":"answered"},
  "evidence_areas":[
    {"name":"Task Ownership","priority":"Core","goal":"Understand how the candidate completes and checks work they are responsible for.","evidence_guidance":"Look for a specific task, the candidate’s actions, and the outcome or handover.","follow_up_signals":"Clarify what the candidate personally checked or did when the outcome was uncertain.","stop_condition":"Move on after a specific action and how the candidate checked or handed over the result."},
    {"name":"Team Coordination","priority":"Important","goal":"Understand how the candidate shares information and coordinates work with others.","evidence_guidance":"Look for a real example of communicating a change or coordinating a shared task.","follow_up_signals":"Clarify what information they shared and whether the other person could act on it.","stop_condition":"Move on when their contribution and its practical effect are clear."}
  ],
  "scenarios":[]
}'::jsonb);

alter table public.recruitment_interview_profile_drafts
  drop constraint recruitment_interview_profile_drafts_profile_key_check,
  alter column base_profile_id drop not null,
  add column name text,
  add column position_id uuid references public.job_positions(id),
  add column template_key text references public.recruitment_interview_templates(template_key),
  add column source_profile_id uuid references public.recruitment_interview_profiles(id),
  add column creation_fingerprint text,
  add constraint recruitment_profile_draft_identity check (
    base_profile_id is not null or
    (name is not null and position_id is not null and creation_fingerprint is not null and
     (template_key is not null) <> (source_profile_id is not null))
  );

alter table public.recruitment_interview_profiles
  drop constraint recruitment_interview_profiles_profile_key_check,
  add column position_id uuid references public.job_positions(id),
  add column template_key text references public.recruitment_interview_templates(template_key),
  add column source_profile_id uuid references public.recruitment_interview_profiles(id),
  add column test_draft_id uuid references public.recruitment_interview_profile_drafts(id),
  add column test_revision integer,
  add constraint recruitment_profile_test_source check (
    (test_draft_id is null and test_revision is null) or
    (test_draft_id is not null and test_revision is not null and test_revision>0)
  );
create unique index recruitment_profile_test_snapshot on public.recruitment_interview_profiles(test_draft_id,test_revision)
where test_draft_id is not null;

alter table public.recruitment_openings add column test_profile_id uuid references public.recruitment_interview_profiles(id);
alter table public.recruitment_interview_configs add column unverified_job_facts jsonb not null default '{}'::jsonb
  check (jsonb_typeof(unverified_job_facts)='object');

create function public.recruitment_profile_templates() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform recruitment_actor('recruitment.manage');
  return coalesce((select jsonb_agg(jsonb_build_object('key',template_key,'name',name) order by name)
    from recruitment_interview_templates),'[]'::jsonb);
end $$;

create function public.recruitment_profile_draft_view(p_draft public.recruitment_interview_profile_drafts) returns jsonb
language sql stable set search_path=public,pg_temp as $$
  select to_jsonb(p_draft)-'creation_fingerprint'||jsonb_build_object(
    'name',coalesce(p_draft.name,p.name), 'version',coalesce(p.version,0)+1,
    'position_id',coalesce(p_draft.position_id,p.position_id),
    'template_key',coalesce(p_draft.template_key,p.template_key), 'template_name',t.name)
  from (select 1) anchor left join recruitment_interview_profiles p on p.id=p_draft.base_profile_id
  left join recruitment_interview_templates t on t.template_key=coalesce(p_draft.template_key,p.template_key);
$$;

create or replace function public.recruitment_profile_drafts() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform recruitment_actor(case when current_user_has_permission('recruitment.view') then 'recruitment.view' else 'recruitment.manage' end);
  return coalesce((select jsonb_agg(recruitment_profile_draft_view(d) order by d.updated_at desc)
    from recruitment_interview_profile_drafts d where d.status='draft'),'[]'::jsonb);
end $$;

create function public.recruitment_create_profile_draft(
  p_request_id uuid,p_name text,p_position_id uuid,p_template_key text,p_source_profile_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor uuid:=recruitment_actor('recruitment.manage');
  d recruitment_interview_profile_drafts%rowtype;
  definition jsonb;
  fingerprint text;
begin
  p_name:=btrim(p_name);
  if p_request_id is null or coalesce(length(p_name),0) not between 3 and 120 or
     ((p_template_key is null)=(p_source_profile_id is null)) then
    raise exception using errcode='22023',message='Enter a profile name and select one starting template or published version.';
  end if;
  fingerprint:=jsonb_build_array(p_name,p_position_id,p_template_key,p_source_profile_id)::text;
  perform pg_advisory_xact_lock(hashtextextended('recruitment_profile_create:'||p_request_id,0));
  select * into d from recruitment_interview_profile_drafts where id=p_request_id;
  if found then
    if d.created_by is distinct from actor or d.creation_fingerprint is distinct from fingerprint or d.status<>'draft' then
      raise exception using errcode='PT409',message='This create request has changed. Reload Interview Profiles.';
    end if;
    return recruitment_profile_draft_view(d);
  end if;
  if not exists(select 1 from job_positions where id=p_position_id and status='active') then
    raise exception using errcode='22023',message='Choose an active Job Position.';
  end if;
  if p_template_key is not null then
    select t.definition into definition from recruitment_interview_templates t where t.template_key=p_template_key;
  else
    select p.definition into definition from recruitment_interview_profiles p
      where p.id=p_source_profile_id and p.test_draft_id is null;
  end if;
  if definition is null then raise exception using errcode='22023',message='The selected starting plan is unavailable.'; end if;
  insert into recruitment_interview_profile_drafts(id,profile_key,name,position_id,template_key,source_profile_id,
    creation_fingerprint,definition,created_by,updated_by)
  values(p_request_id,'profile_'||p_request_id,p_name,p_position_id,p_template_key,p_source_profile_id,
    fingerprint,definition,actor,actor) returning * into d;
  insert into recruitment_events(action,actor_employee_id,details)
  values('interview_profile_draft_created',actor,jsonb_build_object('draft_id',d.id,'position_id',p_position_id,
    'template_key',p_template_key,'source_profile_id',p_source_profile_id));
  return recruitment_profile_draft_view(d);
end $$;

create or replace function public.recruitment_prepare_profile_draft(p_profile_key text,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor uuid:=recruitment_actor('recruitment.manage');
  d recruitment_interview_profile_drafts%rowtype;
  p recruitment_interview_profiles%rowtype;
begin
  select * into p from recruitment_interview_profiles where profile_key=p_profile_key and test_draft_id is null
  order by version desc limit 1;
  if p.id is null then raise exception using errcode='22023',message='Interview Profile is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('recruitment_profile:'||p_profile_key,0));
  select * into d from recruitment_interview_profile_drafts where profile_key=p_profile_key and status='draft';
  if d.id is null then
    select * into p from recruitment_interview_profiles where profile_key=p_profile_key and test_draft_id is null
    order by version desc limit 1;
    if p.version is distinct from p_expected_version then
      raise exception using errcode='PT409',message='Profile has changed. Reload before preparing a draft.';
    end if;
    insert into recruitment_interview_profile_drafts(profile_key,base_profile_id,definition,created_by,updated_by)
    values(p_profile_key,p.id,p.definition,actor,actor) returning * into d;
    insert into recruitment_events(action,actor_employee_id,details)
    values('interview_profile_draft_created',actor,jsonb_build_object('draft_id',d.id,'base_profile_id',p.id));
  end if;
  return recruitment_profile_draft_view(d);
end $$;

create or replace function public.recruitment_save_profile_draft(p_draft_id uuid,p_expected_revision integer,p_definition jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=recruitment_actor('recruitment.manage'); d recruitment_interview_profile_drafts%rowtype;
begin
  if jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>60000 or
     jsonb_typeof(p_definition->'evidence_areas') is distinct from 'array' or
     jsonb_typeof(p_definition->'scenarios') is distinct from 'array' or
     jsonb_typeof(p_definition->'completion_criteria') is distinct from 'object' then
    raise exception using errcode='22023',message='Draft must be a bounded profile definition.';
  end if;
  select * into d from recruitment_interview_profile_drafts where id=p_draft_id for update;
  if d.id is null or d.status<>'draft' then
    raise exception using errcode='55000',message='This draft is no longer editable. Reload the Profile Library.';
  end if;
  if d.revision is distinct from p_expected_revision then
    raise exception using errcode='PT409',message='A newer draft has been saved. Reload before editing again.';
  end if;
  if d.definition is distinct from p_definition then
    update recruitment_interview_profile_drafts set definition=p_definition,revision=revision+1,
      updated_by=actor,updated_at=clock_timestamp() where id=d.id returning * into d;
    insert into recruitment_events(action,actor_employee_id,details)
    values('interview_profile_draft_saved',actor,jsonb_build_object('draft_id',d.id,'revision',d.revision));
  end if;
  return recruitment_profile_draft_view(d);
end $$;

create function public.recruitment_validate_builder_profile(p_definition jsonb) returns void
language plpgsql set search_path=public,pg_temp as $$
begin
  perform recruitment_validate_profile(p_definition);
  if (select count(distinct lower(btrim(value->>'name'))) from jsonb_array_elements(p_definition->'evidence_areas'))
     <> jsonb_array_length(p_definition->'evidence_areas') then
    raise exception using errcode='22023',message='Use distinct names for the assessment areas.';
  end if;
  if p_definition->'completion_criteria'->>'Optional'='covered' and p_definition->'completion_criteria'->>'Important'='partial'
     and exists(select 1 from jsonb_array_elements(p_definition->'evidence_areas') where value->>'priority'='Optional') then
    raise exception using errcode='22023',message='Optional areas cannot require more evidence than Important areas.';
  end if;
end $$;

-- One validated append operation for saved drafts and the retained Service Crew RPC.
create function public.recruitment_append_profile_version(
  p_key text,p_name text,p_expected integer,p_definition jsonb,p_position uuid,p_template text,p_source uuid
) returns uuid language plpgsql set search_path=public,pg_temp as $$
declare actor uuid:=recruitment_actor('recruitment.manage'); current_version integer; result uuid;
begin
  perform recruitment_validate_builder_profile(p_definition);
  perform pg_advisory_xact_lock(hashtextextended('recruitment_profile:'||p_key,0));
  select coalesce(max(version),0) into current_version from recruitment_interview_profiles
    where profile_key=p_key and test_draft_id is null;
  if current_version is distinct from p_expected then
    raise exception using errcode='PT409',message='The published profile has changed. Reload before publishing.';
  end if;
  if p_position is not null and not exists(select 1 from job_positions where id=p_position and status='active') then
    raise exception using errcode='22023',message='This Job Position is no longer active.';
  end if;
  insert into recruitment_interview_profiles(profile_key,name,version,definition,position_id,template_key,source_profile_id,created_by)
  values(p_key,p_name,current_version+1,p_definition,p_position,p_template,p_source,actor) returning id into result;
  insert into recruitment_events(action,actor_employee_id,details)
  values('interview_profile_published',actor,jsonb_build_object('profile_id',result,'version',current_version+1));
  return result;
end $$;

create or replace function public.recruitment_publish_profile_version(p_definition jsonb,p_expected_version integer) returns uuid
language sql security definer set search_path=public,pg_temp as $$
  select recruitment_append_profile_version('service_crew','Service Crew',p_expected_version,p_definition,null,null,null);
$$;

create or replace function public.recruitment_publish_profile_draft(p_draft_id uuid,p_expected_revision integer) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor uuid:=recruitment_actor('recruitment.manage');
  d recruitment_interview_profile_drafts%rowtype;
  p recruitment_interview_profiles%rowtype;
  result uuid;
  family text;
begin
  select profile_key into family from recruitment_interview_profile_drafts where id=p_draft_id;
  if not found then raise exception using errcode='55000',message='Draft is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('recruitment_profile:'||family,0));
  select * into d from recruitment_interview_profile_drafts where id=p_draft_id for update;
  if d.revision is distinct from p_expected_revision then
    raise exception using errcode='PT409',message='A newer draft has been saved. Reload before publishing.';
  end if;
  if d.status='published' then return d.published_profile_id; end if;
  select * into p from recruitment_interview_profiles where id=d.base_profile_id;
  result:=recruitment_append_profile_version(family,coalesce(d.name,p.name),coalesce(p.version,0),d.definition,
    coalesce(d.position_id,p.position_id),coalesce(d.template_key,p.template_key),coalesce(d.source_profile_id,p.source_profile_id));
  update recruitment_interview_profile_drafts set status='published',published_profile_id=result,
    updated_by=actor,updated_at=clock_timestamp() where id=d.id;
  insert into recruitment_events(action,actor_employee_id,details)
  values('interview_profile_draft_published',actor,jsonb_build_object('draft_id',d.id,'revision',d.revision,'profile_id',result));
  return result;
end $$;

revoke all on function public.recruitment_profile_templates(),public.recruitment_profile_draft_view(public.recruitment_interview_profile_drafts),
  public.recruitment_create_profile_draft(uuid,text,uuid,text,uuid),public.recruitment_validate_builder_profile(jsonb),
  public.recruitment_append_profile_version(text,text,integer,jsonb,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.recruitment_profile_templates(),public.recruitment_create_profile_draft(uuid,text,uuid,text,uuid) to authenticated;

-- Only explicitly confirmed facts enter the existing candidate-facing fields.
create function public.recruitment_validate_job_fact_status(p_config jsonb) returns void
language plpgsql set search_path=public,pg_temp as $$
declare pending jsonb:=coalesce(p_config->'unverified_job_facts','{}'::jsonb);
begin
  if jsonb_typeof(pending) is distinct from 'object' or octet_length(pending::text)>8000 then
    raise exception using errcode='22023',message='Unverified job information is invalid.';
  end if;
  if exists(select 1 from jsonb_each(pending) f
    where f.key not in ('employment_type','offered_salary','working_hours','shift_arrangement','public_holidays','benefits','additional_facts')
    or jsonb_typeof(f.value)<>'string' or length(btrim(f.value#>>'{}')) not between 1 and 1000
    or coalesce(p_config->'job_facts','{}'::jsonb) ? f.key) then
    raise exception using errcode='22023',message='Choose one verification status per job fact and enter its value.';
  end if;
end $$;

CREATE FUNCTION public.recruitment_save_opening_config(p_opening jsonb,p_test_profile uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=public.recruitment_actor('recruitment.manage'); v_id uuid:=nullif(p_opening->>'id','')::uuid; v_old public.recruitment_openings%rowtype; v_position public.job_positions%rowtype; v_entity public.legal_entities%rowtype; v_outlet public.outlets%rowtype; v_status text:=coalesce(p_opening->>'status','draft'); v_workplace text; v_outlet_id uuid:=nullif(p_opening->>'outlet_id','')::uuid; v_facts jsonb:=coalesce(p_opening->'config'->'job_facts','{}'::jsonb); v_config jsonb:=coalesce(p_opening->'config','{}'::jsonb); v_version integer; v_profile recruitment_interview_profiles%rowtype; v_requirements jsonb:=coalesce(p_opening->'config'->'opening_requirements','{}'::jsonb);
begin
  if v_id is not null and exists(select 1 from recruitment_openings where id=v_id and test_profile_id is not null) then
    raise exception using errcode='42501',message='A test opening is an immutable snapshot.';
  end if;
  perform public.recruitment_validate_offerings(coalesce(v_config->'job_context','{}'::jsonb),coalesce(v_config->'employment_offerings','[]'::jsonb));
  if jsonb_typeof(v_facts) is distinct from 'object' or pg_column_size(v_facts)>8000 or exists(select 1 from jsonb_each(v_facts) x where x.key not in ('employment_type','offered_salary','working_hours','shift_arrangement','public_holidays','benefits','additional_facts') or jsonb_typeof(x.value)<>'string' or length(btrim(x.value#>>'{}')) not between 1 and 1000) then raise exception using errcode='22023',message='Confirmed job information is invalid.'; end if;
  if jsonb_typeof(v_requirements) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_requirements) k where k not in ('weekend_required','closing_shift','preferred_start')) or (v_requirements ? 'weekend_required' and jsonb_typeof(v_requirements->'weekend_required')<>'boolean') or (v_requirements ? 'closing_shift' and (jsonb_typeof(v_requirements->'closing_shift')<>'string' or length(v_requirements->>'closing_shift')>240)) or (v_requirements ? 'preferred_start' and (jsonb_typeof(v_requirements->'preferred_start')<>'string' or length(v_requirements->>'preferred_start')>240)) then raise exception using errcode='22023',message='Opening requirements are invalid.'; end if;
  perform recruitment_validate_job_fact_status(v_config);
  if nullif(v_config->>'interview_profile_id','') is not null then
   select * into v_profile from recruitment_interview_profiles where id=(v_config->>'interview_profile_id')::uuid
     and ((p_test_profile is null and test_draft_id is null) or id=p_test_profile and test_draft_id is not null);
   if v_profile.id is null then raise exception using errcode='22023',message='Choose a published Interview Profile version.'; end if;
   -- Profile owns evidence, guidance and durations; client-supplied copies are ignored.
   v_config:=v_config||jsonb_build_object('required_topics',(select jsonb_agg(value->>'name' order by ordinality) from jsonb_array_elements(v_profile.definition->'evidence_areas') with ordinality), 'scenario_briefs',coalesce((select jsonb_agg(case when jsonb_typeof(value)='string' then value#>>'{}' else value->>'brief' end order by ordinality) from jsonb_array_elements(v_profile.definition->'scenarios') with ordinality),'[]'::jsonb),'target_minutes',v_profile.definition->'target_minutes','max_minutes',v_profile.definition->'max_minutes','interview_instructions',v_profile.definition->>'follow_up_guidance');
  elsif (v_status='open' and (v_id is null or exists(select 1 from recruitment_openings where id=v_id and status='draft'))) or exists(select 1 from recruitment_interview_configs c join recruitment_openings o on o.id=c.opening_id and o.config_version=c.version where o.id=v_id and c.interview_profile_id is not null) then
   raise exception using errcode='22023',message='Choose an Interview Profile version.';
  end if;
  select * into v_position from public.job_positions where id=(p_opening->>'position_id')::uuid;
  select * into v_entity from public.legal_entities where id=(p_opening->>'legal_entity_id')::uuid;
  if v_position.id is null or v_entity.id is null or (v_status<>'closed' and (v_position.status<>'active' or not v_entity.is_active)) then raise exception using errcode='22023',message='Choose an active Position and Legal Entity.'; end if;
  if v_profile.position_id is not null and v_profile.position_id<>v_position.id then
    raise exception using errcode='22023',message='Choose an Interview Profile for the selected Job Position.';
  end if;
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
    insert into public.recruitment_openings(title,position_id,outlet_id,workplace,legal_entity_id,description,status,created_by,updated_by,test_profile_id)
    values(btrim(p_opening->>'title'),v_position.id,v_outlet_id,v_workplace,v_entity.id,coalesce(p_opening->>'description',''),v_status,v_actor,v_actor,p_test_profile) returning id into v_id;
    v_version:=1;
  else
    select * into v_old from public.recruitment_openings where id=v_id for update;
    if v_old.id is null or not public.recruitment_opening_in_scope(v_old.outlet_id) then raise exception using errcode='42501',message='Opening is unavailable.'; end if;
    if v_old.status='closed' and v_status<>'closed' then raise exception using errcode='55000',message='Closed openings cannot be reopened.'; end if;
    if exists(select 1 from public.recruitment_applications where opening_id=v_id) and (v_old.position_id,v_old.outlet_id,v_old.workplace,v_old.legal_entity_id) is distinct from (v_position.id,v_outlet_id,v_workplace,v_entity.id) then raise exception using errcode='55000',message='Position, workplace and legal employer are fixed after applications exist.'; end if;
    v_version:=v_old.config_version+1;
    update public.recruitment_openings set title=btrim(p_opening->>'title'),position_id=v_position.id,outlet_id=v_outlet_id,workplace=v_workplace,legal_entity_id=v_entity.id,description=coalesce(p_opening->>'description',''),status=v_status,config_version=v_version,updated_by=v_actor,updated_at=clock_timestamp() where id=v_id;
  end if;
  insert into public.recruitment_interview_configs(opening_id,version,required_topics,scenario_briefs,language_guidance,target_minutes,max_minutes,candidate_instructions,interview_instructions,created_by,interview_profile_id,opening_requirements,job_facts,job_context,employment_offerings,unverified_job_facts)
  values(v_id,v_version,v_config->'required_topics',v_config->'scenario_briefs',coalesce(v_config->>'language_guidance',''),(v_config->>'target_minutes')::integer,(v_config->>'max_minutes')::integer,coalesce(v_config->>'candidate_instructions',''),coalesce(v_config->>'interview_instructions',''),v_actor,v_profile.id,v_requirements,v_facts,coalesce(v_config->'job_context','{}'::jsonb),coalesce(v_config->'employment_offerings','[]'::jsonb),coalesce(v_config->'unverified_job_facts','{}'::jsonb));
  insert into public.recruitment_events(opening_id,action,actor_employee_id,details) values(v_id,'opening_saved',v_actor,jsonb_build_object('status',v_status,'config_version',v_version));
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.recruitment_find_applicants(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid:=public.recruitment_actor('recruitment.manage'); v_query text:=btrim(coalesce(p_query,''));
begin
  if length(v_query)<2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.full_name,'contact',x.contact) order by x.full_name)
    from (select a.* from public.recruitment_applicants a where (a.full_name ilike '%'||v_query||'%' or a.contact ilike '%'||v_query||'%')
      and not exists(select 1 from recruitment_applications t join recruitment_openings o on o.id=t.opening_id where t.applicant_id=a.id and o.test_profile_id is not null)
      and (a.created_by=v_actor or exists(select 1 from public.recruitment_applications ap join public.recruitment_openings o on o.id=ap.opening_id where ap.applicant_id=a.id and public.recruitment_opening_in_scope(o.outlet_id)))
      order by a.full_name limit 20) x),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.recruitment_register_application_before_preference(p_opening_id uuid, p_applicant jsonb, p_applicant_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid:=public.recruitment_actor('recruitment.manage'); v_opening public.recruitment_openings%rowtype; v_applicant public.recruitment_applicants%rowtype; v_application uuid; v_position text; v_entity text;
begin
  select * into v_opening from public.recruitment_openings where id=p_opening_id and status='open';
  if v_opening.id is null or not public.recruitment_opening_in_scope(v_opening.outlet_id) then raise exception using errcode='42501',message='Opening is unavailable.'; end if;
  if p_applicant_id is null then
    insert into public.recruitment_applicants(full_name,contact,email,created_by) values(btrim(p_applicant->>'full_name'),btrim(p_applicant->>'contact'),nullif(btrim(p_applicant->>'email'),''),v_actor) returning * into v_applicant;
  else
    select * into v_applicant from public.recruitment_applicants where id=p_applicant_id;
    if v_applicant.id is null or exists(select 1 from recruitment_applications a join recruitment_openings o on o.id=a.opening_id where a.applicant_id=p_applicant_id and o.test_profile_id is not null) or not (v_applicant.created_by=v_actor or exists(select 1 from public.recruitment_applications ap join public.recruitment_openings o on o.id=ap.opening_id where ap.applicant_id=v_applicant.id and public.recruitment_opening_in_scope(o.outlet_id))) then raise exception using errcode='42501',message='Applicant is unavailable.'; end if;
  end if;
  select name into v_position from public.job_positions where id=v_opening.position_id;
  select legal_company_name into v_entity from public.legal_entities where id=v_opening.legal_entity_id;
  insert into public.recruitment_applications(applicant_id,opening_id,opening_title_snapshot,opening_description_snapshot,position_snapshot,workplace_snapshot,legal_entity_snapshot,created_by)
  values(v_applicant.id,v_opening.id,v_opening.title,v_opening.description,v_position,v_opening.workplace,v_entity,v_actor)
  on conflict(applicant_id,opening_id) do nothing returning id into v_application;
  if v_application is null then
    select id into v_application from public.recruitment_applications where applicant_id=v_applicant.id and opening_id=v_opening.id;
  else
    insert into public.recruitment_events(opening_id,application_id,action,actor_employee_id) values(v_opening.id,v_application,'application_registered',v_actor);
  end if;
  return v_application;
end $function$;

create or replace function public.recruitment_register_application(p_opening_id uuid,p_applicant jsonb,p_applicant_id uuid default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
  perform recruitment_actor('recruitment.manage');
  if exists(select 1 from recruitment_openings where recruitment_openings.id=p_opening_id and test_profile_id is not null) then
    raise exception using errcode='42501',message='Test interviews use their own tester invitation.';
  end if;
  result:=recruitment_register_application_before_preference(p_opening_id,p_applicant,p_applicant_id);
  if p_applicant ? 'employment_preference' then perform recruitment_set_preference(result,p_applicant->>'employment_preference'); end if;
  return result;
end $$;

create or replace function public.recruitment_issue_invitation(p_application_id uuid,p_expires_at timestamptz)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform recruitment_actor('recruitment.manage');
  perform 1 from recruitment_applications where id=p_application_id for update;
  if exists(select 1 from recruitment_applications a join recruitment_openings o on o.id=a.opening_id
    where a.id=p_application_id and o.test_profile_id is not null) then
    raise exception using errcode='42501',message='Start a test from the Profile Builder.';
  end if;
  if exists(select 1 from recruitment_applications where id=p_application_id and decision_state in ('hired','rejected')) then
    raise exception 'This application has a final manager decision.';
  end if;
  return recruitment_issue_invitation_phase1(p_application_id,p_expires_at);
end $$;

CREATE OR REPLACE FUNCTION public.recruitment_workspace(p_opening_id uuid DEFAULT NULL::uuid, p_stage text DEFAULT 'all'::text, p_page integer DEFAULT 1, p_include_qa boolean DEFAULT false, p_search text DEFAULT ''::text, p_offering text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d jsonb:=recruitment_admin_data(1,1); result jsonb; v_page integer:=greatest(1,least(coalesce(p_page,1),100000));
begin
 if length(coalesce(p_search,''))>120 or p_offering not in ('all','unknown','full_time','part_time','both') then raise exception using errcode='22023',message='Invalid candidate filter.'; end if;
 if p_stage is null or p_stage not in ('all','invited','interviewing','needs_review','shortlisted','rejected') then raise exception using errcode='22023',message='Candidate filter is invalid.'; end if;
 if p_opening_id is not null and not exists(select 1 from recruitment_openings where id=p_opening_id and test_profile_id is null and recruitment_opening_in_scope(outlet_id)) then raise exception using errcode='42501',message='Opening is unavailable.'; end if;
 with scoped as (
  select o.* from recruitment_openings o where o.test_profile_id is null and recruitment_opening_in_scope(o.outlet_id) and (coalesce(p_include_qa,false) or o.title !~* '^QA([ :_-]|$)')
 ), candidates as (
  select a.id,a.opening_id,a.created_at,case when a.decision_state<>'review' then a.decision_state when t.status in ('completed','partial','failed') then 'needs_review' when t.status in ('starting','interviewing','interrupted','finalizing') then 'interviewing' when i.id is not null then 'invited' else 'registered' end stage,
  jsonb_build_object('id',a.id,'opening_id',a.opening_id,'applicant_id',a.applicant_id,'name',coalesce(t.profile_name,p.full_name),'contact',coalesce(t.profile_contact,p.contact),'email',p.email,'opening_title',a.opening_title_snapshot,'workplace',a.workplace_snapshot,'status',a.status,'decision_state',a.decision_state,'employee_id',a.employee_id,'attempt_status',t.status,'recording_state',t.recording_state,'employment_preference',a.employment_preference,'registered_at',a.created_at,'started_at',t.interview_started_at,'completed_at',t.interview_ended_at,'duration_seconds',case when t.interview_ended_at is not null and t.interview_started_at is not null then greatest(0,extract(epoch from t.interview_ended_at-t.interview_started_at))::integer else null end,'ready_for_review_at',(select max(e.occurred_at) from recruitment_events e where e.attempt_id=t.id and e.action='interview_finalized'),'decision_at',(select max(d.occurred_at) from recruitment_decisions d where d.application_id=a.id),'reviewed_at',(select max(v.reviewed_at) from recruitment_report_reviews v join recruitment_reports r on r.id=v.report_id where r.attempt_id=t.id),'issued_at',i.issued_at,'expires_at',i.expires_at,'revoked_at',i.revoked_at) row
  from recruitment_applications a join scoped o on o.id=a.opening_id join recruitment_applicants p on p.id=a.applicant_id
  left join lateral(select * from recruitment_invitations where application_id=a.id order by issued_at desc,id desc limit 1) i on true
  left join recruitment_interview_attempts t on t.invitation_id=i.id
 ), filtered as (select * from candidates where (p_opening_id is null or opening_id=p_opening_id) and (p_stage='all' or stage=p_stage) and (p_offering='all' or row->>'employment_preference'=p_offering) and (coalesce(p_search,'')='' or strpos(lower(row->>'name'),lower(p_search))>0 or strpos(lower(row->>'contact'),lower(p_search))>0)), paged as (select * from filtered order by created_at desc,id limit 20 offset (v_page-1)*20),
 opening_rows as (
  select o.id,o.created_at,to_jsonb(o)-'created_by'-'updated_by'||jsonb_build_object('position_name',(select name from job_positions where id=o.position_id),'employer_name',(select coalesce(display_name,legal_company_name) from legal_entities where id=o.legal_entity_id),'config',to_jsonb(c)-'created_by'-'opening_id','profile',case when p.id is null then null else jsonb_build_object('id',p.id,'name',p.name,'version',p.version) end,'pipeline',jsonb_build_object('total',(select count(*) from candidates where opening_id=o.id),'invited',(select count(*) from candidates where opening_id=o.id and stage='invited'),'interviewing',(select count(*) from candidates where opening_id=o.id and stage='interviewing'),'needs_review',(select count(*) from candidates where opening_id=o.id and stage='needs_review'),'shortlisted',(select count(*) from candidates where opening_id=o.id and stage='shortlisted'),'rejected',(select count(*) from candidates where opening_id=o.id and stage='rejected'))) row
  from scoped o join recruitment_interview_configs c on c.opening_id=o.id and c.version=o.config_version left join recruitment_interview_profiles p on p.id=c.interview_profile_id
 )
 select jsonb_build_object('openings',coalesce((select jsonb_agg(row order by created_at desc,id) from opening_rows),'[]'::jsonb),'applications',coalesce((select jsonb_agg(row||jsonb_build_object('stage',stage) order by created_at desc,id) from paged),'[]'::jsonb),'applications_total',(select count(*) from filtered),'page',v_page,'page_size',20,
 'summary',jsonb_build_object('active_candidates',(select count(*) from candidates where stage not in ('hired','rejected')),'open_roles',(select count(*) from scoped where status='open'),'interviewing',(select count(*) from candidates where stage='interviewing'),'needs_review',(select count(*) from candidates where stage='needs_review'),'shortlisted',(select count(*) from candidates where stage='shortlisted')),
 'activity',coalesce((select jsonb_agg(jsonb_build_object('action',action,'occurred_at',occurred_at,'candidate',candidate) order by occurred_at desc) from (select e.action,e.occurred_at,p.full_name candidate from recruitment_events e join scoped o on o.id=e.opening_id left join recruitment_applications a on a.id=e.application_id left join recruitment_applicants p on p.id=a.applicant_id where e.opening_id=p_opening_id and e.action in ('application_registered','invitation_issued','invitation_revoked','interview_finalized','opening_saved','manager_decision') order by e.occurred_at desc,e.id desc limit 8) recent),'[]'::jsonb),
 'profiles',coalesce((select jsonb_agg(to_jsonb(p)-'created_by' order by version desc) from recruitment_interview_profiles p where p.test_draft_id is null),'[]'::jsonb)) into result;
 d:=d||jsonb_build_object('outlets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'candidate_location',coalesce(nullif(address,''),nullif(location,''))) order by name) from outlets where recruitment_opening_in_scope(id)),'[]'::jsonb));
 return (d-'openings'-'applications'-'applications_total'-'page'-'page_size')||result;
end $function$;

CREATE OR REPLACE FUNCTION public.recruitment_admin_data_phase1(p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid; v_data jsonb; v_page integer:=greatest(coalesce(p_page,1),1); v_size integer:=least(greatest(coalesce(p_page_size,20),1),100);
begin
  if not (public.current_user_has_permission('recruitment.view') or public.current_user_has_permission('recruitment.manage')) then
    raise exception using errcode='42501',message='Recruitment view permission is required.';
  end if;
  v_actor:=public.recruitment_actor(case when public.current_user_has_permission('recruitment.view') then 'recruitment.view' else 'recruitment.manage' end);
  select jsonb_build_object(
    'openings',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'title',o.title,'position_id',o.position_id,'outlet_id',o.outlet_id,'workplace',o.workplace,'legal_entity_id',o.legal_entity_id,'description',o.description,'status',o.status,'config_version',o.config_version,'config',to_jsonb(c)-'id'-'opening_id'-'created_by','created_at',o.created_at) order by o.created_at desc) from public.recruitment_openings o join public.recruitment_interview_configs c on c.opening_id=o.id and c.version=o.config_version where o.test_profile_id is null and public.recruitment_opening_in_scope(o.outlet_id)),'[]'::jsonb),
    'applications',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'opening_id',a.opening_id,'applicant_id',a.applicant_id,'status',a.status,'name',coalesce(t.profile_name,p.full_name),'contact',coalesce(t.profile_contact,p.contact),'email',p.email,'opening_title',a.opening_title_snapshot,'attempt_status',t.status,'expires_at',i.expires_at,'revoked_at',i.revoked_at,'issued_at',i.issued_at) order by a.created_at desc) from public.recruitment_applications a join public.recruitment_applicants p on p.id=a.applicant_id join public.recruitment_openings o on o.id=a.opening_id left join lateral (select * from public.recruitment_invitations x where x.application_id=a.id order by x.issued_at desc limit 1) i on true left join public.recruitment_interview_attempts t on t.invitation_id=i.id where o.test_profile_id is null and public.recruitment_opening_in_scope(o.outlet_id) and a.id in (select page.id from public.recruitment_applications page join public.recruitment_openings scoped on scoped.id=page.opening_id where scoped.test_profile_id is null and public.recruitment_opening_in_scope(scoped.outlet_id) order by page.created_at desc limit v_size offset (v_page-1)*v_size)),'[]'::jsonb),
    'applications_total',(select count(*) from public.recruitment_applications page join public.recruitment_openings scoped on scoped.id=page.opening_id where scoped.test_profile_id is null and public.recruitment_opening_in_scope(scoped.outlet_id)),
    'page',v_page,'page_size',v_size,
    'positions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from public.job_positions where status='active'),'[]'::jsonb),
    'outlets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from public.outlets where public.recruitment_opening_in_scope(id)),'[]'::jsonb),
    'legal_entities',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',coalesce(display_name,legal_company_name)) order by legal_company_name) from public.legal_entities where is_active),'[]'::jsonb)
  ) into v_data;
  return v_data;
end $function$;

create or replace function public.recruitment_save_opening(p_opening jsonb) returns uuid
language sql security definer set search_path=public,pg_temp as $$
  select recruitment_save_opening_config(p_opening,null);
$$;

-- Test runs use the real candidate lifecycle with a dedicated immutable profile/config pin.
-- Test openings are excluded from hiring and normal Recruitment lists.
create function public.recruitment_start_profile_test(
  p_draft_id uuid,p_expected_revision integer,p_opening_id uuid,p_expected_config_version integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor uuid:=recruitment_actor('recruitment.manage');
  d recruitment_interview_profile_drafts%rowtype;
  o recruitment_openings%rowtype;
  c recruitment_interview_configs%rowtype;
  profile_id uuid;
  test_opening uuid;
  test_application uuid;
  test_attempt uuid;
  token text;
  expires_at timestamptz:=clock_timestamp()+interval '2 hours';
  profile jsonb;
begin
  select * into d from recruitment_interview_profile_drafts where id=p_draft_id for update;
  if d.id is null or d.status<>'draft' or d.revision is distinct from p_expected_revision then
    raise exception using errcode='PT409',message='Reload the saved draft before testing.';
  end if;
  perform recruitment_validate_builder_profile(d.definition);
  profile:=recruitment_profile_draft_view(d);
  select * into o from recruitment_openings where id=p_opening_id and test_profile_id is null and status in ('open','draft');
  if o.id is null or not recruitment_opening_in_scope(o.outlet_id) or
     (o.outlet_id is null and not current_user_has_all_outlet_access()) then
    raise exception using errcode='42501',message='Choose an accessible job to provide hiring context for this test.';
  end if;
  if profile->>'position_id' is not null and (profile->>'position_id')::uuid<>o.position_id then
    raise exception using errcode='22023',message='Choose a job for this profile’s Job Position.';
  end if;
  if o.config_version is distinct from p_expected_config_version then
    raise exception using errcode='PT409',message='Job Facts changed. Reopen the preview before creating a test.';
  end if;
  select * into strict c from recruitment_interview_configs where opening_id=o.id and version=o.config_version;
  select id into profile_id from recruitment_interview_profiles where test_draft_id=d.id and test_revision=d.revision;
  if profile_id is null then
    insert into recruitment_interview_profiles(profile_key,name,version,definition,position_id,template_key,source_profile_id,
      test_draft_id,test_revision,created_by)
    values('test_'||d.id,profile->>'name',d.revision,d.definition,(profile->>'position_id')::uuid,
      profile->>'template_key',d.source_profile_id,d.id,d.revision,actor) returning id into profile_id;
  end if;
  test_opening:=recruitment_save_opening_config(
    (to_jsonb(o)-'id')||jsonb_build_object('title','QA Profile Test · '||left(profile->>'name',120),'status','open',
      'config',(to_jsonb(c)-'unverified_job_facts')||jsonb_build_object('interview_profile_id',profile_id)),profile_id);
  test_application:=recruitment_register_application_before_preference(test_opening,
    jsonb_build_object('full_name','QA Interview Tester','contact','QA-'||gen_random_uuid()),null);
  token:=recruitment_issue_invitation_phase1(test_application,expires_at);
  select id into strict test_attempt from recruitment_interview_attempts where application_id=test_application;
  insert into recruitment_events(opening_id,application_id,attempt_id,action,actor_employee_id,details)
  values(test_opening,test_application,test_attempt,'interview_profile_test_created',actor,
    jsonb_build_object('draft_id',d.id,'revision',d.revision,'source_opening_id',o.id,'source_config_id',c.id));
  return jsonb_build_object('token',token,'expires_at',expires_at,'application_id',test_application,'attempt_id',test_attempt);
end $$;

-- A test application may retain reports and evidence, but it cannot enter hiring.
create function public.recruitment_guard_test_decision() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if exists(select 1 from recruitment_applications a join recruitment_openings o on o.id=a.opening_id
    where a.id=new.application_id and o.test_profile_id is not null) then
    raise exception using errcode='42501',message='Test interviews cannot enter the hiring workflow.';
  end if;
  return new;
end $$;
create trigger recruitment_test_decision_guard before insert on public.recruitment_decisions
for each row execute function public.recruitment_guard_test_decision();

revoke all on function public.recruitment_save_opening_config(jsonb,uuid),
  public.recruitment_validate_job_fact_status(jsonb),public.recruitment_start_profile_test(uuid,integer,uuid,integer),
  public.recruitment_guard_test_decision() from public,anon,authenticated,service_role;
grant execute on function public.recruitment_start_profile_test(uuid,integer,uuid,integer) to authenticated;

create function public.recruitment_profile_test_history(p_profile_key text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform recruitment_actor('recruitment.manage');
  return coalesce((select jsonb_agg(to_jsonb(history) order by history.issued_at desc) from (
    select a.application_id, a.id as attempt_id, a.status, a.recording_state, i.issued_at,
      i.expires_at, i.revoked_at, p.test_revision as revision, o.workplace
    from recruitment_interview_attempts a
    join recruitment_invitations i on i.id=a.invitation_id
    join recruitment_openings o on o.id=a.opening_id
    join recruitment_interview_profiles p on p.id=o.test_profile_id
    join recruitment_interview_profile_drafts d on d.id=p.test_draft_id
    where d.profile_key=p_profile_key and recruitment_opening_in_scope(o.outlet_id)
      and (o.outlet_id is not null or current_user_has_all_outlet_access())
    order by i.issued_at desc limit 25
  ) history),'[]'::jsonb);
end $$;
revoke all on function public.recruitment_profile_test_history(text) from public,anon,authenticated,service_role;
grant execute on function public.recruitment_profile_test_history(text) to authenticated;

-- Keep test records outside Agent discovery and unverified terms outside report inputs.
CREATE OR REPLACE FUNCTION public.recruitment_report_source_pre_assessment(p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select jsonb_build_object('attempt',jsonb_build_object('id',a.id,'status',a.status,'recording_state',a.recording_state,'started_at',a.interview_started_at,'ended_at',a.interview_ended_at,'reason',a.completion_reason),
 'config',to_jsonb(c)-'created_by'-'unverified_job_facts',
 'turns',coalesce((select jsonb_agg(to_jsonb(t) order by turn_number) from recruitment_transcript_turns t where attempt_id=a.id),'[]'::jsonb),
 'units',coalesce((select jsonb_agg(to_jsonb(u)-'object_path' order by sequence) from recruitment_recording_units u where attempt_id=a.id),'[]'::jsonb),
 'annotations',coalesce((select jsonb_agg(to_jsonb(x) order by id) from recruitment_transcript_annotations x where attempt_id=a.id),'[]'::jsonb),
 'topics',coalesce((select jsonb_agg(to_jsonb(x) order by topic_index) from recruitment_topic_coverage x where attempt_id=a.id),'[]'::jsonb),
 'scenarios',coalesce((select jsonb_agg(to_jsonb(x) order by scenario_index) from recruitment_scenario_progress x where attempt_id=a.id),'[]'::jsonb),
 'gaps',coalesce((select jsonb_agg(jsonb_build_object('at',occurred_at,'reason',details->>'reason') order by occurred_at) from recruitment_events where attempt_id=a.id and action='recording_gap'),'[]'::jsonb))
 from recruitment_interview_attempts a join recruitment_interview_configs c on c.id=a.config_version_id where a.id=p_attempt_id and a.status in ('completed','partial','failed');
$function$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_target_scope(p_machine uuid, p_action text, p_target uuid, p_input jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare entity uuid:=(p_input->>'legal_entity_id')::uuid; actual uuid; employee uuid; outlet uuid;run uuid;
begin
 if not feedx_integrations.hr_scope_entity(p_machine,entity) then raise exception using errcode='42501',message='HR company scope is required';end if;
 if p_action like 'hr_payroll%' or p_action like 'hr_legal_entity%' then
  if not feedx_integrations.hr_actor_all(p_machine) then raise exception using errcode='42501',message='Company-wide HR authority required';end if;
 end if;
 if p_action='hr_employment.update' then
  select e.legal_entity_id,e.id into actual,employee from employees e where e.id=p_target;
  if actual is distinct from entity or not feedx_integrations.hr_actor_employee(p_machine,employee) or (p_input->'record'->>'legal_entity_id')::uuid is distinct from entity then raise exception using errcode='42501',message='Employee or destination company is outside this HR intent';end if;
 elsif p_action like 'hr_recruitment.%' then
  select o.legal_entity_id,o.outlet_id into actual,outlet from recruitment_applications a join recruitment_openings o on o.id=a.opening_id where a.id=p_target and o.test_profile_id is null;
  if actual is distinct from entity or not (feedx_integrations.hr_actor_all(p_machine) or (outlet is not null and feedx_integrations.restaurant_actor_outlet(p_machine,outlet))) then raise exception using errcode='42501',message='Application is outside this HR company/workplace';end if;
 elsif p_action like 'hr_compliance.%' then
  select e.legal_entity_id,e.id into actual,employee from employee_compliance_submissions s join employees e on e.id=s.employee_id where s.id=p_target;
  if actual is distinct from entity or not feedx_integrations.hr_actor_employee(p_machine,employee) then raise exception using errcode='42501',message='Submission is outside this HR company/workplace';end if;
 elsif p_action in ('hr_payroll.prepare','hr_payroll.calculate','hr_payroll.update') then
  select p.legal_entity_id into actual from payroll_runs r join payroll_periods p on p.id=r.period_id where r.id=p_target;
  if actual is distinct from entity then raise exception using errcode='42501',message='Payroll Run is outside this company';end if;
 elsif p_action='hr_payroll_adjustment.create' then
  select p.legal_entity_id into actual from payroll_runs r join payroll_periods p on p.id=r.period_id where r.id=(p_input->>'run_id')::uuid;
  if actual is distinct from entity then raise exception using errcode='42501',message='Payroll Run is outside this company';end if;
 elsif p_action='hr_payroll_adjustment.reverse' then
  select p.legal_entity_id into actual from payroll_run_component_adjustments a join payroll_runs r on r.id=a.run_id join payroll_periods p on p.id=r.period_id where a.id=p_target;
  if actual is distinct from entity then raise exception using errcode='42501',message='Adjustment is outside this company';end if;
 elsif p_action='hr_legal_entity.update' and p_target is distinct from entity then raise exception using errcode='42501',message='Legal Entity differs from this company intent';
 end if;
end $function$;

CREATE OR REPLACE FUNCTION public.hr_agent_resource_query(p_token text, p_queries jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare q jsonb;m uuid;entity uuid;binding record;fields text[];predicate text;query_sql text;total int;data jsonb;results jsonb:='[]';size int;cursor uuid;target uuid;parent uuid;version text;next_cursor uuid;
begin
 if jsonb_typeof(p_queries) is distinct from 'array' or jsonb_array_length(p_queries) not between 1 and 5 then raise exception using errcode='22023',message='Supply one to five HR queries';end if;
 for q in select value from jsonb_array_elements(p_queries) loop
  if jsonb_typeof(q)<>'object' or exists(select 1 from jsonb_object_keys(q) k where k not in ('business_module','resource','legal_entity_id','id','parent_id','after','page_size','snapshot')) then raise exception using errcode='22023',message='Unsupported HR query';end if;
  perform feedx_integrations.hr_read_authorize(p_token,q->>'business_module',(q->>'legal_entity_id')::uuid);
  if not exists(select 1 from feedx_integrations.navigation_resources b join feedx_integrations.resources r on r.key=b.resource_key where b.module_id=q->>'business_module' and r.slug=q->>'resource' and r.workspace='HR' and r.implemented) then raise exception using errcode='42501',message='Resource does not belong to this HR View';end if;
 end loop;
 for q in select value from jsonb_array_elements(p_queries) loop
  entity:=(q->>'legal_entity_id')::uuid;m:=feedx_integrations.hr_read_authorize(p_token,q->>'business_module',entity);
  size:=coalesce((q->>'page_size')::int,50);cursor:=(q->>'after')::uuid;target:=(q->>'id')::uuid;parent:=(q->>'parent_id')::uuid;
  if size not between 1 and 100 or (cursor is not null and q->>'snapshot' is null) then raise exception using errcode='22023',message='Use bounded pages and the returned snapshot with every continuation';end if;
  select b.*,r.slug into strict binding from feedx_integrations.navigation_resources b join feedx_integrations.resources r on r.key=b.resource_key where b.module_id=q->>'business_module' and r.slug=q->>'resource' and r.workspace='HR';
  select array_agg(v) into fields from jsonb_array_elements_text(binding.allowed_fields) v;
  predicate:=case binding.row_scope->>'kind'
   when 'employee' then 't.legal_entity_id=$1 and feedx_integrations.hr_actor_employee($2,t.id)'
   when 'employment' then 't.legal_entity_id=$1 and feedx_integrations.hr_actor_employee($2,t.employee_id) and ($5 is null or t.employee_id=$5)'
   when 'opening' then 't.test_profile_id is null and t.legal_entity_id=$1 and (feedx_integrations.hr_actor_all($2) or (t.outlet_id is not null and feedx_integrations.restaurant_actor_outlet($2,t.outlet_id)))'
   when 'application' then 'exists(select 1 from recruitment_openings o where o.id=t.opening_id and o.test_profile_id is null and o.legal_entity_id=$1 and (feedx_integrations.hr_actor_all($2) or (o.outlet_id is not null and feedx_integrations.restaurant_actor_outlet($2,o.outlet_id)))) and ($5 is null or t.opening_id=$5)'
   when 'period' then 't.legal_entity_id=$1'
   when 'run' then 'exists(select 1 from payroll_periods p where p.id=t.period_id and p.legal_entity_id=$1) and ($5 is null or t.period_id=$5)'
   when 'calculation' then 'exists(select 1 from payroll_runs r join payroll_periods p on p.id=r.period_id where r.id=t.run_id and p.legal_entity_id=$1) and ($5 is null or t.run_id=$5)'
   when 'entity' then 't.id=$1'
   when 'global' then 'true'
   when 'compliance' then 'exists(select 1 from employees e where e.id=t.employee_id and e.legal_entity_id=$1 and feedx_integrations.hr_actor_employee($2,e.id)) and ($5 is null or t.employee_id=$5)'
   when 'compliance_review' then 'exists(select 1 from employee_compliance_submissions s join employees e on e.id=s.employee_id where s.id=t.submission_id and e.legal_entity_id=$1 and feedx_integrations.hr_actor_employee($2,e.id)) and ($5 is null or t.submission_id=$5)'
   else null end;
  if predicate is null then raise exception 'Unsupported registered HR projection';end if;
  predicate:=predicate||' and ($3 is null or t.id=$3)';
  execute format('select count(*) from public.%I t where %s',binding.row_scope->>'relation',predicate) into total using entity,m,target,cursor,parent;
  if total>5000 then raise exception using errcode='54000',message='Narrow the HR window by record or parent identity';end if;
  query_sql:=format('select md5(coalesce(string_agg(v::text,E''\n'' order by row_id),'''')) from (select t.id row_id,(select jsonb_object_agg(e.key,e.value) from jsonb_each(to_jsonb(t)) e where e.key=any($6)) v from public.%I t where %s) s',binding.row_scope->>'relation',predicate);
  execute query_sql into version using entity,m,target,cursor,parent,fields;
  if q->>'snapshot' is not null and q->>'snapshot'<>version then raise exception using errcode='40001',message='HR source changed; restart this complete read';end if;
  query_sql:=format('select coalesce(jsonb_agg(v order by row_id),''[]'') from (select t.id row_id,(select jsonb_object_agg(e.key,e.value) from jsonb_each(to_jsonb(t)) e where e.key=any($6)) v from public.%I t where %s and ($4 is null or t.id>$4) order by t.id limit $7) s',binding.row_scope->>'relation',predicate);
  execute query_sql into data using entity,m,target,cursor,parent,fields,size+1;
  next_cursor:=null;
  if jsonb_array_length(data)>size then data:=data-size;next_cursor:=(data->(size-1)->>'id')::uuid;end if;
  results:=results||jsonb_build_array(jsonb_build_object('business_module',q->>'business_module','resource',q->>'resource','legal_entity_id',entity,'records',data,'total_records',total,'snapshot',version,'next_after',next_cursor,'page_complete',next_cursor is null,'limitations','Saved redacted evidence. Payroll versions are recorded calculation evidence, not a freshness or finalized-total claim. No private documents, bank data or identity credentials.'));
 end loop;
 if octet_length(results::text)>524288 then raise exception using errcode='54000',message='HR response exceeds 512 KiB; narrow the read';end if;
 return jsonb_build_object('results',results);
end $function$;
