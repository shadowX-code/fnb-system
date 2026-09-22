-- Crew Foundation Phase A.1: outlet-owned GPS geofence and immutable attendance evidence.
-- This migration is forward-only and intentionally does not alter the original Crew migration.

alter table public.outlets
  add column if not exists attendance_location_enabled boolean not null default false,
  add column if not exists attendance_latitude numeric(9,6),
  add column if not exists attendance_longitude numeric(9,6),
  add column if not exists attendance_radius_meters integer not null default 100;

alter table public.outlets drop constraint if exists outlets_attendance_location_configuration_check;
alter table public.outlets add constraint outlets_attendance_location_configuration_check check (
  (not attendance_location_enabled or (attendance_latitude is not null and attendance_longitude is not null))
  and (attendance_latitude is null or attendance_latitude between -90 and 90)
  and (attendance_longitude is null or attendance_longitude between -180 and 180)
  and attendance_radius_meters between 25 and 2000
);

alter table public.crew_attendance_records
  add column if not exists clock_in_latitude numeric(9,6),
  add column if not exists clock_in_longitude numeric(9,6),
  add column if not exists clock_in_accuracy_meters numeric(10,2),
  add column if not exists clock_in_distance_meters numeric(10,2),
  add column if not exists clock_in_location_verified boolean not null default false,
  add column if not exists clock_in_location_exception boolean not null default false,
  add column if not exists clock_in_exception_reason text,
  add column if not exists clock_in_verification_method text not null default 'gps',
  add column if not exists clock_out_latitude numeric(9,6),
  add column if not exists clock_out_longitude numeric(9,6),
  add column if not exists clock_out_accuracy_meters numeric(10,2),
  add column if not exists clock_out_distance_meters numeric(10,2),
  add column if not exists clock_out_location_verified boolean not null default false,
  add column if not exists clock_out_location_exception boolean not null default false,
  add column if not exists clock_out_exception_reason text,
  add column if not exists clock_out_verification_method text;

alter table public.crew_attendance_records drop constraint if exists crew_attendance_location_evidence_check;
alter table public.crew_attendance_records add constraint crew_attendance_location_evidence_check check (
  clock_in_verification_method in ('gps', 'wifi', 'qr', 'nfc', 'beacon', 'selfie')
  and (clock_out_verification_method is null or clock_out_verification_method in ('gps', 'wifi', 'qr', 'nfc', 'beacon', 'selfie'))
  and (clock_in_latitude is null or clock_in_latitude between -90 and 90)
  and (clock_in_longitude is null or clock_in_longitude between -180 and 180)
  and (clock_out_latitude is null or clock_out_latitude between -90 and 90)
  and (clock_out_longitude is null or clock_out_longitude between -180 and 180)
  and (not clock_in_location_exception or nullif(btrim(coalesce(clock_in_exception_reason, '')), '') is not null)
  and (not clock_out_location_exception or nullif(btrim(coalesce(clock_out_exception_reason, '')), '') is not null)
);

create or replace function public.crew_haversine_meters(p_lat1 numeric, p_lon1 numeric, p_lat2 numeric, p_lon2 numeric)
returns numeric language sql immutable strict as $$
  select 6371000::numeric * 2 * asin(sqrt(
    power(sin(radians((p_lat2 - p_lat1) / 2)), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians((p_lon2 - p_lon1) / 2)), 2)
  ));
$$;

