-- Token-bound, employee-only Growth read model for Crew Mobile.
-- This intentionally exposes no manager notes, other employee data, admin IDs,
-- certification evidence snapshots, or caller-controlled employee identity.

create or replace function public.crew_growth_mobile(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_outlet_id uuid;
  v_skills jsonb;
  v_timeline jsonb;
  v_summary jsonb;
begin
  v_employee_id := public.crew_session_employee(p_token);
  v_outlet_id := public.crew_growth_employee_outlet(v_employee_id);

  if v_outlet_id is null then
    raise exception using errcode = '42501', message = 'Growth is unavailable for this Crew profile.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'name', x.name,
        'category', x.category,
        'description', x.description,
        'certification_method', x.certification_method,
        'validity_months', x.validity_months,
        'status', x.state->>'status',
        'requirements_completed', coalesce((x.state->>'requirements_completed')::integer, 0),
        'requirements_total', coalesce((x.state->>'requirements_total')::integer, 0),
        'requirements', coalesce(x.state->'requirements', '[]'::jsonb),
        'certification', x.state->'certification'
      ) order by x.name
    ),
    '[]'::jsonb
  )
  into v_skills
  from (
    select
      s.id,
      s.name,
      s.category,
      s.description,
      s.certification_method,
      s.validity_months,
      public.crew_growth_employee_skill(v_employee_id, s.id) as state
    from public.crew_skills s
    where s.outlet_id = v_outlet_id
      and s.status = 'active'
      and public.crew_growth_skill_applicable(v_employee_id, s.id)
  ) x;

  select jsonb_build_object(
    'certified', count(*) filter (where item->>'status' = 'certified'),
    'in_progress', count(*) filter (where item->>'status' = 'in_progress'),
    'ready_for_review', count(*) filter (where item->>'status' in ('ready_for_review', 'needs_renewal')),
    'not_started', count(*) filter (where item->>'status' = 'not_started'),
    'total', count(*)
  )
  into v_summary
  from jsonb_array_elements(v_skills) item;

  select coalesce(jsonb_agg(t.event order by t.occurred_at desc), '[]'::jsonb)
  into v_timeline
  from (
    select
      (requirement->>'completed_at')::timestamptz as occurred_at,
      jsonb_build_object(
        'type', requirement->>'type',
        'label', requirement->>'label',
        'skill_name', s.name,
        'occurred_at', (requirement->>'completed_at')::timestamptz,
        'score', nullif(requirement->>'score', '')::integer
      ) as event
    from public.crew_skills s
    cross join lateral jsonb_array_elements(
      coalesce(public.crew_growth_employee_skill(v_employee_id, s.id)->'requirements', '[]'::jsonb)
    ) requirement
    where s.outlet_id = v_outlet_id
      and s.status = 'active'
      and public.crew_growth_skill_applicable(v_employee_id, s.id)
      and coalesce((requirement->>'completed')::boolean, false)
      and requirement->>'completed_at' is not null
    union all
    select
      c.certified_at as occurred_at,
      jsonb_build_object(
        'type', 'certification',
        'label', s.name || ' certified',
        'skill_name', s.name,
        'occurred_at', c.certified_at,
        'score', null
      ) as event
    from public.crew_skill_certifications c
    join public.crew_skills s on s.id = c.skill_id
    where c.employee_id = v_employee_id
      and c.status = 'certified'
      and s.outlet_id = v_outlet_id
  ) t
  where t.occurred_at is not null;

  return jsonb_build_object(
    'employee_id', v_employee_id,
    'outlet_id', v_outlet_id,
    'summary', coalesce(v_summary, jsonb_build_object('certified', 0, 'in_progress', 0, 'ready_for_review', 0, 'not_started', 0, 'total', 0)),
    'skills', v_skills,
    'timeline', v_timeline,
    'performance', null
  );
end;
$$;

revoke all on function public.crew_growth_mobile(text) from public, anon, authenticated;
grant execute on function public.crew_growth_mobile(text) to anon, authenticated;
