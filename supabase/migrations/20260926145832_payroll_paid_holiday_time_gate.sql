-- Only a published Company Paid Holiday selection classifies payroll time as PH.
-- Unselected gazetted days remain ordinary work; missing policy/geography fails
-- closed on potentially applicable holiday dates. No source records are changed.
CREATE OR REPLACE FUNCTION public.payroll_time_evidence_base(p_employee_id uuid, p_work_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_employee public.employees%rowtype;
  v_roster public.duty_roster_published_entries%rowtype;
  v_attendance public.crew_attendance_records%rowtype;
  v_leave public.crew_approved_leaves%rowtype;
  v_holiday public.payroll_public_holidays%rowtype;
  v_paid_holiday jsonb;
  v_comp public.payroll_compensation_versions%rowtype;
  v_profile_id uuid;
  v_attendance_count integer;
  v_roster_start timestamptz;
  v_roster_end timestamptz;
  v_scheduled integer;
  v_actual integer;
  v_proposed integer;
  v_extra integer := 0;
  v_issues text[] := '{}';
  v_class text := 'regular';
  v_payload jsonb;
begin
  select * into v_employee from public.employees where id=p_employee_id;
  select id into v_profile_id from public.payroll_profiles where employee_id=p_employee_id;
  if v_employee.id is null or v_profile_id is null or p_work_date is null then
    raise exception using errcode='22023',message='Employee Payroll Profile and work date are required.';
  end if;
  select * into v_comp from public.payroll_compensation_versions
    where profile_id=v_profile_id and effective_from<=p_work_date
    order by effective_from desc limit 1;
  if v_comp.id is null then return null; end if;
  -- Attendance pins the published revision seen at clock-in. A later roster
  -- publication must not silently replace that historical schedule evidence.
  select r.* into v_roster from public.duty_roster_published_entries r
    join public.crew_attendance_records a on a.scheduled_roster_entry_id=r.id
    where r.employee_id=p_employee_id and r.roster_date=p_work_date
      and a.employee_id=p_employee_id
    order by a.clock_in_at limit 1;
  if v_roster.id is null then
    select r.* into v_roster from public.duty_roster_published_entries r
      join public.duty_roster_publications pub on pub.id=r.publication_id
      where r.employee_id=p_employee_id and r.roster_date=p_work_date
        and not exists(select 1 from public.duty_roster_publications newer
          where newer.outlet_id=pub.outlet_id and newer.week_start_date=pub.week_start_date
            and newer.revision>pub.revision)
      order by pub.revision desc,pub.published_at desc limit 1;
  end if;
  select count(*) into v_attendance_count from public.crew_attendance_records a
    where a.employee_id=p_employee_id and
      (timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date=p_work_date
       or a.scheduled_roster_entry_id=v_roster.id);
  select * into v_attendance from public.crew_attendance_records a
    where a.employee_id=p_employee_id and
      (timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date=p_work_date
       or a.scheduled_roster_entry_id=v_roster.id)
    order by a.clock_in_at limit 1;
  select * into v_leave from public.crew_approved_leaves
    where employee_id=p_employee_id and p_work_date between start_date and end_date
    order by approved_at desc limit 1;
  v_paid_holiday:=public.payroll_paid_holiday_resolve(v_comp.legal_entity_id,
    coalesce(v_roster.outlet_id,v_attendance.outlet_id,v_leave.employment_outlet_id),p_work_date);
  if v_paid_holiday->>'status'='paid_holiday' then
    select * into v_holiday from public.payroll_public_holidays
      where id=(v_paid_holiday->'holidays'->0->>'holiday_id')::uuid;
  elsif v_paid_holiday->>'status'='geography_required' then
    v_issues:=array_append(v_issues,'paid_holiday_geography_required');
  elsif v_paid_holiday->>'status'='policy_required' and exists(
    select 1 from public.payroll_public_holidays h where h.is_active and h.holiday_date=p_work_date
      and (h.legal_entity_id is null or h.legal_entity_id=v_comp.legal_entity_id)
      and (h.scope in ('national','state') or h.outlet_id=coalesce(v_roster.outlet_id,v_attendance.outlet_id))) then
    v_issues:=array_append(v_issues,'paid_holiday_policy_required');
  end if;
  if v_roster.id is null and v_attendance.id is null and v_leave.id is null then return null; end if;

  if v_roster.id is not null and v_roster.entry_type='working'
     and v_roster.start_time is not null and v_roster.end_time is not null then
    v_roster_start := (p_work_date + v_roster.start_time) at time zone 'Asia/Kuala_Lumpur';
    v_roster_end := ((p_work_date + v_roster.end_time)
      + case when v_roster.end_time<=v_roster.start_time then interval '1 day' else interval '0 day' end)
      at time zone 'Asia/Kuala_Lumpur';
    v_scheduled := greatest(0,floor(extract(epoch from (v_roster_end-v_roster_start))/60)::integer-v_roster.break_minutes);
  end if;
  if v_roster.id is not null and v_roster.entry_type<>'working'
    and v_attendance.id is null and v_leave.id is null then return null; end if;
  if v_roster_end is not null and v_attendance.id is null
    and v_roster_end>now() then return null; end if;
  if v_attendance.id is not null and v_attendance.clock_out_at is not null then
    v_actual := greatest(0,floor(extract(epoch from (v_attendance.clock_out_at-v_attendance.clock_in_at))/60)::integer);
  end if;

  if v_leave.id is not null then
    v_class := case when v_leave.leave_type='unpaid' then 'non_payable' else 'leave' end;
    if v_attendance.id is not null then v_issues := array_append(v_issues,'leave_conflict'); end if;
    if v_leave.leave_type<>'unpaid' then v_issues := array_append(v_issues,'paid_leave_basis'); end if;
  elsif v_holiday.id is not null then
    v_class := 'public_holiday';
    v_issues := array_append(v_issues,'public_holiday_review');
  elsif v_roster.id is not null and v_roster.entry_type<>'working' and v_attendance.id is not null then
    v_class := 'rest_day';
    v_issues := array_append(v_issues,'rest_day_work');
  elsif v_roster.id is null and v_attendance.id is not null then
    v_issues := array_append(v_issues,'unscheduled_work');
  end if;
  if v_roster.id is not null and v_attendance.id is not null
    and v_roster.outlet_id is distinct from v_attendance.outlet_id then
    v_issues := array_append(v_issues,'outlet_mismatch');
  end if;
  if v_attendance_count>1 then v_issues := array_append(v_issues,'overlapping_or_multiple_attendance'); end if;
  if v_attendance.id is not null and v_attendance.clock_in_at is null then
    v_issues := array_append(v_issues,'missing_clock_in');
  end if;
  if v_roster.id is not null and v_roster.entry_type='working'
    and v_attendance.id is null and (v_roster_end is null or v_roster_end<now()) then
    v_issues := array_append(v_issues,'missing_punch');
  end if;
  if v_roster.id is not null and v_roster.entry_type='working' and v_roster_start is null then
    v_issues := array_append(v_issues,'invalid_published_shift');
  end if;
  if v_attendance.id is not null and v_attendance.clock_out_at is null then
    v_issues := array_append(v_issues,'missing_clock_out');
  end if;
  -- Calculate overlapping eligible elapsed minutes, then remove the rostered
  -- unpaid break. This is a proposal, not a claim that the break was observed.
  if v_roster_start is not null and v_attendance.id is not null and v_attendance.clock_out_at is not null then
    v_proposed := greatest(0,floor(extract(epoch from
      (least(v_roster_end,v_attendance.clock_out_at)-greatest(v_roster_start,v_attendance.clock_in_at)))/60)::integer
      -v_roster.break_minutes);
    if v_attendance.clock_in_at>v_roster_start then v_issues := array_append(v_issues,'late_arrival'); end if;
    if v_attendance.clock_out_at<v_roster_end then v_issues := array_append(v_issues,'early_departure'); end if;
    v_extra := greatest(0,floor(extract(epoch from (v_attendance.clock_out_at-v_roster_end))/60)::integer);
    if v_extra>10 then v_issues := array_append(v_issues,'extra_time'); end if;
  elsif v_attendance.id is not null and v_actual is not null then
    v_proposed := null; -- No published schedule/break basis: reviewer must decide.
  end if;
  if v_roster_start is not null and v_roster.break_minutes>=floor(extract(epoch from (v_roster_end-v_roster_start))/60)::integer then
    v_issues := array_append(v_issues,'uncertain_break');
  end if;
  if v_class='non_payable' and v_attendance.id is null then v_proposed := 0; end if;
  v_payload := jsonb_build_object(
    'employee_id',p_employee_id,'profile_id',v_profile_id,'work_date',p_work_date,
    'compensation_version_id',v_comp.id,'pay_basis',v_comp.pay_basis,
    'legal_entity_id',v_comp.legal_entity_id,'outlet_id',coalesce(v_roster.outlet_id,v_attendance.outlet_id,v_leave.employment_outlet_id),
    'roster_entry_id',v_roster.id,'roster_publication_id',v_roster.publication_id,
    'roster_entry_type',v_roster.entry_type,'scheduled_start_at',v_roster_start,
    'scheduled_end_at',v_roster_end,'roster_break_minutes',v_roster.break_minutes,
    'attendance_id',v_attendance.id,'attendance_count',v_attendance_count,
    'clock_in_at',v_attendance.clock_in_at,'clock_out_at',v_attendance.clock_out_at,
    'leave_id',v_leave.id,'leave_type',v_leave.leave_type,'holiday_id',v_holiday.id,
    'scheduled_minutes',v_scheduled,'actual_minutes',v_actual,
    'proposed_minutes',v_proposed,'extra_candidate_minutes',v_extra,
    'classification',v_class,'issue_codes',to_jsonb(v_issues),
    'calculation_version','payable-time-v1');
  if v_holiday.id is not null or v_paid_holiday->>'status'='geography_required'
    or 'paid_holiday_policy_required'=any(v_issues)
    or exists(select 1 from public.payroll_public_holidays h where h.is_active and h.holiday_date=p_work_date
      and (h.scope='national' or (h.scope='state' and h.state_code=v_paid_holiday->>'outlet_state_code'))) then
    v_payload:=v_payload||jsonb_build_object('paid_holiday_policy',v_paid_holiday);
  end if;
  return v_payload || jsonb_build_object('source_fingerprint',md5(v_payload::text));
end; $function$;


create or replace function public.payroll_time_evidence_geo(p_employee_id uuid,p_work_date date)
returns jsonb language sql stable security definer set search_path=public as $$
  select public.payroll_time_evidence_base(p_employee_id,p_work_date);
$$;
revoke all on function public.payroll_time_evidence_base(uuid,date),
  public.payroll_time_evidence_geo(uuid,date) from public,anon,authenticated;
