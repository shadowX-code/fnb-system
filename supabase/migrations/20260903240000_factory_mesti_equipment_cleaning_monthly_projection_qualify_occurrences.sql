-- Keep Monthly's Equipment-centric aggregate while making every occurrence
-- reference explicit after audit-employee joins are introduced.

create or replace function public.factory_mesti_equipment_cleaning_month(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month)::date + interval '1 month - 1 day')::date;
begin
  perform public.factory_mesti_materialize_equipment_cleaning_scheduled(v_from, v_to);

  return coalesce((
    with occurrence_rows as (
      select occurrence.*, occurrence.requirement_snapshot->>'task_name' as task_name,
             occurrence.requirement_snapshot->>'recurrence_type' as recurrence_type,
             occurrence.requirement_snapshot->'recurrence_weekdays' as recurrence_weekdays,
             occurrence.requirement_snapshot->>'equipment_code' as equipment_code,
             occurrence.requirement_snapshot->>'equipment_name' as equipment_name,
             occurrence.requirement_snapshot->>'location_name' as location_name
      from public.factory_mesti_equipment_cleaning_occurrences occurrence
      where occurrence.due_date between v_from and v_to
    ), cells as (
      select occurrence_rows.equipment_id, min(occurrence_rows.equipment_code) as equipment_code,
             min(occurrence_rows.equipment_name) as equipment_name, min(occurrence_rows.location_name) as location_name,
             occurrence_rows.due_date,
             count(*)::integer as total_count,
             count(*) filter (where occurrence_rows.status = 'verified')::integer as verified_count,
             count(*) filter (where occurrence_rows.status = 'completed')::integer as completed_count,
             count(*) filter (where occurrence_rows.status = 'unsatisfactory')::integer as unsatisfactory_count,
             count(*) filter (where occurrence_rows.status = 'missed')::integer as missed_count,
             count(*) filter (where occurrence_rows.status = 'pending')::integer as pending_count,
             case when count(*) filter (where occurrence_rows.status = 'unsatisfactory') > 0 then 'unsatisfactory'
                  when count(*) filter (where occurrence_rows.status = 'missed') > 0 then 'missed'
                  when count(*) filter (where occurrence_rows.status = 'verified') = count(*) then 'verified'
                  when count(*) filter (where occurrence_rows.status = 'verified') > 0 then 'mixed'
                  when count(*) filter (where occurrence_rows.status = 'completed') > 0 then 'completed'
                  else 'pending' end as status,
             jsonb_agg(jsonb_build_object(
               'id', occurrence_rows.id, 'due_date', occurrence_rows.due_date, 'status', occurrence_rows.status,
               'requirement_id', occurrence_rows.requirement_id, 'logical_requirement_id', occurrence_rows.logical_requirement_id,
               'task_name', occurrence_rows.task_name, 'source_type', occurrence_rows.source_type,
               'recurrence_type', occurrence_rows.recurrence_type, 'recurrence_weekdays', occurrence_rows.recurrence_weekdays,
               'equipment_id', occurrence_rows.equipment_id, 'equipment_code', occurrence_rows.equipment_code,
               'equipment_name', occurrence_rows.equipment_name, 'location_name', occurrence_rows.location_name,
               'production_id', occurrence_rows.production_id, 'production_snapshot', occurrence_rows.requirement_snapshot->'production_snapshot',
               'completed_by', occurrence_rows.completed_by,
               'completed_by_name', coalesce(completed_employee.nickname, completed_employee.full_name, completed_employee.email),
               'completed_at', occurrence_rows.completed_at, 'verified_by', occurrence_rows.verified_by,
               'verified_by_name', coalesce(verified_employee.nickname, verified_employee.full_name, verified_employee.email),
               'verified_at', occurrence_rows.verified_at
             ) order by occurrence_rows.created_at, occurrence_rows.id) as occurrences
      from occurrence_rows
      left join public.employees completed_employee on completed_employee.id = occurrence_rows.completed_by
      left join public.employees verified_employee on verified_employee.id = occurrence_rows.verified_by
      group by occurrence_rows.equipment_id, occurrence_rows.due_date
    ), equipment_rows as (
      select equipment_id, min(equipment_code) as equipment_code, min(equipment_name) as equipment_name, min(location_name) as location_name,
             count(*)::integer as total_count, coalesce(sum(verified_count), 0)::integer as verified_count,
             coalesce(sum(completed_count), 0)::integer as completed_count, coalesce(sum(unsatisfactory_count), 0)::integer as unsatisfactory_count,
             coalesce(sum(missed_count), 0)::integer as missed_count, coalesce(sum(pending_count), 0)::integer as pending_count,
             jsonb_agg(jsonb_build_object('due_date', due_date, 'status', status, 'total_count', total_count,
               'verified_count', verified_count, 'completed_count', completed_count, 'unsatisfactory_count', unsatisfactory_count,
               'missed_count', missed_count, 'pending_count', pending_count, 'occurrences', occurrences) order by due_date) as days
      from cells
      group by equipment_id
    )
    select jsonb_agg(jsonb_build_object(
      'equipment_id', equipment_id, 'equipment_code', equipment_code, 'equipment_name', equipment_name, 'location_name', location_name,
      'summary', jsonb_build_object('total_count', total_count, 'verified_count', verified_count, 'completed_count', completed_count,
        'unsatisfactory_count', unsatisfactory_count, 'missed_count', missed_count, 'pending_count', pending_count),
      'days', days) order by equipment_code, equipment_name)
    from equipment_rows
  ), '[]'::jsonb);
end;
$$;
