-- Factory MeSTI Cleaning of Area workflow.
-- Storage Location is retained as the stable internal table while the
-- user-facing Factory Location model gains explicit storage eligibility.

alter table public.factory_storage_locations
  add column if not exists is_storage_location boolean not null default true;

update public.factory_storage_locations
set is_storage_location = true
where is_storage_location is distinct from true;

drop policy if exists "factory storage locations view" on public.factory_storage_locations;
create policy "factory storage locations view" on public.factory_storage_locations for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_raw_movements.view')
  or public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_job_orders.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_storage_locations.view')
  or public.current_user_has_permission('factory_storage_locations.manage')
  or public.current_user_has_permission('factory_mesti_cleaning.view')
  or public.current_user_has_permission('factory_mesti_cleaning.manage')
  or public.current_user_has_permission('factory_settings.manage')
);

insert into public.permissions(code,module,description) values
  ('factory_mesti_cleaning.view','Factory MeSTI Cleaning','View Factory MeSTI Cleaning of Area records.'),
  ('factory_mesti_cleaning.create','Factory MeSTI Cleaning','Create Factory MeSTI Cleaning setup records.'),
  ('factory_mesti_cleaning.edit','Factory MeSTI Cleaning','Edit Factory MeSTI Cleaning setup records.'),
  ('factory_mesti_cleaning.delete','Factory MeSTI Cleaning','Deactivate Factory MeSTI Cleaning setup records.'),
  ('factory_mesti_cleaning.complete','Factory MeSTI Cleaning','Complete due Factory MeSTI Cleaning occurrences.'),
  ('factory_mesti_cleaning.review','Factory MeSTI Cleaning','Verify Factory MeSTI Cleaning occurrences.'),
  ('factory_mesti_cleaning.manage','Factory MeSTI Cleaning','Manage Factory MeSTI Cleaning workflow.')
on conflict (code) do update
set module=excluded.module,
    description=excluded.description;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code like 'factory_mesti_cleaning.%'
where lower(r.name) in ('owner','admin')
on conflict do nothing;

