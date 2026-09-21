-- Dashboard attention is a read projection. The full Performance Admin payload
-- refreshes mutable results before reading them, so it cannot be composed here.
create or replace function public.crew_dashboard_admin_data(p_outlet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_business_date date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_period date := date_trunc('month', timezone('Asia/Kuala_Lumpur', now()))::date;
  v_active_crew integer := 0;
  v_scheduled_today integer := 0;
  v_present_today integer := 0;
  v_on_leave_today integer := 0;
  v_birthdays jsonb := '[]'::jsonb;
  v_access jsonb := '{}'::jsonb;
  v_attention jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_pending_compliance integer := 0;
  v_compliance_risk integer := 0;
  v_can_leave boolean := public.current_user_has_permission('crew_leave.view');
  v_can_attendance boolean := public.current_user_has_permission('crew_attendance.view');
  v_can_compliance boolean := public.current_user_has_permission('employee_compliance.view');
  v_can_performance boolean := public.current_user_has_permission('crew_performance.view');
begin
  if p_outlet_id is null or not public.current_user_has_permission('crew_dashboard.view') then
    raise exception using errcode='42501', message='Missing permission to view the Crew Dashboard.';
  end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501', message='Crew Dashboard is outside your outlet scope.';
  end if;

  with active_crew as materialized (
    select e.id
    from public.employees e
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      and e.is_active
      and coalesce(e.employment_status, 'active')='active'
  )
  select count(*) into v_active_crew from active_crew;

  select count(distinct entry.employee_id) into v_scheduled_today
  from public.duty_roster_published_entries entry
  where entry.outlet_id=p_outlet_id
    and entry.roster_date=v_business_date
    and entry.entry_type='working'
    and entry.publication_id=(
      select publication.id
      from public.duty_roster_publications publication
      where publication.outlet_id=p_outlet_id
        and publication.week_start_date<=v_business_date
        and publication.week_end_date>=v_business_date
      order by publication.revision desc, publication.published_at desc
      limit 1
    );

  select count(distinct attendance.employee_id) into v_present_today
  from public.crew_attendance_records attendance
  where attendance.outlet_id=p_outlet_id
    and timezone('Asia/Kuala_Lumpur', attendance.clock_in_at)::date=v_business_date;

  select count(distinct leave_request.employee_id) into v_on_leave_today
  from public.crew_leave_requests leave_request
  join public.employees employee on employee.id=leave_request.employee_id
  where leave_request.employment_outlet_id=p_outlet_id
    and leave_request.status='approved'
    and v_business_date between leave_request.start_date and leave_request.end_date
    and employee.is_active
    and coalesce(employee.employment_status, 'active')='active';

  with active_crew as materialized (
    select e.id, e.full_name, e.position, e.birthday
    from public.employees e
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      and e.is_active
      and coalesce(e.employment_status, 'active')='active'
      and e.birthday is not null
  ), occurrences as (
    select *,
      (birthday + ((extract(year from v_business_date)::integer - extract(year from birthday)::integer) || ' years')::interval)::date as this_year
    from active_crew
  ), upcoming as (
    select *, case when this_year<v_business_date then (this_year + interval '1 year')::date else this_year end as occurrence_date
    from occurrences
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_id', id,
    'full_name', full_name,
    'position', position,
    'date', occurrence_date,
    'days_until', occurrence_date-v_business_date
  ) order by occurrence_date, full_name), '[]'::jsonb)
  into v_birthdays
  from upcoming
  where occurrence_date<=v_business_date+7;

  with active_crew as materialized (
    select coalesce(ca.access_state, 'not_enabled') as access_state
    from public.employees e
    left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      and e.is_active
      and coalesce(e.employment_status, 'active')='active'
  )
  select jsonb_build_object(
    'active', count(*) filter (where access_state='active'),
    'not_enabled', count(*) filter (where access_state='not_enabled'),
    'locked', count(*) filter (where access_state='locked')
  ) into v_access from active_crew;

  if v_can_leave then
    select count(*) into v_count from public.crew_leave_requests leave_request
    where leave_request.employment_outlet_id=p_outlet_id and leave_request.status='pending';
    if v_count>0 then
      v_attention:=v_attention || jsonb_build_array(jsonb_build_object(
        'key', 'leave_requests', 'count', v_count, 'title', 'Pending leave requests', 'detail', 'New requests need review.'
      ));
    end if;
  end if;

  if v_can_attendance then
    select count(*) into v_count from public.crew_attendance_records attendance
    where attendance.outlet_id=p_outlet_id
      and timezone('Asia/Kuala_Lumpur', attendance.clock_in_at)::date=v_business_date
      and (attendance.clock_in_location_exception or attendance.clock_out_location_exception);
    if v_count>0 then
      v_attention:=v_attention || jsonb_build_array(jsonb_build_object(
        'key', 'attendance_exceptions', 'count', v_count, 'title', 'Attendance exceptions', 'detail', 'Location evidence needs review.'
      ));
    end if;
  end if;

  if v_can_compliance then
    with states as (
      select public.employee_compliance_current(employee.id, requirement.id, v_business_date) as state
      from public.employees employee
      cross join public.employee_compliance_requirements requirement
      where public.crew_resolve_employee_outlet(employee.id)=p_outlet_id
        and employee.is_active
        and coalesce(employee.employment_status, 'active')='active'
        and requirement.is_active
    )
    select count(*) filter (where state->>'effective_status'='pending_verification'),
      count(*) filter (where state->>'effective_status' in ('missing', 'expired', 'expiring_soon'))
    into v_pending_compliance, v_compliance_risk
    from states;
    if v_pending_compliance>0 then
      v_attention:=v_attention || jsonb_build_array(jsonb_build_object(
        'key', 'compliance_review', 'count', v_pending_compliance, 'title', 'Compliance review', 'detail', 'Documents are waiting for verification.'
      ));
    end if;
    if v_compliance_risk>0 then
      v_attention:=v_attention || jsonb_build_array(jsonb_build_object(
        'key', 'compliance_status', 'count', v_compliance_risk, 'title', 'Compliance follow-up', 'detail', 'Documents are missing, expiring, or expired.'
      ));
    end if;
  end if;

  if v_can_performance then
    select count(*) into v_count
    from public.crew_performance_results result
    where result.outlet_id=p_outlet_id
      and result.period_start=v_period
      and (
        result.components->'service'->>'status'<>'reviewed'
        or result.components->'conduct'->>'status'<>'reviewed'
      );
    if v_count>0 then
      v_attention:=v_attention || jsonb_build_array(jsonb_build_object(
        'key', 'performance_reviews', 'count', v_count, 'title', 'Performance reviews', 'detail', 'Service Standards or Conduct is still pending.'
      ));
    end if;
  end if;

  return jsonb_build_object(
    'business_date', v_business_date,
    'summary', jsonb_build_object(
      'active_crew', v_active_crew,
      'scheduled_today', v_scheduled_today,
      'present_today', v_present_today,
      'on_leave_today', v_on_leave_today
    ),
    'birthdays', v_birthdays,
    'attention', v_attention,
    'crew_access', coalesce(v_access, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.crew_dashboard_admin_data(uuid) from public, anon, authenticated;
grant execute on function public.crew_dashboard_admin_data(uuid) to authenticated;
