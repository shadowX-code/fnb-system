-- Keep monthly Cleaning of Area evidence aligned with the requirement version
-- that created it. A logical requirement may change recurrence over time; its
-- immutable occurrences must not be relabeled with a newer version's schedule.

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
      select requirement_id, logical_requirement_id, due_date,
             (array_agg(task_name order by id desc))[1] as task_name,
             (array_agg(recurrence_type order by id desc))[1] as recurrence_type,
             (array_agg(recurrence_weekdays order by id desc))[1] as recurrence_weekdays,
             (array_agg(version_no order by id desc))[1] as version_no,
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
      group by requirement_id, logical_requirement_id, due_date
    ), requirement_groups as (
      select requirement_id, logical_requirement_id,
             (array_agg(task_name order by due_date desc))[1] as task_name,
             (array_agg(recurrence_type order by due_date desc))[1] as recurrence_type,
             (array_agg(recurrence_weekdays order by due_date desc))[1] as recurrence_weekdays,
             (array_agg(version_no order by due_date desc))[1] as version_no,
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
      group by requirement_id, logical_requirement_id
    )
    select jsonb_agg(jsonb_build_object(
      'requirement_id', requirement_id,
      'logical_requirement_id', logical_requirement_id,
      'task_name', task_name,
      'recurrence_type', recurrence_type,
      'recurrence_weekdays', recurrence_weekdays,
      'version_no', version_no,
      'days', days
    ) order by task_name, logical_requirement_id, version_no)
    from requirement_groups
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.factory_mesti_cleaning_month(date) from public, anon;
grant execute on function public.factory_mesti_cleaning_month(date) to authenticated;
