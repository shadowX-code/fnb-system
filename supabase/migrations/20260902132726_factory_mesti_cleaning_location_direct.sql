-- Factory MeSTI Cleaning direct Location model.
-- The first Staging iteration introduced a separate Cleaning Area layer.
-- This forward-only migration collapses that layer into canonical Factory
-- Locations while preserving occurrence history through immutable snapshots.

create table if not exists public.factory_mesti_cleaning_requirement_locations (
  requirement_id uuid not null references public.factory_mesti_cleaning_requirements(id) on delete cascade,
  location_id uuid not null references public.factory_storage_locations(id) on delete restrict,
  primary key (requirement_id, location_id)
);

insert into public.factory_mesti_cleaning_requirement_locations(requirement_id, location_id)
select distinct link.requirement_id, area.location_id
from public.factory_mesti_cleaning_requirement_areas link
join public.factory_mesti_cleaning_areas area on area.id=link.area_id
where area.location_id is not null
on conflict do nothing;

alter table public.factory_mesti_cleaning_occurrences
  add column if not exists location_id uuid references public.factory_storage_locations(id) on delete restrict;

update public.factory_mesti_cleaning_occurrences occurrence
set location_id = area.location_id,
    requirement_snapshot = occurrence.requirement_snapshot
      || jsonb_build_object(
        'location_id', area.location_id,
        'location_name', location.location_name,
        'location_code', location.location_code,
        'location_type', location.location_type
      )
      - 'area_id'
      - 'area_name',
    updated_at = now()
from public.factory_mesti_cleaning_areas area
join public.factory_storage_locations location on location.id=area.location_id
where occurrence.area_id=area.id
  and occurrence.location_id is null;

delete from public.factory_mesti_cleaning_occurrences occurrence
using (
  select id,
         row_number() over (
           partition by requirement_id, location_id, due_date
           order by case status
             when 'verified' then 5
             when 'completed' then 4
             when 'unsatisfactory' then 3
             when 'missed' then 2
             else 1
           end desc, updated_at desc, created_at desc, id
         ) as duplicate_rank
  from public.factory_mesti_cleaning_occurrences
  where location_id is not null
) ranked
where ranked.id=occurrence.id
  and ranked.duplicate_rank > 1;

alter table public.factory_mesti_cleaning_occurrences
  alter column location_id set not null;

alter table public.factory_mesti_cleaning_occurrences
  drop constraint if exists factory_mesti_cleaning_occurrences_requirement_id_area_id_due_date_key;

alter table public.factory_mesti_cleaning_occurrences
  add constraint factory_mesti_cleaning_occurrences_requirement_location_due_key unique(requirement_id, location_id, due_date);

alter table public.factory_mesti_cleaning_requirement_locations enable row level security;

grant select, insert, update, delete on public.factory_mesti_cleaning_requirement_locations to authenticated;

drop policy if exists "factory mesti cleaning requirement locations read" on public.factory_mesti_cleaning_requirement_locations;
create policy "factory mesti cleaning requirement locations read" on public.factory_mesti_cleaning_requirement_locations for select to authenticated
using (public.current_user_has_permission('factory_mesti_cleaning.view') or public.current_user_has_permission('factory_mesti_cleaning.manage'));

drop policy if exists "factory mesti cleaning requirement locations setup" on public.factory_mesti_cleaning_requirement_locations;
create policy "factory mesti cleaning requirement locations setup" on public.factory_mesti_cleaning_requirement_locations for all to authenticated
using (public.current_user_has_permission('factory_mesti_cleaning.manage'))
with check (public.current_user_has_permission('factory_mesti_cleaning.manage'));

