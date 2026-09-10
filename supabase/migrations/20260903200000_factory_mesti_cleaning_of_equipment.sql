-- Factory MeSTI Cleaning of Equipment uses the canonical Equipment master and
-- completed Production Equipment Usage evidence. It deliberately owns only its
-- cleaning requirements and immutable cleaning occurrences.

insert into public.permissions(code, module, description) values
  ('factory_mesti_equipment_cleaning.view', 'Factory MeSTI Cleaning of Equipment', 'View Factory MeSTI Cleaning of Equipment records.'),
  ('factory_mesti_equipment_cleaning.create', 'Factory MeSTI Cleaning of Equipment', 'Create Factory MeSTI Cleaning of Equipment requirements.'),
  ('factory_mesti_equipment_cleaning.edit', 'Factory MeSTI Cleaning of Equipment', 'Edit Factory MeSTI Cleaning of Equipment requirements.'),
  ('factory_mesti_equipment_cleaning.delete', 'Factory MeSTI Cleaning of Equipment', 'Deactivate Factory MeSTI Cleaning of Equipment requirements.'),
  ('factory_mesti_equipment_cleaning.complete', 'Factory MeSTI Cleaning of Equipment', 'Complete Factory MeSTI Cleaning of Equipment occurrences.'),
  ('factory_mesti_equipment_cleaning.review', 'Factory MeSTI Cleaning of Equipment', 'Verify Factory MeSTI Cleaning of Equipment occurrences.'),
  ('factory_mesti_equipment_cleaning.manage', 'Factory MeSTI Cleaning of Equipment', 'Manage Factory MeSTI Cleaning of Equipment.')
on conflict (code) do update set module = excluded.module, description = excluded.description;

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission on permission.code like 'factory_mesti_equipment_cleaning.%'
where lower(role.name) in ('owner', 'admin')
on conflict do nothing;

