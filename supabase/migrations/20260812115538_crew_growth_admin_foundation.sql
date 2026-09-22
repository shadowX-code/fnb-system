-- Crew Growth Admin Foundation: outlet-scoped skills, server-derived evidence,
-- practical assessment and append-only certification history.

insert into public.permissions (code, module, description)
values
  ('crew_growth.view', 'Crew Growth', 'View outlet-scoped Crew skills and growth profiles.'),
  ('crew_growth.manage', 'Crew Growth', 'Create and maintain outlet-scoped Crew skills and requirements.'),
  ('crew_growth.assess', 'Crew Growth', 'Record practical Crew skill assessments.'),
  ('crew_growth.certify', 'Crew Growth', 'Issue and renew Crew skill certifications.')
on conflict (code) do update set module=excluded.module, description=excluded.description;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where lower(r.name) in ('owner','admin')
  and p.code in ('crew_growth.view','crew_growth.manage','crew_growth.assess','crew_growth.certify')
on conflict do nothing;

create table public.crew_skills (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  name text not null,
  category text not null default 'Other',
  description text,
  status text not null default 'active' check (status in ('active','inactive')),
  certification_method text not null default 'learning' check (certification_method in ('learning','learning_and_review','manager_review','manual')),
  validity_months integer check (validity_months is null or validity_months between 1 and 120),
  requirements_version integer not null default 1 check (requirements_version > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id, name)
);

create table public.crew_skill_positions (
  skill_id uuid not null references public.crew_skills(id) on delete cascade,
  position text not null,
  primary key (skill_id, position)
);

create table public.crew_skill_outlets (
  skill_id uuid not null references public.crew_skills(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  primary key (skill_id, outlet_id)
);

create table public.crew_skill_requirements (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.crew_skills(id) on delete cascade,
  requirement_type text not null check (requirement_type in ('module','lesson','sop','quiz','practical','performance','manual')),
  reference_id uuid,
  label_snapshot text not null,
  required boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  unique (skill_id, sort_order),
  check (
    (requirement_type in ('module','lesson','sop','quiz') and reference_id is not null)
    or (requirement_type in ('practical','performance','manual'))
  )
);

create table public.crew_practical_assessments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  skill_id uuid not null references public.crew_skills(id) on delete restrict,
  requirements_version integer not null,
  result text not null check (result in ('pass','needs_improvement')),
  checklist jsonb not null default '[]'::jsonb,
  note text,
  assessed_by uuid not null references auth.users(id),
  assessed_at timestamptz not null default now()
);

create table public.crew_skill_certifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  skill_id uuid not null references public.crew_skills(id) on delete restrict,
  requirements_version integer not null,
  status text not null default 'certified' check (status in ('certified','superseded','revoked')),
  certified_at timestamptz not null default now(),
  certified_by uuid not null references auth.users(id),
  expires_at timestamptz,
  evidence_snapshot jsonb not null,
  note text
);

create index crew_skills_outlet_status_idx on public.crew_skills(outlet_id,status);
create index crew_skill_requirements_skill_idx on public.crew_skill_requirements(skill_id,sort_order);
create index crew_practical_assessments_employee_skill_idx on public.crew_practical_assessments(employee_id,skill_id,assessed_at desc);
create index crew_skill_certifications_employee_skill_idx on public.crew_skill_certifications(employee_id,skill_id,certified_at desc);
create unique index crew_skill_certifications_one_current_idx on public.crew_skill_certifications(employee_id,skill_id) where status='certified';

alter table public.crew_skills enable row level security;
alter table public.crew_skill_positions enable row level security;
alter table public.crew_skill_outlets enable row level security;
alter table public.crew_skill_requirements enable row level security;
alter table public.crew_practical_assessments enable row level security;
alter table public.crew_skill_certifications enable row level security;

create or replace function public.crew_growth_can_access_skill(p_skill_id uuid, p_permission text default 'crew_growth.view')
returns boolean language sql stable security definer set search_path=public as $$
  select public.current_user_has_permission(p_permission)
    and exists (
      select 1 from public.crew_skills s
      where s.id=p_skill_id and public.current_user_can_access_outlet(s.outlet_id)
    );
$$;
revoke all on function public.crew_growth_can_access_skill(uuid,text) from public,anon,authenticated;

