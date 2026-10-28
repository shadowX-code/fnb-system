-- Preserve explicitly selected dates, or reject unsafe version/evidence boundaries.
create or replace function public.factory_save_mesti_cleaning_requirement(p_requirement jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_employee public.employees%rowtype := public.factory_mesti_current_employee();
  v_current public.factory_mesti_cleaning_requirements%rowtype;
  v_previous public.factory_mesti_cleaning_requirements%rowtype;
  v_saved public.factory_mesti_cleaning_requirements%rowtype;
  v_location_ids uuid[] := array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_requirement->'location_ids', '[]'::jsonb)) value order by 1);
  v_current_location_ids uuid[];
  v_id uuid := nullif(p_requirement->>'id', '')::uuid;
  v_type text := lower(coalesce(nullif(p_requirement->>'recurrence_type', ''), 'daily'));
  v_weekdays integer[] := array(select distinct value::integer from jsonb_array_elements_text(coalesce(p_requirement->'recurrence_weekdays', '[]'::jsonb)) value order by 1);
  v_requested_effective_from date;
  v_min_effective_from date;
  v_latest_evidence_date date;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_version_created boolean := false;
begin
  if not (public.current_user_has_permission('factory_mesti_cleaning.manage') or public.current_user_has_permission('factory_mesti_cleaning.create') or public.current_user_has_permission('factory_mesti_cleaning.edit')) then
    raise exception using errcode = '42501', message = 'Missing permission to manage Cleaning Requirements.';
  end if;
  if coalesce(p_requirement->>'effective_from', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'Select a valid Effective From date.';
  end if;
  begin
    v_requested_effective_from := (p_requirement->>'effective_from')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Select a valid Effective From date.';
  end;
  if nullif(btrim(p_requirement->>'task_name'), '') is null or cardinality(v_location_ids) = 0 then
    raise exception using errcode = '22023', message = 'Task name and at least one Location are required.';
  end if;
  if v_type not in ('daily', 'weekly') or (v_type = 'weekly' and cardinality(v_weekdays) = 0) then
    raise exception using errcode = '22023', message = 'Select a valid Cleaning recurrence.';
  end if;
  if exists (select 1 from unnest(v_location_ids) location_id left join public.factory_storage_locations location on location.id = location_id and location.status = 'active' where location.id is null) then
    raise exception using errcode = '22023', message = 'Only active Factory Locations may be selected.';
  end if;

  if v_id is null then
    insert into public.factory_mesti_cleaning_requirements(logical_requirement_id, task_name, recurrence_type, recurrence_weekdays, status, effective_from, created_by)
    values (gen_random_uuid(), btrim(p_requirement->>'task_name'), v_type, case when v_type = 'daily' then '{}'::integer[] else v_weekdays end, coalesce(nullif(p_requirement->>'status', ''), 'active'), v_requested_effective_from, v_employee.id)
    returning * into v_saved;
    v_version_created := true;
  else
    -- Hold the issued-date boundary stable against materialization and lifecycle writes.
    lock table public.factory_mesti_cleaning_occurrences in share mode;
    select * into v_current from public.factory_mesti_cleaning_requirements where id = v_id;
    if v_current.id is null then
      raise exception using errcode = '22023', message = 'Cleaning Requirement was not found.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_current.logical_requirement_id::text, 0));
    select * into v_current from public.factory_mesti_cleaning_requirements
    where logical_requirement_id = v_current.logical_requirement_id and effective_until is null
    order by version_no desc limit 1 for update;
    if v_current.id is distinct from v_id then
      raise exception using errcode = '40001', message = 'This Cleaning Requirement has changed. Reload Setup before editing.';
    end if;
    select coalesce(array_agg(link.location_id order by link.location_id), '{}'::uuid[]) into v_current_location_ids
    from public.factory_mesti_cleaning_requirement_locations link where link.requirement_id = v_current.id;
    select max(due_date) into v_latest_evidence_date from public.factory_mesti_cleaning_occurrences
    where logical_requirement_id = v_current.logical_requirement_id;

    if v_current.task_name = btrim(p_requirement->>'task_name') and v_current.recurrence_type = v_type
      and v_current.recurrence_weekdays = (case when v_type = 'daily' then '{}'::integer[] else v_weekdays end)
      and v_current.status = coalesce(nullif(p_requirement->>'status', ''), 'active')
      and v_current.effective_from = v_requested_effective_from and v_current_location_ids = v_location_ids then
      v_saved := v_current;
    elsif v_current.effective_from > v_today and not exists (
      select 1 from public.factory_mesti_cleaning_occurrences where requirement_id = v_current.id
    ) then
      select * into v_previous from public.factory_mesti_cleaning_requirements
      where logical_requirement_id = v_current.logical_requirement_id and superseded_by = v_current.id for update;
      v_min_effective_from := greatest(coalesce(v_previous.effective_from + 1, '-infinity'::date), coalesce(v_latest_evidence_date + 1, '-infinity'::date));
      if v_requested_effective_from < v_min_effective_from then
        raise exception using errcode = '22023', message = format('Effective From must be on or after %s to preserve existing versions and issued occurrences. The selected date was not saved.', to_char(v_min_effective_from, 'DD/MM/YYYY'));
      end if;
      -- Update the non-overlapping boundaries in the order that preserves exclusion constraints.
      if v_previous.id is not null and v_requested_effective_from < v_current.effective_from then
        update public.factory_mesti_cleaning_requirements set effective_until = v_requested_effective_from, updated_at = now() where id = v_previous.id;
      end if;
      update public.factory_mesti_cleaning_requirements
      set task_name = btrim(p_requirement->>'task_name'), recurrence_type = v_type,
        recurrence_weekdays = case when v_type = 'daily' then '{}'::integer[] else v_weekdays end,
        status = coalesce(nullif(p_requirement->>'status', ''), 'active'),
        effective_from = v_requested_effective_from, updated_at = now()
      where id = v_current.id returning * into v_saved;
      if v_previous.id is not null and v_requested_effective_from >= v_current.effective_from then
        update public.factory_mesti_cleaning_requirements set effective_until = v_requested_effective_from, updated_at = now() where id = v_previous.id;
      end if;
      delete from public.factory_mesti_cleaning_requirement_locations where requirement_id = v_saved.id;
    else
      v_min_effective_from := greatest(v_current.effective_from + 1, coalesce(v_latest_evidence_date + 1, '-infinity'::date));
      if v_requested_effective_from < v_min_effective_from then
        raise exception using errcode = '22023', message = format('Effective From must be on or after %s to preserve existing versions and issued occurrences. The selected date was not saved.', to_char(v_min_effective_from, 'DD/MM/YYYY'));
      end if;
      update public.factory_mesti_cleaning_requirements set effective_until = v_requested_effective_from, updated_at = now() where id = v_current.id;
      insert into public.factory_mesti_cleaning_requirements(logical_requirement_id, task_name, recurrence_type, recurrence_weekdays, status, effective_from, version_no, created_by)
      values (v_current.logical_requirement_id, btrim(p_requirement->>'task_name'), v_type, case when v_type = 'daily' then '{}'::integer[] else v_weekdays end, coalesce(nullif(p_requirement->>'status', ''), 'active'), v_requested_effective_from, v_current.version_no + 1, v_employee.id)
      returning * into v_saved;
      update public.factory_mesti_cleaning_requirements set superseded_by = v_saved.id, updated_at = now() where id = v_current.id;
      v_version_created := true;
    end if;
  end if;

  insert into public.factory_mesti_cleaning_requirement_locations(requirement_id, location_id)
  select v_saved.id, location_id from unnest(v_location_ids) location_id on conflict do nothing;
  return to_jsonb(v_saved) || jsonb_build_object('location_ids', to_jsonb(v_location_ids),
    'location_names', coalesce((select jsonb_agg(location.location_name order by location.location_name) from public.factory_storage_locations location where location.id = any(v_location_ids)), '[]'::jsonb),
    'version_created', v_version_created);
end $$;

revoke all on function public.factory_save_mesti_cleaning_requirement(jsonb) from public, anon;
grant execute on function public.factory_save_mesti_cleaning_requirement(jsonb) to authenticated;
