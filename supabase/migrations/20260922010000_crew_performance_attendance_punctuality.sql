-- Attendance Performance v2: completion and punctuality are distinct server-owned
-- evidence streams. Published roster history remains the authority; a clock-in stores
-- the schedule it saw so later roster revisions cannot silently rewrite the evidence.

alter table public.crew_attendance_records
  add column if not exists scheduled_roster_entry_id uuid,
  add column if not exists scheduled_roster_publication_id uuid,
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists scheduled_published_at timestamptz,
  add column if not exists scheduled_entry_type text;

create index if not exists crew_attendance_scheduled_start_idx
  on public.crew_attendance_records(employee_id, scheduled_start_at desc)
  where scheduled_start_at is not null;

create table if not exists public.crew_attendance_performance_exceptions (
  id uuid primary key default gen_random_uuid(),
  attendance_record_id uuid references public.crew_attendance_records(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  outlet_id uuid references public.outlets(id) on delete set null,
  business_date date not null,
  exception_type text not null check (exception_type in ('approved_correction','system_outage')),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete restrict,
  revoke_reason text check (revoke_reason is null or char_length(btrim(revoke_reason)) between 3 and 1000),
  constraint crew_attendance_performance_exception_revocation_check check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by is not null and revoke_reason is not null)
  )
);
create unique index if not exists crew_attendance_performance_exception_active_idx
  on public.crew_attendance_performance_exceptions(employee_id, business_date, exception_type)
  where revoked_at is null;
alter table public.crew_attendance_performance_exceptions enable row level security;
revoke all on table public.crew_attendance_performance_exceptions from public, anon, authenticated;