create policy crew_skills_view on public.crew_skills for select to authenticated
using (public.current_user_has_permission('crew_growth.view') and public.current_user_can_access_outlet(outlet_id));
create policy crew_skills_manage on public.crew_skills for all to authenticated
using (public.current_user_has_permission('crew_growth.manage') and public.current_user_can_access_outlet(outlet_id))
with check (public.current_user_has_permission('crew_growth.manage') and public.current_user_can_access_outlet(outlet_id));
create policy crew_skill_positions_view on public.crew_skill_positions for select to authenticated
using (public.crew_growth_can_access_skill(skill_id,'crew_growth.view'));
create policy crew_skill_positions_manage on public.crew_skill_positions for all to authenticated
using (public.crew_growth_can_access_skill(skill_id,'crew_growth.manage'))
with check (public.crew_growth_can_access_skill(skill_id,'crew_growth.manage'));
create policy crew_skill_outlets_view on public.crew_skill_outlets for select to authenticated
using (public.crew_growth_can_access_skill(skill_id,'crew_growth.view'));
create policy crew_skill_outlets_manage on public.crew_skill_outlets for all to authenticated
using (public.crew_growth_can_access_skill(skill_id,'crew_growth.manage'))
with check (public.crew_growth_can_access_skill(skill_id,'crew_growth.manage') and public.current_user_can_access_outlet(outlet_id));
create policy crew_skill_requirements_view on public.crew_skill_requirements for select to authenticated
using (public.crew_growth_can_access_skill(skill_id,'crew_growth.view'));
create policy crew_skill_requirements_manage on public.crew_skill_requirements for all to authenticated
using (public.crew_growth_can_access_skill(skill_id,'crew_growth.manage'))
with check (public.crew_growth_can_access_skill(skill_id,'crew_growth.manage'));
create policy crew_practical_assessments_view on public.crew_practical_assessments for select to authenticated
using (public.crew_growth_can_access_skill(skill_id,'crew_growth.view'));
create policy crew_skill_certifications_view on public.crew_skill_certifications for select to authenticated
using (public.crew_growth_can_access_skill(skill_id,'crew_growth.view'));

revoke all on table public.crew_skills,public.crew_skill_positions,public.crew_skill_outlets,public.crew_skill_requirements,public.crew_practical_assessments,public.crew_skill_certifications from public,anon;
grant select on table public.crew_skills,public.crew_skill_positions,public.crew_skill_outlets,public.crew_skill_requirements to authenticated;
grant select on table public.crew_practical_assessments,public.crew_skill_certifications to authenticated;

drop policy if exists "crew learning admins can view scoped outlets" on public.outlets;
create policy "crew learning admins can view scoped outlets" on public.outlets for select to authenticated using (
  (public.current_user_has_permission('crew_learning.view') or public.current_user_has_permission('crew_learning.manage')
   or public.current_user_has_permission('crew_sop.view') or public.current_user_has_permission('crew_sop.manage')
   or public.current_user_has_permission('crew_growth.view') or public.current_user_has_permission('crew_growth.manage')
   or public.current_user_has_permission('crew_growth.assess') or public.current_user_has_permission('crew_growth.certify'))
  and public.current_user_can_access_outlet(id)
);

create or replace function public.crew_growth_employee_outlet(p_employee_id uuid)
returns uuid language sql stable security definer set search_path=public as $$
  select ca.primary_outlet_id from public.crew_access ca where ca.employee_id=p_employee_id;
$$;
revoke all on function public.crew_growth_employee_outlet(uuid) from public,anon,authenticated;

create or replace function public.crew_growth_skill_applicable(p_employee_id uuid,p_skill_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1
    from public.crew_skills s
    join public.employees e on e.id=p_employee_id and e.is_active and e.employment_status='active'
    where s.id=p_skill_id and s.status='active'
      and s.outlet_id=public.crew_growth_employee_outlet(e.id)
      and (not exists(select 1 from public.crew_skill_positions sp where sp.skill_id=s.id)
           or exists(select 1 from public.crew_skill_positions sp where sp.skill_id=s.id and lower(sp.position)=lower(coalesce(e.position,''))))
      and (not exists(select 1 from public.crew_skill_outlets so where so.skill_id=s.id)
           or exists(select 1 from public.crew_skill_outlets so where so.skill_id=s.id and so.outlet_id=public.crew_growth_employee_outlet(e.id)))
  );
