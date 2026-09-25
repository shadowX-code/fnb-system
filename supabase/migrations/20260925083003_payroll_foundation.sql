-- People / Payroll Phase 1. No payable-time, statutory amount, payment or payslip calculation.
-- All salary and run writes are command-owned; exposed tables have no client grants.

insert into public.permissions(code,module,description) values
  ('payroll.view','People','View scoped payroll profiles and foundation runs'),
  ('payroll.manage','People','Maintain scoped payroll profiles and foundation settings'),
  ('payroll.finalize','People','Finalize payroll foundation run evidence')
on conflict(code) do update set module=excluded.module,description=excluded.description;

-- New sensitive authority is deliberately granted only to protected administrator roles.
-- Employee-view permissions do not confer payroll access.
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where lower(r.name) in ('owner','admin') and p.code in ('payroll.view','payroll.manage','payroll.finalize')
on conflict do nothing;

create table public.payroll_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete restrict,
  created_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

-- Effective intervals are derived from the next effective_from. Rows never get closed
-- or rewritten, so an older version remains exact historical evidence.
create table public.payroll_compensation_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.payroll_profiles(id) on delete restrict,
  effective_from date not null,
  legal_entity_id uuid not null references public.legal_entities(id) on delete restrict,
  pay_basis text not null check(pay_basis in ('monthly','hourly')),
  currency text not null default 'MYR' check(currency ~ '^[A-Z]{3}$'),
  basic_salary numeric(14,2),
  hourly_rate numeric(14,4),
  default_cost_outlet_id uuid references public.outlets(id) on delete restrict,
  workplace_snapshot text,
  source_document_id uuid references public.employee_employment_documents(id) on delete restrict,
  provenance text not null default 'manual' check(provenance in ('manual','contract_reference','import')),
  reason text not null check(nullif(btrim(reason),'') is not null),
  approved_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(profile_id,effective_from),
  check (
    (pay_basis='monthly' and basic_salary>0 and hourly_rate is null)
    or (pay_basis='hourly' and hourly_rate>0 and basic_salary is null)
  )
);
create index payroll_compensation_effective_idx on public.payroll_compensation_versions(profile_id,effective_from desc);

create table public.payroll_component_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check(code ~ '^[a-z][a-z0-9_]*$'),
  name text not null check(nullif(btrim(name),'') is not null),
  component_type text not null check(component_type in ('earning','allowance','deduction','reimbursement')),
  epf_treatment text not null default 'undetermined' check(epf_treatment in ('included','excluded','undetermined')),
  socso_treatment text not null default 'undetermined' check(socso_treatment in ('included','excluded','undetermined')),
  eis_treatment text not null default 'undetermined' check(eis_treatment in ('included','excluded','undetermined')),
  pcb_treatment text not null default 'undetermined' check(pcb_treatment in ('included','excluded','undetermined')),
  is_active boolean not null default true,
  created_by_employee_id uuid references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);
insert into public.payroll_component_definitions(code,name,component_type)
values ('recurring_allowance','Recurring Allowance','allowance'),
       ('recurring_deduction','Recurring Deduction','deduction')
on conflict(code) do nothing;

create table public.payroll_recurring_component_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.payroll_profiles(id) on delete restrict,
  component_id uuid not null references public.payroll_component_definitions(id) on delete restrict,
  effective_from date not null,
  amount numeric(14,2) not null check(amount>=0),
  is_active boolean not null default true,
  reason text not null check(nullif(btrim(reason),'') is not null),
  approved_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(profile_id,component_id,effective_from),
  check(is_active or amount=0)
);
create index payroll_recurring_effective_idx on public.payroll_recurring_component_versions(profile_id,component_id,effective_from desc);

-- Eligibility is explicit and basis-independent. Null means not yet reviewed;
-- no contribution amount or statutory rate lives here.
create table public.payroll_statutory_profile_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.payroll_profiles(id) on delete restrict,
  effective_from date not null,
  epf_applicable boolean,
  socso_applicable boolean,
  eis_applicable boolean,
  pcb_applicable boolean,
  reason text not null check(nullif(btrim(reason),'') is not null),
  approved_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(profile_id,effective_from)
);
create index payroll_statutory_effective_idx on public.payroll_statutory_profile_versions(profile_id,effective_from desc);

