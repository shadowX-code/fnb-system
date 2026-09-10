insert into public.permissions(code, module, description) values
  ('factory_mesti_operator_hygiene.view', 'Factory MeSTI Operator Hygiene', 'View operator hygiene inspections.'),
  ('factory_mesti_operator_hygiene.manage', 'Factory MeSTI Operator Hygiene', 'Create and edit draft operator hygiene inspections.'),
  ('factory_mesti_operator_hygiene.submit', 'Factory MeSTI Operator Hygiene', 'Submit operator hygiene inspections.'),
  ('factory_mesti_operator_hygiene.verify', 'Factory MeSTI Operator Hygiene', 'Verify operator hygiene inspections.')
on conflict (code) do nothing;

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission on permission.code like 'factory_mesti_operator_hygiene.%'
where lower(role.name) in ('owner', 'admin')
on conflict do nothing;

create table public.factory_mesti_operator_hygiene_sessions (
  id uuid primary key default gen_random_uuid(),
  inspection_date date not null unique,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'verified')),
  submitted_by uuid references public.employees(id),
  submitted_at timestamptz,
  verified_by uuid references public.employees(id),
  verified_at timestamptz,
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'draft') = (submitted_by is null and submitted_at is null)),
  check ((status <> 'verified') or (verified_by is not null and verified_at is not null))
);

create table public.factory_mesti_operator_hygiene_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.factory_mesti_operator_hygiene_sessions(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  employee_snapshot jsonb not null,
  clothing_result text not null check (clothing_result in ('pass', 'fail')),
  hygiene_result text not null check (hygiene_result in ('pass', 'fail')),
  overall_result text not null check (overall_result in ('compliant', 'non_compliant')),
  issue text,
  action_taken text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, employee_id),
  check ((overall_result = 'compliant') = (clothing_result = 'pass' and hygiene_result = 'pass')),
  check (
    overall_result = 'compliant'
    or (nullif(btrim(issue), '') is not null and nullif(btrim(action_taken), '') is not null)
  )
);

alter table public.factory_mesti_operator_hygiene_sessions enable row level security;
alter table public.factory_mesti_operator_hygiene_entries enable row level security;

create policy "operator hygiene session read"
  on public.factory_mesti_operator_hygiene_sessions for select to authenticated
  using (
    public.current_user_has_permission('factory_mesti_operator_hygiene.view')
    or public.current_user_has_permission('factory_mesti_operator_hygiene.manage')
  );

create policy "operator hygiene entry read"
  on public.factory_mesti_operator_hygiene_entries for select to authenticated
  using (
    public.current_user_has_permission('factory_mesti_operator_hygiene.view')
    or public.current_user_has_permission('factory_mesti_operator_hygiene.manage')
  );

revoke all on table public.factory_mesti_operator_hygiene_sessions from public, anon;
revoke all on table public.factory_mesti_operator_hygiene_entries from public, anon;
grant select on table public.factory_mesti_operator_hygiene_sessions to authenticated;
grant select on table public.factory_mesti_operator_hygiene_entries to authenticated;

create or replace function public.factory_mesti_operator_hygiene_snapshot(p_employee public.employees)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'employee_id', p_employee.id,
    'employee_name', coalesce(p_employee.nickname, p_employee.full_name),
    'position', p_employee.position
  )
$$;

