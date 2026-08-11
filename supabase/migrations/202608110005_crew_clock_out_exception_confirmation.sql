-- Crew Foundation Phase A.1: Clock-out exceptions require explicit acknowledgement.
-- A location exception may be recorded only when the Crew client supplies a reason.

create or replace function public.crew_clock(p_token text, p_action text, p_location jsonb default null, p_exception_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid; v_record public.crew_attendance_records%rowtype; v_outlet public.outlets%rowtype; v_action text := lower(btrim(p_action));
  v_lat numeric; v_lon numeric; v_accuracy numeric; v_distance numeric; v_has_location boolean := false; v_verified boolean := false; v_exception boolean := false; v_reason text := nullif(left(btrim(coalesce(p_exception_reason, '')), 280), '');
begin
  v_employee_id := public.crew_session_employee(p_token);
  select o.* into v_outlet from public.crew_access a left join public.outlets o on o.id = a.primary_outlet_id where a.employee_id = v_employee_id;
  if v_outlet.id is null then raise exception using errcode = '22023', message = 'Your Crew Access has no assigned outlet. Ask your manager to confirm your workplace.'; end if;
  if v_outlet.attendance_location_enabled and (v_outlet.attendance_latitude is null or v_outlet.attendance_longitude is null) then
    raise exception using errcode = '22023', message = 'This outlet has location verification enabled but is not configured. Ask your manager to update Outlet settings.';
  end if;
  if p_location is not null then
    v_lat := nullif(p_location->>'latitude', '')::numeric; v_lon := nullif(p_location->>'longitude', '')::numeric; v_accuracy := nullif(p_location->>'accuracy_meters', '')::numeric;
    if v_lat is null or v_lon is null or v_lat not between -90 and 90 or v_lon not between -180 and 180 then raise exception using errcode = '22023', message = 'The supplied location is invalid.'; end if;
    if v_accuracy is not null and (v_accuracy < 0 or v_accuracy > 100000) then raise exception using errcode = '22023', message = 'The supplied location accuracy is invalid.'; end if;
    v_has_location := true;
    if v_outlet.attendance_location_enabled then v_distance := round(public.crew_haversine_meters(v_lat, v_lon, v_outlet.attendance_latitude, v_outlet.attendance_longitude), 2); v_verified := v_distance <= v_outlet.attendance_radius_meters; end if;
  end if;
  if v_action = 'in' then
    select * into v_record from public.crew_attendance_records where employee_id = v_employee_id and status = 'open' for update;
    if found then raise exception using errcode = '23505', message = 'You are already on shift.'; end if;
    if v_outlet.attendance_location_enabled and not v_verified then
      if v_reason is null then
        if v_has_location then raise exception using errcode = '22023', message = format('You are outside the outlet area (%s m away; allowed %s m). Choose an exception reason to continue.', v_distance, v_outlet.attendance_radius_meters); end if;
        raise exception using errcode = '22023', message = 'Location permission is required to verify this clock-in. Choose an exception reason to continue.';
      end if;
      v_exception := true;
    end if;
    insert into public.crew_attendance_records(employee_id, outlet_id, clock_in_at, status, clock_in_latitude, clock_in_longitude, clock_in_accuracy_meters, clock_in_distance_meters, clock_in_location_verified, clock_in_location_exception, clock_in_exception_reason, clock_in_verification_method)
    values(v_employee_id, v_outlet.id, now(), 'open', v_lat, v_lon, v_accuracy, v_distance, v_verified, v_exception, case when v_exception then v_reason else null end, 'gps') returning * into v_record;
  elsif v_action = 'out' then
    select * into v_record from public.crew_attendance_records where employee_id = v_employee_id and status = 'open' for update;
    if not found then raise exception using errcode = '22023', message = 'There is no open shift to clock out.'; end if;
    if v_outlet.attendance_location_enabled and not v_verified then
      if v_reason is null then
        if v_has_location then raise exception using errcode = '22023', message = format('You are outside the outlet area (%s m away; allowed %s m). Choose an exception reason to clock out.', v_distance, v_outlet.attendance_radius_meters); end if;
        raise exception using errcode = '22023', message = 'Location could not be verified. Choose an exception reason to clock out.';
      end if;
      v_exception := true;
    end if;
    update public.crew_attendance_records set clock_out_at = now(), clock_out_source = 'mobile', status = 'completed', clock_out_latitude = v_lat, clock_out_longitude = v_lon, clock_out_accuracy_meters = v_accuracy, clock_out_distance_meters = v_distance, clock_out_location_verified = v_verified, clock_out_location_exception = v_exception, clock_out_exception_reason = case when v_exception then v_reason else null end, clock_out_verification_method = 'gps', updated_at = now() where id = v_record.id returning * into v_record;
  else raise exception using errcode = '22023', message = 'Unsupported attendance action.'; end if;
  return jsonb_build_object('record', to_jsonb(v_record), 'outlet', jsonb_build_object('id', v_outlet.id, 'name', v_outlet.name, 'location_enabled', v_outlet.attendance_location_enabled, 'radius_meters', v_outlet.attendance_radius_meters));
end;
$$;

revoke all on function public.crew_clock(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.crew_clock(text, text, jsonb, text) to anon, authenticated;