-- Calendar authority only. The later pay engine must explicitly select the
-- applicable national/state/outlet/legal-employer holidays and version its rules.
create table public.payroll_public_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null check(nullif(btrim(name),'') is not null),
  scope text not null check(scope in ('national','state','outlet')),
  state_code text,
  outlet_id uuid references public.outlets(id) on delete restrict,
  legal_entity_id uuid references public.legal_entities(id) on delete restrict,
  is_active boolean not null default true,
  source_note text not null check(nullif(btrim(source_note),'') is not null),
  created_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check(
    (scope='national' and state_code is null and outlet_id is null)
    or (scope='state' and state_code ~ '^MY-[A-Z0-9]+$' and outlet_id is null)
    or (scope='outlet' and state_code is null and outlet_id is not null)
  )
);
create unique index payroll_holiday_identity_idx on public.payroll_public_holidays
  (holiday_date,lower(name),scope,coalesce(state_code,''),coalesce(outlet_id::text,''),coalesce(legal_entity_id::text,''));

create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  current_finalized_run_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique(legal_entity_id,period_start,period_end),
  check(period_end>=period_start)
);
create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.payroll_periods(id) on delete restrict,
  revision integer not null check(revision>0),
  supersedes_run_id uuid references public.payroll_runs(id) on delete restrict,
  status text not null default 'draft' check(status in ('draft','review_required','ready','finalized','paid')),
  foundation_only boolean not null default true check(foundation_only),
  reason text not null check(nullif(btrim(reason),'') is not null),
  created_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  finalized_by_employee_id uuid references public.employees(id) on delete restrict,
  finalized_at timestamptz,
  unique(period_id,revision),
  check((status in ('finalized','paid'))=(finalized_at is not null))
);
alter table public.payroll_periods add constraint payroll_period_current_run_fk
  foreign key(current_finalized_run_id) references public.payroll_runs(id) on delete restrict;
create unique index payroll_one_open_run_idx on public.payroll_runs(period_id)
  where status in ('draft','review_required','ready');