create table if not exists public.factory_mesti_cleaning_areas (
  id uuid primary key default gen_random_uuid(),
  area_name text not null,
  location_id uuid not null references public.factory_storage_locations(id) on delete restrict,
  status text not null default 'active' check (status in ('active','inactive')),
  sort_order integer not null default 100,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists factory_mesti_cleaning_areas_active_name_key
on public.factory_mesti_cleaning_areas (lower(area_name))
where status='active';

create table if not exists public.factory_mesti_cleaning_requirements (
  id uuid primary key default gen_random_uuid(),
  task_name text not null,
  recurrence_type text not null check (recurrence_type in ('daily','weekly')),
  recurrence_weekdays integer[] not null default '{}'::integer[],
  responsible_role_id uuid not null references public.roles(id) on delete restrict,
  verifier_role_id uuid not null references public.roles(id) on delete restrict,
  status text not null default 'active' check (status in ('active','inactive')),
  effective_from date not null default current_date,
  version_no integer not null default 1,
  superseded_by uuid references public.factory_mesti_cleaning_requirements(id) on delete set null,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_mesti_cleaning_weekdays_valid check (
    recurrence_type <> 'weekly'
    or (
      cardinality(recurrence_weekdays) > 0
      and recurrence_weekdays <@ array[1,2,3,4,5,6,7]
    )
  )
);

create table if not exists public.factory_mesti_cleaning_requirement_areas (
  requirement_id uuid not null references public.factory_mesti_cleaning_requirements(id) on delete cascade,
  area_id uuid not null references public.factory_mesti_cleaning_areas(id) on delete restrict,
  primary key (requirement_id, area_id)
);

create table if not exists public.factory_mesti_cleaning_occurrences (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.factory_mesti_cleaning_requirements(id) on delete restrict,
  area_id uuid not null references public.factory_mesti_cleaning_areas(id) on delete restrict,
  due_date date not null,
  status text not null default 'pending' check (status in ('pending','completed','verified','unsatisfactory','missed')),
  requirement_snapshot jsonb not null default '{}'::jsonb,
  completed_by uuid references public.employees(id),
  completed_at timestamptz,
  completion_result text,
  completion_note text,
  verified_by uuid references public.employees(id),
  verified_at timestamptz,
  verification_result text,
  verification_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(requirement_id, area_id, due_date)
);

create index if not exists factory_mesti_cleaning_occurrences_due_idx
on public.factory_mesti_cleaning_occurrences(due_date, status);

grant select, insert, update, delete on public.factory_mesti_cleaning_areas to authenticated;
grant select, insert, update, delete on public.factory_mesti_cleaning_requirements to authenticated;
grant select, insert, update, delete on public.factory_mesti_cleaning_requirement_areas to authenticated;
grant select, insert, update on public.factory_mesti_cleaning_occurrences to authenticated;

alter table public.factory_mesti_cleaning_areas enable row level security;
alter table public.factory_mesti_cleaning_requirements enable row level security;
alter table public.factory_mesti_cleaning_requirement_areas enable row level security;
alter table public.factory_mesti_cleaning_occurrences enable row level security;

drop policy if exists "factory mesti cleaning areas read" on public.factory_mesti_cleaning_areas;
create policy "factory mesti cleaning areas read" on public.factory_mesti_cleaning_areas for select to authenticated
using (public.current_user_has_permission('factory_mesti_cleaning.view') or public.current_user_has_permission('factory_mesti_cleaning.manage'));
drop policy if exists "factory mesti cleaning areas setup" on public.factory_mesti_cleaning_areas;
create policy "factory mesti cleaning areas setup" on public.factory_mesti_cleaning_areas for all to authenticated
using (public.current_user_has_permission('factory_mesti_cleaning.manage'))
with check (public.current_user_has_permission('factory_mesti_cleaning.manage'));

drop policy if exists "factory mesti cleaning requirements read" on public.factory_mesti_cleaning_requirements;
create policy "factory mesti cleaning requirements read" on public.factory_mesti_cleaning_requirements for select to authenticated
using (public.current_user_has_permission('factory_mesti_cleaning.view') or public.current_user_has_permission('factory_mesti_cleaning.manage'));
drop policy if exists "factory mesti cleaning requirements setup" on public.factory_mesti_cleaning_requirements;
create policy "factory mesti cleaning requirements setup" on public.factory_mesti_cleaning_requirements for all to authenticated
using (public.current_user_has_permission('factory_mesti_cleaning.manage'))
with check (public.current_user_has_permission('factory_mesti_cleaning.manage'));

drop policy if exists "factory mesti cleaning requirement areas read" on public.factory_mesti_cleaning_requirement_areas;
create policy "factory mesti cleaning requirement areas read" on public.factory_mesti_cleaning_requirement_areas for select to authenticated
using (public.current_user_has_permission('factory_mesti_cleaning.view') or public.current_user_has_permission('factory_mesti_cleaning.manage'));
drop policy if exists "factory mesti cleaning requirement areas setup" on public.factory_mesti_cleaning_requirement_areas;
create policy "factory mesti cleaning requirement areas setup" on public.factory_mesti_cleaning_requirement_areas for all to authenticated
using (public.current_user_has_permission('factory_mesti_cleaning.manage'))
with check (public.current_user_has_permission('factory_mesti_cleaning.manage'));

drop policy if exists "factory mesti cleaning occurrences read" on public.factory_mesti_cleaning_occurrences;
create policy "factory mesti cleaning occurrences read" on public.factory_mesti_cleaning_occurrences for select to authenticated
using (public.current_user_has_permission('factory_mesti_cleaning.view') or public.current_user_has_permission('factory_mesti_cleaning.manage'));

create or replace function public.factory_mesti_current_employee()
returns public.employees
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee public.employees%rowtype;
begin
  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid()
  limit 1;
  if v_employee.id is null then
    raise exception using errcode='42501', message='Current employee profile is required.';
  end if;
  return v_employee;
end;
$$;

create or replace function public.factory_mesti_recurrence_due(p_type text, p_weekdays integer[], p_due_date date)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p_type='daily' then true
    when p_type='weekly' then extract(isodow from p_due_date)::integer = any(coalesce(p_weekdays, '{}'::integer[]))
    else false
  end
$$;

create or replace function public.factory_mesti_cleaning_occurrence_snapshot(
  p_requirement public.factory_mesti_cleaning_requirements,
  p_area public.factory_mesti_cleaning_areas
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'requirement_id', p_requirement.id,
    'task_name', p_requirement.task_name,
    'recurrence_type', p_requirement.recurrence_type,
    'recurrence_weekdays', p_requirement.recurrence_weekdays,
    'responsible_role_id', p_requirement.responsible_role_id,
    'verifier_role_id', p_requirement.verifier_role_id,
    'effective_from', p_requirement.effective_from,
    'version_no', p_requirement.version_no,
    'area_id', p_area.id,
    'area_name', p_area.area_name,
    'location_id', p_area.location_id
  )
$$;

create or replace function public.factory_mesti_materialize_cleaning_occurrences(p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
begin
  if not (public.current_user_has_permission('factory_mesti_cleaning.view') or public.current_user_has_permission('factory_mesti_cleaning.manage')) then
    raise exception using errcode='42501', message='Missing permission to view Factory MeSTI Cleaning.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception using errcode='22023', message='Invalid Cleaning date range.';
  end if;

  insert into public.factory_mesti_cleaning_occurrences(requirement_id, area_id, due_date, status, requirement_snapshot)
  select requirement.id, area.id, due_date.day::date, 'pending',
         public.factory_mesti_cleaning_occurrence_snapshot(requirement, area)
  from public.factory_mesti_cleaning_requirements requirement
  join public.factory_mesti_cleaning_requirement_areas link on link.requirement_id=requirement.id
  join public.factory_mesti_cleaning_areas area on area.id=link.area_id
  cross join generate_series(p_from, p_to, interval '1 day') due_date(day)
  where requirement.status='active'
    and area.status='active'
    and due_date.day::date >= requirement.effective_from
    and public.factory_mesti_recurrence_due(requirement.recurrence_type, requirement.recurrence_weekdays, due_date.day::date)
  on conflict (requirement_id, area_id, due_date) do nothing;

  get diagnostics v_inserted = row_count;

  update public.factory_mesti_cleaning_occurrences
  set status='missed', updated_at=now()
  where status='pending'
    and due_date < current_date
    and due_date between p_from and p_to;

  return v_inserted;
end;
$$;

create or replace function public.factory_mesti_cleaning_day(p_due_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.factory_mesti_materialize_cleaning_occurrences(p_due_date, p_due_date);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id,
      'due_date', o.due_date,
      'status', o.status,
      'requirement_id', o.requirement_id,
      'area_id', o.area_id,
      'task_name', o.requirement_snapshot->>'task_name',
      'area_name', o.requirement_snapshot->>'area_name',
      'location_id', o.requirement_snapshot->>'location_id',
      'recurrence_type', o.requirement_snapshot->>'recurrence_type',
      'recurrence_weekdays', o.requirement_snapshot->'recurrence_weekdays',
      'responsible_role_id', o.requirement_snapshot->>'responsible_role_id',
      'verifier_role_id', o.requirement_snapshot->>'verifier_role_id',
      'version_no', o.requirement_snapshot->>'version_no',
      'completed_by', o.completed_by,
      'completed_by_name', coalesce(completer.nickname, completer.full_name, completer.email),
      'completed_at', o.completed_at,
      'completion_result', o.completion_result,
      'completion_note', o.completion_note,
      'verified_by', o.verified_by,
      'verified_by_name', coalesce(verifier.nickname, verifier.full_name, verifier.email),
      'verified_at', o.verified_at,
      'verification_result', o.verification_result,
      'verification_note', o.verification_note
    ) order by o.requirement_snapshot->>'area_name', o.requirement_snapshot->>'task_name')
    from public.factory_mesti_cleaning_occurrences o
    left join public.employees completer on completer.id=o.completed_by
    left join public.employees verifier on verifier.id=o.verified_by
    where o.due_date=p_due_date
  ), '[]'::jsonb);
