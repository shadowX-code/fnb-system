-- Forward-only repair for the initial Calibration Schedule projection.
-- Selecting r as a composite value hid the requirement columns from the outer JSON projection.
create or replace function public.factory_mesti_calibration_schedule()
returns setof jsonb
language plpgsql
security definer
stable
set search_path=public,pg_temp
as $$
begin
  if not (public.current_user_has_permission('factory_mesti_calibration.view') or public.current_user_has_permission('factory_mesti_calibration.manage')) then
    raise exception using errcode='42501',message='Missing calibration view permission.';
  end if;

  return query
  with current_requirements as (
    select r.*
    from public.factory_mesti_calibration_requirements r
    where r.effective_until is null
  ),
  latest_verified as (
    select distinct on (logical_requirement_id) *
    from public.factory_mesti_calibration_records
    where status='verified'
    order by logical_requirement_id,verified_at desc,created_at desc
  ),
  latest_pass as (
    select distinct on (logical_requirement_id) *
    from public.factory_mesti_calibration_records
    where status='verified' and result='pass'
    order by logical_requirement_id,verified_at desc,created_at desc
  ),
  rows as (
    select r.*,e.equipment_code,e.name equipment_name,c.name category_name,l.location_name,
      latest_pass.calibrated_date last_calibration,
      coalesce(public.factory_mesti_calibration_due_date(latest_pass.calibrated_date,r.interval_months),r.effective_from) next_due,
      latest_verified.result last_result
    from current_requirements r
    join public.factory_equipment e on e.id=r.equipment_id
    left join public.factory_equipment_categories c on c.id=e.category_id
    left join public.factory_storage_locations l on l.id=e.current_location_id
    left join latest_pass on latest_pass.logical_requirement_id=r.logical_requirement_id
    left join latest_verified on latest_verified.logical_requirement_id=r.logical_requirement_id
  )
  select jsonb_build_object(
    'id',id,'logical_requirement_id',logical_requirement_id,'equipment_id',equipment_id,
    'equipment_code',equipment_code,'equipment_name',equipment_name,'category_name',category_name,
    'location_name',location_name,'calibration_type',calibration_type,'interval_months',interval_months,
    'effective_from',effective_from,'last_calibration',last_calibration,'next_due',next_due,
    'status',case
      when status='inactive' then 'inactive'
      when last_result='fail' then 'failed'
      when next_due < (now() at time zone 'Asia/Kuala_Lumpur')::date then 'overdue'
      when next_due = (now() at time zone 'Asia/Kuala_Lumpur')::date then 'due'
      when next_due <= ((now() at time zone 'Asia/Kuala_Lumpur')::date+7) then 'due_soon'
      else 'current'
    end
  )
  from rows;
end $$;

revoke all on function public.factory_mesti_calibration_schedule() from public,anon;
grant execute on function public.factory_mesti_calibration_schedule() to authenticated;
