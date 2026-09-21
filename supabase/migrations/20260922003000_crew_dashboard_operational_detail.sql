-- The Dashboard remains a read-only consumer of Workforce, Operations and
-- People projections. This adds bounded operational detail without creating
-- Dashboard-owned lifecycle state.
create or replace function public.crew_dashboard_admin_data_v3(p_outlet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  d date := timezone('Asia/Kuala_Lumpur', now())::date;
  local_time time := timezone('Asia/Kuala_Lumpur', now())::time;
  base_data jsonb;
  crew_today jsonb := '[]'::jsonb;
  tasks_today jsonb := '[]'::jsonb;
begin
  -- v2 enforces Dashboard permission and outlet scope, and owns summaries,
  -- attention and the 30-day People/Workforce timeline.
  base_data := public.crew_dashboard_admin_data_v2(p_outlet_id);

  with current_publication as (
    select publication.id
    from public.duty_roster_publications publication
    where publication.outlet_id = p_outlet_id
      and publication.week_start_date <= d
      and publication.week_end_date >= d
    order by publication.revision desc, publication.published_at desc
    limit 1
  ), roster as (
    select entry.employee_id, entry.start_time, entry.end_time,
      coalesce(entry.position_snapshot, employee.position) as position,
      employee.full_name,
      attendance.status as attendance_status,
      exists (
        select 1
        from public.crew_leave_requests leave_request
        where leave_request.employee_id = entry.employee_id
          and leave_request.employment_outlet_id = p_outlet_id
          and leave_request.status = 'approved'
          and d between leave_request.start_date and leave_request.end_date
      ) as on_leave
    from public.duty_roster_published_entries entry
    join current_publication publication on publication.id = entry.publication_id
    join public.employees employee on employee.id = entry.employee_id
    left join lateral (
      select record.status
      from public.crew_attendance_records record
      where record.employee_id = entry.employee_id
        and record.outlet_id = p_outlet_id
        and timezone('Asia/Kuala_Lumpur', record.clock_in_at)::date = d
      order by record.clock_in_at desc
      limit 1
    ) attendance on true
    where entry.roster_date = d
      and entry.entry_type = 'working'
  ), roster_rows as (
    select employee_id, full_name, position, start_time, end_time,
      case
        when on_leave then 'on_leave'
        when attendance_status = 'completed' then 'finished'
        when attendance_status = 'open' then 'working'
        when start_time is not null and start_time > local_time then 'starting_later'
        else 'not_checked_in'
      end as status,
      case
        when on_leave then 'on_leave'
        when attendance_status = 'completed' then 'finished'
        when start_time is not null and start_time > local_time then 'starting_later'
        else 'on_duty'
      end as group_key
    from roster
  ), leave_only_rows as (
    select leave_request.employee_id, employee.full_name, employee.position,
      null::time as start_time, null::time as end_time,
      'on_leave'::text as status, 'on_leave'::text as group_key
    from public.crew_leave_requests leave_request
    join public.employees employee on employee.id = leave_request.employee_id
    where leave_request.employment_outlet_id = p_outlet_id
      and leave_request.status = 'approved'
      and d between leave_request.start_date and leave_request.end_date
      and employee.is_active
      and coalesce(employee.employment_status, 'active') = 'active'
      and not exists (select 1 from roster_rows row where row.employee_id = leave_request.employee_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_id', employee_id,
    'name', full_name,
    'position', position,
    'start_time', start_time,
    'end_time', end_time,
    'status', status,
    'group', group_key
  ) order by case group_key when 'on_duty' then 1 when 'starting_later' then 2 when 'on_leave' then 3 else 4 end,
    start_time nulls last, full_name), '[]'::jsonb)
  into crew_today
  from (select * from roster_rows union all select * from leave_only_rows) rows;

  if public.current_user_has_permission('crew_operations.view') then
    with rows as (
      select instance.id, instance.name, instance.status, instance.available_until,
        nullif(array_to_string(instance.applicable_positions, ', '), '') as assignment,
        case
          when instance.status = 'overdue' or (instance.status = 'not_started' and instance.available_until < now()) then 'overdue'
          when instance.status in ('completed', 'completed_with_exceptions') then 'completed'
          when instance.status = 'in_progress' then 'in_progress'
          else 'upcoming'
        end as display_status
      from public.crew_operation_instances instance
      where instance.outlet_id = p_outlet_id
        and instance.business_date = d
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'name', name,
      'assignment', coalesce(assignment, 'All Crew'),
      'due_at', available_until,
      'status', display_status
    ) order by case display_status when 'overdue' then 1 when 'in_progress' then 2 when 'upcoming' then 3 else 4 end,
      available_until nulls last, name), '[]'::jsonb)
    into tasks_today
    from (select * from rows order by case display_status when 'overdue' then 1 when 'in_progress' then 2 when 'upcoming' then 3 else 4 end, available_until nulls last, name limit 6) bounded;
  end if;

  return jsonb_build_object(
    'business_date', base_data -> 'business_date',
    'summary', base_data -> 'summary',
    'attention', base_data -> 'attention',
    'upcoming', base_data -> 'upcoming',
    'crew_today', crew_today,
    'tasks_today', tasks_today
  );
end;
$$;

revoke all on function public.crew_dashboard_admin_data_v3(uuid) from public, anon, authenticated;
grant execute on function public.crew_dashboard_admin_data_v3(uuid) to authenticated;