end;
$$;

create or replace function public.factory_mesti_cleaning_month(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month)::date + interval '1 month - 1 day')::date;
begin
  perform public.factory_mesti_materialize_cleaning_occurrences(v_from, v_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id,
      'due_date', o.due_date,
      'status', o.status,
      'requirement_id', o.requirement_id,
      'area_id', o.area_id,
      'task_name', o.requirement_snapshot->>'task_name',
      'area_name', o.requirement_snapshot->>'area_name',
      'recurrence_type', o.requirement_snapshot->>'recurrence_type',
      'recurrence_weekdays', o.requirement_snapshot->'recurrence_weekdays',
      'responsible_role_id', o.requirement_snapshot->>'responsible_role_id',
      'verifier_role_id', o.requirement_snapshot->>'verifier_role_id',
      'completed_by', o.completed_by,
      'completed_by_name', coalesce(completer.nickname, completer.full_name, completer.email),
      'completed_at', o.completed_at,
      'completion_note', o.completion_note,
      'verified_by', o.verified_by,
      'verified_by_name', coalesce(verifier.nickname, verifier.full_name, verifier.email),
      'verified_at', o.verified_at,
      'verification_result', o.verification_result,
      'verification_note', o.verification_note
    ) order by o.requirement_snapshot->>'area_name', o.requirement_snapshot->>'task_name', o.due_date)
    from public.factory_mesti_cleaning_occurrences o
    left join public.employees completer on completer.id=o.completed_by
    left join public.employees verifier on verifier.id=o.verified_by
    where o.due_date between v_from and v_to
  ), '[]'::jsonb);
