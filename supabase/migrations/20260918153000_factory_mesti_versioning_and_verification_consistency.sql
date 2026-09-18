-- MeSTI requirement versions protect issued evidence. Future, uncommitted
-- versions stay editable; effective versions are superseded forward-only.

create or replace function public.factory_save_mesti_cleaning_requirement(p_requirement jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_employee public.employees%rowtype := public.factory_mesti_current_employee();
  v_current public.factory_mesti_cleaning_requirements%rowtype;
  v_saved public.factory_mesti_cleaning_requirements%rowtype;
  v_location_ids uuid[] := array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_requirement->'location_ids', '[]'::jsonb)) value order by 1);
  v_current_location_ids uuid[];
  v_id uuid := nullif(p_requirement->>'id', '')::uuid;
  v_type text := lower(coalesce(nullif(p_requirement->>'recurrence_type', ''), 'daily'));
  v_weekdays integer[] := array(select distinct value::integer from jsonb_array_elements_text(coalesce(p_requirement->'recurrence_weekdays', '[]'::jsonb)) value order by 1);
  v_requested_effective_from date := coalesce(nullif(p_requirement->>'effective_from', '')::date, (now() at time zone 'Asia/Kuala_Lumpur')::date);
  v_effective_from date;
  v_latest_evidence_date date;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_version_created boolean := false;
begin
  if not (public.current_user_has_permission('factory_mesti_cleaning.manage') or public.current_user_has_permission('factory_mesti_cleaning.create') or public.current_user_has_permission('factory_mesti_cleaning.edit')) then
    raise exception using errcode = '42501', message = 'Missing permission to manage Cleaning Requirements.';
  end if;
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
    values (gen_random_uuid(), btrim(p_requirement->>'task_name'), v_type, case when v_type = 'daily' then '{}'::integer[] else v_weekdays end, coalesce(nullif(p_requirement->>'status', ''), 'active'), greatest(v_requested_effective_from, v_today), v_employee.id)
    returning * into v_saved;
    v_version_created := true;
  else
    select * into v_current from public.factory_mesti_cleaning_requirements where id = v_id;
    if v_current.id is null then raise exception using errcode = '22023', message = 'Cleaning Requirement was not found.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_current.logical_requirement_id::text, 0));
    select * into v_current from public.factory_mesti_cleaning_requirements where logical_requirement_id = v_current.logical_requirement_id and effective_until is null order by version_no desc limit 1 for update;
    select coalesce(array_agg(link.location_id order by link.location_id), '{}'::uuid[]) into v_current_location_ids from public.factory_mesti_cleaning_requirement_locations link where link.requirement_id = v_current.id;
    if v_current.task_name = btrim(p_requirement->>'task_name') and v_current.recurrence_type = v_type and v_current.recurrence_weekdays = (case when v_type = 'daily' then '{}'::integer[] else v_weekdays end) and v_current.status = coalesce(nullif(p_requirement->>'status', ''), 'active') and v_current.effective_from = v_requested_effective_from and v_current_location_ids = v_location_ids then
      v_saved := v_current;
    elsif v_current.effective_from > v_today then
      update public.factory_mesti_cleaning_requirements set task_name = btrim(p_requirement->>'task_name'), recurrence_type = v_type, recurrence_weekdays = case when v_type = 'daily' then '{}'::integer[] else v_weekdays end, status = coalesce(nullif(p_requirement->>'status', ''), 'active'), effective_from = greatest(v_requested_effective_from, v_today), updated_at = now() where id = v_current.id returning * into v_saved;
      delete from public.factory_mesti_cleaning_requirement_locations where requirement_id = v_saved.id;
      delete from public.factory_mesti_cleaning_occurrences where requirement_id = v_saved.id and status = 'pending';
    else
      select max(due_date) into v_latest_evidence_date from public.factory_mesti_cleaning_occurrences where logical_requirement_id = v_current.logical_requirement_id and status <> 'pending';
      v_effective_from := greatest(v_requested_effective_from, v_today, v_current.effective_from + 1, coalesce(v_latest_evidence_date + 1, '-infinity'::date));
      update public.factory_mesti_cleaning_requirements set effective_until = v_effective_from, updated_at = now() where id = v_current.id;
      insert into public.factory_mesti_cleaning_requirements(logical_requirement_id, task_name, recurrence_type, recurrence_weekdays, status, effective_from, version_no, created_by)
      values (v_current.logical_requirement_id, btrim(p_requirement->>'task_name'), v_type, case when v_type = 'daily' then '{}'::integer[] else v_weekdays end, coalesce(nullif(p_requirement->>'status', ''), 'active'), v_effective_from, v_current.version_no + 1, v_employee.id)
      returning * into v_saved;
      update public.factory_mesti_cleaning_requirements set superseded_by = v_saved.id, updated_at = now() where id = v_current.id;
      delete from public.factory_mesti_cleaning_occurrences where requirement_id = v_current.id and status = 'pending' and due_date >= v_effective_from;
      v_version_created := true;
    end if;
  end if;

  insert into public.factory_mesti_cleaning_requirement_locations(requirement_id, location_id)
  select v_saved.id, location_id from unnest(v_location_ids) location_id on conflict do nothing;
  return to_jsonb(v_saved) || jsonb_build_object('location_ids', to_jsonb(v_location_ids), 'location_names', coalesce((select jsonb_agg(location.location_name order by location.location_name) from public.factory_storage_locations location where location.id = any(v_location_ids)), '[]'::jsonb), 'version_created', v_version_created);