-- No amount is invented in Phase 1. This pins the exact foundation inputs
-- visible when a run is finalized; later phases add calculated line evidence.
create table public.payroll_run_profile_snapshots (
  run_id uuid not null references public.payroll_runs(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  profile_id uuid not null references public.payroll_profiles(id) on delete restrict,
  compensation_versions jsonb not null,
  statutory_versions jsonb not null,
  recurring_versions jsonb not null,
  employee_name_snapshot text not null,
  legal_entity_id_snapshot uuid not null references public.legal_entities(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key(run_id,employee_id)
);

create table public.payroll_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  profile_id uuid references public.payroll_profiles(id) on delete restrict,
  run_id uuid references public.payroll_runs(id) on delete restrict,
  holiday_id uuid references public.payroll_public_holidays(id) on delete restrict,
  component_id uuid references public.payroll_component_definitions(id) on delete restrict,
  actor_employee_id uuid not null references public.employees(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  reason text,
  details jsonb not null default '{}'::jsonb,
  check(num_nonnulls(profile_id,run_id,holiday_id,component_id)=1)
);
create index payroll_events_profile_idx on public.payroll_events(profile_id,occurred_at desc) where profile_id is not null;
create index payroll_events_run_idx on public.payroll_events(run_id,occurred_at desc) where run_id is not null;

-- Block ordinary and accidental direct mutation, including privileged writes
-- that bypass Data API grants. Trusted commands set a transaction-local marker.
create or replace function public.payroll_command_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_setting('feedx.payroll_command',true) is distinct from 'yes' then
    raise exception using errcode='42501',message='Payroll records require the canonical command authority.';
  end if;
  if tg_op='DELETE' then
    raise exception using errcode='55000',message='Payroll history cannot be deleted.';
  end if;
  if tg_op='UPDATE' and tg_table_name in
    ('payroll_compensation_versions','payroll_recurring_component_versions',
     'payroll_statutory_profile_versions','payroll_run_profile_snapshots','payroll_events') then
    raise exception using errcode='55000',message='Payroll historical evidence is immutable.';
  end if;
  if tg_op='UPDATE' and tg_table_name='payroll_runs' then
    if old.status in ('finalized','paid') then
      raise exception using errcode='55000',message='Finalized payroll runs are immutable.';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function public.payroll_effective_version_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if exists(select 1 from public.payroll_run_profile_snapshots s
      join public.payroll_runs r on r.id=s.run_id
      join public.payroll_periods period on period.id=r.period_id
      where s.profile_id=new.profile_id and r.status in ('finalized','paid')
        and period.period_end>=new.effective_from) then
    raise exception using errcode='55000',message='Use a controlled correction for a finalized period.';
  end if;
  return new;
end; $$;

create trigger payroll_compensation_finalized_guard before insert on public.payroll_compensation_versions
  for each row execute function public.payroll_effective_version_guard();
create trigger payroll_statutory_finalized_guard before insert on public.payroll_statutory_profile_versions
  for each row execute function public.payroll_effective_version_guard();
create trigger payroll_recurring_finalized_guard before insert on public.payroll_recurring_component_versions
  for each row execute function public.payroll_effective_version_guard();

-- Cost attribution is a People workplace projection, never a client-selected outlet.
create or replace function public.payroll_compensation_scope_guard()
returns trigger language plpgsql set search_path=public as $$
declare v_employee public.employees%rowtype; v_resolved_outlet uuid;
begin
  select e.* into v_employee from public.payroll_profiles p
    join public.employees e on e.id=p.employee_id where p.id=new.profile_id;
  if v_employee.id is null or v_employee.legal_entity_id is distinct from new.legal_entity_id then
    raise exception using errcode='23514',message='Payroll Legal Employer must match the employee assignment.';
  end if;
  v_resolved_outlet:=public.crew_resolve_employee_outlet(v_employee.id);
  if new.default_cost_outlet_id is not null and new.default_cost_outlet_id is distinct from v_resolved_outlet then
    raise exception using errcode='23514',message='Cost outlet must match the canonical employee workplace.';
  end if;
  new.default_cost_outlet_id:=v_resolved_outlet;
  new.workplace_snapshot:=v_employee.workplace;
  return new;
end; $$;
create trigger payroll_compensation_scope_guard before insert on public.payroll_compensation_versions
  for each row execute function public.payroll_compensation_scope_guard();
revoke all on function public.payroll_compensation_scope_guard() from public,anon,authenticated;


do $$ declare t text; begin
  foreach t in array array[
    'payroll_profiles','payroll_compensation_versions','payroll_component_definitions',
    'payroll_recurring_component_versions','payroll_statutory_profile_versions',
    'payroll_public_holidays','payroll_periods','payroll_runs',
    'payroll_run_profile_snapshots','payroll_events'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('create trigger payroll_command_guard before insert or update or delete on public.%I for each row execute function public.payroll_command_guard()',t);
  end loop;
end $$;

create or replace function public.payroll_admin_actor()
returns uuid language plpgsql stable security definer set search_path=public as $$
declare v_actor uuid;
begin
  select e.id into v_actor from public.employees e
  where e.auth_user_id=auth.uid() and e.is_active and e.enable_system_login
    and e.access_state='active' and e.employment_status not in ('resigned','terminated')
  limit 1;
  if v_actor is null then raise exception using errcode='42501',message='Active Admin employee identity required.'; end if;
  return v_actor;
end; $$;

create or replace function public.payroll_can_access_employee(p_employee_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.current_user_has_permission(p_permission)
    and exists(select 1 from public.employees e where e.id=p_employee_id
      and (public.current_user_has_all_outlet_access()
        or public.current_user_can_access_outlet(public.crew_resolve_employee_outlet(e.id))));
$$;

create or replace function public.payroll_can_manage_entity(p_legal_entity_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.current_user_has_permission(p_permission)
    and exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
      where e.auth_user_id=auth.uid() and e.is_active and e.enable_system_login
        and e.access_state='active' and lower(r.name) in ('owner','admin'))
    and exists(select 1 from public.legal_entities le where le.id=p_legal_entity_id);
$$;

-- Read authority never exposes an employee merely because Employees is visible.
create or replace function public.payroll_foundation_read(p_profile_id uuid default null,p_period_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_profiles jsonb; v_candidates jsonb; v_entities jsonb; v_components jsonb; v_holidays jsonb; v_periods jsonb;
begin
  perform public.payroll_admin_actor();
  if not public.current_user_has_permission('payroll.view') then
    raise exception using errcode='42501',message='Payroll view permission required.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'employee_id',e.id,'employee_name',e.full_name,'employee_code',e.employee_code,
    'workplace',e.workplace,'employment_type',e.employment_type,'employment_status',e.employment_status,
    'legal_entity_id',e.legal_entity_id,
    'compensation',coalesce((select jsonb_agg(to_jsonb(v) order by v.effective_from desc) from public.payroll_compensation_versions v where v.profile_id=p.id),'[]'::jsonb),
    'statutory',coalesce((select jsonb_agg(to_jsonb(s) order by s.effective_from desc) from public.payroll_statutory_profile_versions s where s.profile_id=p.id),'[]'::jsonb),
    'recurring',coalesce((select jsonb_agg(to_jsonb(c) order by c.effective_from desc) from public.payroll_recurring_component_versions c where c.profile_id=p.id),'[]'::jsonb)
  ) order by e.full_name),'[]'::jsonb) into v_profiles
  from public.payroll_profiles p join public.employees e on e.id=p.employee_id
  where (p_profile_id is null or p.id=p_profile_id)
    and public.payroll_can_access_employee(e.id,'payroll.view');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'name',e.full_name,'employee_code',e.employee_code,
    'legal_entity_id',e.legal_entity_id,'workplace',e.workplace,
    'employment_type',e.employment_type,'employment_status',e.employment_status)
    order by e.full_name),'[]'::jsonb) into v_candidates
  from public.employees e
  where e.legal_entity_id is not null
    and public.payroll_can_access_employee(e.id,'payroll.view');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',le.id,'name',le.legal_company_name,'display_name',le.display_name,'is_active',le.is_active)
    order by le.legal_company_name),'[]'::jsonb) into v_entities
  from public.legal_entities le
  where public.payroll_can_manage_entity(le.id,'payroll.view')
    or exists(select 1 from public.employees e where e.legal_entity_id=le.id
      and public.payroll_can_access_employee(e.id,'payroll.view'));

  select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]'::jsonb) into v_components
  from public.payroll_component_definitions c;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.holiday_date desc,h.name),'[]'::jsonb) into v_holidays
  from public.payroll_public_holidays h
  where public.payroll_can_manage_entity(h.legal_entity_id,'payroll.view')
    or (h.legal_entity_id is null and public.current_user_has_all_outlet_access());
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'legal_entity_id',p.legal_entity_id,'period_start',p.period_start,'period_end',p.period_end,
    'current_finalized_run_id',p.current_finalized_run_id,
    'runs',coalesce((select jsonb_agg(to_jsonb(r) order by r.revision desc) from public.payroll_runs r where r.period_id=p.id),'[]'::jsonb))
    order by p.period_start desc),'[]'::jsonb) into v_periods
  from public.payroll_periods p
  where (p_period_id is null or p.id=p_period_id)
    and public.payroll_can_manage_entity(p.legal_entity_id,'payroll.view');
  return jsonb_build_object('profiles',v_profiles,'employees',v_candidates,'legal_entities',v_entities,
    'components',v_components,'holidays',v_holidays,'periods',v_periods);
