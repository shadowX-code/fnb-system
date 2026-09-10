-- A Cleaning Requirement is a logical schedule with forward-effective
-- configuration versions. Version row IDs remain attached to immutable
-- occurrence snapshots; the logical ID is the canonical schedule identity.

alter table public.factory_mesti_cleaning_requirements
  add column if not exists logical_requirement_id uuid;

alter table public.factory_mesti_cleaning_requirements
  add column if not exists effective_until date;

with recursive requirement_chain as (
  select root.id as version_id, root.id as logical_requirement_id
  from public.factory_mesti_cleaning_requirements root
  where not exists (
    select 1
    from public.factory_mesti_cleaning_requirements predecessor
    where predecessor.superseded_by = root.id
  )

  union all

  select successor.id, requirement_chain.logical_requirement_id
  from requirement_chain
  join public.factory_mesti_cleaning_requirements successor
    on successor.id = (
      select predecessor.superseded_by
      from public.factory_mesti_cleaning_requirements predecessor
      where predecessor.id = requirement_chain.version_id
    )
)
update public.factory_mesti_cleaning_requirements requirement
set logical_requirement_id = requirement_chain.logical_requirement_id
from requirement_chain
where requirement.id = requirement_chain.version_id
  and requirement.logical_requirement_id is null;

update public.factory_mesti_cleaning_requirements
set logical_requirement_id = id
where logical_requirement_id is null;

with successors as (
  select predecessor.id,
         successor.effective_from as effective_until
  from public.factory_mesti_cleaning_requirements predecessor
  join public.factory_mesti_cleaning_requirements successor
    on successor.id = predecessor.superseded_by
)
update public.factory_mesti_cleaning_requirements requirement
set effective_until = successors.effective_until
from successors
where requirement.id = successors.id
  and requirement.effective_until is null;

alter table public.factory_mesti_cleaning_requirements
  alter column logical_requirement_id set not null;

alter table public.factory_mesti_cleaning_occurrences
  add column if not exists logical_requirement_id uuid;

update public.factory_mesti_cleaning_occurrences occurrence
set logical_requirement_id = requirement.logical_requirement_id,
    requirement_snapshot = occurrence.requirement_snapshot
      || jsonb_build_object('logical_requirement_id', requirement.logical_requirement_id)
from public.factory_mesti_cleaning_requirements requirement
where requirement.id = occurrence.requirement_id
  and occurrence.logical_requirement_id is null;

alter table public.factory_mesti_cleaning_occurrences
  alter column logical_requirement_id set not null;

-- Existing Staging rows created by the versioning defect are duplicates only
-- when they share the same logical schedule, Location, and due date. Keep the
-- strongest lifecycle evidence, then the newest version for equivalent state.
delete from public.factory_mesti_cleaning_occurrences occurrence
using (
  select occurrence.id,
         row_number() over (
           partition by occurrence.logical_requirement_id, occurrence.location_id, occurrence.due_date
           order by case occurrence.status
             when 'verified' then 5
             when 'completed' then 4
             when 'unsatisfactory' then 3
             when 'missed' then 2
             else 1
           end desc,
           requirement.version_no desc,
           occurrence.updated_at desc,
           occurrence.created_at desc,
           occurrence.id
         ) as duplicate_rank
  from public.factory_mesti_cleaning_occurrences occurrence
  join public.factory_mesti_cleaning_requirements requirement
    on requirement.id = occurrence.requirement_id
) ranked
where occurrence.id = ranked.id
  and ranked.duplicate_rank > 1;

alter table public.factory_mesti_cleaning_occurrences
  drop constraint if exists factory_mesti_cleaning_occurrences_requirement_location_due_key;

alter table public.factory_mesti_cleaning_occurrences
  add constraint factory_mesti_cleaning_occurrences_logical_location_due_key
  unique(logical_requirement_id, location_id, due_date);

create index if not exists factory_mesti_cleaning_requirements_logical_version_idx
on public.factory_mesti_cleaning_requirements(logical_requirement_id, version_no desc);

create unique index if not exists factory_mesti_cleaning_requirements_one_current_version_key
on public.factory_mesti_cleaning_requirements(logical_requirement_id)
where effective_until is null;

create extension if not exists btree_gist with schema extensions;

alter table public.factory_mesti_cleaning_requirements
  drop constraint if exists factory_mesti_cleaning_requirements_non_overlapping_versions;

alter table public.factory_mesti_cleaning_requirements
  add constraint factory_mesti_cleaning_requirements_non_overlapping_versions
  exclude using gist (
    logical_requirement_id with =,
    daterange(effective_from, effective_until, '[)') with &&
  );

