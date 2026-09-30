-- Recruitment is a People-owned pre-employment lifecycle. No candidate row is an employee.
insert into public.permissions(code,module) values
  ('recruitment.view','People'),('recruitment.manage','People')
on conflict (code) do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.name in ('owner','admin') and p.code in ('recruitment.view','recruitment.manage')
on conflict do nothing;

create table public.recruitment_openings (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(btrim(title)) between 3 and 160),
  position_id uuid not null references public.job_positions(id) on delete restrict,
  outlet_id uuid references public.outlets(id) on delete restrict,
  workplace text not null,
  legal_entity_id uuid not null references public.legal_entities(id) on delete restrict,
  description text not null default '',
  status text not null default 'draft' check(status in ('draft','open','closed')),
  config_version integer not null default 1,
  created_by uuid not null references public.employees(id),
  updated_by uuid not null references public.employees(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((outlet_id is null and workplace in ('Factory','Management')) or outlet_id is not null)
);
create table public.recruitment_interview_configs (
  id uuid primary key default gen_random_uuid(),
  opening_id uuid not null references public.recruitment_openings(id) on delete restrict,
  version integer not null,
  required_topics jsonb not null check(jsonb_typeof(required_topics)='array'),
  scenario_briefs jsonb not null check(jsonb_typeof(scenario_briefs)='array'),
  language_guidance text not null default '',
  target_minutes integer not null check(target_minutes between 5 and 90),
  max_minutes integer not null check(max_minutes between 5 and 120 and max_minutes>=target_minutes),
  candidate_instructions text not null default '',
  interview_instructions text not null default '',
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(opening_id,version), unique(id,opening_id)
);
create table public.recruitment_applicants (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check(length(btrim(full_name)) between 2 and 160),
  contact text not null check(length(btrim(contact)) between 5 and 40),
  email text,
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create table public.recruitment_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.recruitment_applicants(id) on delete restrict,
  opening_id uuid not null references public.recruitment_openings(id) on delete restrict,
  status text not null default 'registered' check(status in ('registered','invited','ready')),
  opening_title_snapshot text not null,
  opening_description_snapshot text not null,
  position_snapshot text not null,
  workplace_snapshot text not null,
  legal_entity_snapshot text not null,
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(applicant_id,opening_id)
);
create table public.recruitment_invitations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.recruitment_applications(id) on delete restrict,
  token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  issued_by uuid not null references public.employees(id),
  issued_at timestamptz not null default clock_timestamp()
);
create index recruitment_invitations_application_idx on public.recruitment_invitations(application_id,issued_at desc);
create table public.recruitment_interview_attempts (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique references public.recruitment_invitations(id) on delete restrict,
  application_id uuid not null references public.recruitment_applications(id) on delete restrict,
  opening_id uuid not null references public.recruitment_openings(id) on delete restrict,
  config_version_id uuid not null,
  status text not null default 'invited' check(status in ('invited','profile_confirmed','consented','ready')),
  profile_name text,
  profile_contact text,
  profile_confirmed_at timestamptz,
  device_check jsonb,
  ready_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(config_version_id,opening_id) references public.recruitment_interview_configs(id,opening_id) on delete restrict
);
create table public.recruitment_consents (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.recruitment_interview_attempts(id) on delete restrict,
  application_id uuid not null references public.recruitment_applications(id) on delete restrict,
  copy_version text not null,
  copy_snapshot jsonb not null,
  accepted_purposes jsonb not null,
  accepted_at timestamptz not null default clock_timestamp()
);
create table public.recruitment_consent_copy_versions (
  version text primary key,
  copy jsonb not null,
  status text not null check(status in ('provisional','approved')),
  created_at timestamptz not null default clock_timestamp()
);
insert into public.recruitment_consent_copy_versions(version,copy,status) values
('phase1-provisional-v1',jsonb_build_object(
  'ai','I consent to an AI-conducted interview.',
  'recording','I consent to camera and microphone recording during the interview.',
  'review','I consent to authorized recruitment managers reviewing the interview evidence.',
  'notice','Provisional Phase 1 wording; finalize policy before real candidate collection.'
),'provisional');
create table public.recruitment_events (
  id bigint generated always as identity primary key,
  opening_id uuid references public.recruitment_openings(id),
  application_id uuid references public.recruitment_applications(id),
  attempt_id uuid references public.recruitment_interview_attempts(id),
  action text not null,
  actor_employee_id uuid references public.employees(id),
  occurred_at timestamptz not null default clock_timestamp(),
  details jsonb not null default '{}'::jsonb
);
create index recruitment_events_application_idx on public.recruitment_events(application_id,occurred_at);

