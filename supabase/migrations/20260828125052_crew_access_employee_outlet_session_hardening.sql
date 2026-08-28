-- Crew Access must always mirror the Employee Master workplace scope.  This
-- keeps the existing text-workplace resolver as the Phase A authority while a
-- future UUID outlet-assignment model is planned separately.

create or replace function public.crew_access_sync_employee_outlet_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_outlet_id uuid;
  v_current_outlet_id uuid;
  v_revoked_sessions integer := 0;
begin
  if new.workplace is not distinct from old.workplace then
    return new;
  end if;

  select primary_outlet_id
  into v_previous_outlet_id
  from public.crew_access
  where employee_id = new.id
  for update;

  if not found then
    return new;
  end if;

  v_current_outlet_id := public.crew_resolve_employee_outlet(new.id);

  update public.crew_access
  set primary_outlet_id = v_current_outlet_id,
      updated_at = now()
  where employee_id = new.id;

  update public.crew_sessions
  set revoked_at = now()
  where employee_id = new.id
    and revoked_at is null;
  get diagnostics v_revoked_sessions = row_count;

  insert into public.audit_logs(action, module, description, metadata)
  values (
    'crew_access_outlet_scope_synced',
    'crew',
    'Crew Access outlet scope synchronized after an Employee Master workplace change.',
    jsonb_build_object(
      'employee_id', new.id,
      'actor_id', auth.uid(),
      'previous_outlet_id', v_previous_outlet_id,
      'current_outlet_id', v_current_outlet_id,
      'revoked_session_count', v_revoked_sessions
    )
  );

  return new;
end;
$$;

drop trigger if exists crew_access_employee_outlet_scope_sync on public.employees;
create trigger crew_access_employee_outlet_scope_sync
after update of workplace on public.employees
for each row execute function public.crew_access_sync_employee_outlet_scope();