create table if not exists public.factory_mesti_equipment_cleaning_requirements (
  id uuid primary key default gen_random_uuid(),
  logical_requirement_id uuid not null,
  task_name text not null,
  trigger_type text not null check (trigger_type in ('scheduled', 'after_operation')),
  recurrence_type text check (recurrence_type in ('daily', 'weekly')),
  recurrence_weekdays integer[] not null default '{}'::integer[],
  status text not null default 'active' check (status in ('active', 'inactive')),
  effective_from date not null default current_date,
  effective_until date,
  version_no integer not null default 1,
  superseded_by uuid references public.factory_mesti_equipment_cleaning_requirements(id) on delete set null,
  created_by uuid references public.employees(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_mesti_equipment_cleaning_schedule_valid check (
    (trigger_type = 'scheduled' and recurrence_type in ('daily', 'weekly')
      and (recurrence_type = 'daily' or (cardinality(recurrence_weekdays) > 0 and recurrence_weekdays <@ array[1,2,3,4,5,6,7])))
    or (trigger_type = 'after_operation' and recurrence_type is null and cardinality(recurrence_weekdays) = 0)
  )
);

create table if not exists public.factory_mesti_equipment_cleaning_requirement_equipment (
  requirement_id uuid not null references public.factory_mesti_equipment_cleaning_requirements(id) on delete cascade,
  equipment_id uuid not null references public.factory_equipment(id) on delete restrict,
  primary key (requirement_id, equipment_id)
);

create table if not exists public.factory_mesti_equipment_cleaning_occurrences (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.factory_mesti_equipment_cleaning_requirements(id) on delete restrict,
  logical_requirement_id uuid not null,
  equipment_id uuid not null references public.factory_equipment(id) on delete restrict,
  due_date date not null,
  production_equipment_usage_id uuid references public.factory_production_equipment_usage(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'completed', 'verified', 'unsatisfactory', 'missed')),
  requirement_snapshot jsonb not null default '{}'::jsonb,
  completed_by uuid references public.employees(id) on delete restrict,
  completed_at timestamptz,
  completion_result text,
  completion_note text,
  verified_by uuid references public.employees(id) on delete restrict,
  verified_at timestamptz,
  verification_result text,
  verification_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists factory_mesti_equipment_cleaning_scheduled_identity_key
on public.factory_mesti_equipment_cleaning_occurrences(logical_requirement_id, equipment_id, due_date)
where production_equipment_usage_id is null;

create unique index if not exists factory_mesti_equipment_cleaning_after_operation_identity_key
on public.factory_mesti_equipment_cleaning_occurrences(logical_requirement_id, production_equipment_usage_id)
where production_equipment_usage_id is not null;

create unique index if not exists factory_mesti_equipment_cleaning_one_current_version_key
on public.factory_mesti_equipment_cleaning_requirements(logical_requirement_id)
where effective_until is null;

create index if not exists factory_mesti_equipment_cleaning_requirement_versions_idx
on public.factory_mesti_equipment_cleaning_requirements(logical_requirement_id, version_no desc);

create index if not exists factory_mesti_equipment_cleaning_occurrences_daily_idx
on public.factory_mesti_equipment_cleaning_occurrences(due_date, status, equipment_id);

create extension if not exists btree_gist with schema extensions;
alter table public.factory_mesti_equipment_cleaning_requirements
  drop constraint if exists factory_mesti_equipment_cleaning_non_overlapping_versions;
alter table public.factory_mesti_equipment_cleaning_requirements
  add constraint factory_mesti_equipment_cleaning_non_overlapping_versions
  exclude using gist (logical_requirement_id with =, daterange(effective_from, effective_until, '[)') with &&);

alter table public.factory_mesti_equipment_cleaning_requirements enable row level security;
alter table public.factory_mesti_equipment_cleaning_requirement_equipment enable row level security;
alter table public.factory_mesti_equipment_cleaning_occurrences enable row level security;

revoke all on public.factory_mesti_equipment_cleaning_requirements from authenticated;
revoke all on public.factory_mesti_equipment_cleaning_requirement_equipment from authenticated;
revoke all on public.factory_mesti_equipment_cleaning_occurrences from authenticated;
grant select on public.factory_mesti_equipment_cleaning_requirements to authenticated;
grant select on public.factory_mesti_equipment_cleaning_requirement_equipment to authenticated;
grant select on public.factory_mesti_equipment_cleaning_occurrences to authenticated;

create policy "factory mesti equipment cleaning requirements read" on public.factory_mesti_equipment_cleaning_requirements for select to authenticated
using (public.current_user_has_permission('factory_mesti_equipment_cleaning.view') or public.current_user_has_permission('factory_mesti_equipment_cleaning.manage'));
create policy "factory mesti equipment cleaning links read" on public.factory_mesti_equipment_cleaning_requirement_equipment for select to authenticated
using (public.current_user_has_permission('factory_mesti_equipment_cleaning.view') or public.current_user_has_permission('factory_mesti_equipment_cleaning.manage'));
create policy "factory mesti equipment cleaning occurrences read" on public.factory_mesti_equipment_cleaning_occurrences for select to authenticated
using (public.current_user_has_permission('factory_mesti_equipment_cleaning.view') or public.current_user_has_permission('factory_mesti_equipment_cleaning.manage'));

drop policy if exists "factory equipment view" on public.factory_equipment;
create policy "factory equipment view" on public.factory_equipment for select to authenticated
using (
  public.current_user_has_permission('factory_equipment.view')
  or public.current_user_has_permission('factory_equipment.manage')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_mesti_calibration.view')
  or public.current_user_has_permission('factory_mesti_calibration.manage')
  or public.current_user_has_permission('factory_mesti_equipment_cleaning.view')
  or public.current_user_has_permission('factory_mesti_equipment_cleaning.manage')
);

create or replace function public.factory_mesti_equipment_cleaning_snapshot(
  p_requirement public.factory_mesti_equipment_cleaning_requirements,
  p_equipment public.factory_equipment,
  p_usage public.factory_production_equipment_usage default null
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'requirement_id', p_requirement.id,
    'logical_requirement_id', p_requirement.logical_requirement_id,
    'task_name', p_requirement.task_name,
    'trigger_type', p_requirement.trigger_type,
    'recurrence_type', p_requirement.recurrence_type,
    'recurrence_weekdays', p_requirement.recurrence_weekdays,
    'effective_from', p_requirement.effective_from,
    'effective_until', p_requirement.effective_until,
    'version_no', p_requirement.version_no,
    'equipment_id', p_equipment.id,
    'equipment_code', p_equipment.equipment_code,
    'equipment_name', p_equipment.name,
    'location_id', p_equipment.current_location_id,
    'location_name', location.location_name,
    'production_equipment_usage_id', p_usage.id,
    'usage_completed_at', p_usage.used_at,
    'job_order_id', p_usage.job_order_id,
    'production_id', p_usage.production_id,
    'production_step_execution_id', p_usage.production_step_execution_id,
    'equipment_snapshot', coalesce(p_usage.equipment_snapshot, jsonb_build_object(
      'equipment_code', p_equipment.equipment_code, 'name', p_equipment.name,
      'location_id', p_equipment.current_location_id, 'location_name', location.location_name
    )),
    'production_snapshot', coalesce(p_usage.production_snapshot, '{}'::jsonb)
  )
  from public.factory_storage_locations location
  where location.id = p_equipment.current_location_id
$$;

create or replace function public.factory_mesti_materialize_equipment_cleaning_scheduled(p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_inserted integer := 0;
begin
  if not (public.current_user_has_permission('factory_mesti_equipment_cleaning.view') or public.current_user_has_permission('factory_mesti_equipment_cleaning.manage')) then
    raise exception using errcode = '42501', message = 'Missing permission to view Factory MeSTI Cleaning of Equipment.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception using errcode = '22023', message = 'Invalid equipment Cleaning date range.';
  end if;

  insert into public.factory_mesti_equipment_cleaning_occurrences(
    requirement_id, logical_requirement_id, equipment_id, due_date, requirement_snapshot
  )
  select requirement.id, requirement.logical_requirement_id, equipment.id, due.day::date,
         public.factory_mesti_equipment_cleaning_snapshot(requirement, equipment)
  from public.factory_mesti_equipment_cleaning_requirements requirement
  join public.factory_mesti_equipment_cleaning_requirement_equipment link on link.requirement_id = requirement.id
  join public.factory_equipment equipment on equipment.id = link.equipment_id and equipment.status = 'active'
  cross join generate_series(p_from, p_to, interval '1 day') due(day)
  where requirement.status = 'active'
    and requirement.trigger_type = 'scheduled'
    and due.day::date >= requirement.effective_from
    and (requirement.effective_until is null or due.day::date < requirement.effective_until)
    and public.factory_mesti_recurrence_due(requirement.recurrence_type, requirement.recurrence_weekdays, due.day::date)
  on conflict (logical_requirement_id, equipment_id, due_date) where production_equipment_usage_id is null do nothing;
  get diagnostics v_inserted = row_count;

  update public.factory_mesti_equipment_cleaning_occurrences
  set status = 'missed', updated_at = now()
  where production_equipment_usage_id is null and status = 'pending' and due_date < current_date and due_date between p_from and p_to;
  return v_inserted;
end;
$$;

create or replace function public.factory_mesti_materialize_equipment_cleaning_after_operation(p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_inserted integer := 0;
begin
  if not (public.current_user_has_permission('factory_mesti_equipment_cleaning.view') or public.current_user_has_permission('factory_mesti_equipment_cleaning.manage')) then
    raise exception using errcode = '42501', message = 'Missing permission to view Factory MeSTI Cleaning of Equipment.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception using errcode = '22023', message = 'Invalid equipment usage date range.';
  end if;

  insert into public.factory_mesti_equipment_cleaning_occurrences(
    requirement_id, logical_requirement_id, equipment_id, due_date, production_equipment_usage_id, requirement_snapshot
  )
  select requirement.id, requirement.logical_requirement_id, usage.equipment_id,
         (usage.used_at at time zone 'Asia/Kuala_Lumpur')::date, usage.id,
         public.factory_mesti_equipment_cleaning_snapshot(requirement, equipment, usage)
  from public.factory_production_equipment_usage usage
  join public.factory_productions production on production.id = usage.production_id and lower(production.status) = 'completed'
  join public.factory_equipment equipment on equipment.id = usage.equipment_id
  join public.factory_mesti_equipment_cleaning_requirement_equipment link on link.equipment_id = usage.equipment_id
  join public.factory_mesti_equipment_cleaning_requirements requirement on requirement.id = link.requirement_id
  where requirement.status = 'active'
    and requirement.trigger_type = 'after_operation'
    and (usage.used_at at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to
    and (usage.used_at at time zone 'Asia/Kuala_Lumpur')::date >= requirement.effective_from
    and (requirement.effective_until is null or (usage.used_at at time zone 'Asia/Kuala_Lumpur')::date < requirement.effective_until)
  on conflict (logical_requirement_id, production_equipment_usage_id) where production_equipment_usage_id is not null do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.factory_save_mesti_equipment_cleaning_requirement(p_requirement jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee public.employees%rowtype := public.factory_mesti_current_employee();
  v_submitted public.factory_mesti_equipment_cleaning_requirements%rowtype;
  v_current public.factory_mesti_equipment_cleaning_requirements%rowtype;
  v_saved public.factory_mesti_equipment_cleaning_requirements%rowtype;
  v_equipment_ids uuid[] := array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_requirement->'equipment_ids', '[]'::jsonb)) value order by 1);
  v_current_equipment_ids uuid[];
  v_id uuid := nullif(p_requirement->>'id', '')::uuid;
  v_trigger text := lower(coalesce(nullif(p_requirement->>'trigger_type', ''), 'scheduled'));
  v_recurrence text := lower(nullif(p_requirement->>'recurrence_type', ''));
  v_weekdays integer[] := array(select distinct value::integer from jsonb_array_elements_text(coalesce(p_requirement->'recurrence_weekdays', '[]'::jsonb)) value order by 1);
  v_status text := lower(coalesce(nullif(p_requirement->>'status', ''), 'active'));
  v_requested_from date := coalesce(nullif(p_requirement->>'effective_from', '')::date, current_date);
  v_effective_from date;
  v_latest_evidence_date date;
  v_version_created boolean := false;
begin
  if not (public.current_user_has_permission('factory_mesti_equipment_cleaning.manage') or public.current_user_has_permission('factory_mesti_equipment_cleaning.create') or public.current_user_has_permission('factory_mesti_equipment_cleaning.edit')) then
    raise exception using errcode = '42501', message = 'Missing permission to manage Equipment Cleaning Requirements.';
  end if;
  if nullif(btrim(p_requirement->>'task_name'), '') is null then raise exception using errcode = '22023', message = 'Task name is required.'; end if;
  if cardinality(v_equipment_ids) = 0 then raise exception using errcode = '22023', message = 'At least one active Equipment item is required.'; end if;
  if exists (select 1 from unnest(v_equipment_ids) equipment_id left join public.factory_equipment equipment on equipment.id = equipment_id and equipment.status = 'active' where equipment.id is null) then
    raise exception using errcode = '22023', message = 'Only active canonical Equipment may be selected.';
  end if;
  if v_trigger not in ('scheduled', 'after_operation') then raise exception using errcode = '22023', message = 'Unsupported Cleaning trigger.'; end if;
  if v_status not in ('active', 'inactive') then raise exception using errcode = '22023', message = 'Unsupported Requirement status.'; end if;
  if v_trigger = 'scheduled' and v_recurrence not in ('daily', 'weekly') then raise exception using errcode = '22023', message = 'Scheduled Cleaning requires Daily or Weekly recurrence.'; end if;
  if v_trigger = 'scheduled' and v_recurrence = 'weekly' and cardinality(v_weekdays) = 0 then raise exception using errcode = '22023', message = 'Select at least one weekday.'; end if;
  if v_trigger = 'after_operation' then v_recurrence := null; v_weekdays := '{}'::integer[]; end if;
  if v_trigger = 'scheduled' and v_recurrence = 'daily' then v_weekdays := '{}'::integer[]; end if;

  if v_id is null then
    insert into public.factory_mesti_equipment_cleaning_requirements(logical_requirement_id, task_name, trigger_type, recurrence_type, recurrence_weekdays, status, effective_from, created_by)
    values (gen_random_uuid(), btrim(p_requirement->>'task_name'), v_trigger, v_recurrence, v_weekdays, v_status, v_requested_from, v_employee.id)
    returning * into v_saved;
    v_version_created := true;
  else
    select * into v_submitted from public.factory_mesti_equipment_cleaning_requirements where id = v_id;
    if v_submitted.id is null then raise exception using errcode = '22023', message = 'Equipment Cleaning Requirement was not found.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_submitted.logical_requirement_id::text, 0));
    select * into v_current from public.factory_mesti_equipment_cleaning_requirements where logical_requirement_id = v_submitted.logical_requirement_id and effective_until is null order by version_no desc limit 1 for update;
    if v_current.id is null then raise exception using errcode = '22023', message = 'Equipment Cleaning Requirement has no current version.'; end if;
    select coalesce(array_agg(link.equipment_id order by link.equipment_id), '{}'::uuid[]) into v_current_equipment_ids from public.factory_mesti_equipment_cleaning_requirement_equipment link where link.requirement_id = v_current.id;
    if v_current.task_name = btrim(p_requirement->>'task_name') and v_current.trigger_type = v_trigger and v_current.recurrence_type is not distinct from v_recurrence and v_current.recurrence_weekdays = v_weekdays and v_current.status = v_status and v_current_equipment_ids = v_equipment_ids then
      v_saved := v_current;
    else
      select max(due_date) into v_latest_evidence_date from public.factory_mesti_equipment_cleaning_occurrences where logical_requirement_id = v_current.logical_requirement_id and status <> 'pending';
      v_effective_from := greatest(v_requested_from, current_date, v_current.effective_from, coalesce(v_latest_evidence_date + 1, '-infinity'::date));
      update public.factory_mesti_equipment_cleaning_requirements set effective_until = v_effective_from, updated_at = now() where id = v_current.id;
      insert into public.factory_mesti_equipment_cleaning_requirements(logical_requirement_id, task_name, trigger_type, recurrence_type, recurrence_weekdays, status, effective_from, version_no, created_by)
      values (v_current.logical_requirement_id, btrim(p_requirement->>'task_name'), v_trigger, v_recurrence, v_weekdays, v_status, v_effective_from, v_current.version_no + 1, v_employee.id)
      returning * into v_saved;
      update public.factory_mesti_equipment_cleaning_requirements set superseded_by = v_saved.id, updated_at = now() where id = v_current.id;
      delete from public.factory_mesti_equipment_cleaning_occurrences where logical_requirement_id = v_current.logical_requirement_id and production_equipment_usage_id is null and status = 'pending' and due_date >= v_effective_from;
      v_version_created := true;
    end if;
  end if;

  insert into public.factory_mesti_equipment_cleaning_requirement_equipment(requirement_id, equipment_id)
  select v_saved.id, equipment_id from unnest(v_equipment_ids) equipment_id on conflict do nothing;
  return to_jsonb(v_saved) || jsonb_build_object(
    'equipment_ids', to_jsonb(v_equipment_ids),
    'equipment_names', coalesce((select jsonb_agg(concat_ws(' · ', equipment.equipment_code, equipment.name) order by equipment.equipment_code) from public.factory_equipment equipment where equipment.id = any(v_equipment_ids)), '[]'::jsonb),
    'version_created', v_version_created
  );
end;
$$;

create or replace function public.factory_mesti_equipment_cleaning_day(p_due_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.factory_mesti_materialize_equipment_cleaning_scheduled(p_due_date, p_due_date);
  perform public.factory_mesti_materialize_equipment_cleaning_after_operation(p_due_date, p_due_date);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', occurrence.id, 'due_date', occurrence.due_date, 'status', occurrence.status,
      'requirement_id', occurrence.requirement_id, 'logical_requirement_id', occurrence.logical_requirement_id,
      'equipment_id', occurrence.equipment_id, 'production_equipment_usage_id', occurrence.production_equipment_usage_id,
      'task_name', occurrence.requirement_snapshot->>'task_name', 'trigger_type', occurrence.requirement_snapshot->>'trigger_type',
      'recurrence_type', occurrence.requirement_snapshot->>'recurrence_type', 'recurrence_weekdays', occurrence.requirement_snapshot->'recurrence_weekdays',
      'equipment_code', occurrence.requirement_snapshot->>'equipment_code', 'equipment_name', occurrence.requirement_snapshot->>'equipment_name',
      'location_name', coalesce(occurrence.requirement_snapshot->'equipment_snapshot'->>'location_name', occurrence.requirement_snapshot->>'location_name'),
      'usage_completed_at', occurrence.requirement_snapshot->>'usage_completed_at', 'production_snapshot', occurrence.requirement_snapshot->'production_snapshot',
      'version_no', occurrence.requirement_snapshot->>'version_no', 'completed_by', occurrence.completed_by,
      'completed_by_name', coalesce(completer.nickname, completer.full_name, completer.email), 'completed_at', occurrence.completed_at,
      'completion_note', occurrence.completion_note, 'verified_by', occurrence.verified_by,
      'verified_by_name', coalesce(verifier.nickname, verifier.full_name, verifier.email), 'verified_at', occurrence.verified_at,
      'verification_result', occurrence.verification_result, 'verification_note', occurrence.verification_note
    ) order by occurrence.requirement_snapshot->>'equipment_code', occurrence.requirement_snapshot->>'equipment_name', occurrence.created_at)
    from public.factory_mesti_equipment_cleaning_occurrences occurrence
    left join public.employees completer on completer.id = occurrence.completed_by
    left join public.employees verifier on verifier.id = occurrence.verified_by
    where occurrence.due_date = p_due_date
  ), '[]'::jsonb);