end; $$;

create or replace function public.payroll_profile_create(
  p_employee_id uuid,p_effective_from date,p_pay_basis text,p_rate numeric,p_currency text,
  p_reason text,p_source_document_id uuid default null,p_default_cost_outlet_id uuid default null,
  p_epf boolean default null,p_socso boolean default null,p_eis boolean default null,p_pcb boolean default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_employee public.employees%rowtype; v_profile uuid; v_document public.employee_employment_documents%rowtype;
begin
  if not public.payroll_can_access_employee(p_employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll profile scope denied.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id for share;
  if v_employee.legal_entity_id is null or not exists(select 1 from public.legal_entities where id=v_employee.legal_entity_id and is_active) then
    raise exception using errcode='22023',message='Assign an active Legal Employer before creating a Payroll Profile.';
  end if;
  if p_effective_from is null or nullif(btrim(p_reason),'') is null or p_pay_basis not in ('monthly','hourly')
     or coalesce(p_rate,0)<=0 or coalesce(p_currency,'') !~ '^[A-Z]{3}$' then
    raise exception using errcode='22023',message='Valid basis, rate, currency, effective date and reason are required.';
  end if;
  if p_default_cost_outlet_id is not null and not exists(select 1 from public.outlets where id=p_default_cost_outlet_id) then
    raise exception using errcode='22023',message='Cost outlet was not found.';
  end if;
  if p_source_document_id is not null then
    select * into v_document from public.employee_employment_documents where id=p_source_document_id;
    if v_document.id is null or v_document.employee_id<>p_employee_id or v_document.legal_entity_id_snapshot<>v_employee.legal_entity_id
      or v_document.status='draft' then
      raise exception using errcode='22023',message='Contract provenance must reference this employee and Legal Employer.';
    end if;
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_profiles(employee_id,created_by_employee_id) values(p_employee_id,v_actor) returning id into v_profile;
  insert into public.payroll_compensation_versions(profile_id,effective_from,legal_entity_id,pay_basis,currency,basic_salary,hourly_rate,default_cost_outlet_id,workplace_snapshot,source_document_id,provenance,reason,approved_by_employee_id)
  values(v_profile,p_effective_from,v_employee.legal_entity_id,p_pay_basis,p_currency,
    case when p_pay_basis='monthly' then p_rate else null end,
    case when p_pay_basis='hourly' then p_rate else null end,
    p_default_cost_outlet_id,v_employee.workplace,p_source_document_id,
    case when p_source_document_id is null then 'manual' else 'contract_reference' end,btrim(p_reason),v_actor);
  insert into public.payroll_statutory_profile_versions(profile_id,effective_from,epf_applicable,socso_applicable,eis_applicable,pcb_applicable,reason,approved_by_employee_id)
  values(v_profile,p_effective_from,p_epf,p_socso,p_eis,p_pcb,btrim(p_reason),v_actor);
  insert into public.payroll_events(event_type,profile_id,actor_employee_id,reason,details)
  values('profile_created',v_profile,v_actor,btrim(p_reason),jsonb_build_object('employee_id',p_employee_id,'pay_basis',p_pay_basis,'effective_from',p_effective_from));
  return v_profile;
end; $$;

create or replace function public.payroll_compensation_adjust(
  p_profile_id uuid,p_effective_from date,p_pay_basis text,p_rate numeric,p_currency text,
  p_reason text,p_source_document_id uuid default null,p_default_cost_outlet_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_profile public.payroll_profiles%rowtype; v_employee public.employees%rowtype;
  v_previous public.payroll_compensation_versions%rowtype; v_document public.employee_employment_documents%rowtype; v_id uuid;
begin
  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll profile scope denied.';
  end if;
  select * into v_employee from public.employees where id=v_profile.employee_id for share;
  select * into v_previous from public.payroll_compensation_versions where profile_id=p_profile_id order by effective_from desc limit 1;
  if p_effective_from<=v_previous.effective_from or nullif(btrim(p_reason),'') is null
    or p_pay_basis not in ('monthly','hourly') or coalesce(p_rate,0)<=0
    or coalesce(p_currency,'') !~ '^[A-Z]{3}$' then
    raise exception using errcode='22023',message='Adjustment needs a later effective date and valid reviewed terms.';
  end if;
  if v_employee.legal_entity_id is null or not exists(select 1 from public.legal_entities where id=v_employee.legal_entity_id and is_active) then
    raise exception using errcode='22023',message='An active Legal Employer is required.';
  end if;
  if exists(select 1 from public.payroll_run_profile_snapshots s join public.payroll_runs r on r.id=s.run_id
      join public.payroll_periods period on period.id=r.period_id
      where s.profile_id=p_profile_id and r.status in ('finalized','paid') and period.period_end>=p_effective_from) then
    raise exception using errcode='55000',message='Use a controlled correction for a finalized period.';
  end if;
  if p_source_document_id is not null then
    select * into v_document from public.employee_employment_documents where id=p_source_document_id;
    if v_document.id is null or v_document.employee_id<>v_profile.employee_id
       or v_document.legal_entity_id_snapshot<>v_employee.legal_entity_id or v_document.status='draft' then
      raise exception using errcode='22023',message='Contract provenance does not match this employment.';
    end if;
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_compensation_versions(profile_id,effective_from,legal_entity_id,pay_basis,currency,basic_salary,hourly_rate,default_cost_outlet_id,workplace_snapshot,source_document_id,provenance,reason,approved_by_employee_id)
  values(p_profile_id,p_effective_from,v_employee.legal_entity_id,p_pay_basis,p_currency,
    case when p_pay_basis='monthly' then p_rate else null end,
    case when p_pay_basis='hourly' then p_rate else null end,
    p_default_cost_outlet_id,v_employee.workplace,p_source_document_id,
    case when p_source_document_id is null then 'manual' else 'contract_reference' end,btrim(p_reason),v_actor) returning id into v_id;
  insert into public.payroll_events(event_type,profile_id,actor_employee_id,reason,details)
  values('compensation_adjusted',p_profile_id,v_actor,btrim(p_reason),
    jsonb_build_object('previous_version_id',v_previous.id,'new_version_id',v_id,
      'previous_basis',v_previous.pay_basis,'new_basis',p_pay_basis,
      'previous_rate',coalesce(v_previous.basic_salary,v_previous.hourly_rate),'new_rate',p_rate,'effective_from',p_effective_from));
  return v_id;
end; $$;

create or replace function public.payroll_statutory_adjust(
  p_profile_id uuid,p_effective_from date,p_epf boolean,p_socso boolean,p_eis boolean,p_pcb boolean,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_profile public.payroll_profiles%rowtype; v_previous public.payroll_statutory_profile_versions%rowtype; v_id uuid;
begin
  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll statutory profile scope denied.';
  end if;
  select * into v_previous from public.payroll_statutory_profile_versions where profile_id=p_profile_id order by effective_from desc limit 1;
  if p_effective_from<=v_previous.effective_from or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='A later effective date and reason are required.';
  end if;
  if exists(select 1 from public.payroll_run_profile_snapshots s join public.payroll_runs r on r.id=s.run_id
      join public.payroll_periods period on period.id=r.period_id
      where s.profile_id=p_profile_id and r.status in ('finalized','paid') and period.period_end>=p_effective_from) then
    raise exception using errcode='55000',message='Use a controlled correction for a finalized period.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_statutory_profile_versions(profile_id,effective_from,epf_applicable,socso_applicable,eis_applicable,pcb_applicable,reason,approved_by_employee_id)
  values(p_profile_id,p_effective_from,p_epf,p_socso,p_eis,p_pcb,btrim(p_reason),v_actor) returning id into v_id;
  insert into public.payroll_events(event_type,profile_id,actor_employee_id,reason,details)
  values('statutory_applicability_reviewed',p_profile_id,v_actor,btrim(p_reason),
    jsonb_build_object('previous_version_id',v_previous.id,'new_version_id',v_id,'effective_from',p_effective_from));
  return v_id;
end; $$;

create or replace function public.payroll_recurring_adjust(
  p_profile_id uuid,p_component_id uuid,p_effective_from date,p_amount numeric,p_is_active boolean,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_profile public.payroll_profiles%rowtype; v_component public.payroll_component_definitions%rowtype; v_previous public.payroll_recurring_component_versions%rowtype; v_id uuid;
begin
  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll component scope denied.';
  end if;
  select * into v_component from public.payroll_component_definitions where id=p_component_id and is_active;
  if v_component.id is null or v_component.component_type not in ('allowance','deduction') then
    raise exception using errcode='22023',message='Choose an active recurring allowance or deduction.';
  end if;
  select * into v_previous from public.payroll_recurring_component_versions where profile_id=p_profile_id and component_id=p_component_id order by effective_from desc limit 1;
  if (v_previous.id is not null and p_effective_from<=v_previous.effective_from)
    or p_effective_from is null or nullif(btrim(p_reason),'') is null
    or (p_is_active and coalesce(p_amount,0)<=0) or (not p_is_active and p_amount<>0) then
    raise exception using errcode='22023',message='A valid later effective date, amount and reason are required.';
  end if;
  if exists(select 1 from public.payroll_run_profile_snapshots s join public.payroll_runs r on r.id=s.run_id
      join public.payroll_periods period on period.id=r.period_id
      where s.profile_id=p_profile_id and r.status in ('finalized','paid') and period.period_end>=p_effective_from) then
    raise exception using errcode='55000',message='Use a controlled correction for a finalized period.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_recurring_component_versions(profile_id,component_id,effective_from,amount,is_active,reason,approved_by_employee_id)
  values(p_profile_id,p_component_id,p_effective_from,p_amount,p_is_active,btrim(p_reason),v_actor) returning id into v_id;
  insert into public.payroll_events(event_type,profile_id,actor_employee_id,reason,details)
  values('recurring_component_adjusted',p_profile_id,v_actor,btrim(p_reason),
    jsonb_build_object('component_id',p_component_id,'previous_version_id',v_previous.id,'new_version_id',v_id,'effective_from',p_effective_from));
  return v_id;
end; $$;

create or replace function public.payroll_holiday_save(
  p_holiday_date date,p_name text,p_scope text,p_source_note text,
  p_legal_entity_id uuid default null,p_state_code text default null,p_outlet_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_id uuid;
begin
  if p_legal_entity_id is null or not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.manage') then
    raise exception using errcode='42501',message='Legal Entity Payroll settings authority required.';
  end if;
  if p_holiday_date is null or nullif(btrim(p_name),'') is null or nullif(btrim(p_source_note),'') is null
    or not ((p_scope='national' and p_state_code is null and p_outlet_id is null)
      or (p_scope='state' and p_state_code ~ '^MY-[A-Z0-9]+$' and p_outlet_id is null)
      or (p_scope='outlet' and p_state_code is null and p_outlet_id is not null)) then
    raise exception using errcode='22023',message='Holiday scope, date, name and source are required.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_public_holidays(holiday_date,name,scope,state_code,outlet_id,legal_entity_id,source_note,created_by_employee_id)
  values(p_holiday_date,btrim(p_name),p_scope,p_state_code,p_outlet_id,p_legal_entity_id,btrim(p_source_note),v_actor) returning id into v_id;
  insert into public.payroll_events(event_type,holiday_id,actor_employee_id,details)
  values('holiday_added',v_id,v_actor,jsonb_build_object('legal_entity_id',p_legal_entity_id,'holiday_date',p_holiday_date));
  return v_id;
end; $$;

create or replace function public.payroll_component_create(
  p_code text,p_name text,p_component_type text,p_epf_treatment text,
  p_socso_treatment text,p_eis_treatment text,p_pcb_treatment text,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_id uuid;
begin
  if not public.current_user_has_permission('payroll.manage')
    or not exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
      where e.id=v_actor and lower(r.name) in ('owner','admin')) then
    raise exception using errcode='42501',message='Payroll component settings authority required.';
  end if;
  if p_code !~ '^[a-z][a-z0-9_]*$' or nullif(btrim(p_name),'') is null
    or p_component_type not in ('earning','allowance','deduction','reimbursement')
    or p_epf_treatment not in ('included','excluded','undetermined')
    or p_socso_treatment not in ('included','excluded','undetermined')
    or p_eis_treatment not in ('included','excluded','undetermined')
    or p_pcb_treatment not in ('included','excluded','undetermined')
    or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='Valid component code, type, wage treatments and reason are required.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_component_definitions(code,name,component_type,epf_treatment,socso_treatment,eis_treatment,pcb_treatment,created_by_employee_id)
  values(p_code,btrim(p_name),p_component_type,p_epf_treatment,p_socso_treatment,p_eis_treatment,p_pcb_treatment,v_actor)
  returning id into v_id;
  insert into public.payroll_events(event_type,component_id,actor_employee_id,reason,details)
  values('component_created',v_id,v_actor,btrim(p_reason),jsonb_build_object('code',p_code));
  return v_id;
end; $$;

create or replace function public.payroll_run_create(
  p_legal_entity_id uuid,p_period_start date,p_period_end date,p_reason text,
  p_supersedes_run_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_period public.payroll_periods%rowtype; v_parent public.payroll_runs%rowtype; v_id uuid; v_revision integer;
begin
  if not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.manage') then
    raise exception using errcode='42501',message='Legal Entity Payroll Run authority required.';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start
    or date_trunc('month',p_period_start)::date<>p_period_start
    or p_period_end<>(p_period_start+interval '1 month' - interval '1 day')::date
    or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='A complete calendar month and reason are required.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_periods(legal_entity_id,period_start,period_end)
  values(p_legal_entity_id,p_period_start,p_period_end)
  on conflict(legal_entity_id,period_start,period_end) do nothing;
  select * into v_period from public.payroll_periods
    where legal_entity_id=p_legal_entity_id and period_start=p_period_start and period_end=p_period_end for update;
  if exists(select 1 from public.payroll_runs where period_id=v_period.id and status in ('draft','review_required','ready')) then
    raise exception using errcode='23505',message='An open run already exists for this period.';
  end if;
  if p_supersedes_run_id is null and v_period.current_finalized_run_id is not null then
    raise exception using errcode='55000',message='A correction must reference the current finalized run.';
  end if;
  if p_supersedes_run_id is not null then
    select * into v_parent from public.payroll_runs where id=p_supersedes_run_id and period_id=v_period.id and status='finalized';
    if v_parent.id is null or v_period.current_finalized_run_id is distinct from v_parent.id then
      raise exception using errcode='55000',message='Correction must supersede the current finalized run.';
    end if;
  end if;
  select coalesce(max(revision),0)+1 into v_revision from public.payroll_runs where period_id=v_period.id;
  insert into public.payroll_runs(period_id,revision,supersedes_run_id,reason,created_by_employee_id)
  values(v_period.id,v_revision,p_supersedes_run_id,btrim(p_reason),v_actor) returning id into v_id;
  insert into public.payroll_events(event_type,run_id,actor_employee_id,reason,details)
  values(case when p_supersedes_run_id is null then 'run_created' else 'correction_draft_created' end,
    v_id,v_actor,btrim(p_reason),jsonb_build_object('period_id',v_period.id,'supersedes_run_id',p_supersedes_run_id));
  return v_id;
end; $$;

create or replace function public.payroll_run_transition(p_run_id uuid,p_next_status text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype; v_count integer;
begin
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id for update;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,
    case when p_next_status='finalized' then 'payroll.finalize' else 'payroll.manage' end) then
    raise exception using errcode='42501',message='Payroll Run transition authority denied.';
  end if;
  if nullif(btrim(p_reason),'') is null or not (
    (v_run.status='draft' and p_next_status='review_required')
    or (v_run.status='review_required' and p_next_status='ready')
    or (v_run.status='ready' and p_next_status='finalized')
    or (v_run.status='ready' and p_next_status='review_required')
  ) then
    raise exception using errcode='55000',message='Invalid Payroll Run transition or missing reason.';
  end if;
  -- No Paid transition until settlement authority exists. No monetary result is
  -- implied by the foundation-only Finalized status.
  if p_next_status='finalized' then
    if v_run.supersedes_run_id is not null and v_period.current_finalized_run_id is distinct from v_run.supersedes_run_id then
      raise exception using errcode='55000',message='Current finalized run changed; recreate this correction.';
    end if;
    if v_run.supersedes_run_id is null and v_period.current_finalized_run_id is not null then
      raise exception using errcode='55000',message='Use a correction run instead.';
    end if;
    perform set_config('feedx.payroll_command','yes',true);
    insert into public.payroll_run_profile_snapshots(
      run_id,employee_id,profile_id,compensation_versions,statutory_versions,recurring_versions,
      employee_name_snapshot,legal_entity_id_snapshot)
    select v_run.id,e.id,p.id,
      (select coalesce(jsonb_agg(to_jsonb(c) order by c.effective_from), '[]'::jsonb)
        from public.payroll_compensation_versions c where c.profile_id=p.id and c.effective_from<=v_period.period_end
          and c.effective_from>=coalesce((select max(prior.effective_from) from public.payroll_compensation_versions prior
            where prior.profile_id=p.id and prior.effective_from<v_period.period_start),v_period.period_start)),
      (select coalesce(jsonb_agg(to_jsonb(s) order by s.effective_from), '[]'::jsonb)
        from public.payroll_statutory_profile_versions s where s.profile_id=p.id and s.effective_from<=v_period.period_end
          and s.effective_from>=coalesce((select max(prior.effective_from) from public.payroll_statutory_profile_versions prior
            where prior.profile_id=p.id and prior.effective_from<v_period.period_start),v_period.period_start)),
      (select coalesce(jsonb_agg(to_jsonb(rc) order by rc.effective_from), '[]'::jsonb)
        from public.payroll_recurring_component_versions rc where rc.profile_id=p.id and rc.effective_from<=v_period.period_end),
      e.full_name,v_period.legal_entity_id
    from public.payroll_profiles p join public.employees e on e.id=p.employee_id
    where exists(select 1 from public.payroll_compensation_versions c
      where c.profile_id=p.id and c.legal_entity_id=v_period.legal_entity_id and c.effective_from<=v_period.period_end
        and not exists(select 1 from public.payroll_compensation_versions later
          where later.profile_id=p.id and later.effective_from<=v_period.period_end and later.effective_from>c.effective_from));
    get diagnostics v_count=row_count;
    if v_count=0 then raise exception using errcode='22023',message='No effective Payroll Profiles exist for this run.'; end if;
    update public.payroll_runs set status='finalized',finalized_by_employee_id=v_actor,finalized_at=clock_timestamp()
      where id=v_run.id;
    update public.payroll_periods set current_finalized_run_id=v_run.id where id=v_period.id;
  else
    perform set_config('feedx.payroll_command','yes',true);
    update public.payroll_runs set status=p_next_status where id=v_run.id;
  end if;
  insert into public.payroll_events(event_type,run_id,actor_employee_id,reason,details)
  values('run_'||p_next_status,v_run.id,v_actor,btrim(p_reason),
    jsonb_build_object('from_status',v_run.status,'to_status',p_next_status,'foundation_only',true,'profile_count',v_count));
  return jsonb_build_object('id',v_run.id,'status',p_next_status,'foundation_only',true,'profile_count',v_count);
end; $$;

-- Client-callable surface. Internal helpers are deliberately not executable by clients.
revoke all on function public.payroll_admin_actor() from public,anon,authenticated;
revoke all on function public.payroll_can_access_employee(uuid,text) from public,anon,authenticated;
revoke all on function public.payroll_can_manage_entity(uuid,text) from public,anon,authenticated;
revoke all on function public.payroll_command_guard() from public,anon,authenticated;
revoke all on function public.payroll_effective_version_guard() from public,anon,authenticated;
revoke all on function public.payroll_foundation_read(uuid,uuid) from public,anon;
revoke all on function public.payroll_profile_create(uuid,date,text,numeric,text,text,uuid,uuid,boolean,boolean,boolean,boolean) from public,anon;
revoke all on function public.payroll_compensation_adjust(uuid,date,text,numeric,text,text,uuid,uuid) from public,anon;
revoke all on function public.payroll_statutory_adjust(uuid,date,boolean,boolean,boolean,boolean,text) from public,anon;
revoke all on function public.payroll_recurring_adjust(uuid,uuid,date,numeric,boolean,text) from public,anon;
revoke all on function public.payroll_holiday_save(date,text,text,text,uuid,text,uuid) from public,anon;
revoke all on function public.payroll_component_create(text,text,text,text,text,text,text,text) from public,anon;
revoke all on function public.payroll_run_create(uuid,date,date,text,uuid) from public,anon;
revoke all on function public.payroll_run_transition(uuid,text,text) from public,anon;
grant execute on function public.payroll_foundation_read(uuid,uuid) to authenticated;
grant execute on function public.payroll_profile_create(uuid,date,text,numeric,text,text,uuid,uuid,boolean,boolean,boolean,boolean) to authenticated;
grant execute on function public.payroll_compensation_adjust(uuid,date,text,numeric,text,text,uuid,uuid) to authenticated;
grant execute on function public.payroll_statutory_adjust(uuid,date,boolean,boolean,boolean,boolean,text) to authenticated;
grant execute on function public.payroll_recurring_adjust(uuid,uuid,date,numeric,boolean,text) to authenticated;
grant execute on function public.payroll_holiday_save(date,text,text,text,uuid,text,uuid) to authenticated;
grant execute on function public.payroll_component_create(text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.payroll_run_create(uuid,date,date,text,uuid) to authenticated;
grant execute on function public.payroll_run_transition(uuid,text,text) to authenticated;