create table if not exists public.crew_attendance_performance_exception_audit (
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references public.crew_attendance_performance_exceptions(id) on delete restrict,
  action text not null check (action in ('approved','revoked')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);
alter table public.crew_attendance_performance_exception_audit enable row level security;
revoke all on table public.crew_attendance_performance_exception_audit from public, anon, authenticated;

create or replace function public.crew_attendance_record_schedule(p_record_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(
    case when a.scheduled_start_at is not null then jsonb_strip_nulls(jsonb_build_object(
      'entry_id', a.scheduled_roster_entry_id,
      'publication_id', a.scheduled_roster_publication_id,
      'date', timezone('Asia/Kuala_Lumpur', a.clock_in_at)::date,
      'outlet_id', a.outlet_id,
      'start_time', timezone('Asia/Kuala_Lumpur', a.scheduled_start_at)::time,
      'end_time', timezone('Asia/Kuala_Lumpur', a.scheduled_end_at)::time,
      'entry_type', coalesce(a.scheduled_entry_type, 'working'),
      'published_at', a.scheduled_published_at,
      'source', 'clock_in_snapshot'
    )) else (
      select jsonb_build_object(
        'entry_id', pe.id,
        'publication_id', pe.publication_id,
        'date', pe.roster_date,
        'outlet_id', pe.outlet_id,
        'outlet_name', pe.outlet_name_snapshot,
        'start_time', pe.start_time,
        'end_time', pe.end_time,
        'entry_type', pe.entry_type,
        'template_code', pe.template_code,
        'template_name', pe.template_name,
        'position', pe.position_snapshot,
        'group', pe.group_snapshot,
        'published_at', pe.published_at,
        'source', 'published_history'
      )
      from public.duty_roster_published_entries pe
      join public.duty_roster_publications publication on publication.id = pe.publication_id
      where pe.employee_id = a.employee_id
        and pe.roster_date = timezone('Asia/Kuala_Lumpur', a.clock_in_at)::date
        and publication.published_at <= a.clock_in_at
      order by publication.published_at desc, pe.published_at desc
      limit 1
    ) end,
    'null'::jsonb
  )
  from public.crew_attendance_records a
  where a.id = p_record_id
$$;
revoke all on function public.crew_attendance_record_schedule(uuid) from public, anon, authenticated;

create or replace function public.crew_clock(p_token text,p_action text,p_location jsonb default null,p_exception_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_employee_id uuid; v_record public.crew_attendance_records%rowtype; v_outlet public.outlets%rowtype; v_action text:=lower(btrim(p_action)); v_schedule jsonb; v_outlet_id uuid;
  v_lat numeric; v_lon numeric; v_accuracy numeric; v_distance numeric; v_has_location boolean:=false; v_verified boolean:=false; v_exception boolean:=false; v_reason text:=nullif(left(btrim(coalesce(p_exception_reason,'')),280),'');
  v_scheduled_start timestamptz; v_scheduled_end timestamptz;
begin
  v_employee_id:=public.crew_session_employee(p_token);
  if v_action='out' then
    select * into v_record from public.crew_attendance_records where employee_id=v_employee_id and status='open' for update;
    if not found then raise exception using errcode='22023',message='There is no open shift to clock out.'; end if;
    v_outlet_id:=v_record.outlet_id;
  else
    v_schedule:=public.crew_roster_employee_day(v_employee_id,timezone('Asia/Kuala_Lumpur',now())::date);
    v_outlet_id:=case when v_schedule is not null and coalesce(v_schedule->>'entry_type','working')='working' then (v_schedule->>'outlet_id')::uuid else null end;
    if v_outlet_id is null then select a.primary_outlet_id into v_outlet_id from public.crew_access a where a.employee_id=v_employee_id; end if;
    if v_schedule is not null and v_schedule->>'entry_type'='working' and v_schedule->>'start_time' is not null then
      v_scheduled_start:=(((v_schedule->>'date')::date + (v_schedule->>'start_time')::time) at time zone 'Asia/Kuala_Lumpur');
      if v_schedule->>'end_time' is not null then
        v_scheduled_end:=(((v_schedule->>'date')::date + (v_schedule->>'end_time')::time) at time zone 'Asia/Kuala_Lumpur');
        if v_scheduled_end <= v_scheduled_start then v_scheduled_end:=v_scheduled_end + interval '1 day'; end if;
      end if;
    end if;
  end if;
  select o.* into v_outlet from public.outlets o where o.id=v_outlet_id;
  if v_outlet.id is null then raise exception using errcode='22023',message='Your Crew Access has no assigned outlet. Ask your manager to confirm your workplace.'; end if;
  if v_outlet.attendance_location_enabled and (v_outlet.attendance_latitude is null or v_outlet.attendance_longitude is null) then raise exception using errcode='22023',message='This outlet has location verification enabled but is not configured. Ask your manager to update Outlet settings.'; end if;
  if p_location is not null then
    v_lat:=nullif(p_location->>'latitude','')::numeric; v_lon:=nullif(p_location->>'longitude','')::numeric; v_accuracy:=nullif(p_location->>'accuracy_meters','')::numeric;
    if v_lat is null or v_lon is null or v_lat not between -90 and 90 or v_lon not between -180 and 180 then raise exception using errcode='22023',message='The supplied location is invalid.'; end if;
    if v_accuracy is not null and (v_accuracy<0 or v_accuracy>100000) then raise exception using errcode='22023',message='The supplied location accuracy is invalid.'; end if;
    v_has_location:=true;
    if v_outlet.attendance_location_enabled then v_distance:=round(public.crew_haversine_meters(v_lat,v_lon,v_outlet.attendance_latitude,v_outlet.attendance_longitude),2); v_verified:=v_distance<=v_outlet.attendance_radius_meters; end if;
  end if;
  if v_action='in' then
    select * into v_record from public.crew_attendance_records where employee_id=v_employee_id and status='open' for update;
    if found then raise exception using errcode='23505',message='You are already on shift.'; end if;
    if v_outlet.attendance_location_enabled and not v_verified then
      if v_reason is null then
        if v_has_location then raise exception using errcode='22023',message=format('You are outside the outlet area (%s m away; allowed %s m). Choose an exception reason to continue.',v_distance,v_outlet.attendance_radius_meters); end if;
        raise exception using errcode='22023',message='Location permission is required to verify this clock-in. Choose an exception reason to continue.';
      end if;
      v_exception:=true;
    end if;
    insert into public.crew_attendance_records(employee_id,outlet_id,clock_in_at,status,clock_in_latitude,clock_in_longitude,clock_in_accuracy_meters,clock_in_distance_meters,clock_in_location_verified,clock_in_location_exception,clock_in_exception_reason,clock_in_verification_method,scheduled_roster_entry_id,scheduled_roster_publication_id,scheduled_start_at,scheduled_end_at,scheduled_published_at,scheduled_entry_type)
    values(v_employee_id,v_outlet.id,now(),'open',v_lat,v_lon,v_accuracy,v_distance,v_verified,v_exception,case when v_exception then v_reason else null end,'gps',nullif(v_schedule->>'entry_id','')::uuid,nullif(v_schedule->>'publication_id','')::uuid,v_scheduled_start,v_scheduled_end,nullif(v_schedule->>'published_at','')::timestamptz,nullif(v_schedule->>'entry_type','')) returning * into v_record;
  elsif v_action='out' then
    if v_outlet.attendance_location_enabled and not v_verified then
      if v_reason is null then
        if v_has_location then raise exception using errcode='22023',message=format('You are outside the outlet area (%s m away; allowed %s m). Choose an exception reason to clock out.',v_distance,v_outlet.attendance_radius_meters); end if;
        raise exception using errcode='22023',message='Location could not be verified. Choose an exception reason to clock out.';
      end if;
      v_exception:=true;
    end if;
    update public.crew_attendance_records set clock_out_at=now(),clock_out_source='mobile',status='completed',clock_out_latitude=v_lat,clock_out_longitude=v_lon,clock_out_accuracy_meters=v_accuracy,clock_out_distance_meters=v_distance,clock_out_location_verified=v_verified,clock_out_location_exception=v_exception,clock_out_exception_reason=case when v_exception then v_reason else null end,clock_out_verification_method='gps',updated_at=now() where id=v_record.id returning * into v_record;
  else raise exception using errcode='22023',message='Unsupported attendance action.'; end if;
  perform public.crew_refresh_performance(v_employee_id, timezone('Asia/Kuala_Lumpur', v_record.clock_in_at)::date);
  return jsonb_build_object('record',to_jsonb(v_record),'outlet',jsonb_build_object('id',v_outlet.id,'name',v_outlet.name,'location_enabled',v_outlet.attendance_location_enabled,'radius_meters',v_outlet.attendance_radius_meters),'schedule',v_schedule);
end; $$;
revoke all on function public.crew_clock(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.crew_clock(text,text,jsonb,text) to anon,authenticated;

create or replace function public.crew_attendance_performance_exception_update(p_attendance_record_id uuid,p_action text,p_exception_type text default null,p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_record public.crew_attendance_records%rowtype; v_exception public.crew_attendance_performance_exceptions%rowtype; v_action text:=lower(btrim(p_action)); v_reason text:=btrim(coalesce(p_reason,'')); v_period date;
begin
  if not public.current_user_has_permission('crew_attendance.manage') then raise exception using errcode='42501',message='Attendance management permission is required.'; end if;
  select * into v_record from public.crew_attendance_records where id=p_attendance_record_id for update;
  if not found or not public.current_user_can_access_outlet(v_record.outlet_id) then raise exception using errcode='42501',message='Attendance is outside your outlet scope.'; end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 1000 then raise exception using errcode='22023',message='A meaningful exception reason is required.'; end if;
  if v_action='approve' then
    if p_exception_type not in ('approved_correction','system_outage') then raise exception using errcode='22023',message='Unsupported attendance exception.'; end if;
    insert into public.crew_attendance_performance_exceptions(attendance_record_id,employee_id,outlet_id,business_date,exception_type,reason,approved_by)
    values(v_record.id,v_record.employee_id,v_record.outlet_id,timezone('Asia/Kuala_Lumpur',v_record.clock_in_at)::date,p_exception_type,v_reason,auth.uid()) returning * into v_exception;
    insert into public.crew_attendance_performance_exception_audit(exception_id,action,actor_id,detail) values(v_exception.id,'approved',auth.uid(),jsonb_build_object('reason',v_reason,'exception_type',p_exception_type));
  elsif v_action='revoke' then
    select * into v_exception from public.crew_attendance_performance_exceptions where attendance_record_id=v_record.id and revoked_at is null order by approved_at desc limit 1 for update;
    if not found then raise exception using errcode='22023',message='There is no active attendance exception to revoke.'; end if;
    update public.crew_attendance_performance_exceptions set revoked_at=now(),revoked_by=auth.uid(),revoke_reason=v_reason where id=v_exception.id returning * into v_exception;
    insert into public.crew_attendance_performance_exception_audit(exception_id,action,actor_id,detail) values(v_exception.id,'revoked',auth.uid(),jsonb_build_object('reason',v_reason));
  else raise exception using errcode='22023',message='Unsupported attendance exception action.'; end if;
  v_period:=date_trunc('month',timezone('Asia/Kuala_Lumpur',v_record.clock_in_at))::date;
  perform public.crew_refresh_performance(v_record.employee_id,v_period);
  return jsonb_build_object('id',v_exception.id,'action',v_action,'exception_type',v_exception.exception_type,'reason',v_exception.reason,'approved_at',v_exception.approved_at,'revoked_at',v_exception.revoked_at);
end; $$;
revoke all on function public.crew_attendance_performance_exception_update(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.crew_attendance_performance_exception_update(uuid,text,text,text) to authenticated;

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
    from days d left join latest_published lp using(business_date)
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
