-- The monthly cell drill-down is an audit read model. Preserve the same
-- occurrence identity and provenance fields exposed by the daily read model.

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
             jsonb_agg(jsonb_build_object(
               'id', id, 'status', status, 'due_date', due_date,
               'requirement_id', requirement_id, 'logical_requirement_id', logical_requirement_id,
               'task_name', task_name, 'trigger_type', trigger_type,
               'recurrence_type', recurrence_type, 'recurrence_weekdays', recurrence_weekdays,
               'equipment_code', requirement_snapshot->>'equipment_code',
               'equipment_name', requirement_snapshot->>'equipment_name',
               'location_name', coalesce(requirement_snapshot->'equipment_snapshot'->>'location_name', requirement_snapshot->>'location_name'),
               'production_equipment_usage_id', production_equipment_usage_id,
               'usage_completed_at', requirement_snapshot->>'usage_completed_at',
               'production_snapshot', requirement_snapshot->'production_snapshot',
               'completed_by', completed_by,
               'completed_by_name', (select coalesce(employee.nickname, employee.full_name, employee.email) from public.employees employee where employee.id = occurrences.completed_by),
               'completed_at', completed_at, 'verified_by', verified_by,
               'verified_by_name', (select coalesce(employee.nickname, employee.full_name, employee.email) from public.employees employee where employee.id = occurrences.verified_by),
               'verified_at', verified_at
             ) order by requirement_snapshot->>'equipment_code', created_at) as occurrences
      from occurrences group by logical_requirement_id, task_name, trigger_type, recurrence_type, recurrence_weekdays, due_date
    )
    select jsonb_agg(jsonb_build_object('logical_requirement_id', logical_requirement_id, 'task_name', task_name, 'trigger_type', trigger_type, 'recurrence_type', recurrence_type, 'recurrence_weekdays', recurrence_weekdays, 'days', days) order by task_name, logical_requirement_id)
    from (select logical_requirement_id, min(task_name) as task_name, min(trigger_type) as trigger_type, min(recurrence_type) as recurrence_type, (array_agg(recurrence_weekdays))[1] as recurrence_weekdays, jsonb_agg(jsonb_build_object('due_date', due_date, 'status', status, 'total_count', total_count, 'verified_count', verified_count, 'completed_count', completed_count, 'unsatisfactory_count', unsatisfactory_count, 'missed_count', missed_count, 'pending_count', pending_count, 'occurrences', occurrences) order by due_date) as days from cells group by logical_requirement_id) grouped
  ), '[]'::jsonb);
end;
$$;