-- Session checks always consult current Crew Access and employment state so disable/termination blocks a valid-looking token immediately.
create or replace function public.crew_session_employee(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_employee_id uuid;
begin
  update public.crew_sessions s
  set last_seen_at = now()
  from public.crew_access a
  join public.employees e on e.id = a.employee_id
  where s.employee_id = a.employee_id
    and s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and a.access_state = 'active'
    and (a.locked_until is null or a.locked_until <= now())
    and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
  returning s.employee_id into v_employee_id;
  if v_employee_id is null then raise exception using errcode = '42501', message = 'Crew Access is no longer active. Please contact your manager.'; end if;
  return v_employee_id;
end;
$$;

create or replace function public.crew_attendance_context(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_employee_id uuid; v_outlet public.outlets%rowtype;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select o.* into v_outlet from public.crew_access a left join public.outlets o on o.id = a.primary_outlet_id where a.employee_id = v_employee_id;
  if v_outlet.id is null then raise exception using errcode = '22023', message = 'Your Crew Access has no assigned outlet. Ask your manager to confirm your workplace.'; end if;
  if v_outlet.attendance_location_enabled and (v_outlet.attendance_latitude is null or v_outlet.attendance_longitude is null) then
    raise exception using errcode = '22023', message = 'This outlet has location verification enabled but is not configured. Ask your manager to update Outlet settings.';
  end if;
  return jsonb_build_object('outlet_id', v_outlet.id, 'outlet_name', v_outlet.name, 'location_enabled', v_outlet.attendance_location_enabled, 'latitude', v_outlet.attendance_latitude, 'longitude', v_outlet.attendance_longitude, 'radius_meters', v_outlet.attendance_radius_meters);
end;
$$;

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
      v_exception := true;
      v_reason := coalesce(v_reason, case when v_has_location then 'Outside the configured outlet area at clock out.' else 'Location unavailable at clock out.' end);
    end if;
    update public.crew_attendance_records set clock_out_at = now(), clock_out_source = 'mobile', status = 'completed', clock_out_latitude = v_lat, clock_out_longitude = v_lon, clock_out_accuracy_meters = v_accuracy, clock_out_distance_meters = v_distance, clock_out_location_verified = v_verified, clock_out_location_exception = v_exception, clock_out_exception_reason = case when v_exception then v_reason else null end, clock_out_verification_method = 'gps', updated_at = now() where id = v_record.id returning * into v_record;
  else raise exception using errcode = '22023', message = 'Unsupported attendance action.'; end if;
  return jsonb_build_object('record', to_jsonb(v_record), 'outlet', jsonb_build_object('id', v_outlet.id, 'name', v_outlet.name, 'location_enabled', v_outlet.attendance_location_enabled, 'radius_meters', v_outlet.attendance_radius_meters));
end;
$$;

-- Remove the Phase A two-argument overload so an old client cannot bypass GPS policy.
drop function if exists public.crew_clock(text, text);

create or replace function public.crew_change_passcode(p_token text, p_current_passcode text, p_new_passcode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_employee_id uuid; v_access public.crew_access%rowtype; v_token text;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select * into v_access from public.crew_access where employee_id = v_employee_id for update;
  if crypt(coalesce(p_current_passcode, ''), v_access.passcode_hash) <> v_access.passcode_hash then raise exception using errcode = '42501', message = 'Current passcode is incorrect.'; end if;
  if not public.crew_valid_passcode(p_new_passcode) then raise exception using errcode = '22023', message = 'Passcode must be four digits and cannot be a common sequence or repeated number.'; end if;
  update public.crew_access set passcode_hash = crypt(p_new_passcode, gen_salt('bf')), updated_at = now() where employee_id = v_employee_id;
  update public.crew_sessions set revoked_at = now() where employee_id = v_employee_id and revoked_at is null;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.crew_sessions(employee_id, token_hash, expires_at) values (v_employee_id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '14 days');
  insert into public.audit_logs(action, module, description, metadata) values ('crew_passcode_changed', 'crew', 'Crew member changed their passcode.', jsonb_build_object('employee_id', v_employee_id));
  return jsonb_build_object('token', v_token, 'expires_at', now() + interval '14 days');
end;
$$;

-- Crew Access state changes are audit events; no plaintext passcode is ever put into metadata.
create or replace function public.manage_crew_access(p_employee_id uuid, p_action text, p_passcode text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_employee public.employees%rowtype; v_mobile text; v_passcode text; v_outlet uuid; v_action text := lower(btrim(p_action)); v_actor uuid := auth.uid(); v_result jsonb;
begin
  if not public.current_user_has_permission('crew_employees.manage') then raise exception using errcode = '42501', message = 'Missing permission to manage Crew Access.'; end if;
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Employee was not found.'; end if;
  if v_employee.employment_status in ('resigned', 'terminated') then raise exception using errcode = '22023', message = 'Crew Access cannot be enabled for a resigned or terminated employee.'; end if;
  v_mobile := public.crew_normalize_mobile(v_employee.contact); v_outlet := public.crew_resolve_employee_outlet(v_employee.id);
  if v_outlet is not null and not public.current_user_can_access_outlet(v_outlet) then raise exception using errcode = '42501', message = 'You cannot manage Crew Access for an employee assigned to an inaccessible outlet.'; end if;
  if v_action = 'disable' then
    update public.crew_access set access_state = 'disabled', disabled_at = now(), locked_until = null, updated_at = now() where employee_id = p_employee_id;
    update public.crew_sessions set revoked_at = now() where employee_id = p_employee_id and revoked_at is null;
    insert into public.audit_logs(action, module, description, metadata) values ('crew_access_disabled', 'crew', 'Crew Access disabled.', jsonb_build_object('employee_id', p_employee_id, 'actor_id', v_actor));
    return jsonb_build_object('employee_id', p_employee_id, 'access_state', 'disabled');
  end if;
  if v_action not in ('enable', 'reset_passcode') then raise exception using errcode = '22023', message = 'Unsupported Crew Access action.'; end if;
  v_passcode := coalesce(nullif(btrim(p_passcode), ''), lpad((1000 + floor(random() * 9000))::text, 4, '0'));
  if not public.crew_valid_passcode(v_passcode) then raise exception using errcode = '22023', message = 'Passcode must be four digits and cannot be a common sequence or repeated number.'; end if;
  insert into public.crew_access (employee_id, mobile_number, passcode_hash, access_state, activated_at, disabled_at, locked_until, primary_outlet_id) values (p_employee_id, v_mobile, crypt(v_passcode, gen_salt('bf')), 'active', now(), null, null, v_outlet) on conflict (employee_id) do update set mobile_number = excluded.mobile_number, passcode_hash = excluded.passcode_hash, access_state = 'active', activated_at = now(), disabled_at = null, locked_until = null, primary_outlet_id = excluded.primary_outlet_id, updated_at = now();
  update public.crew_sessions set revoked_at = now() where employee_id = p_employee_id and revoked_at is null;
  insert into public.audit_logs(action, module, description, metadata) values (case when v_action = 'enable' then 'crew_access_enabled' else 'crew_access_passcode_reset' end, 'crew', 'Crew Access credentials changed.', jsonb_build_object('employee_id', p_employee_id, 'actor_id', v_actor, 'mobile_number', v_mobile, 'outlet_id', v_outlet));
  v_result := jsonb_build_object('employee_id', p_employee_id, 'access_state', 'active', 'mobile_number', v_mobile, 'temporary_passcode', v_passcode, 'activated_at', now());
  return v_result;
end;
$$;

drop policy if exists crew_attendance_admin_read on public.crew_attendance_records;
create policy crew_attendance_admin_read on public.crew_attendance_records for select to authenticated using (
  public.current_user_has_permission('crew_attendance.view') and (outlet_id is null or public.current_user_can_access_outlet(outlet_id))
);

drop policy if exists crew_access_admin_read on public.crew_access;
create policy crew_access_admin_read on public.crew_access for select to authenticated using (
  public.current_user_has_permission('crew_employees.view') and (primary_outlet_id is null or public.current_user_can_access_outlet(primary_outlet_id))
);

grant execute on function public.crew_haversine_meters(numeric, numeric, numeric, numeric) to anon, authenticated;
grant execute on function public.crew_attendance_context(text) to anon, authenticated;
grant execute on function public.crew_clock(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.crew_change_passcode(text, text, text) to anon, authenticated;