$$;
revoke all on function public.crew_growth_skill_applicable(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_growth_requirement_evidence(p_employee_id uuid,p_requirement_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r public.crew_skill_requirements%rowtype; completed boolean:=false; detail text; score integer; assessed_at timestamptz;
begin
  select * into r from public.crew_skill_requirements where id=p_requirement_id;
  if not found then raise exception using errcode='P0002',message='Skill requirement not found.'; end if;
  if r.requirement_type='module' then
    select exists(select 1 from public.crew_module_progress mp join public.crew_journey_assignments a on a.id=mp.assignment_id where a.employee_id=p_employee_id and mp.module_id=r.reference_id and mp.status='completed') into completed;
    detail:=case when completed then 'Onboarding module completed' else 'Onboarding module pending' end;
  elsif r.requirement_type='lesson' then
    select exists(select 1 from public.crew_lesson_progress lp join public.crew_journey_assignments a on a.id=lp.assignment_id where a.employee_id=p_employee_id and lp.lesson_id=r.reference_id and lp.status='completed') into completed;
    detail:=case when completed then 'Lesson completed' else 'Lesson pending' end;
  elsif r.requirement_type='sop' then
    select exists(select 1 from public.crew_sop_acknowledgements sa where sa.employee_id=p_employee_id and sa.sop_version_id=r.reference_id) into completed;
    detail:=case when completed then 'SOP acknowledged' else 'SOP acknowledgement pending' end;
  elsif r.requirement_type='quiz' then
    select qa.score,qa.completed_at into score,assessed_at from public.crew_quiz_attempts qa where qa.employee_id=p_employee_id and qa.quiz_id=r.reference_id and qa.passed order by qa.completed_at desc limit 1;
    completed:=score is not null; detail:=case when completed then format('Knowledge Check passed · %s%%',score) else 'Knowledge Check pending' end;
  elsif r.requirement_type='practical' then
    select pa.result='pass',pa.assessed_at into completed,assessed_at from public.crew_practical_assessments pa join public.crew_skills s on s.id=pa.skill_id where pa.employee_id=p_employee_id and pa.skill_id=r.skill_id and pa.requirements_version=s.requirements_version order by pa.assessed_at desc limit 1;
    completed:=coalesce(completed,false); detail:=case when completed then 'Practical review passed' else 'Manager practical review pending' end;
  elsif r.requirement_type='manual' then
    completed:=false; detail:='Manager certification required';
  else
    completed:=false; detail:='Performance evidence reserved for a future phase';
  end if;
  return jsonb_build_object('requirement_id',r.id,'type',r.requirement_type,'label',r.label_snapshot,'required',r.required,'completed',completed,'detail',detail,'score',score,'completed_at',assessed_at);
end;
$$;
revoke all on function public.crew_growth_requirement_evidence(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_growth_employee_skill(p_employee_id uuid,p_skill_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare s public.crew_skills%rowtype; cert public.crew_skill_certifications%rowtype; requirements jsonb; history jsonb; total integer; done integer; automated_total integer; automated_done integer; practical_required boolean; manual_required boolean; status text; applicable boolean;
begin
  select * into s from public.crew_skills where id=p_skill_id;
  if not found then raise exception using errcode='P0002',message='Skill not found.'; end if;
  applicable:=public.crew_growth_skill_applicable(p_employee_id,p_skill_id);
  select * into cert from public.crew_skill_certifications where employee_id=p_employee_id and skill_id=p_skill_id and status='certified' order by certified_at desc limit 1;
  select coalesce(jsonb_agg(public.crew_growth_requirement_evidence(p_employee_id,r.id) order by r.sort_order),'[]'::jsonb) into requirements from public.crew_skill_requirements r where r.skill_id=p_skill_id;
  select count(*) filter(where required),count(*) filter(where required and coalesce((e->>'completed')::boolean,false)),count(*) filter(where required and e->>'type' not in ('practical','manual','performance')),count(*) filter(where required and e->>'type' not in ('practical','manual','performance') and coalesce((e->>'completed')::boolean,false)),bool_or(required and e->>'type'='practical'),bool_or(required and e->>'type'='manual') into total,done,automated_total,automated_done,practical_required,manual_required from jsonb_array_elements(requirements) e;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,'requirements_version',c.requirements_version,'certified_at',c.certified_at,'certified_by',c.certified_by,'expires_at',c.expires_at,'evidence',c.evidence_snapshot,'note',c.note) order by c.certified_at desc),'[]'::jsonb) into history from public.crew_skill_certifications c where c.employee_id=p_employee_id and c.skill_id=p_skill_id;
  if not applicable then status:='not_applicable';
  elsif cert.id is not null and cert.expires_at is not null and cert.expires_at<=now() then status:='expired';
  elsif cert.id is not null and cert.expires_at is not null and cert.expires_at<=now()+interval '30 days' then status:='needs_renewal';
  elsif cert.id is not null then status:='certified';
  elsif coalesce(automated_total,0)>0 and automated_done=automated_total and coalesce(practical_required,false) then status:='ready_for_review';
  elsif coalesce(automated_done,0)=coalesce(automated_total,0) and coalesce(manual_required,false) then status:='ready_for_review';
  elsif total>0 and done=total then status:='ready_for_review';
  elsif done>0 then status:='in_progress';
  else status:='not_started'; end if;
  return jsonb_build_object('employee_id',p_employee_id,'skill_id',p_skill_id,'status',status,'applicable',applicable,'requirements',requirements,'requirements_completed',coalesce(done,0),'requirements_total',coalesce(total,0),'certification',case when cert.id is null then null else jsonb_build_object('id',cert.id,'certified_at',cert.certified_at,'expires_at',cert.expires_at,'requirements_version',cert.requirements_version) end,'certification_history',history);
end;
$$;
revoke all on function public.crew_growth_employee_skill(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_growth_admin_data(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare skills jsonb; crew jsonb; recent jsonb; reviews jsonb;
begin
  if not public.current_user_has_permission('crew_growth.view') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Growth is unavailable for this outlet.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'outlet_id',s.outlet_id,'name',s.name,'category',s.category,'description',s.description,'status',s.status,'certification_method',s.certification_method,'validity_months',s.validity_months,'requirements_version',s.requirements_version,'updated_at',s.updated_at,'positions',(select coalesce(jsonb_agg(sp.position order by sp.position),'[]'::jsonb) from public.crew_skill_positions sp where sp.skill_id=s.id),'outlets',(select coalesce(jsonb_agg(so.outlet_id order by so.outlet_id),'[]'::jsonb) from public.crew_skill_outlets so where so.skill_id=s.id),'requirements',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'type',r.requirement_type,'reference_id',r.reference_id,'label',r.label_snapshot,'required',r.required,'config',r.config,'sort_order',r.sort_order) order by r.sort_order),'[]'::jsonb) from public.crew_skill_requirements r where r.skill_id=s.id)) order by s.name),'[]'::jsonb) into skills from public.crew_skills s where s.outlet_id=p_outlet_id;
  select coalesce(jsonb_agg(jsonb_build_object('employee',jsonb_build_object('id',e.id,'full_name',e.full_name,'employee_code',e.employee_code,'position',e.position),'skills',(select coalesce(jsonb_agg(public.crew_growth_employee_skill(e.id,s.id) order by s.name),'[]'::jsonb) from public.crew_skills s where s.outlet_id=p_outlet_id)) order by e.full_name),'[]'::jsonb) into crew from public.employees e join public.crew_access ca on ca.employee_id=e.id and ca.primary_outlet_id=p_outlet_id where e.is_active and e.employment_status='active';
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'employee_id',c.employee_id,'employee_name',e.full_name,'skill_id',c.skill_id,'skill_name',s.name,'certified_at',c.certified_at,'certified_by',coalesce(up.full_name,up.email,'FeedX Admin'),'expires_at',c.expires_at) order by c.certified_at desc),'[]'::jsonb) into recent from public.crew_skill_certifications c join public.crew_skills s on s.id=c.skill_id join public.employees e on e.id=c.employee_id left join public.user_profiles up on up.id=c.certified_by where s.outlet_id=p_outlet_id and c.status='certified';
  select coalesce(jsonb_agg(x.row_data order by x.employee_name,x.skill_name),'[]'::jsonb) into reviews from (select e.full_name employee_name,s.name skill_name,jsonb_build_object('employee_id',e.id,'employee_name',e.full_name,'position',e.position,'skill_id',s.id,'skill_name',s.name,'state',public.crew_growth_employee_skill(e.id,s.id)) row_data from public.employees e join public.crew_access ca on ca.employee_id=e.id and ca.primary_outlet_id=p_outlet_id cross join public.crew_skills s where s.outlet_id=p_outlet_id and e.is_active and e.employment_status='active' and (public.crew_growth_employee_skill(e.id,s.id)->>'status') in ('ready_for_review','needs_renewal','expired')) x;
  return jsonb_build_object('skills',skills,'crew',crew,'reviews',reviews,'recent_certifications',recent);