alter table public.recruitment_openings enable row level security;
alter table public.recruitment_interview_configs enable row level security;
alter table public.recruitment_applicants enable row level security;
alter table public.recruitment_applications enable row level security;
alter table public.recruitment_invitations enable row level security;
alter table public.recruitment_interview_attempts enable row level security;
alter table public.recruitment_consents enable row level security;
alter table public.recruitment_consent_copy_versions enable row level security;
alter table public.recruitment_events enable row level security;
revoke all on public.recruitment_openings,public.recruitment_interview_configs,public.recruitment_applicants,public.recruitment_applications,public.recruitment_invitations,public.recruitment_interview_attempts,public.recruitment_consents,public.recruitment_consent_copy_versions,public.recruitment_events from public,anon,authenticated;

create function public.recruitment_immutable_evidence()
returns trigger language plpgsql set search_path=public as $$
begin raise exception using errcode='55000',message='Recruitment evidence is immutable.'; end $$;
create trigger recruitment_config_immutable before update or delete on public.recruitment_interview_configs for each row execute function public.recruitment_immutable_evidence();
create trigger recruitment_consent_immutable before update or delete on public.recruitment_consents for each row execute function public.recruitment_immutable_evidence();
create trigger recruitment_consent_copy_immutable before update or delete on public.recruitment_consent_copy_versions for each row execute function public.recruitment_immutable_evidence();
create trigger recruitment_event_immutable before update or delete on public.recruitment_events for each row execute function public.recruitment_immutable_evidence();

create function public.recruitment_actor(p_permission text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid;
begin
  if auth.uid() is null or not public.current_user_has_permission(p_permission) then
    raise exception using errcode='42501',message='Recruitment permission is required.';
  end if;
  select id into v_actor from public.employees where auth_user_id=auth.uid() and enable_system_login and access_state='active' and is_active limit 1;
  if v_actor is null then raise exception using errcode='42501',message='Active employee identity is required.'; end if;
  return v_actor;
end $$;

create function public.recruitment_opening_in_scope(p_outlet_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select p_outlet_id is null or public.current_user_has_all_outlet_access() or public.current_user_can_access_outlet(p_outlet_id);
$$;

create function public.recruitment_admin_data(p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor uuid; v_data jsonb; v_page integer:=greatest(coalesce(p_page,1),1); v_size integer:=least(greatest(coalesce(p_page_size,20),1),100);
begin
  if not (public.current_user_has_permission('recruitment.view') or public.current_user_has_permission('recruitment.manage')) then
    raise exception using errcode='42501',message='Recruitment view permission is required.';
  end if;
  v_actor:=public.recruitment_actor(case when public.current_user_has_permission('recruitment.view') then 'recruitment.view' else 'recruitment.manage' end);
  select jsonb_build_object(
    'openings',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'title',o.title,'position_id',o.position_id,'outlet_id',o.outlet_id,'workplace',o.workplace,'legal_entity_id',o.legal_entity_id,'description',o.description,'status',o.status,'config_version',o.config_version,'config',to_jsonb(c)-'id'-'opening_id'-'created_by','created_at',o.created_at) order by o.created_at desc) from public.recruitment_openings o join public.recruitment_interview_configs c on c.opening_id=o.id and c.version=o.config_version where public.recruitment_opening_in_scope(o.outlet_id)),'[]'::jsonb),
    'applications',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'opening_id',a.opening_id,'applicant_id',a.applicant_id,'status',a.status,'name',coalesce(t.profile_name,p.full_name),'contact',coalesce(t.profile_contact,p.contact),'email',p.email,'opening_title',a.opening_title_snapshot,'attempt_status',t.status,'expires_at',i.expires_at,'revoked_at',i.revoked_at,'issued_at',i.issued_at) order by a.created_at desc) from public.recruitment_applications a join public.recruitment_applicants p on p.id=a.applicant_id join public.recruitment_openings o on o.id=a.opening_id left join lateral (select * from public.recruitment_invitations x where x.application_id=a.id order by x.issued_at desc limit 1) i on true left join public.recruitment_interview_attempts t on t.invitation_id=i.id where public.recruitment_opening_in_scope(o.outlet_id) and a.id in (select page.id from public.recruitment_applications page join public.recruitment_openings scoped on scoped.id=page.opening_id where public.recruitment_opening_in_scope(scoped.outlet_id) order by page.created_at desc limit v_size offset (v_page-1)*v_size)),'[]'::jsonb),
    'applications_total',(select count(*) from public.recruitment_applications page join public.recruitment_openings scoped on scoped.id=page.opening_id where public.recruitment_opening_in_scope(scoped.outlet_id)),
    'page',v_page,'page_size',v_size,
    'positions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from public.job_positions where status='active'),'[]'::jsonb),
    'outlets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from public.outlets where public.recruitment_opening_in_scope(id)),'[]'::jsonb),
    'legal_entities',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',coalesce(display_name,legal_company_name)) order by legal_company_name) from public.legal_entities where is_active),'[]'::jsonb)
  ) into v_data;
  return v_data;
