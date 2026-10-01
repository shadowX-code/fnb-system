-- Snapshot each new event's decision basis; existing evidence remains unchanged.
alter table public.crew_attendance_records
  add column clock_in_geofence_latitude numeric(9,6),
  add column clock_in_geofence_longitude numeric(9,6),
  add column clock_in_geofence_radius_meters integer,
  add column clock_out_geofence_latitude numeric(9,6),
  add column clock_out_geofence_longitude numeric(9,6),
  add column clock_out_geofence_radius_meters integer;

alter table public.crew_attendance_records add constraint crew_attendance_geofence_basis_check check (
  ((clock_in_geofence_latitude is null and clock_in_geofence_longitude is null and clock_in_geofence_radius_meters is null) or
   (clock_in_geofence_latitude is not null and clock_in_geofence_longitude is not null and clock_in_geofence_radius_meters is not null and clock_in_geofence_latitude between -90 and 90 and clock_in_geofence_longitude between -180 and 180 and clock_in_geofence_radius_meters between 25 and 2000))
  and
  ((clock_out_geofence_latitude is null and clock_out_geofence_longitude is null and clock_out_geofence_radius_meters is null) or
   (clock_out_geofence_latitude is not null and clock_out_geofence_longitude is not null and clock_out_geofence_radius_meters is not null and clock_out_geofence_latitude between -90 and 90 and clock_out_geofence_longitude between -180 and 180 and clock_out_geofence_radius_meters between 25 and 2000))
);

