-- Attendance presentation only: the attendance outlet and pinned roster evidence
-- remain independent of People employment assignment history.
create or replace function public.crew_attendance_admin_with_roster(
  p_from date default (timezone('Asia/Kuala_Lumpur',now())::date-31),
  p_to date default timezone('Asia/Kuala_Lumpur',now())::date,
  p_outlet_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  if not public.current_user_has_permission('crew_attendance.view') then
    raise exception using errcode='42501',message='Attendance permission is required.';
  end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then
    raise exception using errcode='22023',message='Attendance date range must be 367 days or fewer.';
  end if;
  if p_outlet_id is not null and not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Attendance is outside your outlet scope.';
  end if;

  with attendance as materialized (
    select a.*,timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date business_date,
      e.full_name,e.nickname,o.name outlet_name,o.code outlet_code
    from public.crew_attendance_records a
    join public.employees e on e.id=a.employee_id
    left join public.outlets o on o.id=a.outlet_id
    where timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date between p_from and p_to
      and (p_outlet_id is null or a.outlet_id=p_outlet_id)
      and public.current_user_can_access_outlet(a.outlet_id)
  ), employment_keys as materialized (
    select distinct employee_id,business_date from attendance
  ), employment as materialized (
    select k.employee_id,k.business_date,
      public.employee_employment_assignment_at(k.employee_id,k.business_date) assignment
    from employment_keys k
  ), presented as (
    select a.id,a.clock_in_at,
      (to_jsonb(a)-'full_name'-'nickname'-'outlet_name'-'outlet_code'-'business_date') ||
      jsonb_build_object(
        'employee',jsonb_build_object('id',a.employee_id,'full_name',a.full_name,'nickname',a.nickname,
          'position',(em.assignment).position,'workplace',(em.assignment).workplace),
        'employment_context',jsonb_build_object('state',case when (em.assignment).id is null then 'unverified' else 'verified' end,
          'position',(em.assignment).position,'workplace',(em.assignment).workplace),
        'outlet',jsonb_build_object('id',a.outlet_id,'name',a.outlet_name,'code',a.outlet_code),
        'schedule',s.schedule,
        'roster_evidence_state',case when s.schedule is null then 'no_roster'
          when s.schedule->>'entry_type'<>'working' then 'not_required'
          when a.status='open' then 'open' else 'completed' end,
        'clock_in_variance_minutes',case when s.schedule is not null and s.schedule->>'entry_type'='working'
          and s.schedule->>'start_time' is not null then
          round(extract(epoch from (a.clock_in_at-(((s.schedule->>'date')::date+
            (s.schedule->>'start_time')::time) at time zone 'Asia/Kuala_Lumpur')))/60)::integer
          else null end,
        'evidence_version','roster-attendance-evidence-v1') value
    from attendance a
    join employment em on em.employee_id=a.employee_id and em.business_date=a.business_date
    left join lateral (
      select case when a.scheduled_roster_entry_id is not null then
        (select jsonb_build_object('entry_id',r.id,'publication_id',r.publication_id,
          'date',r.roster_date,'outlet_id',r.outlet_id,'outlet_name',r.outlet_name_snapshot,
          'entry_type',r.entry_type,'start_time',r.start_time,'end_time',r.end_time,
          'position',r.position_snapshot,'template_name',r.template_name)
         from public.duty_roster_published_entries r where r.id=a.scheduled_roster_entry_id)
        else public.crew_roster_employee_day(a.employee_id,a.business_date) end schedule
    ) s on true
  )
  select coalesce(jsonb_agg(value order by clock_in_at desc,id desc),'[]'::jsonb) into v_rows
  from presented;
  return v_rows;
end; $$;
revoke all on function public.crew_attendance_admin_with_roster(date,date,uuid) from public,anon,authenticated;
grant execute on function public.crew_attendance_admin_with_roster(date,date,uuid) to authenticated;

create or replace function public.crew_attendance_admin_page(
  p_from date,p_to date,p_outlet_id uuid default null,
  p_filters jsonb default '{}'::jsonb,p_page integer default 1,p_page_size integer default 20
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_page integer:=greatest(coalesce(p_page,1),1);
  v_size integer:=case when p_page_size in (20,50,100) then p_page_size else 20 end;
  v_all jsonb; v_filtered jsonb; v_rows jsonb; v_total integer; v_summary jsonb; v_options jsonb;
begin
  -- The owning read checks permission, outlet scope and date bounds before
  -- returning one complete, historically attributed projection for this page.
  v_all:=public.crew_attendance_admin_with_roster(p_from,p_to,p_outlet_id);
  with filtered as (
    select value from jsonb_array_elements(v_all) value
    where (coalesce(p_filters->>'employee_id','all')='all' or value->>'employee_id'=p_filters->>'employee_id')
      and (coalesce(p_filters->>'position','all')='all' or value->'employee'->>'position'=p_filters->>'position')
      and (coalesce(p_filters->>'status','all')='all'
        or (p_filters->>'status'='verified' and coalesce((value->>'clock_in_location_verified')::boolean,false)
          and (value->>'clock_out_at' is null or coalesce((value->>'clock_out_location_verified')::boolean,false)))
        or (p_filters->>'status'='variance' and coalesce((value->>'clock_in_variance_minutes')::integer,0)<>0)
        or (p_filters->>'status'='location_exception' and
          (coalesce((value->>'clock_in_location_exception')::boolean,false) or coalesce((value->>'clock_out_location_exception')::boolean,false)))
        or (p_filters->>'status'='incomplete' and value->'schedule' is not null
          and value->'schedule'->>'entry_type'='working' and value->>'status'<>'completed')
        or (p_filters->>'status'='no_roster' and (value->'schedule' is null or value->'schedule'='null'::jsonb)))
  ) select count(*),coalesce(jsonb_agg(value order by value->>'clock_in_at' desc,value->>'id' desc),'[]'::jsonb)
    into v_total,v_filtered from filtered;
  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into v_rows
    from (select value,ord from jsonb_array_elements(v_filtered) with ordinality x(value,ord)
      order by ord offset (v_page-1)*v_size limit v_size) page_rows;
  select jsonb_build_object(
    'present',count(distinct value->'employee'->>'id') filter(where value->>'clock_in_at' is not null),
    'variance',count(*) filter(where coalesce((value->>'clock_in_variance_minutes')::integer,0)<>0),
    'exceptions',count(*) filter(where coalesce((value->>'clock_in_location_exception')::boolean,false)
      or coalesce((value->>'clock_out_location_exception')::boolean,false)),
    'incomplete',count(*) filter(where value->'schedule' is not null and value->'schedule'->>'entry_type'='working' and value->>'status'<>'completed'),
    'non_working',count(*) filter(where value->'schedule' is not null and value->'schedule'->>'entry_type'<>'working'),
    'no_roster',count(*) filter(where value->'schedule' is null or value->'schedule'='null'::jsonb),
    'large_variance',count(*) filter(where abs(coalesce((value->>'clock_in_variance_minutes')::integer,0))>=30))
    into v_summary from jsonb_array_elements(v_all) value;
  select jsonb_build_object(
    'employees',coalesce(jsonb_agg(distinct jsonb_build_object('id',value->'employee'->>'id',
      'full_name',value->'employee'->>'full_name','nickname',value->'employee'->>'nickname')),'[]'::jsonb),
    'positions',coalesce(jsonb_agg(distinct value->'employee'->>'position')
      filter(where value->'employee'->>'position' is not null),'[]'::jsonb))
    into v_options from jsonb_array_elements(v_all) value;
  return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,'page_size',v_size,
    'summary',v_summary || jsonb_build_object('filter_options',v_options));
end; $$;
revoke all on function public.crew_attendance_admin_page(date,date,uuid,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.crew_attendance_admin_page(date,date,uuid,jsonb,integer,integer) to authenticated;