drop function if exists public.factory_mesti_cleaning_occurrence_snapshot(public.factory_mesti_cleaning_requirements,public.factory_mesti_cleaning_areas);

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
    'task_name', p_requirement.task_name,
    'recurrence_type', p_requirement.recurrence_type,
    'recurrence_weekdays', p_requirement.recurrence_weekdays,
    'responsible_role_id', p_requirement.responsible_role_id,
    'verifier_role_id', p_requirement.verifier_role_id,
    'effective_from', p_requirement.effective_from,
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

  insert into public.factory_mesti_cleaning_occurrences(requirement_id, location_id, due_date, status, requirement_snapshot)
  select requirement.id, location.id, due_date.day::date, 'pending',
         public.factory_mesti_cleaning_occurrence_snapshot(requirement, location)
  from public.factory_mesti_cleaning_requirements requirement
  join public.factory_mesti_cleaning_requirement_locations link on link.requirement_id=requirement.id
  join public.factory_storage_locations location on location.id=link.location_id
  cross join generate_series(p_from, p_to, interval '1 day') due_date(day)
  where requirement.status='active'
    and location.status='active'
    and due_date.day::date >= requirement.effective_from
    and public.factory_mesti_recurrence_due(requirement.recurrence_type, requirement.recurrence_weekdays, due_date.day::date)
  on conflict (requirement_id, location_id, due_date) do nothing;

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
      'location_id', o.location_id,
      'location_name', o.requirement_snapshot->>'location_name',
      'location_code', o.requirement_snapshot->>'location_code',
      'location_type', o.requirement_snapshot->>'location_type',
      'recurrence_type', o.requirement_snapshot->>'recurrence_type',
      'recurrence_weekdays', o.requirement_snapshot->'recurrence_weekdays',
      'task_name', o.requirement_snapshot->>'task_name',
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
    ) order by o.requirement_snapshot->>'location_name', o.requirement_snapshot->>'task_name')
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
      'location_id', o.location_id,
      'location_name', o.requirement_snapshot->>'location_name',
      'location_code', o.requirement_snapshot->>'location_code',
      'location_type', o.requirement_snapshot->>'location_type',
      'recurrence_type', o.requirement_snapshot->>'recurrence_type',
      'recurrence_weekdays', o.requirement_snapshot->'recurrence_weekdays',
      'task_name', o.requirement_snapshot->>'task_name',
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
    ) order by o.requirement_snapshot->>'location_name', o.requirement_snapshot->>'task_name', o.due_date)
    from public.factory_mesti_cleaning_occurrences o
    left join public.employees completer on completer.id=o.completed_by
    left join public.employees verifier on verifier.id=o.verified_by
    where o.due_date between v_from and v_to
  ), '[]'::jsonb);
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
  v_location_ids uuid[] := array(select distinct jsonb_array_elements_text(coalesce(p_requirement->'location_ids','[]'::jsonb))::uuid);
  v_id uuid := nullif(p_requirement->>'id','')::uuid;
  v_type text := lower(coalesce(nullif(p_requirement->>'recurrence_type',''),'daily'));
  v_weekdays integer[] := array(select distinct jsonb_array_elements_text(coalesce(p_requirement->'recurrence_weekdays','[]'::jsonb))::integer);
  v_effective_from date := coalesce(nullif(p_requirement->>'effective_from','')::date, current_date);
begin
  if not (public.current_user_has_permission('factory_mesti_cleaning.manage') or public.current_user_has_permission('factory_mesti_cleaning.create') or public.current_user_has_permission('factory_mesti_cleaning.edit')) then
    raise exception using errcode='42501', message='Missing permission to manage Cleaning Requirements.';
  end if;
  if nullif(btrim(p_requirement->>'task_name'),'') is null then
    raise exception using errcode='22023', message='Task name is required.';
  end if;
  if cardinality(v_location_ids) = 0 then
    raise exception using errcode='22023', message='At least one Location is required.';
  end if;
  if exists (
    select 1
    from unnest(v_location_ids) location_id
    left join public.factory_storage_locations location on location.id=location_id and location.status='active'
    where location.id is null
  ) then
    raise exception using errcode='22023', message='Only active Factory Locations may be selected.';
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

  insert into public.factory_mesti_cleaning_requirement_locations(requirement_id, location_id)
  select v_saved.id, location_id from unnest(v_location_ids) location_id
  on conflict do nothing;

  return to_jsonb(v_saved)
    || jsonb_build_object(
      'location_ids', to_jsonb(v_location_ids),
      'location_names', coalesce((
        select jsonb_agg(location.location_name order by location.location_name)
        from public.factory_storage_locations location
        where location.id = any(v_location_ids)
      ), '[]'::jsonb)
    );
end;
$$;

drop function if exists public.factory_save_mesti_cleaning_area(jsonb);

alter table public.factory_mesti_cleaning_occurrences
  drop column if exists area_id;

drop table if exists public.factory_mesti_cleaning_requirement_areas;
drop table if exists public.factory_mesti_cleaning_areas;

revoke all on function public.factory_mesti_cleaning_occurrence_snapshot(public.factory_mesti_cleaning_requirements,public.factory_storage_locations) from public, anon;
revoke all on function public.factory_mesti_materialize_cleaning_occurrences(date,date) from public, anon;
revoke all on function public.factory_mesti_cleaning_day(date) from public, anon;
revoke all on function public.factory_mesti_cleaning_month(date) from public, anon;
revoke all on function public.factory_save_mesti_cleaning_requirement(jsonb) from public, anon;
grant execute on function public.factory_mesti_materialize_cleaning_occurrences(date,date) to authenticated;
grant execute on function public.factory_mesti_cleaning_day(date) to authenticated;
grant execute on function public.factory_mesti_cleaning_month(date) to authenticated;
grant execute on function public.factory_save_mesti_cleaning_requirement(jsonb) to authenticated;