end $$;

create function public.recruitment_find_applicants(p_query text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor uuid:=public.recruitment_actor('recruitment.manage'); v_query text:=btrim(coalesce(p_query,''));
begin
  if length(v_query)<2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.full_name,'contact',x.contact) order by x.full_name)
    from (select a.* from public.recruitment_applicants a where (a.full_name ilike '%'||v_query||'%' or a.contact ilike '%'||v_query||'%')
      and (a.created_by=v_actor or exists(select 1 from public.recruitment_applications ap join public.recruitment_openings o on o.id=ap.opening_id where ap.applicant_id=a.id and public.recruitment_opening_in_scope(o.outlet_id)))
      order by a.full_name limit 20) x),'[]'::jsonb);
end $$;

create function public.recruitment_save_opening(p_opening jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.recruitment_actor('recruitment.manage'); v_id uuid:=nullif(p_opening->>'id','')::uuid; v_old public.recruitment_openings%rowtype; v_position public.job_positions%rowtype; v_entity public.legal_entities%rowtype; v_outlet public.outlets%rowtype; v_status text:=coalesce(p_opening->>'status','draft'); v_workplace text; v_outlet_id uuid:=nullif(p_opening->>'outlet_id','')::uuid; v_config jsonb:=coalesce(p_opening->'config','{}'::jsonb); v_version integer;
begin
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
  insert into public.recruitment_interview_configs(opening_id,version,required_topics,scenario_briefs,language_guidance,target_minutes,max_minutes,candidate_instructions,interview_instructions,created_by)
  values(v_id,v_version,v_config->'required_topics',v_config->'scenario_briefs',coalesce(v_config->>'language_guidance',''),(v_config->>'target_minutes')::integer,(v_config->>'max_minutes')::integer,coalesce(v_config->>'candidate_instructions',''),coalesce(v_config->>'interview_instructions',''),v_actor);
  insert into public.recruitment_events(opening_id,action,actor_employee_id,details) values(v_id,'opening_saved',v_actor,jsonb_build_object('status',v_status,'config_version',v_version));
  return v_id;
end $$;

create function public.recruitment_register_application(p_opening_id uuid,p_applicant jsonb,p_applicant_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.recruitment_actor('recruitment.manage'); v_opening public.recruitment_openings%rowtype; v_applicant public.recruitment_applicants%rowtype; v_application uuid; v_position text; v_entity text;
begin
  select * into v_opening from public.recruitment_openings where id=p_opening_id and status='open';
  if v_opening.id is null or not public.recruitment_opening_in_scope(v_opening.outlet_id) then raise exception using errcode='42501',message='Opening is unavailable.'; end if;
  if p_applicant_id is null then
    insert into public.recruitment_applicants(full_name,contact,email,created_by) values(btrim(p_applicant->>'full_name'),btrim(p_applicant->>'contact'),nullif(btrim(p_applicant->>'email'),''),v_actor) returning * into v_applicant;
  else
    select * into v_applicant from public.recruitment_applicants where id=p_applicant_id;
    if v_applicant.id is null or not (v_applicant.created_by=v_actor or exists(select 1 from public.recruitment_applications ap join public.recruitment_openings o on o.id=ap.opening_id where ap.applicant_id=v_applicant.id and public.recruitment_opening_in_scope(o.outlet_id))) then raise exception using errcode='42501',message='Applicant is unavailable.'; end if;
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
end $$;

create function public.recruitment_issue_invitation(p_application_id uuid,p_expires_at timestamptz)
returns text language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.recruitment_actor('recruitment.manage'); v_application public.recruitment_applications%rowtype; v_opening public.recruitment_openings%rowtype; v_config_id uuid; v_token text; v_invitation uuid; v_attempt uuid;
begin
  select * into v_application from public.recruitment_applications where id=p_application_id for update;
  select * into v_opening from public.recruitment_openings where id=v_application.opening_id;
  if v_application.id is null or v_opening.status<>'open' or not public.recruitment_opening_in_scope(v_opening.outlet_id) then raise exception using errcode='42501',message='Application is unavailable.'; end if;
  if p_expires_at<=clock_timestamp()+interval '1 hour' or p_expires_at>clock_timestamp()+interval '30 days' then raise exception using errcode='22023',message='Choose an expiry between one hour and 30 days.'; end if;
  update public.recruitment_invitations set revoked_at=clock_timestamp() where application_id=p_application_id and revoked_at is null;
  select id into v_config_id from public.recruitment_interview_configs where opening_id=v_opening.id and version=v_opening.config_version;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.recruitment_invitations(application_id,token_hash,expires_at,issued_by) values(p_application_id,encode(extensions.digest(v_token,'sha256'),'hex'),p_expires_at,v_actor) returning id into v_invitation;
  insert into public.recruitment_interview_attempts(invitation_id,application_id,opening_id,config_version_id) values(v_invitation,p_application_id,v_opening.id,v_config_id) returning id into v_attempt;
  update public.recruitment_applications set status='invited' where id=p_application_id;
  insert into public.recruitment_events(opening_id,application_id,attempt_id,action,actor_employee_id) values(v_opening.id,p_application_id,v_attempt,'invitation_issued',v_actor);
  return v_token;
end $$;

create function public.recruitment_revoke_invitation(p_application_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.recruitment_actor('recruitment.manage'); v_opening public.recruitment_openings%rowtype;
begin
  select o.* into v_opening from public.recruitment_applications a join public.recruitment_openings o on o.id=a.opening_id where a.id=p_application_id;
  if v_opening.id is null or not public.recruitment_opening_in_scope(v_opening.outlet_id) then raise exception using errcode='42501',message='Application is unavailable.'; end if;
  update public.recruitment_invitations set revoked_at=clock_timestamp() where application_id=p_application_id and revoked_at is null;
  insert into public.recruitment_events(opening_id,application_id,action,actor_employee_id) values(v_opening.id,p_application_id,'invitation_revoked',v_actor);
end $$;

create function public.recruitment_public_attempt(p_token text)
returns public.recruitment_interview_attempts language plpgsql security definer set search_path=public as $$
declare v_attempt public.recruitment_interview_attempts%rowtype;
begin
  if p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select t.* into v_attempt from public.recruitment_invitations i join public.recruitment_interview_attempts t on t.invitation_id=i.id join public.recruitment_openings o on o.id=t.opening_id
  where i.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and i.revoked_at is null and i.expires_at>clock_timestamp() and o.status='open';
  return v_attempt;
end $$;

create function public.recruitment_public_entry(p_token text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_attempt public.recruitment_interview_attempts%rowtype; v_data jsonb;
begin
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then return jsonb_build_object('available',false); end if;
  select jsonb_build_object('available',true,'job',jsonb_build_object('title',a.opening_title_snapshot,'position',a.position_snapshot,'workplace',a.workplace_snapshot,'company',a.legal_entity_snapshot,'description',a.opening_description_snapshot,'candidate_instructions',c.candidate_instructions,'target_minutes',c.target_minutes,'max_minutes',c.max_minutes),'profile',jsonb_build_object('full_name',coalesce(t.profile_name,p.full_name),'contact',coalesce(t.profile_contact,p.contact)),'status',t.status,'consented',exists(select 1 from public.recruitment_consents x where x.attempt_id=t.id),'copy_version',v.version,'consent_copy',v.copy,'consent_status',v.status) into v_data
  from public.recruitment_interview_attempts t join public.recruitment_applications a on a.id=t.application_id join public.recruitment_applicants p on p.id=a.applicant_id join public.recruitment_openings o on o.id=t.opening_id join public.recruitment_interview_configs c on c.id=t.config_version_id cross join public.recruitment_consent_copy_versions v where t.id=v_attempt.id and v.version='phase1-provisional-v1';
  return v_data;
end $$;

create function public.recruitment_public_confirm_profile(p_token text,p_name text,p_contact text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_attempt public.recruitment_interview_attempts%rowtype;
begin
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  if length(btrim(coalesce(p_name,''))) not between 2 and 160 or length(btrim(coalesce(p_contact,''))) not between 5 and 40 then raise exception using errcode='22023',message='Confirm a valid name and contact number.'; end if;
  if v_attempt.status='invited' then
    update public.recruitment_interview_attempts set profile_name=btrim(p_name),profile_contact=btrim(p_contact),profile_confirmed_at=clock_timestamp(),status='profile_confirmed' where id=v_attempt.id;
    insert into public.recruitment_events(opening_id,application_id,attempt_id,action) values(v_attempt.opening_id,v_attempt.application_id,v_attempt.id,'profile_confirmed');
  elsif (v_attempt.profile_name,v_attempt.profile_contact) is distinct from (btrim(p_name),btrim(p_contact)) then
    raise exception using errcode='55000',message='Profile was already confirmed.';
  end if;
  return public.recruitment_public_entry(p_token);
end $$;

create function public.recruitment_public_consent(p_token text,p_copy_version text,p_accepted jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_attempt public.recruitment_interview_attempts%rowtype; v_copy jsonb;
begin
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  if v_attempt.status='invited' then raise exception using errcode='55000',message='Confirm your profile first.'; end if;
  select copy into v_copy from public.recruitment_consent_copy_versions where version=p_copy_version;
  if p_copy_version<>'phase1-provisional-v1' or v_copy is null then raise exception using errcode='22023',message='Consent copy has changed. Reload this page.'; end if;
  if p_accepted is distinct from '{"ai":true,"recording":true,"review":true}'::jsonb then raise exception using errcode='22023',message='All three consent purposes must be accepted.'; end if;
  insert into public.recruitment_consents(attempt_id,application_id,copy_version,copy_snapshot,accepted_purposes) values(v_attempt.id,v_attempt.application_id,p_copy_version,v_copy,p_accepted) on conflict(attempt_id) do nothing;
  update public.recruitment_interview_attempts set status='consented' where id=v_attempt.id and status='profile_confirmed';
  if found then insert into public.recruitment_events(opening_id,application_id,attempt_id,action,details) values(v_attempt.opening_id,v_attempt.application_id,v_attempt.id,'consent_accepted',jsonb_build_object('copy_version',p_copy_version)); end if;
  return public.recruitment_public_entry(p_token);
end $$;

create function public.recruitment_public_ready(p_token text,p_device_check jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_attempt public.recruitment_interview_attempts%rowtype;
begin
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  if v_attempt.status not in ('consented','ready') or not exists(select 1 from public.recruitment_consents where attempt_id=v_attempt.id) then raise exception using errcode='55000',message='Consent is required before device check.'; end if;
  if p_device_check->>'camera' <> 'ready' or p_device_check->>'microphone' <> 'ready' then raise exception using errcode='22023',message='Camera and microphone must be ready.'; end if;
  update public.recruitment_interview_attempts set status='ready',device_check=jsonb_build_object('camera','ready','microphone','ready','checked_at',clock_timestamp()),ready_at=coalesce(ready_at,clock_timestamp()) where id=v_attempt.id and status='consented';
  if found then
    update public.recruitment_applications set status='ready' where id=v_attempt.application_id;
    insert into public.recruitment_events(opening_id,application_id,attempt_id,action) values(v_attempt.opening_id,v_attempt.application_id,v_attempt.id,'device_ready');
  end if;
  return public.recruitment_public_entry(p_token);
end $$;

revoke all on function public.recruitment_immutable_evidence(),public.recruitment_actor(text),public.recruitment_opening_in_scope(uuid),public.recruitment_admin_data(integer,integer),public.recruitment_find_applicants(text),public.recruitment_save_opening(jsonb),public.recruitment_register_application(uuid,jsonb,uuid),public.recruitment_issue_invitation(uuid,timestamptz),public.recruitment_revoke_invitation(uuid),public.recruitment_public_attempt(text),public.recruitment_public_entry(text),public.recruitment_public_confirm_profile(text,text,text),public.recruitment_public_consent(text,text,jsonb),public.recruitment_public_ready(text,jsonb) from public,anon,authenticated;
grant execute on function public.recruitment_admin_data(integer,integer),public.recruitment_find_applicants(text),public.recruitment_save_opening(jsonb),public.recruitment_register_application(uuid,jsonb,uuid),public.recruitment_issue_invitation(uuid,timestamptz),public.recruitment_revoke_invitation(uuid) to authenticated;
grant execute on function public.recruitment_public_entry(text),public.recruitment_public_confirm_profile(text,text,text),public.recruitment_public_consent(text,text,jsonb),public.recruitment_public_ready(text,jsonb) to anon,authenticated;