end $$;

create or replace function public.factory_save_mesti_equipment_cleaning_requirement(p_requirement jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_employee public.employees%rowtype := public.factory_mesti_current_employee();
  v_current public.factory_mesti_equipment_cleaning_requirements%rowtype;
  v_saved public.factory_mesti_equipment_cleaning_requirements%rowtype;
  v_ids uuid[] := array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_requirement->'equipment_ids', '[]'::jsonb)) value order by 1);
  v_existing uuid[];
  v_weekdays integer[] := array(select distinct value::integer from jsonb_array_elements_text(coalesce(p_requirement->'recurrence_weekdays', '[]'::jsonb)) value order by 1);
  v_requested date := coalesce(nullif(p_requirement->>'effective_from', '')::date, (now() at time zone 'Asia/Kuala_Lumpur')::date);
  v_effective date;
  v_latest_evidence date;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_created boolean := false;
  v_type text := coalesce(nullif(p_requirement->>'recurrence_type', ''), 'daily');
  v_status text := coalesce(nullif(p_requirement->>'status', ''), 'active');
begin
  if not (public.current_user_has_permission('factory_mesti_equipment_cleaning.manage') or public.current_user_has_permission(case when nullif(p_requirement->>'id', '') is null then 'factory_mesti_equipment_cleaning.create' else 'factory_mesti_equipment_cleaning.edit' end)) then raise exception using errcode = '42501', message = 'Missing permission to manage Equipment Cleaning Requirements.'; end if;
  if nullif(btrim(p_requirement->>'task_name'), '') is null or cardinality(v_ids) = 0 or v_type not in ('daily', 'weekly') or (v_type = 'weekly' and cardinality(v_weekdays) = 0) then raise exception using errcode = '22023', message = 'Task Name, active Equipment, and a valid recurrence are required.'; end if;
  if exists(select 1 from unnest(v_ids) id left join public.factory_equipment equipment on equipment.id = id and equipment.status = 'active' where equipment.id is null) then raise exception using errcode = '22023', message = 'Only active Equipment can be scheduled.'; end if;
  if nullif(p_requirement->>'id', '') is null then
    insert into public.factory_mesti_equipment_cleaning_requirements(logical_requirement_id, task_name, recurrence_type, recurrence_weekdays, status, effective_from, version_no, created_by)
    values(gen_random_uuid(), btrim(p_requirement->>'task_name'), v_type, case when v_type = 'daily' then '{}'::integer[] else v_weekdays end, v_status, greatest(v_requested, v_today), 1, v_employee.id) returning * into v_saved;
    v_created := true;
  else
    select * into v_current from public.factory_mesti_equipment_cleaning_requirements where id = (p_requirement->>'id')::uuid;
    if v_current.id is null then raise exception using errcode = '22023', message = 'Cleaning Requirement was not found.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_current.logical_requirement_id::text, 0));
    select * into v_current from public.factory_mesti_equipment_cleaning_requirements where logical_requirement_id = v_current.logical_requirement_id and effective_until is null order by version_no desc limit 1 for update;
    select coalesce(array_agg(equipment_id order by equipment_id), '{}'::uuid[]) into v_existing from public.factory_mesti_equipment_cleaning_requirement_equipment where requirement_id = v_current.id;
    if v_current.task_name = btrim(p_requirement->>'task_name') and v_current.recurrence_type = v_type and v_current.recurrence_weekdays = (case when v_type = 'daily' then '{}'::integer[] else v_weekdays end) and v_current.status = v_status and v_current.effective_from = v_requested and v_existing = v_ids then
      v_saved := v_current;
    elsif v_current.effective_from > v_today then
      update public.factory_mesti_equipment_cleaning_requirements set task_name = btrim(p_requirement->>'task_name'), recurrence_type = v_type, recurrence_weekdays = case when v_type = 'daily' then '{}'::integer[] else v_weekdays end, status = v_status, effective_from = greatest(v_requested, v_today), updated_at = now() where id = v_current.id returning * into v_saved;
      delete from public.factory_mesti_equipment_cleaning_requirement_equipment where requirement_id = v_saved.id;
      delete from public.factory_mesti_equipment_cleaning_occurrences where requirement_id = v_saved.id and status = 'pending' and source_type = 'scheduled';
    else
      select max(due_date) into v_latest_evidence from public.factory_mesti_equipment_cleaning_occurrences where logical_requirement_id = v_current.logical_requirement_id and status <> 'pending';
      v_effective := greatest(v_requested, v_today, v_current.effective_from + 1, coalesce(v_latest_evidence + 1, '-infinity'::date));
      update public.factory_mesti_equipment_cleaning_requirements set effective_until = v_effective, updated_at = now() where id = v_current.id;
      insert into public.factory_mesti_equipment_cleaning_requirements(logical_requirement_id, task_name, recurrence_type, recurrence_weekdays, status, effective_from, version_no, created_by)
      values(v_current.logical_requirement_id, btrim(p_requirement->>'task_name'), v_type, case when v_type = 'daily' then '{}'::integer[] else v_weekdays end, v_status, v_effective, v_current.version_no + 1, v_employee.id) returning * into v_saved;
      update public.factory_mesti_equipment_cleaning_requirements set superseded_by = v_saved.id, updated_at = now() where id = v_current.id;
      delete from public.factory_mesti_equipment_cleaning_occurrences where requirement_id = v_current.id and status = 'pending' and source_type = 'scheduled' and due_date >= v_effective;
      v_created := true;
    end if;
  end if;
  insert into public.factory_mesti_equipment_cleaning_requirement_equipment(requirement_id, equipment_id) select v_saved.id, id from unnest(v_ids) id on conflict do nothing;
  return to_jsonb(v_saved) || jsonb_build_object('equipment_ids', to_jsonb(v_ids), 'version_created', v_created);
