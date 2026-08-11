-- Crew Foundation Phase A.1 corrective migration.
-- pgcrypto is installed in the `extensions` schema on hosted Supabase projects.
-- Keep SECURITY DEFINER search_path narrow and qualify every pgcrypto call.

create or replace function public.crew_session_employee(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_employee_id uuid;
begin
  update public.crew_sessions s
  set last_seen_at = now()
  from public.crew_access a
  join public.employees e on e.id = a.employee_id
  where s.employee_id = a.employee_id
    and s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
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

create or replace function public.crew_authenticate(p_mobile text, p_passcode text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_mobile text; v_access public.crew_access%rowtype; v_employee public.employees%rowtype; v_access_found boolean := false; v_failures integer := 0; v_token text; v_last_success timestamptz;
begin
  v_mobile := public.crew_normalize_mobile(p_mobile);
  select * into v_access from public.crew_access where mobile_number = v_mobile for update;
  v_access_found := found;
  if v_access_found then
    select * into v_employee from public.employees where id = v_access.employee_id;
    if v_access.access_state = 'locked' and v_access.locked_until is not null and v_access.locked_until <= now()
      and coalesce(v_employee.employment_status, 'active') not in ('resigned', 'terminated') then
      update public.crew_access set access_state = 'active', locked_until = null, updated_at = now() where employee_id = v_access.employee_id;
      select * into v_access from public.crew_access where employee_id = v_access.employee_id for update;
      v_access_found := found;
    end if;
    if v_access.access_state = 'locked' and v_access.locked_until is not null and v_access.locked_until > now() then
      insert into public.crew_login_attempts(mobile_number, succeeded, ip_hash) values (v_mobile, false, p_ip_hash);
      raise exception using errcode = '42501', message = 'Mobile number or passcode is incorrect.';
    end if;
  end if;
  select max(attempted_at) into v_last_success from public.crew_login_attempts where mobile_number = v_mobile and succeeded;
  select count(*) into v_failures from public.crew_login_attempts
  where mobile_number = v_mobile and not succeeded and attempted_at > now() - interval '15 minutes' and (v_last_success is null or attempted_at > v_last_success);
  if v_failures >= 5 then
    if v_access_found and v_access.access_state = 'active' then update public.crew_access set access_state = 'locked', locked_until = now() + interval '15 minutes', updated_at = now() where employee_id = v_access.employee_id; end if;
    raise exception using errcode = '42501', message = 'Mobile number or passcode is incorrect.';
  end if;
  if not v_access_found or v_access.access_state <> 'active' or (v_access.locked_until is not null and v_access.locked_until > now()) or extensions.crypt(coalesce(p_passcode, ''), v_access.passcode_hash) <> v_access.passcode_hash then
    insert into public.crew_login_attempts(mobile_number, succeeded, ip_hash) values (v_mobile, false, p_ip_hash);
    if v_access_found and v_access.access_state = 'active' and v_failures + 1 >= 5 then update public.crew_access set access_state = 'locked', locked_until = now() + interval '15 minutes', updated_at = now() where employee_id = v_access.employee_id; end if;
    raise exception using errcode = '42501', message = 'Mobile number or passcode is incorrect.';
  end if;
  if not v_access_found or coalesce(v_employee.employment_status, 'active') in ('resigned', 'terminated') then
    insert into public.crew_login_attempts(mobile_number, succeeded, ip_hash) values (v_mobile, false, p_ip_hash);
    raise exception using errcode = '42501', message = 'Mobile number or passcode is incorrect.';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.crew_sessions(employee_id, token_hash, expires_at) values(v_access.employee_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '14 days');
  insert into public.crew_login_attempts(mobile_number, succeeded, ip_hash) values (v_mobile, true, p_ip_hash);
  update public.crew_access set access_state = 'active', locked_until = null, last_login_at = now(), updated_at = now() where employee_id = v_access.employee_id;
  return jsonb_build_object('token', v_token, 'expires_at', now() + interval '14 days', 'employee', jsonb_build_object('id', v_employee.id, 'full_name', v_employee.full_name, 'nickname', v_employee.nickname, 'position', v_employee.position, 'workplace', v_employee.workplace, 'contact', v_employee.contact, 'employee_code', v_employee.employee_code), 'access', jsonb_build_object('state', 'active', 'outlet_id', v_access.primary_outlet_id));
end;
$$;

create or replace function public.crew_change_passcode(p_token text, p_current_passcode text, p_new_passcode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_employee_id uuid; v_access public.crew_access%rowtype; v_token text;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select * into v_access from public.crew_access where employee_id = v_employee_id for update;
  if extensions.crypt(coalesce(p_current_passcode, ''), v_access.passcode_hash) <> v_access.passcode_hash then raise exception using errcode = '42501', message = 'Current passcode is incorrect.'; end if;
  if not public.crew_valid_passcode(p_new_passcode) then raise exception using errcode = '22023', message = 'Passcode must be four digits and cannot be a common sequence or repeated number.'; end if;
  update public.crew_access set passcode_hash = extensions.crypt(p_new_passcode, extensions.gen_salt('bf')), updated_at = now() where employee_id = v_employee_id;
  update public.crew_sessions set revoked_at = now() where employee_id = v_employee_id and revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.crew_sessions(employee_id, token_hash, expires_at) values (v_employee_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '14 days');
  insert into public.audit_logs(action, module, description, metadata) values ('crew_passcode_changed', 'crew', 'Crew member changed their passcode.', jsonb_build_object('employee_id', v_employee_id));
  return jsonb_build_object('token', v_token, 'expires_at', now() + interval '14 days');
end;
$$;

create or replace function public.manage_crew_access(p_employee_id uuid, p_action text, p_passcode text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_employee public.employees%rowtype; v_mobile text; v_passcode text; v_outlet uuid; v_existing_outlet uuid; v_action text := lower(btrim(p_action)); v_actor uuid := auth.uid(); v_result jsonb;
begin
  if not public.current_user_has_permission('crew_employees.manage') then raise exception using errcode = '42501', message = 'Missing permission to manage Crew Access.'; end if;
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Employee was not found.'; end if;
  select primary_outlet_id into v_existing_outlet from public.crew_access where employee_id = p_employee_id;
  v_outlet := coalesce(v_existing_outlet, public.crew_resolve_employee_outlet(v_employee.id));
  if v_outlet is not null and not public.current_user_can_access_outlet(v_outlet) then raise exception using errcode = '42501', message = 'You cannot manage Crew Access for an employee assigned to an inaccessible outlet.'; end if;
  if v_action = 'disable' then
    update public.crew_access set access_state = 'disabled', disabled_at = now(), locked_until = null, updated_at = now() where employee_id = p_employee_id;
    update public.crew_sessions set revoked_at = now() where employee_id = p_employee_id and revoked_at is null;
    insert into public.audit_logs(action, module, description, metadata) values ('crew_access_disabled', 'crew', 'Crew Access disabled.', jsonb_build_object('employee_id', p_employee_id, 'actor_id', v_actor));
    return jsonb_build_object('employee_id', p_employee_id, 'access_state', 'disabled');
  end if;
  if v_action not in ('enable', 'reset_passcode') then raise exception using errcode = '22023', message = 'Unsupported Crew Access action.'; end if;
  if v_employee.employment_status in ('resigned', 'terminated') then raise exception using errcode = '22023', message = 'Crew Access cannot be enabled for a resigned or terminated employee.'; end if;
  v_mobile := public.crew_normalize_mobile(v_employee.contact); v_outlet := public.crew_resolve_employee_outlet(v_employee.id);
  if v_outlet is not null and not public.current_user_can_access_outlet(v_outlet) then raise exception using errcode = '42501', message = 'You cannot manage Crew Access for an employee assigned to an inaccessible outlet.'; end if;
  v_passcode := coalesce(nullif(btrim(p_passcode), ''), lpad((1000 + floor(random() * 9000))::text, 4, '0'));
  if not public.crew_valid_passcode(v_passcode) then raise exception using errcode = '22023', message = 'Passcode must be four digits and cannot be a common sequence or repeated number.'; end if;
  insert into public.crew_access (employee_id, mobile_number, passcode_hash, access_state, activated_at, disabled_at, locked_until, primary_outlet_id) values (p_employee_id, v_mobile, extensions.crypt(v_passcode, extensions.gen_salt('bf')), 'active', now(), null, null, v_outlet) on conflict (employee_id) do update set mobile_number = excluded.mobile_number, passcode_hash = excluded.passcode_hash, access_state = 'active', activated_at = now(), disabled_at = null, locked_until = null, primary_outlet_id = excluded.primary_outlet_id, updated_at = now();
  update public.crew_sessions set revoked_at = now() where employee_id = p_employee_id and revoked_at is null;
  insert into public.audit_logs(action, module, description, metadata) values (case when v_action = 'enable' then 'crew_access_enabled' else 'crew_access_passcode_reset' end, 'crew', 'Crew Access credentials changed.', jsonb_build_object('employee_id', p_employee_id, 'actor_id', v_actor, 'mobile_number', v_mobile, 'outlet_id', v_outlet));
  v_result := jsonb_build_object('employee_id', p_employee_id, 'access_state', 'active', 'mobile_number', v_mobile, 'temporary_passcode', v_passcode, 'activated_at', now());
  return v_result;
end;
$$;

-- Preserve the reviewed API boundary after CREATE OR REPLACE.
revoke all on function public.crew_session_employee(text) from public, anon, authenticated;
revoke all on function public.crew_authenticate(text, text, text) from public, anon, authenticated;
revoke all on function public.crew_change_passcode(text, text, text) from public, anon, authenticated;
revoke all on function public.manage_crew_access(uuid, text, text) from public, anon, authenticated;
grant execute on function public.crew_authenticate(text, text, text) to anon, authenticated;
grant execute on function public.crew_change_passcode(text, text, text) to anon, authenticated;
grant execute on function public.manage_crew_access(uuid, text, text) to authenticated;