create or replace function public.factory_mesti_cleaning_occurrence_snapshot(
  p_requirement public.factory_mesti_cleaning_requirements,
  p_location public.factory_storage_locations
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
    'responsible_role_id', p_requirement.responsible_role_id,
    'verifier_role_id', p_requirement.verifier_role_id,
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
    requirement_id,
    logical_requirement_id,
    location_id,
    due_date,
    status,
    requirement_snapshot
  )
  select requirement.id,
         requirement.logical_requirement_id,
         location.id,
         due_date.day::date,
         'pending',
         public.factory_mesti_cleaning_occurrence_snapshot(requirement, location)
  from public.factory_mesti_cleaning_requirements requirement
  join public.factory_mesti_cleaning_requirement_locations link
    on link.requirement_id = requirement.id
  join public.factory_storage_locations location
    on location.id = link.location_id
  cross join generate_series(p_from, p_to, interval '1 day') due_date(day)
  where requirement.status = 'active'
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
    select 1
    from unnest(v_location_ids) location_id
    left join public.factory_storage_locations location
      on location.id = location_id and location.status = 'active'
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
      logical_requirement_id,
      task_name,
      recurrence_type,
      recurrence_weekdays,
      responsible_role_id,
      verifier_role_id,
      status,
      effective_from,
      created_by
    ) values (
      v_logical_requirement_id,
      btrim(p_requirement->>'task_name'),
      v_type,
      case when v_type = 'daily' then '{}'::integer[] else v_weekdays end,
      (p_requirement->>'responsible_role_id')::uuid,
      (p_requirement->>'verifier_role_id')::uuid,
      coalesce(nullif(p_requirement->>'status', ''), 'active'),
      v_requested_effective_from,
      v_employee.id
    ) returning * into v_saved;
    v_version_created := true;
  else
    select * into v_submitted
    from public.factory_mesti_cleaning_requirements
    where id = v_id;
    if v_submitted.id is null then
      raise exception using errcode='22023', message='Cleaning Requirement was not found.';
    end if;

    v_logical_requirement_id := v_submitted.logical_requirement_id;
    perform pg_advisory_xact_lock(hashtextextended(v_logical_requirement_id::text, 0));

    select * into v_current
    from public.factory_mesti_cleaning_requirements
    where logical_requirement_id = v_logical_requirement_id
      and effective_until is null
    order by version_no desc
    limit 1
    for update;
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
      and v_current.responsible_role_id is not distinct from (p_requirement->>'responsible_role_id')::uuid
      and v_current.verifier_role_id is not distinct from (p_requirement->>'verifier_role_id')::uuid
      and v_current.status = coalesce(nullif(p_requirement->>'status', ''), 'active')
      and v_current_location_ids = v_location_ids then
      v_saved := v_current;
    else
      select max(due_date) into v_latest_evidence_date
      from public.factory_mesti_cleaning_occurrences
      where logical_requirement_id = v_logical_requirement_id
        and status <> 'pending';

      v_effective_from := greatest(
        v_requested_effective_from,
        current_date,
        v_current.effective_from,
        coalesce(v_latest_evidence_date + 1, '-infinity'::date)
      );

      update public.factory_mesti_cleaning_requirements
      set effective_until = v_effective_from,
          updated_at = now()
      where id = v_current.id;

      insert into public.factory_mesti_cleaning_requirements(
        logical_requirement_id,
        task_name,
        recurrence_type,
        recurrence_weekdays,
        responsible_role_id,
        verifier_role_id,
        status,
        effective_from,
        version_no,
        created_by
      ) values (
        v_logical_requirement_id,
        btrim(p_requirement->>'task_name'),
        v_type,
        case when v_type = 'daily' then '{}'::integer[] else v_weekdays end,
        (p_requirement->>'responsible_role_id')::uuid,
        (p_requirement->>'verifier_role_id')::uuid,
        coalesce(nullif(p_requirement->>'status', ''), 'active'),
        v_effective_from,
        v_current.version_no + 1,
        v_employee.id
      ) returning * into v_saved;

      update public.factory_mesti_cleaning_requirements
      set superseded_by = v_saved.id,
          updated_at = now()
      where id = v_current.id;

      -- Pending future schedule rows are mutable projections. Finalized or
      -- missed evidence is never replaced by a later configuration version.
      delete from public.factory_mesti_cleaning_occurrences
      where logical_requirement_id = v_logical_requirement_id
        and status = 'pending'
        and due_date >= v_effective_from;

      v_version_created := true;
    end if;
  end if;

  insert into public.factory_mesti_cleaning_requirement_locations(requirement_id, location_id)
  select v_saved.id, location_id
  from unnest(v_location_ids) location_id
  on conflict do nothing;

  return to_jsonb(v_saved)
    || jsonb_build_object(
      'location_ids', to_jsonb(v_location_ids),
      'location_names', coalesce((
        select jsonb_agg(location.location_name order by location.location_name)
        from public.factory_storage_locations location
        where location.id = any(v_location_ids)
      ), '[]'::jsonb),
      'version_created', v_version_created
    );
end;
$$;

revoke all on function public.factory_mesti_cleaning_occurrence_snapshot(public.factory_mesti_cleaning_requirements, public.factory_storage_locations) from public, anon;
revoke all on function public.factory_mesti_materialize_cleaning_occurrences(date, date) from public, anon;
revoke all on function public.factory_save_mesti_cleaning_requirement(jsonb) from public, anon;
grant execute on function public.factory_mesti_materialize_cleaning_occurrences(date, date) to authenticated;
grant execute on function public.factory_save_mesti_cleaning_requirement(jsonb) to authenticated;