create or replace function public.factory_mesti_save_operator_hygiene(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.factory_current_active_employee_id();
  v_session public.factory_mesti_operator_hygiene_sessions%rowtype;
  v_entry jsonb;
  v_employee_id uuid;
  v_clothing text;
  v_hygiene text;
  v_issue text;
  v_action text;
begin
  if not public.current_user_has_permission('factory_mesti_operator_hygiene.manage') then
    raise exception using errcode = '42501', message = 'Missing hygiene manage permission.';
  end if;
  if nullif(p_payload->>'inspection_date', '') is null then
    raise exception 'Inspection date is required.';
  end if;

  insert into public.factory_mesti_operator_hygiene_sessions(inspection_date, created_by)
  values ((p_payload->>'inspection_date')::date, v_actor)
  on conflict (inspection_date) do update set updated_at = now()
  returning * into v_session;

  if v_session.status <> 'draft' then
    raise exception 'Submitted hygiene sessions are immutable.';
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(p_payload->'entries', '[]'::jsonb)) loop
    v_employee_id := (v_entry->>'employee_id')::uuid;
    v_clothing := lower(v_entry->>'clothing_result');
    v_hygiene := lower(v_entry->>'hygiene_result');
    v_issue := nullif(btrim(v_entry->>'issue'), '');
    v_action := nullif(btrim(v_entry->>'action_taken'), '');
    if v_clothing not in ('pass', 'fail') or v_hygiene not in ('pass', 'fail') then
      raise exception 'Inspection result must be Pass or Fail.';
    end if;
    if (v_clothing = 'fail' or v_hygiene = 'fail') and (v_issue is null or v_action is null) then
      raise exception 'Fail entries require an Issue and Action.';
    end if;

    insert into public.factory_mesti_operator_hygiene_entries(
      session_id, employee_id, employee_snapshot, clothing_result, hygiene_result, overall_result, issue, action_taken, notes
    )
    select
      v_session.id,
      employee.id,
      public.factory_mesti_operator_hygiene_snapshot(employee),
      v_clothing,
      v_hygiene,
      case when v_clothing = 'pass' and v_hygiene = 'pass' then 'compliant' else 'non_compliant' end,
      v_issue,
      v_action,
      nullif(btrim(v_entry->>'notes'), '')
    from public.employees employee
    where employee.id = v_employee_id
      and employee.is_active
      and coalesce(employee.employment_status, 'active') = 'active'
    on conflict (session_id, employee_id) do update set
      clothing_result = excluded.clothing_result,
      hygiene_result = excluded.hygiene_result,
      overall_result = excluded.overall_result,
      issue = excluded.issue,
      action_taken = excluded.action_taken,
      notes = excluded.notes,
      updated_at = now();

    if not found then
      raise exception 'Selected employee is not active.';
    end if;
  end loop;

  return to_jsonb(v_session);
end
$$;

