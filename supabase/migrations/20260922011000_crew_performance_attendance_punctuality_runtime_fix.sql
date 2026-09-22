-- Correct the date join in the v2 evidence CTE. The original migration is
-- retained as applied history; this forward replacement restores the authority.
create or replace function public.crew_performance_attendance_component(p_employee_id uuid,p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_period date:=date_trunc('month',p_period)::date; v_expected integer:=0; v_completed integer:=0; v_punctual_records integer:=0;
  v_minor integer:=0; v_late integer:=0; v_severe integer:=0; v_excluded_leave integer:=0; v_excluded_late_roster integer:=0; v_exceptions integer:=0;
  v_completeness numeric:=12; v_punctuality numeric:=12; v_score numeric; v_location_exceptions integer:=0;
begin
  with days as (
    select generate_series(v_period,v_period+interval '1 month'-interval '1 day',interval '1 day')::date business_date
  ), latest_published as (
    select distinct on (pe.roster_date) pe.roster_date,pe.start_time,pe.end_time,pe.entry_type,pe.published_at
    from public.duty_roster_published_entries pe join public.duty_roster_publications publication on publication.id=pe.publication_id
    where pe.employee_id=p_employee_id and pe.roster_date>=v_period and pe.roster_date<v_period+interval '1 month'
    order by pe.roster_date,publication.published_at desc,pe.published_at desc
  ), scheduled as (
    select d.business_date,lp.start_time,lp.end_time,lp.entry_type,lp.published_at,
      ((d.business_date+lp.start_time) at time zone 'Asia/Kuala_Lumpur') scheduled_start,
      case when lp.end_time is null then null when lp.end_time>lp.start_time then ((d.business_date+lp.end_time) at time zone 'Asia/Kuala_Lumpur') else ((d.business_date+lp.end_time+1) at time zone 'Asia/Kuala_Lumpur') end scheduled_end
    from days d left join latest_published lp on lp.roster_date=d.business_date
  ), attendance as (
    select timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date business_date,min(a.clock_in_at) clock_in_at,
      bool_or(a.status='completed' and a.clock_out_at is not null) completed,
      min(a.scheduled_start_at) filter(where a.scheduled_start_at is not null) snap_start,
      min(a.scheduled_published_at) filter(where a.scheduled_published_at is not null) snap_published
    from public.crew_attendance_records a where a.employee_id=p_employee_id and a.clock_in_at>=v_period and a.clock_in_at<v_period+interval '1 month'
    group by 1
  ), active_exceptions as (
    select distinct business_date from public.crew_attendance_performance_exceptions where employee_id=p_employee_id and business_date>=v_period and business_date<v_period+interval '1 month' and revoked_at is null
  ), eligible as (
    select s.*,a.clock_in_at,a.completed,coalesce(a.snap_start,s.scheduled_start) score_start,coalesce(a.snap_published,s.published_at) score_published,
      exists(select 1 from active_exceptions x where x.business_date=s.business_date) has_exception
    from scheduled s left join attendance a using(business_date)
    where s.entry_type='working' and s.start_time is not null and coalesce(s.scheduled_end,s.scheduled_start+interval '12 hours') < now() and s.published_at<=s.scheduled_start
  )
  select count(*) filter(where not has_exception),count(*) filter(where not has_exception and completed),count(*) filter(where not has_exception and completed and score_start is not null and score_published<=score_start),
    count(*) filter(where not has_exception and completed and score_start is not null and score_published<=score_start and extract(epoch from(clock_in_at-score_start))/60 between 11 and 20),
    count(*) filter(where not has_exception and completed and score_start is not null and score_published<=score_start and extract(epoch from(clock_in_at-score_start))/60 between 21 and 45),
    count(*) filter(where not has_exception and completed and score_start is not null and score_published<=score_start and extract(epoch from(clock_in_at-score_start))/60>45),
    count(*) filter(where entry_type is not null and entry_type<>'working'),count(*) filter(where published_at>scheduled_start),count(*) filter(where has_exception)
  into v_expected,v_completed,v_punctual_records,v_minor,v_late,v_severe,v_excluded_leave,v_excluded_late_roster,v_exceptions
  from eligible;
  select count(*) into v_location_exceptions from public.crew_attendance_records a where a.employee_id=p_employee_id and a.clock_in_at>=v_period and a.clock_in_at<v_period+interval '1 month' and (coalesce(a.clock_in_location_exception,false) or coalesce(a.clock_out_location_exception,false));
  if v_expected>0 then v_completeness:=round(15*v_completed::numeric/v_expected,2); end if;
  if v_punctual_records>0 then v_punctuality:=round(greatest(0,15-v_minor*0.5-v_late*1.5-v_severe*3),2); end if;
  v_score:=round(v_completeness+v_punctuality,2);
  return jsonb_build_object('score',v_score,'max_score',30,'status',case when v_expected=0 and v_punctual_records=0 then 'insufficient_data' else 'calculated' end,
    'explanation',case when v_expected=0 then 'No completed eligible published shifts this month; Attendance uses the neutral 12/15 completeness baseline.' else 'Attendance combines completed scheduled shifts and clock-in punctuality against the published roster.' end,
    'evidence',jsonb_build_object('scheduled_completed_shifts',v_expected,'completed_scheduled_shifts',v_completed,'punctuality_records',v_punctual_records,'completeness_score',v_completeness,'punctuality_score',v_punctuality,'grace_minutes',10,'late_minor',v_minor,'late',v_late,'late_severe',v_severe,'approved_exceptions',v_exceptions,'late_roster_excluded',v_excluded_late_roster,'location_exceptions',v_location_exceptions),'calculation_version','performance-attendance-v2');
end; $$;
revoke all on function public.crew_performance_attendance_component(uuid,date) from public,anon,authenticated;