create or replace function public.crew_session_employee(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
begin
  update public.crew_sessions s
  set last_seen_at = now()
  from public.crew_access ca
  join public.employees e on e.id = ca.employee_id
  where s.employee_id = ca.employee_id
    and s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and ca.access_state = 'active'
    and (ca.locked_until is null or ca.locked_until <= now())
    and coalesce(e.is_active, true)
    and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
    and ca.primary_outlet_id is not null
    and ca.primary_outlet_id = public.crew_resolve_employee_outlet(e.id)
  returning s.employee_id into v_employee_id;

  if v_employee_id is null then
    raise exception using errcode = '42501', message = 'Crew Access is no longer active. Please sign in again.';
  end if;
  return v_employee_id;
end;
$$;

create or replace function public.crew_operations_employee_context(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_employee public.employees%rowtype;
  v_access public.crew_access%rowtype;
  v_outlet_id uuid;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select * into v_employee
  from public.employees e
  where e.id = v_employee_id
    and coalesce(e.is_active, true)
    and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated');
  v_outlet_id := public.crew_resolve_employee_outlet(v_employee_id);
  select * into v_access
  from public.crew_access ca
  where ca.employee_id = v_employee_id
    and ca.access_state = 'active'
    and ca.primary_outlet_id = v_outlet_id;

  if v_employee.id is null or v_access.employee_id is null or v_outlet_id is null then
    raise exception using errcode = '42501', message = 'Crew Operations access is unavailable.';
  end if;

  return jsonb_build_object(
    'employee_id', v_employee.id,
    'employee_name', v_employee.full_name,
    'position', v_employee.position,
    'role_id', v_employee.role_id,
    'outlet_id', v_outlet_id
  );
end;
$$;

create or replace function public.crew_authenticate(p_mobile text, p_passcode text, p_ip_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mobile text;
  v_access public.crew_access%rowtype;
  v_employee public.employees%rowtype;
  v_access_found boolean := false;
  v_failures integer := 0;
  v_token text;
  v_last_success timestamptz;
  v_outlet_id uuid;
begin
  v_mobile := public.crew_normalize_mobile(p_mobile);
  select * into v_access from public.crew_access where mobile_number = v_mobile for update;
  v_access_found := found;
  if v_access_found then
    select * into v_employee from public.employees where id = v_access.employee_id;
    v_outlet_id := public.crew_resolve_employee_outlet(v_access.employee_id);
    if v_access.access_state = 'locked' and v_access.locked_until is not null and v_access.locked_until <= now()
      and coalesce(v_employee.is_active, true)
      and coalesce(v_employee.employment_status, 'active') not in ('resigned', 'terminated')
      and v_access.primary_outlet_id = v_outlet_id then
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
    if v_access_found and v_access.access_state = 'active' then
      update public.crew_access set access_state = 'locked', locked_until = now() + interval '15 minutes', updated_at = now() where employee_id = v_access.employee_id;
    end if;
    raise exception using errcode = '42501', message = 'Mobile number or passcode is incorrect.';
  end if;

  if not v_access_found or v_access.access_state <> 'active' or (v_access.locked_until is not null and v_access.locked_until > now()) or extensions.crypt(coalesce(p_passcode, ''), v_access.passcode_hash) <> v_access.passcode_hash then
    insert into public.crew_login_attempts(mobile_number, succeeded, ip_hash) values (v_mobile, false, p_ip_hash);
    if v_access_found and v_access.access_state = 'active' and v_failures + 1 >= 5 then
      update public.crew_access set access_state = 'locked', locked_until = now() + interval '15 minutes', updated_at = now() where employee_id = v_access.employee_id;
    end if;
    raise exception using errcode = '42501', message = 'Mobile number or passcode is incorrect.';
  end if;

  if not coalesce(v_employee.is_active, true)
    or coalesce(v_employee.employment_status, 'active') in ('resigned', 'terminated')
    or v_outlet_id is null
    or v_access.primary_outlet_id is distinct from v_outlet_id then
    insert into public.crew_login_attempts(mobile_number, succeeded, ip_hash) values (v_mobile, false, p_ip_hash);
    raise exception using errcode = '42501', message = 'Mobile number or passcode is incorrect.';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.crew_sessions(employee_id, token_hash, expires_at) values(v_access.employee_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '14 days');
  insert into public.crew_login_attempts(mobile_number, succeeded, ip_hash) values (v_mobile, true, p_ip_hash);
  update public.crew_access set access_state = 'active', locked_until = null, last_login_at = now(), updated_at = now() where employee_id = v_access.employee_id;
  return jsonb_build_object('token', v_token, 'expires_at', now() + interval '14 days', 'employee', jsonb_build_object('id', v_employee.id, 'full_name', v_employee.full_name, 'nickname', v_employee.nickname, 'position', v_employee.position, 'workplace', v_employee.workplace, 'contact', v_employee.contact, 'employee_code', v_employee.employee_code), 'access', jsonb_build_object('state', 'active', 'outlet_id', v_outlet_id));
end;
$$;

create or replace function public.manage_crew_access(p_employee_id uuid, p_action text, p_passcode text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employees%rowtype;
  v_mobile text;
  v_passcode text;
  v_outlet_id uuid;
  v_action text := lower(btrim(p_action));
  v_actor uuid := auth.uid();
  v_revoked_sessions integer := 0;
  v_existing_access_state text;
begin
  if not public.current_user_has_permission('crew_employees.manage') then
    raise exception using errcode = '42501', message = 'Missing permission to manage Crew Access.';
  end if;
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Employee was not found.'; end if;
  v_outlet_id := public.crew_resolve_employee_outlet(v_employee.id);
  if v_outlet_id is null or not public.current_user_can_access_outlet(v_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot manage Crew Access for an employee outside your current outlet scope.';
  end if;

  if v_action = 'disable' then
    update public.crew_access set access_state = 'disabled', disabled_at = now(), locked_until = null, updated_at = now() where employee_id = p_employee_id;
    update public.crew_sessions set revoked_at = now() where employee_id = p_employee_id and revoked_at is null;
    get diagnostics v_revoked_sessions = row_count;
    insert into public.audit_logs(action, module, description, metadata) values ('crew_access_disabled', 'crew', 'Crew Access disabled and active Crew sessions revoked.', jsonb_build_object('employee_id', p_employee_id, 'actor_id', v_actor, 'outlet_id', v_outlet_id, 'revoked_session_count', v_revoked_sessions));
    return jsonb_build_object('employee_id', p_employee_id, 'access_state', 'disabled', 'revoked_session_count', v_revoked_sessions);
  end if;

  if v_action not in ('enable', 'reset_passcode') then raise exception using errcode = '22023', message = 'Unsupported Crew Access action.'; end if;
  if not coalesce(v_employee.is_active, true) or coalesce(v_employee.employment_status, 'active') in ('resigned', 'terminated') then
    raise exception using errcode = '22023', message = 'Crew Access can be activated only for an active employee.';
  end if;
  select access_state into v_existing_access_state from public.crew_access where employee_id = p_employee_id for update;
  if v_action = 'reset_passcode' and v_existing_access_state is distinct from 'active' then
    raise exception using errcode = '22023', message = 'Activate Crew Access before resetting its passcode.';
  end if;
  v_mobile := public.crew_normalize_mobile(v_employee.contact);
  v_passcode := coalesce(nullif(btrim(p_passcode), ''), lpad((1000 + floor(random() * 9000))::text, 4, '0'));
  if not public.crew_valid_passcode(v_passcode) then raise exception using errcode = '22023', message = 'Passcode must be four digits and cannot be a common sequence or repeated number.'; end if;

  insert into public.crew_access (employee_id, mobile_number, passcode_hash, access_state, activated_at, disabled_at, locked_until, primary_outlet_id)
  values (p_employee_id, v_mobile, extensions.crypt(v_passcode, extensions.gen_salt('bf')), 'active', now(), null, null, v_outlet_id)
  on conflict (employee_id) do update set mobile_number = excluded.mobile_number, passcode_hash = excluded.passcode_hash, access_state = 'active', activated_at = now(), disabled_at = null, locked_until = null, primary_outlet_id = excluded.primary_outlet_id, updated_at = now();
  update public.crew_sessions set revoked_at = now() where employee_id = p_employee_id and revoked_at is null;
  get diagnostics v_revoked_sessions = row_count;
  insert into public.audit_logs(action, module, description, metadata) values (case when v_action = 'enable' then 'crew_access_enabled' else 'crew_access_passcode_reset' end, 'crew', 'Crew Access credentials changed.', jsonb_build_object('employee_id', p_employee_id, 'actor_id', v_actor, 'outlet_id', v_outlet_id, 'revoked_session_count', v_revoked_sessions));
  return jsonb_build_object('employee_id', p_employee_id, 'access_state', 'active', 'mobile_number', v_mobile, 'temporary_passcode', v_passcode, 'activated_at', now());
end;
$$;

create or replace function public.crew_can_initiate_cash_handover(p_employee_id uuid, p_outlet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.crew_access ca join public.employees e on e.id = ca.employee_id
    where ca.employee_id = p_employee_id
      and ca.primary_outlet_id = p_outlet_id
      and ca.primary_outlet_id = public.crew_resolve_employee_outlet(e.id)
      and ca.access_state = 'active'
      and ca.can_initiate_handover
      and coalesce(e.is_active, true)
      and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
  );
$$;

create or replace function public.crew_update_cash_operations_access(p_employee_id uuid, p_can_initiate_handover boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_access public.crew_access%rowtype;
  v_outlet_id uuid;
  v_before boolean;
begin
  if not public.current_user_has_permission('crew_employees.manage') then raise exception using errcode = '42501', message = 'Missing permission to manage Crew Access.'; end if;
  v_outlet_id := public.crew_resolve_employee_outlet(p_employee_id);
  select * into v_access from public.crew_access where employee_id = p_employee_id for update;
  if v_access.employee_id is null or v_access.access_state <> 'active' then raise exception using errcode = '22023', message = 'Crew Access must be active before Special Access can be configured.'; end if;
  if v_outlet_id is null or v_access.primary_outlet_id is distinct from v_outlet_id or not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode = '42501', message = 'Crew Access outlet scope is unavailable or inaccessible.'; end if;
  v_before := v_access.can_initiate_handover;
  update public.crew_access set can_initiate_handover = coalesce(p_can_initiate_handover, false), updated_at = now() where employee_id = p_employee_id returning * into v_access;
  if v_before is distinct from v_access.can_initiate_handover then
    insert into public.audit_logs(action, module, description, metadata) values ('crew_access_cash_handover_capability_updated', 'crew', 'Crew Cash Handover capability updated.', jsonb_build_object('employee_id', p_employee_id, 'outlet_id', v_outlet_id, 'can_initiate_handover_before', v_before, 'can_initiate_handover_after', v_access.can_initiate_handover, 'actor_id', auth.uid()));
  end if;
  return jsonb_build_object('employee_id', v_access.employee_id, 'access_state', v_access.access_state, 'can_initiate_handover', v_access.can_initiate_handover, 'updated_at', v_access.updated_at);
end;
$$;

create or replace function public.crew_access_admin_list(p_outlet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_outlet_id is null or not (public.current_user_has_permission('crew_employees.view') or public.current_user_has_permission('crew_employees.manage')) then
    raise exception using errcode = '42501', message = 'Missing permission to view Crew Access.';
  end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot view Crew Access outside your outlet scope.';
  end if;
  return coalesce((
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
      'position', e.position, 'workplace', e.workplace, 'contact', e.contact,
      'employment_type', e.employment_type, 'employment_status', e.employment_status,
      'is_active', e.is_active,
      'crew_access', case when ca.employee_id is null then null else jsonb_build_object(
        'employee_id', ca.employee_id, 'mobile_number', ca.mobile_number,
        'access_state', ca.access_state, 'activated_at', ca.activated_at,
        'disabled_at', ca.disabled_at, 'locked_until', ca.locked_until,
        'last_login_at', ca.last_login_at, 'primary_outlet_id', ca.primary_outlet_id,
        'can_initiate_handover', ca.can_initiate_handover
      ) end
    ) order by e.full_name), '[]'::jsonb)
    from public.employees e
    left join public.crew_access ca on ca.employee_id = e.id
    where public.crew_resolve_employee_outlet(e.id) = p_outlet_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.crew_access_sync_employee_outlet_scope() from public, anon, authenticated;
revoke all on function public.crew_session_employee(text) from public, anon, authenticated;
revoke all on function public.crew_operations_employee_context(text) from public, anon, authenticated;
revoke all on function public.crew_authenticate(text, text, text) from public, anon, authenticated;
revoke all on function public.manage_crew_access(uuid, text, text) from public, anon, authenticated;
revoke all on function public.crew_can_initiate_cash_handover(uuid, uuid) from public, anon, authenticated;
revoke all on function public.crew_update_cash_operations_access(uuid, boolean) from public, anon, authenticated;
revoke all on function public.crew_access_admin_list(uuid) from public, anon, authenticated;
grant execute on function public.crew_authenticate(text, text, text) to anon, authenticated;
grant execute on function public.manage_crew_access(uuid, text, text) to authenticated;
grant execute on function public.crew_update_cash_operations_access(uuid, boolean) to authenticated;
grant execute on function public.crew_access_admin_list(uuid) to authenticated;