create or replace function public.factory_mesti_submit_operator_hygiene(p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.factory_current_active_employee_id();
  v_session public.factory_mesti_operator_hygiene_sessions%rowtype;
begin
  if not (
    public.current_user_has_permission('factory_mesti_operator_hygiene.submit')
    or public.current_user_has_permission('factory_mesti_operator_hygiene.manage')
  ) then
    raise exception using errcode = '42501', message = 'Missing hygiene submit permission.';
  end if;

  select * into v_session
  from public.factory_mesti_operator_hygiene_sessions
  where inspection_date = p_date
  for update;
  if v_session.id is null then
    raise exception 'Inspection session not found.';
  end if;
  if not exists (select 1 from public.factory_mesti_operator_hygiene_entries where session_id = v_session.id) then
    raise exception 'Inspection session has no operator entries.';
  end if;
  if v_session.status = 'draft' then
    update public.factory_mesti_operator_hygiene_sessions
    set status = 'submitted', submitted_by = v_actor, submitted_at = now(), updated_at = now()
    where id = v_session.id
    returning * into v_session;
  end if;

  return to_jsonb(v_session);
end
$$;

create or replace function public.factory_mesti_verify_operator_hygiene(p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.factory_current_active_employee_id();
  v_session public.factory_mesti_operator_hygiene_sessions%rowtype;
begin
  if not public.current_user_has_permission('factory_mesti_operator_hygiene.verify') then
    raise exception using errcode = '42501', message = 'Missing hygiene verify permission.';
  end if;

  select * into v_session
  from public.factory_mesti_operator_hygiene_sessions
  where inspection_date = p_date
  for update;
  if v_session.status <> 'submitted' then
    raise exception 'Inspection is not awaiting verification.';
  end if;
  if v_session.submitted_by = v_actor then
    raise exception 'Self-verification is not allowed.';
  end if;

  update public.factory_mesti_operator_hygiene_sessions
  set status = 'verified', verified_by = v_actor, verified_at = now(), updated_at = now()
  where id = v_session.id
  returning * into v_session;

  return to_jsonb(v_session);
end
$$;

create or replace function public.factory_mesti_operator_hygiene_daily(p_date date)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not (
    public.current_user_has_permission('factory_mesti_operator_hygiene.view')
    or public.current_user_has_permission('factory_mesti_operator_hygiene.manage')
  ) then
    raise exception using errcode = '42501', message = 'Missing hygiene view permission.';
  end if;

  return jsonb_build_object(
    'session', (
      select to_jsonb(session)
        || jsonb_build_object(
          'submitted_by_name', coalesce(submitted_by.nickname, submitted_by.full_name),
          'verified_by_name', coalesce(verified_by.nickname, verified_by.full_name)
        )
      from public.factory_mesti_operator_hygiene_sessions session
      left join public.employees submitted_by on submitted_by.id = session.submitted_by
      left join public.employees verified_by on verified_by.id = session.verified_by
      where session.inspection_date = p_date
    ),
    'entries', coalesce((
      select jsonb_agg(to_jsonb(entry) order by entry.employee_snapshot->>'employee_name')
      from public.factory_mesti_operator_hygiene_entries entry
      join public.factory_mesti_operator_hygiene_sessions session on session.id = entry.session_id
      where session.inspection_date = p_date
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', employee.id,
          'name', coalesce(employee.nickname, employee.full_name),
          'position', employee.position
        )
        order by coalesce(employee.nickname, employee.full_name)
      )
      from public.employees employee
      where employee.is_active
        and coalesce(employee.employment_status, 'active') = 'active'
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.factory_mesti_operator_hygiene_monthly(p_month date)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not (
    public.current_user_has_permission('factory_mesti_operator_hygiene.view')
    or public.current_user_has_permission('factory_mesti_operator_hygiene.manage')
  ) then
    raise exception using errcode = '42501', message = 'Missing hygiene view permission.';
  end if;

  return query
  select jsonb_build_object(
    'employee_id', employee.id,
    'employee_name', coalesce(employee.nickname, employee.full_name),
    'position', employee.position,
    'summary', jsonb_build_object(
      'inspected_count', count(entry.id),
      'compliant_count', count(entry.id) filter (where entry.overall_result = 'compliant'),
      'non_compliant_count', count(entry.id) filter (where entry.overall_result = 'non_compliant')
    ),
    'days', coalesce(jsonb_object_agg(
      session.inspection_date::text,
      jsonb_build_object(
        'entry_id', entry.id,
        'state', case when session.status = 'verified' then entry.overall_result else 'awaiting_verification' end,
        'session_status', session.status,
        'clothing_result', entry.clothing_result,
        'hygiene_result', entry.hygiene_result,
        'overall_result', entry.overall_result,
        'issue', entry.issue,
        'action_taken', entry.action_taken,
        'notes', entry.notes,
        'submitted_by_name', coalesce(submitted_by.nickname, submitted_by.full_name),
        'submitted_at', session.submitted_at,
        'verified_by_name', coalesce(verified_by.nickname, verified_by.full_name),
        'verified_at', session.verified_at
      )
    ) filter (where entry.id is not null), '{}'::jsonb)
  )
  from public.employees employee
  left join public.factory_mesti_operator_hygiene_entries entry on entry.employee_id = employee.id
    and exists (
      select 1
      from public.factory_mesti_operator_hygiene_sessions scoped_session
      where scoped_session.id = entry.session_id
        and scoped_session.inspection_date >= date_trunc('month', p_month)::date
        and scoped_session.inspection_date < (date_trunc('month', p_month)::date + interval '1 month')
    )
  left join public.factory_mesti_operator_hygiene_sessions session on session.id = entry.session_id
  left join public.employees submitted_by on submitted_by.id = session.submitted_by
  left join public.employees verified_by on verified_by.id = session.verified_by
  where employee.is_active
    and coalesce(employee.employment_status, 'active') = 'active'
  group by employee.id, employee.nickname, employee.full_name, employee.position
  order by coalesce(employee.nickname, employee.full_name);
end
$$;

revoke all on function public.factory_mesti_operator_hygiene_snapshot(public.employees) from public, anon, authenticated;
revoke all on function public.factory_mesti_save_operator_hygiene(jsonb) from public, anon;
revoke all on function public.factory_mesti_submit_operator_hygiene(date) from public, anon;
revoke all on function public.factory_mesti_verify_operator_hygiene(date) from public, anon;
revoke all on function public.factory_mesti_operator_hygiene_daily(date) from public, anon;
revoke all on function public.factory_mesti_operator_hygiene_monthly(date) from public, anon;

grant execute on function public.factory_mesti_save_operator_hygiene(jsonb) to authenticated;
grant execute on function public.factory_mesti_submit_operator_hygiene(date) to authenticated;
grant execute on function public.factory_mesti_verify_operator_hygiene(date) to authenticated;
grant execute on function public.factory_mesti_operator_hygiene_daily(date) to authenticated;
grant execute on function public.factory_mesti_operator_hygiene_monthly(date) to authenticated;