end;
$$;
revoke all on function public.crew_growth_admin_data(uuid) from public,anon,authenticated;
grant execute on function public.crew_growth_admin_data(uuid) to authenticated;

create or replace function public.crew_growth_save_skill(p_skill jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_skill_id uuid; v_outlet_id uuid; prior_version integer; item jsonb; ordinal integer:=0;
begin
  v_outlet_id:=(p_skill->>'outlet_id')::uuid;
  if not public.current_user_has_permission('crew_growth.manage') or not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode='42501',message='You cannot manage Growth for this outlet.'; end if;
  if nullif(trim(p_skill->>'name'),'') is null or nullif(trim(p_skill->>'category'),'') is null then raise exception using errcode='22023',message='Skill name and category are required.'; end if;
  v_skill_id:=nullif(p_skill->>'id','')::uuid;
  if v_skill_id is null then
    insert into public.crew_skills(outlet_id,name,category,description,status,certification_method,validity_months,created_by) values(v_outlet_id,trim(p_skill->>'name'),trim(p_skill->>'category'),nullif(trim(p_skill->>'description'),''),coalesce(p_skill->>'status','active'),coalesce(p_skill->>'certification_method','learning'),nullif(p_skill->>'validity_months','')::integer,auth.uid()) returning id into v_skill_id;
  else
    select requirements_version into prior_version from public.crew_skills where id=v_skill_id and outlet_id=v_outlet_id for update;
    if not found then raise exception using errcode='42501',message='Skill is unavailable.'; end if;
    update public.crew_skills set name=trim(p_skill->>'name'),category=trim(p_skill->>'category'),description=nullif(trim(p_skill->>'description'),''),status=coalesce(p_skill->>'status','active'),certification_method=coalesce(p_skill->>'certification_method','learning'),validity_months=nullif(p_skill->>'validity_months','')::integer,requirements_version=prior_version+1,updated_at=now() where id=v_skill_id;
    delete from public.crew_skill_positions where skill_id=v_skill_id;
    delete from public.crew_skill_outlets where skill_id=v_skill_id;
    delete from public.crew_skill_requirements where skill_id=v_skill_id;
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_skill->'positions','[]'::jsonb)) loop insert into public.crew_skill_positions values(v_skill_id,trim(both '"' from item::text)) on conflict do nothing; end loop;
  for item in select value from jsonb_array_elements(coalesce(p_skill->'outlets','[]'::jsonb)) loop if public.current_user_can_access_outlet((trim(both '"' from item::text))::uuid) then insert into public.crew_skill_outlets values(v_skill_id,(trim(both '"' from item::text))::uuid) on conflict do nothing; else raise exception using errcode='42501',message='Skill outlet scope is unavailable.'; end if; end loop;
  for item in select value from jsonb_array_elements(coalesce(p_skill->'requirements','[]'::jsonb)) loop ordinal:=ordinal+1; insert into public.crew_skill_requirements(skill_id,requirement_type,reference_id,label_snapshot,required,config,sort_order) values(v_skill_id,item->>'type',nullif(item->>'reference_id','')::uuid,coalesce(nullif(trim(item->>'label'),''),'Requirement'),coalesce((item->>'required')::boolean,true),coalesce(item->'config','{}'::jsonb),ordinal); end loop;
  return v_skill_id;