end $$;

create or replace function public.factory_save_mesti_calibration_requirement(p_requirement jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.factory_current_active_employee_id();
  v_current public.factory_mesti_calibration_requirements%rowtype;
  v_saved public.factory_mesti_calibration_requirements%rowtype;
  v_id uuid := nullif(p_requirement->>'id', '')::uuid;
  v_requested date := coalesce(nullif(p_requirement->>'effective_from', '')::date, (now() at time zone 'Asia/Kuala_Lumpur')::date);
  v_effective date;
  v_latest_evidence date;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_type text := btrim(p_requirement->>'calibration_type');
  v_equipment_id uuid := nullif(p_requirement->>'equipment_id', '')::uuid;
  v_interval integer := (p_requirement->>'interval_months')::integer;
  v_status text := coalesce(nullif(p_requirement->>'status', ''), 'active');
begin
  if not (public.current_user_has_permission('factory_mesti_calibration.create') or public.current_user_has_permission('factory_mesti_calibration.edit') or public.current_user_has_permission('factory_mesti_calibration.manage')) then raise exception using errcode = '42501', message = 'Missing calibration setup permission.'; end if;
  if v_equipment_id is null or v_type = '' or v_interval not in (1, 3, 6, 12) or v_status not in ('active', 'inactive') then raise exception using errcode = '22023', message = 'Equipment, Calibration Type, status and a valid interval are required.'; end if;
  if v_status = 'active' and not exists (select 1 from public.factory_equipment where id = v_equipment_id and status = 'active') then raise exception using errcode = '22023', message = 'Only active Factory Equipment may have an active calibration requirement.'; end if;
  if v_id is null then
    insert into public.factory_mesti_calibration_requirements(equipment_id, calibration_type, interval_months, effective_from, status, created_by)
    values (v_equipment_id, v_type, v_interval, greatest(v_requested, v_today), v_status, v_actor) returning * into v_saved;
    return to_jsonb(v_saved) || jsonb_build_object('version_created', true);
  end if;
  select * into v_current from public.factory_mesti_calibration_requirements where id = v_id;
  if v_current.id is null then raise exception using errcode = '22023', message = 'Calibration requirement was not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_current.logical_requirement_id::text, 0));
  select * into v_current from public.factory_mesti_calibration_requirements where logical_requirement_id = v_current.logical_requirement_id and effective_until is null order by version_no desc limit 1 for update;
  if v_current.equipment_id = v_equipment_id and lower(v_current.calibration_type) = lower(v_type) and v_current.interval_months = v_interval and v_current.status = v_status and v_current.effective_from = v_requested then
    return to_jsonb(v_current) || jsonb_build_object('version_created', false);
  elsif v_current.effective_from > v_today then
    update public.factory_mesti_calibration_requirements set equipment_id = v_equipment_id, calibration_type = v_type, interval_months = v_interval, effective_from = greatest(v_requested, v_today), status = v_status, updated_at = now() where id = v_current.id returning * into v_saved;
    return to_jsonb(v_saved) || jsonb_build_object('version_created', false);
  end if;
  select max(calibrated_date) into v_latest_evidence from public.factory_mesti_calibration_records where logical_requirement_id = v_current.logical_requirement_id;
  v_effective := greatest(v_requested, v_today, v_current.effective_from + 1, coalesce(v_latest_evidence + 1, '-infinity'::date));
  update public.factory_mesti_calibration_requirements set effective_until = v_effective, updated_at = now() where id = v_current.id;
  insert into public.factory_mesti_calibration_requirements(logical_requirement_id, equipment_id, calibration_type, interval_months, effective_from, status, version_no, created_by)
  values (v_current.logical_requirement_id, v_equipment_id, v_type, v_interval, v_effective, v_status, v_current.version_no + 1, v_actor) returning * into v_saved;
  update public.factory_mesti_calibration_requirements set superseded_by = v_saved.id, updated_at = now() where id = v_current.id;
  return to_jsonb(v_saved) || jsonb_build_object('version_created', true);
end $$;

create or replace function public.factory_save_mesti_waste_disposal_requirement(p_requirement jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.factory_current_active_employee_id();
  v_id uuid := nullif(p_requirement->>'id', '')::uuid;
  v_location_id uuid := nullif(p_requirement->>'location_id', '')::uuid;
  v_count integer := nullif(p_requirement->>'required_count', '')::integer;
  v_requested date := coalesce(nullif(p_requirement->>'effective_from', '')::date, (now() at time zone 'Asia/Kuala_Lumpur')::date);
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_effective date;
  v_status text := coalesce(nullif(p_requirement->>'status', ''), 'active');
  v_current public.factory_mesti_waste_disposal_requirements%rowtype;
  v_saved public.factory_mesti_waste_disposal_requirements%rowtype;
begin
  if not public.current_user_has_permission('factory_mesti_waste_disposal.manage') then raise exception using errcode = '42501', message = 'Missing waste disposal manage permission.'; end if;
  if v_location_id is null or v_count is null or v_count < 1 or v_status not in ('active', 'inactive') then raise exception using errcode = '22023', message = 'Location, Daily frequency, Required Times / Day and Status are required.'; end if;
  if not exists (select 1 from public.factory_storage_locations where id = v_location_id and status = 'active') then raise exception using errcode = '22023', message = 'Selected Location is not active.'; end if;
  if v_id is null then
    insert into public.factory_mesti_waste_disposal_requirements(logical_requirement_id, location_id, required_count, effective_from, status, created_by)
    values (gen_random_uuid(), v_location_id, v_count, greatest(v_requested, v_today), v_status, v_actor) returning * into v_saved;
    return to_jsonb(v_saved) || jsonb_build_object('version_created', false);
  end if;
  select * into v_current from public.factory_mesti_waste_disposal_requirements where id = v_id;
  if v_current.id is null then raise exception using errcode = '22023', message = 'Waste disposal requirement not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_current.logical_requirement_id::text, 0));
  select * into v_current from public.factory_mesti_waste_disposal_requirements where logical_requirement_id = v_current.logical_requirement_id and effective_until is null order by version_no desc limit 1 for update;
  if v_current.location_id = v_location_id and v_current.required_count = v_count and v_current.frequency = 'daily' and v_current.status = v_status and v_current.effective_from = v_requested then
    return to_jsonb(v_current) || jsonb_build_object('version_created', false);
  elsif v_current.effective_from > v_today then
    update public.factory_mesti_waste_disposal_requirements set location_id = v_location_id, required_count = v_count, frequency = 'daily', status = v_status, effective_from = greatest(v_requested, v_today), updated_at = now() where id = v_current.id returning * into v_saved;
    return to_jsonb(v_saved) || jsonb_build_object('version_created', false);
  end if;
  v_effective := greatest(v_requested, v_today, v_current.effective_from + 1);
  update public.factory_mesti_waste_disposal_requirements set effective_until = v_effective, updated_at = now() where id = v_current.id;
  insert into public.factory_mesti_waste_disposal_requirements(logical_requirement_id, location_id, required_count, effective_from, status, version_no, created_by)
  values (v_current.logical_requirement_id, v_location_id, v_count, v_effective, v_status, v_current.version_no + 1, v_actor) returning * into v_saved;
  update public.factory_mesti_waste_disposal_requirements set superseded_by = v_saved.id, updated_at = now() where id = v_current.id;
  return to_jsonb(v_saved) || jsonb_build_object('version_created', true);
end $$;

create or replace function public.factory_mesti_verify_cleaning_occurrence(p_occurrence_id uuid, p_result text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_employee public.employees%rowtype := public.factory_mesti_current_employee(); v_occurrence public.factory_mesti_cleaning_occurrences%rowtype; v_result text := lower(coalesce(p_result, 'verified'));
begin
  if not (public.current_user_has_permission('factory_mesti_cleaning.review') or public.current_user_has_permission('factory_mesti_cleaning.manage')) then raise exception using errcode = '42501', message = 'Missing permission to verify Cleaning occurrences.'; end if;
  select * into v_occurrence from public.factory_mesti_cleaning_occurrences where id = p_occurrence_id for update;
  if v_occurrence.id is null then raise exception using errcode = 'P0002', message = 'Cleaning occurrence was not found.'; end if;
  if v_occurrence.status <> 'completed' then raise exception using errcode = '55000', message = 'Only completed Cleaning occurrences can be verified.'; end if;
  if v_result not in ('verified', 'unsatisfactory') then raise exception using errcode = '22023', message = 'Unsupported verification result.'; end if;
  update public.factory_mesti_cleaning_occurrences set status = v_result, verified_by = v_employee.id, verified_at = now(), verification_result = v_result, verification_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = v_occurrence.id returning * into v_occurrence;
  return to_jsonb(v_occurrence);
end $$;

create or replace function public.factory_mesti_verify_equipment_cleaning_occurrence(p_occurrence_id uuid, p_result text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_employee public.employees%rowtype := public.factory_mesti_current_employee(); v_occurrence public.factory_mesti_equipment_cleaning_occurrences%rowtype; v_result text := lower(coalesce(p_result, 'verified'));
begin
  if not (public.current_user_has_permission('factory_mesti_equipment_cleaning.review') or public.current_user_has_permission('factory_mesti_equipment_cleaning.manage')) then raise exception using errcode = '42501', message = 'Missing permission to verify Equipment Cleaning occurrences.'; end if;
  select * into v_occurrence from public.factory_mesti_equipment_cleaning_occurrences where id = p_occurrence_id for update;
  if v_occurrence.id is null then raise exception using errcode = 'P0002', message = 'Equipment Cleaning occurrence was not found.'; end if;
  if v_occurrence.status <> 'completed' then raise exception using errcode = '55000', message = 'Only completed Equipment Cleaning occurrences can be verified.'; end if;
  if v_result not in ('verified', 'unsatisfactory') then raise exception using errcode = '22023', message = 'Unsupported verification result.'; end if;
  update public.factory_mesti_equipment_cleaning_occurrences set status = v_result, verified_by = v_employee.id, verified_at = now(), verification_result = v_result, verification_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = v_occurrence.id returning * into v_occurrence;
  return to_jsonb(v_occurrence);
end $$;

create or replace function public.factory_mesti_verify_calibration(p_record_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := public.factory_current_active_employee_id(); v_record public.factory_mesti_calibration_records%rowtype; v_verified_at timestamptz := clock_timestamp();
begin
  if not (public.current_user_has_permission('factory_mesti_calibration.review') or public.current_user_has_permission('factory_mesti_calibration.manage')) then raise exception using errcode = '42501', message = 'Missing calibration verification permission.'; end if;
  select * into v_record from public.factory_mesti_calibration_records where id = p_record_id for update;
  if v_record.id is null or v_record.status <> 'awaiting_verification' then raise exception 'Calibration record is not awaiting verification.'; end if;
  update public.factory_mesti_calibration_records set status = 'verified', verified_by = v_actor, verified_at = v_verified_at, updated_at = v_verified_at where id = v_record.id returning * into v_record;
  return to_jsonb(v_record);
end $$;

create or replace function public.factory_mesti_verify_operator_hygiene(p_date date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := public.factory_current_active_employee_id(); v_session public.factory_mesti_operator_hygiene_sessions%rowtype;
begin
  if not public.current_user_has_permission('factory_mesti_operator_hygiene.verify') then raise exception using errcode = '42501', message = 'Missing hygiene verify permission.'; end if;
  select * into v_session from public.factory_mesti_operator_hygiene_sessions where inspection_date = p_date for update;
  if v_session.id is null or v_session.status <> 'submitted' then raise exception 'Inspection is not awaiting verification.'; end if;
  update public.factory_mesti_operator_hygiene_sessions set status = 'verified', verified_by = v_actor, verified_at = now(), updated_at = now() where id = v_session.id returning * into v_session;
  return to_jsonb(v_session);
end $$;

create or replace function public.factory_mesti_waste_disposal_verify(p_date date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := public.factory_current_active_employee_id(); v_session public.factory_mesti_waste_disposal_sessions%rowtype;
begin
  if not public.current_user_has_permission('factory_mesti_waste_disposal.verify') then raise exception using errcode = '42501', message = 'Missing waste disposal verify permission.'; end if;
  select * into v_session from public.factory_mesti_waste_disposal_sessions where disposal_date = p_date for update;
  if v_session.id is null or v_session.status <> 'submitted' then raise exception 'Waste disposal is not awaiting verification.'; end if;
  update public.factory_mesti_waste_disposal_sessions set status = 'verified', verified_by = v_actor, verified_at = now(), updated_at = now() where id = v_session.id returning * into v_session;
  return to_jsonb(v_session);
end $$;

create or replace function public.factory_mesti_operator_hygiene_monthly(p_month date)
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_operator_hygiene.view') or public.current_user_has_permission('factory_mesti_operator_hygiene.manage')) then raise exception using errcode = '42501', message = 'Missing hygiene view permission.'; end if;
  return query
  select jsonb_build_object(
    'employee_id', employee.id,
    'employee_name', coalesce(employee.nickname, employee.full_name),
    'position', employee.position,
    'summary', jsonb_build_object('inspected_count', count(entry.id), 'compliant_count', count(entry.id) filter (where entry.overall_result = 'compliant'), 'non_compliant_count', count(entry.id) filter (where entry.overall_result = 'non_compliant')),
    'days', coalesce(jsonb_object_agg(session.inspection_date::text, jsonb_build_object('entry_id', entry.id, 'state', case when session.status = 'verified' then entry.overall_result else 'awaiting_verification' end, 'session_status', session.status, 'clothing_result', entry.clothing_result, 'hygiene_result', entry.hygiene_result, 'overall_result', entry.overall_result, 'issue', entry.issue, 'action_taken', entry.action_taken, 'notes', entry.notes, 'submitted_by_name', coalesce(submitted_by.nickname, submitted_by.full_name), 'submitted_at', session.submitted_at, 'verified_by_name', coalesce(verified_by.nickname, verified_by.full_name), 'verified_at', session.verified_at)), '{}'::jsonb)
  )
  from public.factory_mesti_operator_hygiene_entries entry
  join public.factory_mesti_operator_hygiene_sessions session on session.id = entry.session_id
  join public.employees employee on employee.id = entry.employee_id
  left join public.employees submitted_by on submitted_by.id = session.submitted_by
  left join public.employees verified_by on verified_by.id = session.verified_by
  where session.inspection_date >= date_trunc('month', p_month)::date
    and session.inspection_date < (date_trunc('month', p_month)::date + interval '1 month')
  group by employee.id, employee.nickname, employee.full_name, employee.position
  order by coalesce(employee.nickname, employee.full_name);
end $$;

revoke all on function public.factory_save_mesti_cleaning_requirement(jsonb), public.factory_save_mesti_equipment_cleaning_requirement(jsonb), public.factory_save_mesti_calibration_requirement(jsonb), public.factory_save_mesti_waste_disposal_requirement(jsonb), public.factory_mesti_verify_cleaning_occurrence(uuid, text, text), public.factory_mesti_verify_equipment_cleaning_occurrence(uuid, text, text), public.factory_mesti_verify_calibration(uuid), public.factory_mesti_verify_operator_hygiene(date), public.factory_mesti_waste_disposal_verify(date), public.factory_mesti_operator_hygiene_monthly(date) from public, anon;
grant execute on function public.factory_save_mesti_cleaning_requirement(jsonb), public.factory_save_mesti_equipment_cleaning_requirement(jsonb), public.factory_save_mesti_calibration_requirement(jsonb), public.factory_save_mesti_waste_disposal_requirement(jsonb), public.factory_mesti_verify_cleaning_occurrence(uuid, text, text), public.factory_mesti_verify_equipment_cleaning_occurrence(uuid, text, text), public.factory_mesti_verify_calibration(uuid), public.factory_mesti_verify_operator_hygiene(date), public.factory_mesti_waste_disposal_verify(date), public.factory_mesti_operator_hygiene_monthly(date) to authenticated;
