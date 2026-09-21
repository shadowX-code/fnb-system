-- The Dashboard is a read-only operational brief, not a module directory.
create or replace function public.crew_dashboard_admin_data(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  d date := timezone('Asia/Kuala_Lumpur', now())::date;
  m date := date_trunc('month', timezone('Asia/Kuala_Lumpur', now()))::date;
  scheduled int:=0; present_count int:=0; leave_count int:=0; attendance_issues int:=0;
  task_total int:=0; task_completed int:=0; task_overdue int:=0; access_issues int:=0;
  birthdays jsonb:='[]'::jsonb; upcoming jsonb:='[]'::jsonb; attention jsonb:='[]'::jsonb;
  leave_today jsonb:='[]'::jsonb; task_detail jsonb:='{}'::jsonb; missing_detail jsonb:='{}'::jsonb;
  pending_leave jsonb:='{}'::jsonb; compliance_pending int:=0; compliance_risk int:=0; performance_pending int:=0;
  can_leave boolean:=public.current_user_has_permission('crew_leave.view');
  can_attendance boolean:=public.current_user_has_permission('crew_attendance.view');
  can_tasks boolean:=public.current_user_has_permission('crew_operations.view');
  can_compliance boolean:=public.current_user_has_permission('employee_compliance.view');
  can_performance boolean:=public.current_user_has_permission('crew_performance.view');
begin
  if p_outlet_id is null or not public.current_user_has_permission('crew_dashboard.view') then raise exception using errcode='42501',message='Missing permission to view the Crew Dashboard.'; end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Crew Dashboard is outside your outlet scope.'; end if;

  with published as (select distinct entry.employee_id from public.duty_roster_published_entries entry where entry.outlet_id=p_outlet_id and entry.roster_date=d and entry.entry_type='working' and entry.publication_id=(select p.id from public.duty_roster_publications p where p.outlet_id=p_outlet_id and p.week_start_date<=d and p.week_end_date>=d order by p.revision desc,p.published_at desc limit 1)), checked_in as (select distinct employee_id from public.crew_attendance_records where outlet_id=p_outlet_id and timezone('Asia/Kuala_Lumpur',clock_in_at)::date=d) select count(*),count(*) filter(where employee_id in(select employee_id from checked_in)) into scheduled,present_count from published;
  if can_attendance then
    select count(*) into attendance_issues from public.crew_attendance_records where outlet_id=p_outlet_id and timezone('Asia/Kuala_Lumpur',clock_in_at)::date=d and (clock_in_location_exception or clock_out_location_exception);
    with published as (select distinct entry.employee_id from public.duty_roster_published_entries entry where entry.outlet_id=p_outlet_id and entry.roster_date=d and entry.entry_type='working' and entry.publication_id=(select p.id from public.duty_roster_publications p where p.outlet_id=p_outlet_id and p.week_start_date<=d and p.week_end_date>=d order by p.revision desc,p.published_at desc limit 1)), checked_in as (select distinct employee_id from public.crew_attendance_records where outlet_id=p_outlet_id and timezone('Asia/Kuala_Lumpur',clock_in_at)::date=d) select jsonb_build_object('name',e.full_name,'position',e.position) into missing_detail from published p join public.employees e on e.id=p.employee_id where not exists(select 1 from checked_in c where c.employee_id=p.employee_id) order by e.full_name limit 1;
  end if;

  if can_leave then
    select count(distinct r.employee_id),coalesce(jsonb_agg(jsonb_build_object('name',e.full_name,'type',r.leave_type) order by e.full_name),'[]'::jsonb) into leave_count,leave_today from public.crew_leave_requests r join public.employees e on e.id=r.employee_id where r.employment_outlet_id=p_outlet_id and r.status='approved' and d between r.start_date and r.end_date and e.is_active;
    select jsonb_build_object('name',e.full_name,'type',r.leave_type,'date',r.start_date) into pending_leave from public.crew_leave_requests r join public.employees e on e.id=r.employee_id where r.employment_outlet_id=p_outlet_id and r.status='pending' order by r.created_at limit 1;
    if pending_leave<>'{}'::jsonb then attention:=attention||jsonb_build_array(jsonb_build_object('key','leave_requests','priority','normal','title','1 leave request awaiting review','detail',concat_ws(' · ',pending_leave->>'type',to_char((pending_leave->>'date')::date,'DD Mon'),pending_leave->>'name'))); end if;
    select coalesce(jsonb_agg(jsonb_build_object('type','leave','name',e.full_name,'position',e.position,'date',r.start_date,'days_until',r.start_date-d) order by r.start_date,e.full_name),'[]'::jsonb) into upcoming from public.crew_leave_requests r join public.employees e on e.id=r.employee_id where r.employment_outlet_id=p_outlet_id and r.status='approved' and r.start_date>d and r.start_date<=d+7;
  end if;

  if can_tasks then
    select count(*),count(*) filter(where status in('completed','completed_with_exceptions')),count(*) filter(where status='overdue' or (status='not_started' and available_until<now())) into task_total,task_completed,task_overdue from public.crew_operation_instances where outlet_id=p_outlet_id and business_date=d;
    select jsonb_build_object('name',name,'due_at',available_until) into task_detail from public.crew_operation_instances where outlet_id=p_outlet_id and business_date=d and (status='overdue' or (status='not_started' and available_until<now())) order by available_until nulls last,name limit 1;
    if task_overdue>0 then attention:=attention||jsonb_build_array(jsonb_build_object('key','tasks','priority','urgent','title',format('%s task%s overdue',task_overdue,case when task_overdue=1 then '' else 's' end),'detail',coalesce(task_detail->>'name','Today''s task'))); end if;
  end if;
  if can_attendance then
    if scheduled>present_count then attention:=attention||jsonb_build_array(jsonb_build_object('key','missing_checkin','priority','urgent','title',(scheduled-present_count)||' Crew not yet checked in','detail',coalesce(concat_ws(' · ',missing_detail->>'name',missing_detail->>'position'),'Published roster is awaiting attendance'))); end if;
    if attendance_issues>0 then attention:=attention||jsonb_build_array(jsonb_build_object('key','attendance_exceptions','priority','normal','title',format('%s attendance issue%s',attendance_issues,case when attendance_issues=1 then '' else 's' end),'detail','Location evidence needs review.')); end if;
  end if;
  if can_compliance then
    with states as (select public.employee_compliance_current(e.id,r.id,d) s from public.employees e cross join public.employee_compliance_requirements r where public.crew_resolve_employee_outlet(e.id)=p_outlet_id and e.is_active and coalesce(e.employment_status,'active')='active' and r.is_active) select count(*) filter(where s->>'effective_status'='pending_verification'),count(*) filter(where s->>'effective_status' in('missing','expired','expiring_soon')) into compliance_pending,compliance_risk from states;
    if compliance_pending>0 then attention:=attention||jsonb_build_array(jsonb_build_object('key','compliance_review','priority','normal','title',format('%s compliance record%s need verification',compliance_pending,case when compliance_pending=1 then '' else 's' end),'detail','Employee documents are waiting for review.')); end if;
    if compliance_risk>0 then attention:=attention||jsonb_build_array(jsonb_build_object('key','compliance_status','priority','normal','title',format('%s compliance record%s need follow-up',compliance_risk,case when compliance_risk=1 then '' else 's' end),'detail','Documents are missing, expiring, or expired.')); end if;
  end if;
  if can_performance then select count(*) into performance_pending from public.crew_performance_results r where r.outlet_id=p_outlet_id and r.period_start=m and (r.components->'service'->>'status'<>'reviewed' or r.components->'conduct'->>'status'<>'reviewed'); if performance_pending>0 then attention:=attention||jsonb_build_array(jsonb_build_object('key','performance_reviews','priority','normal','title',performance_pending||' Performance reviews pending','detail',to_char(m,'FMMonth YYYY'))); end if; end if;
  select count(*) into access_issues from public.employees e left join public.crew_access ca on ca.employee_id=e.id where public.crew_resolve_employee_outlet(e.id)=p_outlet_id and e.is_active and coalesce(e.employment_status,'active')='active' and coalesce(ca.access_state,'not_enabled')<>'active';
  if access_issues>0 then attention:=attention||jsonb_build_array(jsonb_build_object('key','crew_access','priority','low','title',format('%s Crew access issue%s',access_issues,case when access_issues=1 then '' else 's' end),'detail','Crew mobile access needs setup or review.')); end if;
  with active as (select e.id,e.full_name,e.position,e.birthday from public.employees e where public.crew_resolve_employee_outlet(e.id)=p_outlet_id and e.is_active and coalesce(e.employment_status,'active')='active' and e.birthday is not null), events as (select id,full_name,position,case when make_date(extract(year from d)::int,extract(month from birthday)::int,extract(day from birthday)::int)<d then make_date(extract(year from d)::int+1,extract(month from birthday)::int,extract(day from birthday)::int) else make_date(extract(year from d)::int,extract(month from birthday)::int,extract(day from birthday)::int) end date from active) select coalesce(jsonb_agg(jsonb_build_object('type','birthday','name',full_name,'position',position,'date',date,'days_until',date-d) order by date,full_name),'[]'::jsonb) into birthdays from events where date<=d+7;
  return jsonb_build_object('business_date',d,'summary',jsonb_build_object('scheduled_today',scheduled,'present_today',present_count,'not_checked_in',greatest(scheduled-present_count,0),'attendance_issues',attendance_issues,'on_leave_today',leave_count,'leave_today',leave_today,'tasks_total',task_total,'tasks_completed',task_completed,'tasks_overdue',task_overdue),'attention',(select coalesce(jsonb_agg(x order by case x->>'priority' when 'urgent' then 1 when 'normal' then 2 else 3 end),'[]'::jsonb) from jsonb_array_elements(attention)x),'upcoming',(birthdays||upcoming));
end; $$;
revoke all on function public.crew_dashboard_admin_data(uuid) from public,anon,authenticated;
grant execute on function public.crew_dashboard_admin_data(uuid) to authenticated;