-- Browser GPS must report accuracy no worse than half the radius, capped at 50 m.
create or replace function public.crew_attendance_context(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee_id uuid; v_outlet public.outlets%rowtype; v_schedule jsonb; v_outlet_id uuid; v_management boolean; v_open_shift boolean:=false;
begin
  v_employee_id:=public.crew_session_employee(p_token);
  select lower(btrim(coalesce(workplace,'')))='management' into v_management from public.employees where id=v_employee_id;
  v_schedule:=public.crew_roster_employee_day(v_employee_id,timezone('Asia/Kuala_Lumpur',now())::date);
  select a.outlet_id into v_outlet_id from public.crew_attendance_records a where a.employee_id=v_employee_id and a.status='open' order by a.clock_in_at desc limit 1;
  v_open_shift:=found;
  if not v_open_shift then
    v_outlet_id:=case when v_schedule is not null and coalesce(v_schedule->>'entry_type','working')='working' then (v_schedule->>'outlet_id')::uuid else null end;
  end if;
  if v_outlet_id is null and not v_management then
    select a.primary_outlet_id into v_outlet_id from public.crew_access a where a.employee_id=v_employee_id;
  end if;
  if v_outlet_id is null and v_management then
    return jsonb_build_object('outlet_id',null,'outlet_name',null,'location_enabled',false,
      'schedule',v_schedule,'shift_start',null,'shift_end',null,'scheduled_position',null,
      'scheduled_entry_type',v_schedule->>'entry_type','clock_eligible',false);
  end if;
  select o.* into v_outlet from public.outlets o where o.id=v_outlet_id;
  if v_outlet.id is null then raise exception using errcode='22023',message='Your Crew Access has no assigned outlet. Ask your manager to confirm your workplace.'; end if;
  if v_outlet.attendance_location_enabled and (v_outlet.attendance_latitude is null or v_outlet.attendance_longitude is null) then
    raise exception using errcode='22023',message='This outlet has location verification enabled but is not configured. Ask your manager to update Outlet settings.';
  end if;
  return jsonb_build_object('outlet_id',v_outlet.id,'outlet_name',v_outlet.name,'location_enabled',v_outlet.attendance_location_enabled,
    'latitude',v_outlet.attendance_latitude,'longitude',v_outlet.attendance_longitude,'radius_meters',v_outlet.attendance_radius_meters,
    'accuracy_limit_meters',case when v_outlet.attendance_location_enabled then least(v_outlet.attendance_radius_meters::numeric/2,50) else null end,
    'schedule',v_schedule,'shift_start',v_schedule->>'start_time','shift_end',v_schedule->>'end_time',
    'scheduled_position',v_schedule->>'position','scheduled_entry_type',v_schedule->>'entry_type',
    'clock_eligible',v_open_shift or not v_management or v_schedule->>'entry_type'='working');
end; $$;

create or replace function public.crew_clock(p_token text,p_action text,p_location jsonb default null,p_exception_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_employee_id uuid; v_record public.crew_attendance_records%rowtype; v_outlet public.outlets%rowtype; v_action text:=lower(btrim(p_action)); v_schedule jsonb; v_outlet_id uuid;
  v_lat numeric; v_lon numeric; v_accuracy numeric; v_distance numeric; v_has_location boolean:=false; v_verified boolean:=false; v_accuracy_ok boolean:=false; v_accuracy_limit numeric; v_exception boolean:=false; v_reason text:=nullif(left(btrim(coalesce(p_exception_reason,'')),280),'');
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
  v_accuracy_limit:=least(v_outlet.attendance_radius_meters::numeric/2,50);
  if p_location is not null then
    v_lat:=nullif(p_location->>'latitude','')::numeric; v_lon:=nullif(p_location->>'longitude','')::numeric; v_accuracy:=nullif(p_location->>'accuracy_meters','')::numeric;
    if v_lat is null or v_lon is null or v_lat not between -90 and 90 or v_lon not between -180 and 180 then raise exception using errcode='22023',message='The supplied location is invalid.'; end if;
    if v_accuracy is not null and (v_accuracy<0 or v_accuracy>100000) then raise exception using errcode='22023',message='The supplied location accuracy is invalid.'; end if;
    v_has_location:=true;
    if v_outlet.attendance_location_enabled then
      v_distance:=round(public.crew_haversine_meters(v_lat,v_lon,v_outlet.attendance_latitude,v_outlet.attendance_longitude),2);
      v_accuracy_ok:=v_accuracy is not null and v_accuracy<=v_accuracy_limit;
      v_verified:=v_distance<=v_outlet.attendance_radius_meters and v_accuracy_ok;
    end if;
  end if;
  if v_action='in' then
    select * into v_record from public.crew_attendance_records where employee_id=v_employee_id and status='open' for update;
    if found then raise exception using errcode='23505',message='You are already on shift.'; end if;
    if v_outlet.attendance_location_enabled and not v_verified then
      if v_reason is null then
        if v_has_location and v_distance>v_outlet.attendance_radius_meters then raise exception using errcode='22023',message=format('You are outside the outlet area (%s m away; allowed %s m). Choose an exception reason to continue.',v_distance,v_outlet.attendance_radius_meters); end if;
        if v_has_location and not v_accuracy_ok then raise exception using errcode='22023',message='Location accuracy is insufficient. Retry GPS or choose an exception reason to continue.'; end if;
        raise exception using errcode='22023',message='Location permission is required to verify this clock-in. Choose an exception reason to continue.';
      end if;
      v_exception:=true;
    end if;
    insert into public.crew_attendance_records(employee_id,outlet_id,clock_in_at,status,clock_in_latitude,clock_in_longitude,clock_in_accuracy_meters,clock_in_distance_meters,clock_in_location_verified,clock_in_location_exception,clock_in_exception_reason,clock_in_verification_method,clock_in_geofence_latitude,clock_in_geofence_longitude,clock_in_geofence_radius_meters,scheduled_roster_entry_id,scheduled_roster_publication_id,scheduled_start_at,scheduled_end_at,scheduled_published_at,scheduled_entry_type)
    values(v_employee_id,v_outlet.id,now(),'open',v_lat,v_lon,v_accuracy,v_distance,v_verified,v_exception,case when v_exception then v_reason else null end,'gps',
      case when v_outlet.attendance_location_enabled then v_outlet.attendance_latitude else null end,
      case when v_outlet.attendance_location_enabled then v_outlet.attendance_longitude else null end,
      case when v_outlet.attendance_location_enabled then v_outlet.attendance_radius_meters else null end,
      nullif(v_schedule->>'entry_id','')::uuid,nullif(v_schedule->>'publication_id','')::uuid,v_scheduled_start,v_scheduled_end,nullif(v_schedule->>'published_at','')::timestamptz,nullif(v_schedule->>'entry_type','')) returning * into v_record;
  elsif v_action='out' then
    if v_outlet.attendance_location_enabled and not v_verified then
      if v_reason is null then
        if v_has_location and v_distance>v_outlet.attendance_radius_meters then raise exception using errcode='22023',message=format('You are outside the outlet area (%s m away; allowed %s m). Choose an exception reason to clock out.',v_distance,v_outlet.attendance_radius_meters); end if;
        if v_has_location and not v_accuracy_ok then raise exception using errcode='22023',message='Location accuracy is insufficient. Retry GPS or choose an exception reason to clock out.'; end if;
        raise exception using errcode='22023',message='Location could not be verified. Choose an exception reason to clock out.';
      end if;
      v_exception:=true;
    end if;
    update public.crew_attendance_records set clock_out_at=now(),clock_out_source='mobile',status='completed',clock_out_latitude=v_lat,clock_out_longitude=v_lon,clock_out_accuracy_meters=v_accuracy,clock_out_distance_meters=v_distance,clock_out_location_verified=v_verified,clock_out_location_exception=v_exception,clock_out_exception_reason=case when v_exception then v_reason else null end,clock_out_verification_method='gps',
      clock_out_geofence_latitude=case when v_outlet.attendance_location_enabled then v_outlet.attendance_latitude else null end,
      clock_out_geofence_longitude=case when v_outlet.attendance_location_enabled then v_outlet.attendance_longitude else null end,
      clock_out_geofence_radius_meters=case when v_outlet.attendance_location_enabled then v_outlet.attendance_radius_meters else null end,updated_at=now() where id=v_record.id returning * into v_record;
  else raise exception using errcode='22023',message='Unsupported attendance action.'; end if;
  perform public.crew_refresh_performance(v_employee_id, timezone('Asia/Kuala_Lumpur', v_record.clock_in_at)::date);
  return jsonb_build_object('record',to_jsonb(v_record),'outlet',jsonb_build_object('id',v_outlet.id,'name',v_outlet.name,'location_enabled',v_outlet.attendance_location_enabled,'radius_meters',v_outlet.attendance_radius_meters),'schedule',v_schedule);
end; $$;

revoke all on function public.crew_attendance_context(text) from public,anon,authenticated;
grant execute on function public.crew_attendance_context(text) to anon,authenticated;
revoke all on function public.crew_clock(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.crew_clock(text,text,jsonb,text) to anon,authenticated;