end;
$$;
revoke all on function public.crew_growth_save_skill(jsonb) from public,anon,authenticated;
grant execute on function public.crew_growth_save_skill(jsonb) to authenticated;

create or replace function public.crew_growth_submit_assessment(p_employee_id uuid,p_skill_id uuid,p_result text,p_checklist jsonb,p_note text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare assessment_id uuid; skill_version integer; employee_outlet uuid;
begin
  if p_result not in ('pass','needs_improvement') or jsonb_typeof(coalesce(p_checklist,'[]'::jsonb))<>'array' then raise exception using errcode='22023',message='Assessment payload is invalid.'; end if;
  if not public.current_user_has_permission('crew_growth.assess') or not public.crew_growth_can_access_skill(p_skill_id,'crew_growth.view') then raise exception using errcode='42501',message='You cannot assess this skill.'; end if;
  employee_outlet:=public.crew_growth_employee_outlet(p_employee_id);
  select requirements_version into skill_version from public.crew_skills where id=p_skill_id and outlet_id=employee_outlet;
  if not found or not public.crew_growth_skill_applicable(p_employee_id,p_skill_id) then raise exception using errcode='42501',message='Employee is outside this skill scope.'; end if;
  insert into public.crew_practical_assessments(employee_id,skill_id,requirements_version,result,checklist,note,assessed_by) values(p_employee_id,p_skill_id,skill_version,p_result,p_checklist,nullif(trim(p_note),''),auth.uid()) returning id into assessment_id;
  return assessment_id;
end;
$$;
revoke all on function public.crew_growth_submit_assessment(uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.crew_growth_submit_assessment(uuid,uuid,text,jsonb,text) to authenticated;

create or replace function public.crew_growth_certify(p_employee_id uuid,p_skill_id uuid,p_note text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare s public.crew_skills%rowtype; state jsonb; unmet integer; certification_id uuid; evidence jsonb;
begin
  if not public.current_user_has_permission('crew_growth.certify') or not public.crew_growth_can_access_skill(p_skill_id,'crew_growth.view') then raise exception using errcode='42501',message='You cannot certify this skill.'; end if;
  select * into s from public.crew_skills where id=p_skill_id for update;
  if not public.crew_growth_skill_applicable(p_employee_id,p_skill_id) then raise exception using errcode='42501',message='Employee is outside this skill scope.'; end if;
  state:=public.crew_growth_employee_skill(p_employee_id,p_skill_id);
  select count(*) into unmet from jsonb_array_elements(state->'requirements') e where coalesce((e->>'required')::boolean,false) and e->>'type' not in ('manual','performance') and not coalesce((e->>'completed')::boolean,false);
  if unmet>0 then raise exception using errcode='22023',message='Required learning or practical evidence is incomplete.'; end if;
  evidence:=jsonb_build_object('skill',jsonb_build_object('id',s.id,'name',s.name,'requirements_version',s.requirements_version),'requirements',state->'requirements','certified_at',now());
  update public.crew_skill_certifications set status='superseded' where employee_id=p_employee_id and skill_id=p_skill_id and status='certified';
  insert into public.crew_skill_certifications(employee_id,skill_id,requirements_version,certified_by,expires_at,evidence_snapshot,note) values(p_employee_id,p_skill_id,s.requirements_version,auth.uid(),case when s.validity_months is null then null else now()+make_interval(months=>s.validity_months) end,evidence,nullif(trim(p_note),'')) returning id into certification_id;
  return certification_id;
end;
$$;
revoke all on function public.crew_growth_certify(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.crew_growth_certify(uuid,uuid,text) to authenticated;

create or replace function public.crew_growth_history_guard() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_table_name='crew_skill_certifications' and tg_op='UPDATE'
     and old.status='certified' and new.status='superseded'
     and new.employee_id=old.employee_id and new.skill_id=old.skill_id
     and new.requirements_version=old.requirements_version and new.certified_at=old.certified_at
     and new.certified_by=old.certified_by and new.expires_at is not distinct from old.expires_at
     and new.evidence_snapshot=old.evidence_snapshot and new.note is not distinct from old.note then
    return new;
  end if;
  raise exception using errcode='42501',message='Growth history is append-only.';
end;
$$;
revoke all on function public.crew_growth_history_guard() from public,anon,authenticated;
create trigger crew_practical_assessments_append_only before update or delete on public.crew_practical_assessments for each row execute function public.crew_growth_history_guard();
create trigger crew_skill_certifications_append_only before update or delete on public.crew_skill_certifications for each row execute function public.crew_growth_history_guard();

comment on table public.crew_skill_certifications is 'Append-only Crew certification history. Evidence is frozen per skill requirements version.';
