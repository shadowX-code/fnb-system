-- Crew Foundation (Phase A)
-- Crew access is deliberately independent from employees.auth_user_id / Admin Access.

create extension if not exists pgcrypto;

create table if not exists public.crew_access (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  mobile_number text not null,
  passcode_hash text not null,
  access_state text not null default 'active' check (access_state in ('active', 'disabled', 'locked')),
  activated_at timestamptz not null default now(),
  disabled_at timestamptz,
  locked_until timestamptz,
  last_login_at timestamptz,
  primary_outlet_id uuid references public.outlets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crew_access_mobile_unique unique (mobile_number)
);

create table if not exists public.crew_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists crew_sessions_active_employee_idx on public.crew_sessions(employee_id, expires_at) where revoked_at is null;

create table if not exists public.crew_login_attempts (
  id uuid primary key default gen_random_uuid(),
  mobile_number text not null,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null default false,
  ip_hash text
);
create index if not exists crew_login_attempts_mobile_time_idx on public.crew_login_attempts(mobile_number, attempted_at desc);

create table if not exists public.crew_attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  outlet_id uuid references public.outlets(id) on delete set null,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  clock_in_source text not null default 'mobile' check (clock_in_source in ('mobile', 'admin')),
  clock_out_source text check (clock_out_source in ('mobile', 'admin')),
  status text not null default 'open' check (status in ('open', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crew_attendance_clock_order check (clock_out_at is null or clock_in_at is null or clock_out_at >= clock_in_at)
);
create unique index if not exists crew_attendance_one_open_shift_idx on public.crew_attendance_records(employee_id) where status = 'open';
create index if not exists crew_attendance_employee_date_idx on public.crew_attendance_records(employee_id, clock_in_at desc);

alter table public.crew_access enable row level security;
alter table public.crew_sessions enable row level security;
alter table public.crew_login_attempts enable row level security;
alter table public.crew_attendance_records enable row level security;

drop policy if exists crew_access_admin_read on public.crew_access;
create policy crew_access_admin_read on public.crew_access for select to authenticated using (public.current_user_has_permission('crew_employees.view'));
drop policy if exists crew_attendance_admin_read on public.crew_attendance_records;
create policy crew_attendance_admin_read on public.crew_attendance_records for select to authenticated using (public.current_user_has_permission('crew_attendance.view'));

create or replace function public.crew_normalize_mobile(p_mobile text)
returns text language plpgsql immutable as $$
declare v_digits text := regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g');
begin
  if v_digits like '0%' then v_digits := '60' || substr(v_digits, 2); end if;
  if length(v_digits) < 9 or length(v_digits) > 15 then
    raise exception using errcode = '22023', message = 'Enter a valid mobile number including country code.';
  end if;
  return '+' || v_digits;
end;
$$;

create or replace function public.crew_valid_passcode(p_passcode text)
returns boolean language sql immutable as $$
  select p_passcode ~ '^[0-9]{4}$'
    and p_passcode not in ('0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','0123','1234','2345','3456','4567','5678','6789','7890','9876','8765','7654','6543','5432','4321','3210','2109');
$$;

create or replace function public.crew_resolve_employee_outlet(p_employee_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select o.id
  from public.employees e
  join public.outlets o on lower(btrim(o.name)) = lower(btrim(e.workplace)) or lower(btrim(coalesce(o.code, ''))) = lower(btrim(e.workplace))
  where e.id = p_employee_id
  limit 1;
$$;

create or replace function public.manage_crew_access(p_employee_id uuid, p_action text, p_passcode text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_employee public.employees%rowtype; v_mobile text; v_passcode text; v_outlet uuid; v_action text := lower(btrim(p_action));
begin
  if not public.current_user_has_permission('crew_employees.manage') then
    raise exception using errcode = '42501', message = 'Missing permission to manage Crew Access.';
  end if;
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Employee was not found.'; end if;
  if v_employee.employment_status in ('resigned', 'terminated') then raise exception using errcode = '22023', message = 'Crew Access cannot be enabled for a resigned or terminated employee.'; end if;
  v_mobile := public.crew_normalize_mobile(v_employee.contact);
  v_outlet := public.crew_resolve_employee_outlet(v_employee.id);
  if v_action = 'disable' then
    update public.crew_access set access_state = 'disabled', disabled_at = now(), locked_until = null, updated_at = now() where employee_id = p_employee_id;
    update public.crew_sessions set revoked_at = now() where employee_id = p_employee_id and revoked_at is null;
    return jsonb_build_object('employee_id', p_employee_id, 'access_state', 'disabled');
  end if;
  if v_action not in ('enable', 'reset_passcode') then raise exception using errcode = '22023', message = 'Unsupported Crew Access action.'; end if;
  v_passcode := coalesce(nullif(btrim(p_passcode), ''), lpad((1000 + floor(random() * 9000))::text, 4, '0'));
  if not public.crew_valid_passcode(v_passcode) then raise exception using errcode = '22023', message = 'Passcode must be four digits and cannot be a common sequence or repeated number.'; end if;
  insert into public.crew_access (employee_id, mobile_number, passcode_hash, access_state, activated_at, disabled_at, locked_until, primary_outlet_id)
  values (p_employee_id, v_mobile, crypt(v_passcode, gen_salt('bf')), 'active', now(), null, null, v_outlet)
  on conflict (employee_id) do update set mobile_number = excluded.mobile_number, passcode_hash = excluded.passcode_hash, access_state = 'active', activated_at = now(), disabled_at = null, locked_until = null, primary_outlet_id = excluded.primary_outlet_id, updated_at = now();
  update public.crew_sessions set revoked_at = now() where employee_id = p_employee_id and revoked_at is null;
  return jsonb_build_object('employee_id', p_employee_id, 'access_state', 'active', 'mobile_number', v_mobile, 'temporary_passcode', v_passcode, 'activated_at', now());
end;
$$;

create or replace function public.crew_authenticate(p_mobile text, p_passcode text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_mobile text; v_access public.crew_access%rowtype; v_employee public.employees%rowtype; v_failures integer; v_token text;
begin
  v_mobile := public.crew_normalize_mobile(p_mobile);
  select count(*) into v_failures from public.crew_login_attempts where mobile_number = v_mobile and not succeeded and attempted_at > now() - interval '15 minutes';
  if v_failures >= 5 then raise exception using errcode = '42501', message = 'Too many login attempts. Try again in 15 minutes.'; end if;
  select * into v_access from public.crew_access where mobile_number = v_mobile for update;
  if not found or v_access.access_state <> 'active' or (v_access.locked_until is not null and v_access.locked_until > now()) or crypt(coalesce(p_passcode, ''), v_access.passcode_hash) <> v_access.passcode_hash then
    insert into public.crew_login_attempts(mobile_number, succeeded, ip_hash) values (v_mobile, false, p_ip_hash);
    if found and v_failures + 1 >= 5 then update public.crew_access set access_state = 'locked', locked_until = now() + interval '15 minutes', updated_at = now() where employee_id = v_access.employee_id; end if;
    raise exception using errcode = '42501', message = 'Mobile number or passcode is incorrect.';
  end if;
  select * into v_employee from public.employees where id = v_access.employee_id;
  if not found or v_employee.employment_status in ('resigned', 'terminated') then raise exception using errcode = '42501', message = 'Crew Access is not available for this employee.'; end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.crew_sessions(employee_id, token_hash, expires_at) values(v_access.employee_id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '14 days');
  insert into public.crew_login_attempts(mobile_number, succeeded, ip_hash) values (v_mobile, true, p_ip_hash);
  update public.crew_access set access_state = 'active', locked_until = null, last_login_at = now(), updated_at = now() where employee_id = v_access.employee_id;
  return jsonb_build_object('token', v_token, 'expires_at', now() + interval '14 days', 'employee', jsonb_build_object('id', v_employee.id, 'full_name', v_employee.full_name, 'nickname', v_employee.nickname, 'position', v_employee.position, 'workplace', v_employee.workplace, 'contact', v_employee.contact, 'employee_code', v_employee.employee_code), 'access', jsonb_build_object('state', 'active', 'outlet_id', v_access.primary_outlet_id));
end;
$$;

create or replace function public.crew_session_employee(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_employee_id uuid;
begin
  update public.crew_sessions set last_seen_at = now() where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and revoked_at is null and expires_at > now() returning employee_id into v_employee_id;
  if v_employee_id is null then raise exception using errcode = '42501', message = 'Crew session has expired. Please sign in again.'; end if;
  return v_employee_id;
end;
$$;

create or replace function public.crew_clock(p_token text, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_employee_id uuid; v_record public.crew_attendance_records%rowtype; v_outlet uuid;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select primary_outlet_id into v_outlet from public.crew_access where employee_id = v_employee_id;
  if lower(btrim(p_action)) = 'in' then
    select * into v_record from public.crew_attendance_records where employee_id = v_employee_id and status = 'open' for update;
    if found then return jsonb_build_object('record', to_jsonb(v_record), 'message', 'You are already on shift.'); end if;
    insert into public.crew_attendance_records(employee_id, outlet_id, clock_in_at, status) values(v_employee_id, v_outlet, now(), 'open') returning * into v_record;
  elsif lower(btrim(p_action)) = 'out' then
    select * into v_record from public.crew_attendance_records where employee_id = v_employee_id and status = 'open' for update;
    if not found then raise exception using errcode = '22023', message = 'There is no open shift to clock out.'; end if;
    update public.crew_attendance_records set clock_out_at = now(), clock_out_source = 'mobile', status = 'completed', updated_at = now() where id = v_record.id returning * into v_record;
  else raise exception using errcode = '22023', message = 'Unsupported attendance action.'; end if;
  return jsonb_build_object('record', to_jsonb(v_record));
end;
$$;

create or replace function public.crew_my_attendance(p_token text, p_limit integer default 60)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_employee_id uuid;
begin
  v_employee_id := public.crew_session_employee(p_token);
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.clock_in_at desc) from (select * from public.crew_attendance_records where employee_id = v_employee_id order by clock_in_at desc limit greatest(1, least(coalesce(p_limit, 60), 180))) r), '[]'::jsonb);
end;
$$;

revoke all on function public.crew_authenticate(text, text, text) from public;
grant execute on function public.manage_crew_access(uuid, text, text) to authenticated;
grant execute on function public.crew_authenticate(text, text, text) to anon, authenticated;
grant execute on function public.crew_clock(text, text) to anon, authenticated;
grant execute on function public.crew_my_attendance(text, integer) to anon, authenticated;

insert into public.permissions (code, module, description)
values
  ('crew_dashboard.view', 'Crew Dashboard', 'View Crew dashboard.'),
  ('crew_employees.view', 'Crew Employees', 'View Crew employee access.'),
  ('crew_employees.manage', 'Crew Employees', 'Manage Crew employee access and passcodes.'),
  ('crew_attendance.view', 'Crew Attendance', 'View Crew attendance.'),
  ('crew_attendance.manage', 'Crew Attendance', 'Manage Crew attendance.')
on conflict (code) do update set module = excluded.module, description = excluded.description;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where lower(r.name) in ('owner', 'admin') and p.code in ('crew_dashboard.view','crew_employees.view','crew_employees.manage','crew_attendance.view','crew_attendance.manage')
on conflict do nothing;
