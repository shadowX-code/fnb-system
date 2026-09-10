-- MeSTI authorization belongs exclusively to the canonical FeedX permission set.
-- Existing occurrence/record snapshots remain immutable audit evidence.

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
         public.factory_mesti_cleaning_occurrence_snapshot(requirement, location)
  from public.factory_mesti_cleaning_requirements requirement
  join public.factory_mesti_cleaning_requirement_locations link on link.requirement_id = requirement.id
  join public.factory_storage_locations location on location.id = link.location_id
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
  if not (public.current_user_has_permission('factory_mesti_cleaning.complete') or public.current_user_has_permission('factory_mesti_cleaning.manage')) then
    raise exception using errcode='42501', message='Missing permission to complete Cleaning occurrences.';
  end if;
  select * into v_occurrence from public.factory_mesti_cleaning_occurrences where id=p_occurrence_id for update;
  if v_occurrence.id is null then raise exception using errcode='P0002', message='Cleaning occurrence was not found.'; end if;
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
  if not (public.current_user_has_permission('factory_mesti_cleaning.review') or public.current_user_has_permission('factory_mesti_cleaning.manage')) then
    raise exception using errcode='42501', message='Missing permission to verify Cleaning occurrences.';
  end if;
  select * into v_occurrence from public.factory_mesti_cleaning_occurrences where id=p_occurrence_id for update;
  if v_occurrence.id is null then raise exception using errcode='P0002', message='Cleaning occurrence was not found.'; end if;
  if v_occurrence.completed_by = v_employee.id then
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

create or replace function public.factory_mesti_record_calibration(p_requirement_id uuid, p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a uuid := public.factory_current_active_employee_id();
  req public.factory_mesti_calibration_requirements%rowtype;
  equip public.factory_equipment%rowtype;
  rec public.factory_mesti_calibration_records%rowtype;
  due date := (p_record->>'scheduled_due_date')::date;
  calibrated date := (p_record->>'calibrated_date')::date;
  expected_due date;
  result_value text := lower(btrim(p_record->>'result'));
begin
  if not (public.current_user_has_permission('factory_mesti_calibration.complete') or public.current_user_has_permission('factory_mesti_calibration.manage')) then
    raise exception using errcode='42501', message='Missing calibration record permission.';
  end if;
  select * into req from public.factory_mesti_calibration_requirements where id=p_requirement_id and status='active' and effective_until is null;
  if req.id is null then raise exception using errcode='22023', message='Active calibration requirement was not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(req.logical_requirement_id::text, 0));
  select * into req from public.factory_mesti_calibration_requirements where logical_requirement_id=req.logical_requirement_id and effective_until is null and status='active' for update;
  if req.id is null then raise exception using errcode='22023', message='Active calibration requirement was not found.'; end if;
  if due is null or calibrated is null or result_value not in ('pass','fail') then raise exception using errcode='22023', message='Scheduled Due, Calibrated Date and a Pass or Fail result are required.'; end if;
  select coalesce(public.factory_mesti_calibration_due_date(r.calibrated_date,req.interval_months),req.effective_from)
  into expected_due
  from public.factory_mesti_calibration_records r
  where r.logical_requirement_id=req.logical_requirement_id and r.status='verified' and r.result='pass'
  order by r.verified_at desc,r.created_at desc
  limit 1;
  if due is distinct from coalesce(expected_due,req.effective_from) then raise exception using errcode='22023', message='Scheduled Due no longer matches the canonical calibration schedule.'; end if;
  select * into equip from public.factory_equipment where id=req.equipment_id;
  if equip.id is null then raise exception using errcode='22023', message='Equipment was not found.'; end if;
  insert into public.factory_mesti_calibration_records(logical_requirement_id,requirement_id,equipment_id,scheduled_due_date,calibrated_date,result,equipment_snapshot,provider_name,reference_no,notes,recorded_by)
  values(req.logical_requirement_id,req.id,equip.id,due,calibrated,result_value,public.factory_mesti_calibration_snapshot(equip),nullif(btrim(p_record->>'provider_name'),''),nullif(btrim(p_record->>'reference_no'),''),nullif(btrim(p_record->>'notes'),''),a)
  returning * into rec;
  return to_jsonb(rec);
end;
$$;

create or replace function public.factory_mesti_verify_calibration(p_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a uuid := public.factory_current_active_employee_id();
  rec public.factory_mesti_calibration_records%rowtype;
  verified_at_value timestamptz := clock_timestamp();
begin
  if not (public.current_user_has_permission('factory_mesti_calibration.review') or public.current_user_has_permission('factory_mesti_calibration.manage')) then
    raise exception using errcode='42501', message='Missing calibration verification permission.';
  end if;
  select * into rec from public.factory_mesti_calibration_records where id=p_record_id for update;
  if rec.id is null or rec.status <> 'awaiting_verification' then raise exception 'Calibration record is not awaiting verification.'; end if;
  if rec.recorded_by=a then raise exception using errcode='42501', message='Self-verification is not allowed.'; end if;
  update public.factory_mesti_calibration_records
  set status='verified', verified_by=a, verified_at=verified_at_value, updated_at=verified_at_value
  where id=rec.id
  returning * into rec;
  return to_jsonb(rec);
end;
$$;

drop function if exists public.factory_save_mesti_cleaning_settings(jsonb);
drop function if exists public.factory_save_mesti_calibration_settings(jsonb);
drop function if exists public.factory_mesti_cleaning_occurrence_snapshot(public.factory_mesti_cleaning_requirements, public.factory_storage_locations, public.factory_mesti_cleaning_settings);
drop table if exists public.factory_mesti_cleaning_settings;
drop table if exists public.factory_mesti_calibration_settings;

revoke all on function public.factory_mesti_cleaning_occurrence_snapshot(public.factory_mesti_cleaning_requirements, public.factory_storage_locations) from public, anon;
revoke all on function public.factory_mesti_materialize_cleaning_occurrences(date, date) from public, anon;
revoke all on function public.factory_mesti_complete_cleaning_occurrence(uuid, text) from public, anon;
revoke all on function public.factory_mesti_verify_cleaning_occurrence(uuid, text, text) from public, anon;
revoke all on function public.factory_mesti_record_calibration(uuid, jsonb) from public, anon;
revoke all on function public.factory_mesti_verify_calibration(uuid) from public, anon;
grant execute on function public.factory_mesti_materialize_cleaning_occurrences(date, date) to authenticated;
grant execute on function public.factory_mesti_complete_cleaning_occurrence(uuid, text) to authenticated;
grant execute on function public.factory_mesti_verify_cleaning_occurrence(uuid, text, text) to authenticated;
grant execute on function public.factory_mesti_record_calibration(uuid, jsonb) to authenticated;
grant execute on function public.factory_mesti_verify_calibration(uuid) to authenticated;
