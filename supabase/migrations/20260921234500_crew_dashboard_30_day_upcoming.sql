-- Extend the Dashboard read projection without rewriting the applied daily authority.
create or replace function public.crew_dashboard_admin_data_v2(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  d date := timezone('Asia/Kuala_Lumpur', now())::date;
  base_data jsonb;
  later_birthdays jsonb := '[]'::jsonb;
  later_leave jsonb := '[]'::jsonb;
  compliance_expiry jsonb := '[]'::jsonb;
  all_upcoming jsonb := '[]'::jsonb;
begin
  -- The established projection remains the authority for today and attention.
  base_data := public.crew_dashboard_admin_data(p_outlet_id);

  with active as (
    select e.full_name, e.position, e.birthday
    from public.employees e
    where public.crew_resolve_employee_outlet(e.id) = p_outlet_id
      and e.is_active
      and coalesce(e.employment_status, 'active') = 'active'
      and e.birthday is not null
  ), events as (
    select full_name, position,
      case
        when make_date(extract(year from d)::int, extract(month from birthday)::int, extract(day from birthday)::int) < d
          then make_date(extract(year from d)::int + 1, extract(month from birthday)::int, extract(day from birthday)::int)
        else make_date(extract(year from d)::int, extract(month from birthday)::int, extract(day from birthday)::int)
      end as event_date
    from active
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'type', 'birthday', 'name', full_name, 'position', position,
    'date', event_date, 'days_until', event_date - d
  ) order by event_date, full_name), '[]'::jsonb)
  into later_birthdays
  from events
  where event_date > d + 7 and event_date <= d + 30;

  if public.current_user_has_permission('crew_leave.view') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'type', 'leave', 'name', e.full_name, 'position', e.position,
      'date', r.start_date, 'days_until', r.start_date - d, 'leave_type', r.leave_type
    ) order by r.start_date, e.full_name), '[]'::jsonb)
    into later_leave
    from public.crew_leave_requests r
    join public.employees e on e.id = r.employee_id
    where r.employment_outlet_id = p_outlet_id
      and r.status = 'approved'
      and e.is_active
      and r.start_date > d + 7
      and r.start_date <= d + 30;
  end if;

  if public.current_user_has_permission('employee_compliance.view') then
    with states as (
      select e.full_name, e.position, r.name as requirement_name,
        public.employee_compliance_current(e.id, r.id, d) as state
      from public.employees e
      cross join public.employee_compliance_requirements r
      where public.crew_resolve_employee_outlet(e.id) = p_outlet_id
        and e.is_active
        and coalesce(e.employment_status, 'active') = 'active'
        and r.is_active
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'type', 'compliance', 'name', full_name, 'position', position,
      'requirement_name', requirement_name,
      'date', (state ->> 'effective_expiry_date')::date,
      'days_until', (state ->> 'effective_expiry_date')::date - d
    ) order by (state ->> 'effective_expiry_date')::date, full_name, requirement_name), '[]'::jsonb)
    into compliance_expiry
    from states
    where state ->> 'effective_status' in ('verified', 'expiring_soon')
      and (state ->> 'effective_expiry_date')::date > d
      and (state ->> 'effective_expiry_date')::date <= d + 30;
  end if;

  select coalesce(jsonb_agg(event order by (event ->> 'date')::date, event ->> 'name', event ->> 'type'), '[]'::jsonb)
  into all_upcoming
  from jsonb_array_elements(
    coalesce(base_data -> 'upcoming', '[]'::jsonb) || later_birthdays || later_leave || compliance_expiry
  ) event;

  return jsonb_set(base_data, '{upcoming}', all_upcoming);
end;
$$;

revoke all on function public.crew_dashboard_admin_data_v2(uuid) from public, anon, authenticated;
grant execute on function public.crew_dashboard_admin_data_v2(uuid) to authenticated;
