-- Cleaning roles are module configuration, while occurrence snapshots remain
-- the immutable record of the role rules that applied to completed work.

create table if not exists public.factory_mesti_cleaning_settings (
  id boolean primary key default true check (id),
  responsible_role_id uuid not null references public.roles(id) on delete restrict,
  verifier_role_id uuid not null references public.roles(id) on delete restrict,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prefer the role pair that is actually effective today. This avoids a
-- forward-dated version changing the module baseline during migration.
with candidates as (
  select requirement.responsible_role_id,
         requirement.verifier_role_id,
         count(*) as use_count,
         max(requirement.updated_at) as last_updated,
         0 as fallback_rank
  from public.factory_mesti_cleaning_requirements requirement
  where requirement.effective_from <= current_date
    and (requirement.effective_until is null or current_date < requirement.effective_until)
  group by requirement.responsible_role_id, requirement.verifier_role_id

  union all

  select role.id, role.id, 0, role.updated_at, 1
  from public.roles role
  where role.is_active = true
), selected as (
  select responsible_role_id, verifier_role_id
  from candidates
  order by fallback_rank, use_count desc, last_updated desc, responsible_role_id, verifier_role_id
  limit 1
)
insert into public.factory_mesti_cleaning_settings(id, responsible_role_id, verifier_role_id)
select true, responsible_role_id, verifier_role_id
from selected
on conflict (id) do nothing;

alter table public.factory_mesti_cleaning_settings enable row level security;

drop policy if exists "factory mesti cleaning settings read" on public.factory_mesti_cleaning_settings;
create policy "factory mesti cleaning settings read" on public.factory_mesti_cleaning_settings for select to authenticated
using (public.current_user_has_permission('factory_mesti_cleaning.view') or public.current_user_has_permission('factory_mesti_cleaning.manage'));

revoke all on table public.factory_mesti_cleaning_settings from public, anon;
grant select on table public.factory_mesti_cleaning_settings to authenticated;

alter table public.factory_mesti_cleaning_requirements
  drop column if exists responsible_role_id,
  drop column if exists verifier_role_id;

create function public.factory_mesti_cleaning_occurrence_snapshot(
  p_requirement public.factory_mesti_cleaning_requirements,
  p_location public.factory_storage_locations,
  p_settings public.factory_mesti_cleaning_settings
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
    'recurrence_type', p_requirement.recurrence_type,
    'recurrence_weekdays', p_requirement.recurrence_weekdays,
    'responsible_role_id', p_settings.responsible_role_id,
    'verifier_role_id', p_settings.verifier_role_id,
    'effective_from', p_requirement.effective_from,
    'effective_until', p_requirement.effective_until,
    'version_no', p_requirement.version_no,
    'location_id', p_location.id,
    'location_name', p_location.location_name,
    'location_code', p_location.location_code,
    'location_type', p_location.location_type
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

  insert into public.factory_mesti_cleaning_occurrences(
    requirement_id, logical_requirement_id, location_id, due_date, status, requirement_snapshot
  )
  select requirement.id,
         requirement.logical_requirement_id,
         location.id,
         due_date.day::date,
         'pending',
         public.factory_mesti_cleaning_occurrence_snapshot(requirement, location, settings)
  from public.factory_mesti_cleaning_requirements requirement
  join public.factory_mesti_cleaning_requirement_locations link on link.requirement_id = requirement.id
  join public.factory_storage_locations location on location.id = link.location_id
  cross join public.factory_mesti_cleaning_settings settings
  cross join generate_series(p_from, p_to, interval '1 day') due_date(day)
  where settings.id = true
    and requirement.status = 'active'
    and location.status = 'active'
    and due_date.day::date >= requirement.effective_from
    and (requirement.effective_until is null or due_date.day::date < requirement.effective_until)
    and public.factory_mesti_recurrence_due(requirement.recurrence_type, requirement.recurrence_weekdays, due_date.day::date)
  on conflict (logical_requirement_id, location_id, due_date) do nothing;

  get diagnostics v_inserted = row_count;

  update public.factory_mesti_cleaning_occurrences
  set status = 'missed', updated_at = now()
  where status = 'pending'
    and due_date < current_date
    and due_date between p_from and p_to;

  return v_inserted;
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
  v_submitted public.factory_mesti_cleaning_requirements%rowtype;
  v_current public.factory_mesti_cleaning_requirements%rowtype;
  v_saved public.factory_mesti_cleaning_requirements%rowtype;
  v_location_ids uuid[] := array(
    select distinct value::uuid
    from jsonb_array_elements_text(coalesce(p_requirement->'location_ids', '[]'::jsonb)) value
    order by 1
  );
  v_current_location_ids uuid[];
  v_id uuid := nullif(p_requirement->>'id', '')::uuid;
  v_logical_requirement_id uuid;
  v_type text := lower(coalesce(nullif(p_requirement->>'recurrence_type', ''), 'daily'));
  v_weekdays integer[] := array(
    select distinct value::integer
    from jsonb_array_elements_text(coalesce(p_requirement->'recurrence_weekdays', '[]'::jsonb)) value
    order by 1
  );
  v_requested_effective_from date := coalesce(nullif(p_requirement->>'effective_from', '')::date, current_date);
  v_effective_from date;
  v_latest_evidence_date date;
  v_version_created boolean := false;
begin
  if not (public.current_user_has_permission('factory_mesti_cleaning.manage') or public.current_user_has_permission('factory_mesti_cleaning.create') or public.current_user_has_permission('factory_mesti_cleaning.edit')) then
    raise exception using errcode='42501', message='Missing permission to manage Cleaning Requirements.';
  end if;
  if nullif(btrim(p_requirement->>'task_name'), '') is null then
    raise exception using errcode='22023', message='Task name is required.';
  end if;
  if cardinality(v_location_ids) = 0 then
    raise exception using errcode='22023', message='At least one Location is required.';
  end if;
  if exists (
    select 1 from unnest(v_location_ids) location_id
    left join public.factory_storage_locations location on location.id = location_id and location.status = 'active'
    where location.id is null
  ) then
    raise exception using errcode='22023', message='Only active Factory Locations may be selected.';
  end if;
  if v_type not in ('daily', 'weekly') then
    raise exception using errcode='22023', message='Unsupported recurrence.';
  end if;
  if v_type = 'weekly' and cardinality(v_weekdays) = 0 then
    raise exception using errcode='22023', message='Select at least one weekday.';
  end if;

  if v_id is null then
    v_logical_requirement_id := gen_random_uuid();
    insert into public.factory_mesti_cleaning_requirements(
      logical_requirement_id, task_name, recurrence_type, recurrence_weekdays, status, effective_from, created_by
    ) values (
      v_logical_requirement_id, btrim(p_requirement->>'task_name'), v_type,
      case when v_type = 'daily' then '{}'::integer[] else v_weekdays end,
      coalesce(nullif(p_requirement->>'status', ''), 'active'), v_requested_effective_from, v_employee.id
    ) returning * into v_saved;
    v_version_created := true;
  else
    select * into v_submitted from public.factory_mesti_cleaning_requirements where id = v_id;
    if v_submitted.id is null then
      raise exception using errcode='22023', message='Cleaning Requirement was not found.';
    end if;

    v_logical_requirement_id := v_submitted.logical_requirement_id;
    perform pg_advisory_xact_lock(hashtextextended(v_logical_requirement_id::text, 0));
    select * into v_current
    from public.factory_mesti_cleaning_requirements
    where logical_requirement_id = v_logical_requirement_id and effective_until is null
    order by version_no desc limit 1 for update;
    if v_current.id is null then
      raise exception using errcode='22023', message='Cleaning Requirement has no current version.';
    end if;

    select coalesce(array_agg(link.location_id order by link.location_id), '{}'::uuid[])
    into v_current_location_ids
    from public.factory_mesti_cleaning_requirement_locations link
    where link.requirement_id = v_current.id;

    if v_current.task_name = btrim(p_requirement->>'task_name')
      and v_current.recurrence_type = v_type
      and v_current.recurrence_weekdays = (case when v_type = 'daily' then '{}'::integer[] else v_weekdays end)
      and v_current.status = coalesce(nullif(p_requirement->>'status', ''), 'active')
      and v_current_location_ids = v_location_ids then
      v_saved := v_current;
    else
      select max(due_date) into v_latest_evidence_date
      from public.factory_mesti_cleaning_occurrences
      where logical_requirement_id = v_logical_requirement_id and status <> 'pending';

      v_effective_from := greatest(v_requested_effective_from, current_date, v_current.effective_from, coalesce(v_latest_evidence_date + 1, '-infinity'::date));
      update public.factory_mesti_cleaning_requirements set effective_until = v_effective_from, updated_at = now() where id = v_current.id;
      insert into public.factory_mesti_cleaning_requirements(
        logical_requirement_id, task_name, recurrence_type, recurrence_weekdays, status, effective_from, version_no, created_by
      ) values (
        v_logical_requirement_id, btrim(p_requirement->>'task_name'), v_type,
        case when v_type = 'daily' then '{}'::integer[] else v_weekdays end,
        coalesce(nullif(p_requirement->>'status', ''), 'active'), v_effective_from, v_current.version_no + 1, v_employee.id
      ) returning * into v_saved;
      update public.factory_mesti_cleaning_requirements set superseded_by = v_saved.id, updated_at = now() where id = v_current.id;
      delete from public.factory_mesti_cleaning_occurrences
      where logical_requirement_id = v_logical_requirement_id and status = 'pending' and due_date >= v_effective_from;
      v_version_created := true;
    end if;
  end if;

  insert into public.factory_mesti_cleaning_requirement_locations(requirement_id, location_id)
  select v_saved.id, location_id from unnest(v_location_ids) location_id on conflict do nothing;

  return to_jsonb(v_saved) || jsonb_build_object(
    'location_ids', to_jsonb(v_location_ids),
    'location_names', coalesce((select jsonb_agg(location.location_name order by location.location_name) from public.factory_storage_locations location where location.id = any(v_location_ids)), '[]'::jsonb),
    'version_created', v_version_created
  );
end;
$$;

create or replace function public.factory_save_mesti_cleaning_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee public.employees%rowtype := public.factory_mesti_current_employee();
  v_responsible_role_id uuid := nullif(p_settings->>'responsible_role_id', '')::uuid;
  v_verifier_role_id uuid := nullif(p_settings->>'verifier_role_id', '')::uuid;
  v_saved public.factory_mesti_cleaning_settings%rowtype;
begin
  if not public.current_user_has_permission('factory_mesti_cleaning.manage') then
    raise exception using errcode='42501', message='Missing permission to manage Cleaning Settings.';
  end if;
  if v_responsible_role_id is null or v_verifier_role_id is null then
    raise exception using errcode='22023', message='Responsible and verifier roles are required.';
  end if;
  if exists (
    select 1 from unnest(array[v_responsible_role_id, v_verifier_role_id]) role_id
    left join public.roles role on role.id = role_id and role.is_active = true
    where role.id is null
  ) then
    raise exception using errcode='22023', message='Cleaning Settings roles must be active.';
  end if;

  insert into public.factory_mesti_cleaning_settings(id, responsible_role_id, verifier_role_id, created_by)
  values (true, v_responsible_role_id, v_verifier_role_id, v_employee.id)
  on conflict (id) do update
  set responsible_role_id = excluded.responsible_role_id,
      verifier_role_id = excluded.verifier_role_id,
      updated_at = now()
  returning * into v_saved;

  -- Pending projections are not final evidence. Recreate them so the new
  -- module settings authorize every still-actionable due date consistently.
  delete from public.factory_mesti_cleaning_occurrences
  where status = 'pending' and due_date >= current_date;

  return to_jsonb(v_saved);
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
    with occurrences as (
      select o.id, o.due_date, o.status, o.requirement_id, o.logical_requirement_id, o.location_id,
             o.completed_by, o.completed_at, o.completion_result, o.completion_note,
             o.verified_by, o.verified_at, o.verification_result, o.verification_note,
             o.requirement_snapshot->>'location_name' as location_name,
             o.requirement_snapshot->>'location_code' as location_code,
             o.requirement_snapshot->>'location_type' as location_type,
             o.requirement_snapshot->>'recurrence_type' as recurrence_type,
             o.requirement_snapshot->'recurrence_weekdays' as recurrence_weekdays,
             o.requirement_snapshot->>'task_name' as task_name,
             o.requirement_snapshot->>'responsible_role_id' as responsible_role_id,
             o.requirement_snapshot->>'verifier_role_id' as verifier_role_id,
             o.requirement_snapshot->>'version_no' as version_no,
             coalesce(completer.nickname, completer.full_name, completer.email) as completed_by_name,
             coalesce(verifier.nickname, verifier.full_name, verifier.email) as verified_by_name
      from public.factory_mesti_cleaning_occurrences o
      left join public.employees completer on completer.id = o.completed_by
      left join public.employees verifier on verifier.id = o.verified_by
      where o.due_date between v_from and v_to
    ), day_groups as (
      select logical_requirement_id, due_date,
             (array_agg(task_name order by due_date desc, id desc))[1] as task_name,
             (array_agg(recurrence_type order by due_date desc, id desc))[1] as recurrence_type,
             (array_agg(recurrence_weekdays order by due_date desc, id desc))[1] as recurrence_weekdays,
             count(*)::integer as total_count,
             count(*) filter (where status = 'verified')::integer as verified_count,
             count(*) filter (where status = 'completed')::integer as completed_count,
             count(*) filter (where status = 'unsatisfactory')::integer as unsatisfactory_count,
             count(*) filter (where status = 'missed')::integer as missed_count,
             count(*) filter (where status = 'pending')::integer as pending_count,
             jsonb_agg(jsonb_build_object(
               'id', id, 'due_date', due_date, 'status', status,
               'requirement_id', requirement_id, 'logical_requirement_id', logical_requirement_id,
               'location_id', location_id, 'location_name', location_name,
               'location_code', location_code, 'location_type', location_type,
               'recurrence_type', recurrence_type, 'recurrence_weekdays', recurrence_weekdays,
               'task_name', task_name, 'responsible_role_id', responsible_role_id,
               'verifier_role_id', verifier_role_id, 'version_no', version_no,
               'completed_by', completed_by, 'completed_by_name', completed_by_name,
               'completed_at', completed_at, 'completion_result', completion_result,
               'completion_note', completion_note, 'verified_by', verified_by,
               'verified_by_name', verified_by_name, 'verified_at', verified_at,
               'verification_result', verification_result, 'verification_note', verification_note
             ) order by location_name, id) as occurrences
      from occurrences
      group by logical_requirement_id, due_date
    ), requirement_groups as (
      select logical_requirement_id,
             (array_agg(task_name order by due_date desc))[1] as task_name,
             (array_agg(recurrence_type order by due_date desc))[1] as recurrence_type,
             (array_agg(recurrence_weekdays order by due_date desc))[1] as recurrence_weekdays,
             jsonb_agg(jsonb_build_object(
               'due_date', due_date,
               'status', case
                 when unsatisfactory_count > 0 then 'unsatisfactory'
                 when missed_count > 0 then 'missed'
                 when completed_count > 0 and completed_count = total_count then 'completed'
                 when verified_count = total_count then 'verified'
                 when pending_count = total_count then 'pending'
                 else 'mixed'
               end,
               'total_count', total_count, 'verified_count', verified_count,
               'completed_count', completed_count, 'unsatisfactory_count', unsatisfactory_count,
               'missed_count', missed_count, 'pending_count', pending_count,
               'occurrences', occurrences
             ) order by due_date) as days
      from day_groups
      group by logical_requirement_id
    )
    select jsonb_agg(jsonb_build_object(
      'logical_requirement_id', logical_requirement_id,
      'task_name', task_name,
      'recurrence_type', recurrence_type,
      'recurrence_weekdays', recurrence_weekdays,
      'days', days
    ) order by task_name, logical_requirement_id)
    from requirement_groups
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.factory_mesti_cleaning_occurrence_snapshot(public.factory_mesti_cleaning_requirements, public.factory_storage_locations, public.factory_mesti_cleaning_settings) from public, anon;
revoke all on function public.factory_mesti_materialize_cleaning_occurrences(date, date) from public, anon;
revoke all on function public.factory_save_mesti_cleaning_requirement(jsonb) from public, anon;
revoke all on function public.factory_save_mesti_cleaning_settings(jsonb) from public, anon;
revoke all on function public.factory_mesti_cleaning_month(date) from public, anon;
grant execute on function public.factory_mesti_materialize_cleaning_occurrences(date, date) to authenticated;
grant execute on function public.factory_save_mesti_cleaning_requirement(jsonb) to authenticated;
grant execute on function public.factory_save_mesti_cleaning_settings(jsonb) to authenticated;
grant execute on function public.factory_mesti_cleaning_month(date) to authenticated;
