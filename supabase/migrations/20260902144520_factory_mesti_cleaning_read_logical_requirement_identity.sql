-- Daily and Monthly are projections of the logical requirement schedule, not
-- of an individual configuration-version row.

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
      'logical_requirement_id', o.logical_requirement_id,
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
    left join public.employees completer on completer.id = o.completed_by
    left join public.employees verifier on verifier.id = o.verified_by
    where o.due_date = p_due_date
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
      'logical_requirement_id', o.logical_requirement_id,
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
      'completion_note', o.completion_note,
      'verified_by', o.verified_by,
      'verified_by_name', coalesce(verifier.nickname, verifier.full_name, verifier.email),
      'verified_at', o.verified_at,
      'verification_result', o.verification_result,
      'verification_note', o.verification_note
    ) order by o.requirement_snapshot->>'location_name', o.requirement_snapshot->>'task_name', o.due_date)
    from public.factory_mesti_cleaning_occurrences o
    left join public.employees completer on completer.id = o.completed_by
    left join public.employees verifier on verifier.id = o.verified_by
    where o.due_date between v_from and v_to
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.factory_mesti_cleaning_day(date) from public, anon;
revoke all on function public.factory_mesti_cleaning_month(date) from public, anon;
grant execute on function public.factory_mesti_cleaning_day(date) to authenticated;
grant execute on function public.factory_mesti_cleaning_month(date) to authenticated;