end;
$$;

create or replace function public.factory_save_mesti_cleaning_area(p_area jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee public.employees%rowtype := public.factory_mesti_current_employee();
  v_area public.factory_mesti_cleaning_areas%rowtype;
  v_id uuid := nullif(p_area->>'id','')::uuid;
begin
  if not (public.current_user_has_permission('factory_mesti_cleaning.manage') or public.current_user_has_permission('factory_mesti_cleaning.create') or public.current_user_has_permission('factory_mesti_cleaning.edit')) then
    raise exception using errcode='42501', message='Missing permission to manage Cleaning Areas.';
  end if;
  if nullif(btrim(p_area->>'area_name'),'') is null then
    raise exception using errcode='22023', message='Area name is required.';
  end if;
  if not exists(select 1 from public.factory_storage_locations where id=nullif(p_area->>'location_id','')::uuid and status='active') then
    raise exception using errcode='22023', message='Active Factory Location is required.';
  end if;

  if v_id is null then
    insert into public.factory_mesti_cleaning_areas(area_name, location_id, status, sort_order, created_by)
    values (btrim(p_area->>'area_name'), (p_area->>'location_id')::uuid, coalesce(nullif(p_area->>'status',''),'active'), coalesce(nullif(p_area->>'sort_order','')::integer,100), v_employee.id)
    returning * into v_area;
  else
    update public.factory_mesti_cleaning_areas
    set area_name=btrim(p_area->>'area_name'),
        location_id=(p_area->>'location_id')::uuid,
        status=coalesce(nullif(p_area->>'status',''),'active'),
        sort_order=coalesce(nullif(p_area->>'sort_order','')::integer,sort_order),
        updated_at=now()
    where id=v_id
    returning * into v_area;
  end if;
  return to_jsonb(v_area);
end;
$$;

create or replace function public.factory_save_mesti_cleaning_requirement(p_requirement jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee public.employees%rowtype := public.factory_mesti_current_employee();
  v_existing public.factory_mesti_cleaning_requirements%rowtype;
  v_saved public.factory_mesti_cleaning_requirements%rowtype;
  v_area_ids uuid[] := array(select jsonb_array_elements_text(coalesce(p_requirement->'area_ids','[]'::jsonb))::uuid);
  v_id uuid := nullif(p_requirement->>'id','')::uuid;
  v_type text := lower(coalesce(nullif(p_requirement->>'recurrence_type',''),'daily'));
  v_weekdays integer[] := array(select jsonb_array_elements_text(coalesce(p_requirement->'recurrence_weekdays','[]'::jsonb))::integer);
  v_effective_from date := coalesce(nullif(p_requirement->>'effective_from','')::date, current_date);
begin
  if not (public.current_user_has_permission('factory_mesti_cleaning.manage') or public.current_user_has_permission('factory_mesti_cleaning.create') or public.current_user_has_permission('factory_mesti_cleaning.edit')) then
    raise exception using errcode='42501', message='Missing permission to manage Cleaning Requirements.';
  end if;
  if nullif(btrim(p_requirement->>'task_name'),'') is null then
    raise exception using errcode='22023', message='Task name is required.';
  end if;
  if cardinality(v_area_ids) = 0 then
    raise exception using errcode='22023', message='At least one Cleaning Area is required.';
  end if;
  if v_type not in ('daily','weekly') then
    raise exception using errcode='22023', message='Unsupported recurrence.';
  end if;
  if v_type='weekly' and cardinality(v_weekdays)=0 then
    raise exception using errcode='22023', message='Select at least one weekday.';
  end if;

  if v_id is not null then
    select * into v_existing from public.factory_mesti_cleaning_requirements where id=v_id for update;
  end if;

  if v_existing.id is null then
    insert into public.factory_mesti_cleaning_requirements(task_name, recurrence_type, recurrence_weekdays, responsible_role_id, verifier_role_id, status, effective_from, created_by)
    values (btrim(p_requirement->>'task_name'), v_type, case when v_type='daily' then '{}'::integer[] else v_weekdays end, (p_requirement->>'responsible_role_id')::uuid, (p_requirement->>'verifier_role_id')::uuid, coalesce(nullif(p_requirement->>'status',''),'active'), v_effective_from, v_employee.id)
    returning * into v_saved;
  else
    update public.factory_mesti_cleaning_requirements
    set status='inactive', updated_at=now()
    where id=v_existing.id;
    insert into public.factory_mesti_cleaning_requirements(task_name, recurrence_type, recurrence_weekdays, responsible_role_id, verifier_role_id, status, effective_from, version_no, created_by)
    values (btrim(p_requirement->>'task_name'), v_type, case when v_type='daily' then '{}'::integer[] else v_weekdays end, (p_requirement->>'responsible_role_id')::uuid, (p_requirement->>'verifier_role_id')::uuid, coalesce(nullif(p_requirement->>'status',''),'active'), v_effective_from, v_existing.version_no + 1, v_employee.id)
    returning * into v_saved;
    update public.factory_mesti_cleaning_requirements set superseded_by=v_saved.id where id=v_existing.id;
  end if;

  insert into public.factory_mesti_cleaning_requirement_areas(requirement_id, area_id)
  select v_saved.id, area_id from unnest(v_area_ids) area_id
  where exists(select 1 from public.factory_mesti_cleaning_areas area where area.id=area_id)
  on conflict do nothing;

  return to_jsonb(v_saved) || jsonb_build_object('area_ids', to_jsonb(v_area_ids));
end;
$$;

create or replace function public.factory_mesti_complete_cleaning_occurrence(p_occurrence_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee public.employees%rowtype := public.factory_mesti_current_employee();
  v_occurrence public.factory_mesti_cleaning_occurrences%rowtype;
begin
  select * into v_occurrence from public.factory_mesti_cleaning_occurrences where id=p_occurrence_id for update;
  if v_occurrence.id is null then raise exception using errcode='P0002', message='Cleaning occurrence was not found.'; end if;
  if v_employee.role_id::text <> v_occurrence.requirement_snapshot->>'responsible_role_id'
     and not public.current_user_has_permission('factory_mesti_cleaning.manage') then
    raise exception using errcode='42501', message='Current role cannot complete this Cleaning occurrence.';
  end if;
  if v_occurrence.status not in ('pending','missed','unsatisfactory') then
    raise exception using errcode='55000', message='Cleaning occurrence cannot be completed from its current state.';
  end if;
  update public.factory_mesti_cleaning_occurrences
  set status='completed', completed_by=v_employee.id, completed_at=now(), completion_result='completed',
      completion_note=nullif(btrim(coalesce(p_note,'')),''), updated_at=now()
  where id=p_occurrence_id
  returning * into v_occurrence;
  return to_jsonb(v_occurrence);
end;
$$;

create or replace function public.factory_mesti_verify_cleaning_occurrence(p_occurrence_id uuid, p_result text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee public.employees%rowtype := public.factory_mesti_current_employee();
  v_occurrence public.factory_mesti_cleaning_occurrences%rowtype;
  v_result text := lower(coalesce(p_result,'verified'));
begin
  select * into v_occurrence from public.factory_mesti_cleaning_occurrences where id=p_occurrence_id for update;
  if v_occurrence.id is null then raise exception using errcode='P0002', message='Cleaning occurrence was not found.'; end if;
  if v_employee.role_id::text <> v_occurrence.requirement_snapshot->>'verifier_role_id'
     and not public.current_user_has_permission('factory_mesti_cleaning.manage') then
    raise exception using errcode='42501', message='Current role cannot verify this Cleaning occurrence.';
  end if;
  if v_occurrence.completed_by = v_employee.id and not public.current_user_has_permission('factory_mesti_cleaning.manage') then
    raise exception using errcode='42501', message='Self-verification is not allowed.';
  end if;
  if v_occurrence.status <> 'completed' then
    raise exception using errcode='55000', message='Only completed Cleaning occurrences can be verified.';
  end if;
  if v_result not in ('verified','unsatisfactory') then
    raise exception using errcode='22023', message='Unsupported verification result.';
  end if;
  update public.factory_mesti_cleaning_occurrences
  set status=v_result, verified_by=v_employee.id, verified_at=now(), verification_result=v_result,
      verification_note=nullif(btrim(coalesce(p_note,'')),''), updated_at=now()
  where id=p_occurrence_id
  returning * into v_occurrence;
  return to_jsonb(v_occurrence);
end;
$$;

revoke all on function public.factory_mesti_current_employee() from public, anon;
revoke all on function public.factory_mesti_recurrence_due(text,integer[],date) from public, anon;
revoke all on function public.factory_mesti_cleaning_occurrence_snapshot(public.factory_mesti_cleaning_requirements,public.factory_mesti_cleaning_areas) from public, anon;
revoke all on function public.factory_mesti_materialize_cleaning_occurrences(date,date) from public, anon;
revoke all on function public.factory_mesti_cleaning_day(date) from public, anon;
revoke all on function public.factory_mesti_cleaning_month(date) from public, anon;
revoke all on function public.factory_save_mesti_cleaning_area(jsonb) from public, anon;
revoke all on function public.factory_save_mesti_cleaning_requirement(jsonb) from public, anon;
revoke all on function public.factory_mesti_complete_cleaning_occurrence(uuid,text) from public, anon;
revoke all on function public.factory_mesti_verify_cleaning_occurrence(uuid,text,text) from public, anon;
grant execute on function public.factory_mesti_materialize_cleaning_occurrences(date,date) to authenticated;
grant execute on function public.factory_mesti_cleaning_day(date) to authenticated;
grant execute on function public.factory_mesti_cleaning_month(date) to authenticated;
grant execute on function public.factory_save_mesti_cleaning_area(jsonb) to authenticated;
grant execute on function public.factory_save_mesti_cleaning_requirement(jsonb) to authenticated;
grant execute on function public.factory_mesti_complete_cleaning_occurrence(uuid,text) to authenticated;
grant execute on function public.factory_mesti_verify_cleaning_occurrence(uuid,text,text) to authenticated;
