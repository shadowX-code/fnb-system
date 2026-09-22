-- Resolve the post-reset crew_learning_home PL/pgSQL variable/column ambiguity.
create or replace function public.crew_learning_home(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_assignment_id uuid;
  v_assignment_row public.crew_journey_assignments%rowtype;
  v_required_total integer := 0;
  v_required_completed integer := 0;
  v_outlet_id uuid;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select ca.primary_outlet_id into v_outlet_id
  from public.crew_access ca
  where ca.employee_id = v_employee_id;

  v_assignment_id := public.crew_ensure_onboarding_assignment(v_employee_id);

  if v_assignment_id is null then
    select a.id into v_assignment_id
    from public.crew_journey_assignments a
    join public.crew_journeys j on j.id = a.journey_id
    where a.employee_id = v_employee_id
      and j.is_mandatory_onboarding
    order by a.assigned_at desc
    limit 1;
  end if;

  if v_assignment_id is not null then
    select a.* into v_assignment_row
    from public.crew_journey_assignments a
    where a.id = v_assignment_id;

    select count(*) into v_required_total
    from jsonb_array_elements(
      coalesce(v_assignment_row.journey_snapshot->'modules', '[]'::jsonb)
    ) m
    cross join lateral jsonb_array_elements(
      coalesce(m->'lessons', '[]'::jsonb)
    ) l
    where coalesce((l->'lesson'->>'required')::boolean, true);

    select count(*) into v_required_completed
    from public.crew_lesson_progress p
    where p.assignment_id = v_assignment_id
      and p.status = 'completed';
  end if;

  return jsonb_build_object(
    'outlet_id', v_outlet_id,
    'assignment', case when v_assignment_id is null then null else jsonb_build_object(
      'id', v_assignment_row.id,
      'status', v_assignment_row.status,
      'started_at', v_assignment_row.started_at,
      'completed_at', v_assignment_row.completed_at,
      'lessons_total', v_required_total,
      'lessons_completed', least(v_required_completed, v_required_total),
      'progress_percentage', case when v_required_total = 0 then 0 else round(100.0 * least(v_required_completed, v_required_total) / v_required_total) end,
      'enrollment_source', v_assignment_row.enrollment_source
    ) end,
    'onboarding_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'status', a.status,
        'completed_at', a.completed_at,
        'journey_name', a.journey_snapshot->'journey'->>'name',
        'journey_version', a.journey_version_assigned
      ) order by a.assigned_at desc)
      from public.crew_journey_assignments a
      join public.crew_journeys j on j.id = a.journey_id
      where a.employee_id = v_employee_id
        and j.is_mandatory_onboarding
    ), '[]'::jsonb),
    'sop_summary', jsonb_build_object(
      'published_count', (
        select count(*) from public.crew_sops s
        where s.outlet_id = v_outlet_id and s.status = 'published'
      ),
      'acknowledgement_required', (
        select count(*)
        from public.crew_sops s
        join public.crew_sop_versions v
          on v.sop_id = s.id
         and v.version = s.current_version
         and v.status = 'published'
        where s.outlet_id = v_outlet_id
          and s.status = 'published'
          and v.require_acknowledgement
          and not exists (
            select 1 from public.crew_sop_acknowledgements a
            where a.employee_id = v_employee_id
              and a.sop_version_id = v.id
          )
      )
    )
  );
end;
$$;
revoke all on function public.crew_learning_home(text) from public, anon, authenticated;
grant execute on function public.crew_learning_home(text) to anon, authenticated;