end;
$$;

create or replace function public.factory_mesti_equipment_cleaning_month(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_from date := date_trunc('month', p_month)::date; v_to date := (date_trunc('month', p_month)::date + interval '1 month - 1 day')::date;
begin
  perform public.factory_mesti_materialize_equipment_cleaning_scheduled(v_from, v_to);
  perform public.factory_mesti_materialize_equipment_cleaning_after_operation(v_from, v_to);
  return coalesce((
    with occurrences as (
      select occurrence.*, occurrence.requirement_snapshot->>'task_name' as task_name,
             occurrence.requirement_snapshot->>'trigger_type' as trigger_type,
             occurrence.requirement_snapshot->>'recurrence_type' as recurrence_type,
             occurrence.requirement_snapshot->'recurrence_weekdays' as recurrence_weekdays
      from public.factory_mesti_equipment_cleaning_occurrences occurrence where occurrence.due_date between v_from and v_to
    ), cells as (
      select logical_requirement_id, task_name, trigger_type, recurrence_type, recurrence_weekdays, due_date,
             count(*)::integer as total_count, count(*) filter (where status = 'verified')::integer as verified_count,
             count(*) filter (where status = 'completed')::integer as completed_count, count(*) filter (where status = 'unsatisfactory')::integer as unsatisfactory_count,
             count(*) filter (where status = 'missed')::integer as missed_count, count(*) filter (where status = 'pending')::integer as pending_count,
             case when count(distinct status) > 1 then 'mixed' else min(status) end as status,
             jsonb_agg(jsonb_build_object('id', id, 'status', status, 'equipment_code', requirement_snapshot->>'equipment_code', 'equipment_name', requirement_snapshot->>'equipment_name', 'location_name', coalesce(requirement_snapshot->'equipment_snapshot'->>'location_name', requirement_snapshot->>'location_name'), 'production_equipment_usage_id', production_equipment_usage_id, 'production_snapshot', requirement_snapshot->'production_snapshot', 'completed_by_name', (select coalesce(employee.nickname, employee.full_name, employee.email) from public.employees employee where employee.id = occurrences.completed_by), 'completed_at', completed_at, 'verified_by_name', (select coalesce(employee.nickname, employee.full_name, employee.email) from public.employees employee where employee.id = occurrences.verified_by), 'verified_at', verified_at) order by requirement_snapshot->>'equipment_code', created_at) as occurrences
      from occurrences group by logical_requirement_id, task_name, trigger_type, recurrence_type, recurrence_weekdays, due_date
    )
    select jsonb_agg(jsonb_build_object('logical_requirement_id', logical_requirement_id, 'task_name', task_name, 'trigger_type', trigger_type, 'recurrence_type', recurrence_type, 'recurrence_weekdays', recurrence_weekdays, 'days', days) order by task_name, logical_requirement_id)
    from (select logical_requirement_id, min(task_name) as task_name, min(trigger_type) as trigger_type, min(recurrence_type) as recurrence_type, (array_agg(recurrence_weekdays))[1] as recurrence_weekdays, jsonb_agg(jsonb_build_object('due_date', due_date, 'status', status, 'total_count', total_count, 'verified_count', verified_count, 'completed_count', completed_count, 'unsatisfactory_count', unsatisfactory_count, 'missed_count', missed_count, 'pending_count', pending_count, 'occurrences', occurrences) order by due_date) as days from cells group by logical_requirement_id) grouped
  ), '[]'::jsonb);
end;
$$;

create or replace function public.factory_mesti_complete_equipment_cleaning_occurrence(p_occurrence_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_employee public.employees%rowtype := public.factory_mesti_current_employee(); v_occurrence public.factory_mesti_equipment_cleaning_occurrences%rowtype;
begin
  if not (public.current_user_has_permission('factory_mesti_equipment_cleaning.complete') or public.current_user_has_permission('factory_mesti_equipment_cleaning.manage')) then raise exception using errcode = '42501', message = 'Missing permission to complete Equipment Cleaning occurrences.'; end if;
  select * into v_occurrence from public.factory_mesti_equipment_cleaning_occurrences where id = p_occurrence_id for update;
  if v_occurrence.id is null then raise exception using errcode = 'P0002', message = 'Equipment Cleaning occurrence was not found.'; end if;
  if v_occurrence.status not in ('pending', 'missed', 'unsatisfactory') then raise exception using errcode = '55000', message = 'Equipment Cleaning occurrence cannot be completed from its current state.'; end if;
  update public.factory_mesti_equipment_cleaning_occurrences set status = 'completed', completed_by = v_employee.id, completed_at = now(), completion_result = 'completed', completion_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = v_occurrence.id returning * into v_occurrence;
  return to_jsonb(v_occurrence);
end;
$$;

create or replace function public.factory_mesti_verify_equipment_cleaning_occurrence(p_occurrence_id uuid, p_result text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_employee public.employees%rowtype := public.factory_mesti_current_employee(); v_occurrence public.factory_mesti_equipment_cleaning_occurrences%rowtype; v_result text := lower(coalesce(p_result, 'verified'));
begin
  if not (public.current_user_has_permission('factory_mesti_equipment_cleaning.review') or public.current_user_has_permission('factory_mesti_equipment_cleaning.manage')) then raise exception using errcode = '42501', message = 'Missing permission to verify Equipment Cleaning occurrences.'; end if;
  select * into v_occurrence from public.factory_mesti_equipment_cleaning_occurrences where id = p_occurrence_id for update;
  if v_occurrence.id is null then raise exception using errcode = 'P0002', message = 'Equipment Cleaning occurrence was not found.'; end if;
  if v_occurrence.completed_by = v_employee.id then raise exception using errcode = '42501', message = 'Self-verification is not allowed.'; end if;
  if v_occurrence.status <> 'completed' then raise exception using errcode = '55000', message = 'Only completed Equipment Cleaning occurrences can be verified.'; end if;
  if v_result not in ('verified', 'unsatisfactory') then raise exception using errcode = '22023', message = 'Unsupported verification result.'; end if;
  update public.factory_mesti_equipment_cleaning_occurrences set status = v_result, verified_by = v_employee.id, verified_at = now(), verification_result = v_result, verification_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = v_occurrence.id returning * into v_occurrence;
  return to_jsonb(v_occurrence);
end;
$$;

revoke all on function public.factory_mesti_materialize_equipment_cleaning_scheduled(date, date) from public, anon;
revoke all on function public.factory_mesti_materialize_equipment_cleaning_after_operation(date, date) from public, anon;
revoke all on function public.factory_save_mesti_equipment_cleaning_requirement(jsonb) from public, anon;
revoke all on function public.factory_mesti_equipment_cleaning_day(date) from public, anon;
revoke all on function public.factory_mesti_equipment_cleaning_month(date) from public, anon;
revoke all on function public.factory_mesti_complete_equipment_cleaning_occurrence(uuid, text) from public, anon;
revoke all on function public.factory_mesti_verify_equipment_cleaning_occurrence(uuid, text, text) from public, anon;
grant execute on function public.factory_mesti_materialize_equipment_cleaning_scheduled(date, date) to authenticated;
grant execute on function public.factory_mesti_materialize_equipment_cleaning_after_operation(date, date) to authenticated;
grant execute on function public.factory_save_mesti_equipment_cleaning_requirement(jsonb) to authenticated;
grant execute on function public.factory_mesti_equipment_cleaning_day(date) to authenticated;
grant execute on function public.factory_mesti_equipment_cleaning_month(date) to authenticated;
grant execute on function public.factory_mesti_complete_equipment_cleaning_occurrence(uuid, text) to authenticated;
grant execute on function public.factory_mesti_verify_equipment_cleaning_occurrence(uuid, text, text) to authenticated;
