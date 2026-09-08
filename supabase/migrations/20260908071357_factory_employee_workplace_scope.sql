-- Factory employee selection is intentionally distinct from outlet/Crew scope.
-- Historical evidence continues to resolve its persisted actor and snapshots directly.
create or replace function public.factory_eligible_employees()
returns table(id uuid, name text, employee_position text, workplace text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    e.id,
    coalesce(e.nickname, e.full_name) as name,
    e.position,
    e.workplace
  from public.employees e
  where e.is_active
    and coalesce(e.employment_status, 'active') = 'active'
    and lower(btrim(coalesce(e.workplace, ''))) in ('factory', 'management')
  order by coalesce(e.nickname, e.full_name), e.id;
$$;

revoke all on function public.factory_eligible_employees() from public, anon, authenticated;

create or replace function public.factory_mesti_submit_health_declaration(p_declaration jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := public.factory_current_active_employee_id();
  kind text := lower(btrim(p_declaration->>'declaration_type'));
  symptom_values text[] := coalesce(array(select lower(btrim(value)) from jsonb_array_elements_text(coalesce(p_declaration->'symptoms', '[]'::jsonb)) value where btrim(value) <> '' order by lower(btrim(value))), '{}'::text[]);
  employee public.employees%rowtype;
  row public.factory_mesti_health_declarations%rowtype;
  request uuid := nullif(p_declaration->>'request_id','')::uuid;
  visitor text := nullif(left(btrim(p_declaration->>'visitor_name'), 200), '');
begin
  if not (public.current_user_has_permission('factory_mesti_health_declaration.create') or public.current_user_has_permission('factory_mesti_health_declaration.manage')) then
    raise exception using errcode='42501', message='Missing Health Declaration record permission.';
  end if;
  if kind not in ('employee','visitor') then raise exception using errcode='22023', message='Declaration type must be Employee or Visitor.'; end if;
  if symptom_values is not null and not (symptom_values <@ array['diarrhea','fever','jaundice','visible_skin_infection','ear_nose_eye_infection','other']) then
    raise exception using errcode='22023', message='One or more symptoms are invalid.';
  end if;
  if request is not null then
    select * into row from public.factory_mesti_health_declarations where created_by=actor and request_id=request;
    if row.id is not null then return to_jsonb(row) || jsonb_build_object('idempotent', true); end if;
  end if;
  if kind = 'employee' then
    select e.* into employee
    from public.employees e
    join public.factory_eligible_employees() eligible on eligible.id = e.id
    where e.id = nullif(p_declaration->>'employee_id','')::uuid;
    if employee.id is null then raise exception using errcode='22023', message='Select an eligible Factory Employee.'; end if;
    insert into public.factory_mesti_health_declarations(declaration_type,health_status,symptoms,notes,employee_id,employee_snapshot,created_by,request_id)
    values ('employee', case when cardinality(symptom_values)=0 then 'fit_for_work' else 'health_issue_declared' end, symptom_values, nullif(left(btrim(p_declaration->>'notes'), 2000), ''), employee.id, public.factory_mesti_health_declaration_employee_snapshot(employee), actor, request)
    returning * into row;
  else
    if visitor is null then raise exception using errcode='22023', message='Visitor Name is required.'; end if;
    insert into public.factory_mesti_health_declarations(declaration_type,health_status,symptoms,notes,visitor_name,visitor_company,visitor_purpose,visitor_host,visitor_contact,entry_decision,created_by,request_id)
    values ('visitor', case when cardinality(symptom_values)=0 then 'cleared' else 'health_issue_declared' end, symptom_values, nullif(left(btrim(p_declaration->>'notes'), 2000), ''), visitor, nullif(left(btrim(p_declaration->>'company'),200),''), nullif(left(btrim(p_declaration->>'purpose'),300),''), nullif(left(btrim(p_declaration->>'host'),200),''), nullif(left(btrim(p_declaration->>'contact'),200),''), case when lower(p_declaration->>'entry_decision') = 'entry_restricted' then 'entry_restricted' else 'allowed' end, actor, request)
    returning * into row;
  end if;
  return to_jsonb(row) || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.factory_mesti_health_declaration_options()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_health_declaration.view') or public.current_user_has_permission('factory_mesti_health_declaration.create') or public.current_user_has_permission('factory_mesti_health_declaration.manage')) then raise exception using errcode='42501', message='Missing Health Declaration permission.'; end if;
  return jsonb_build_object('employees', coalesce((select jsonb_agg(jsonb_build_object('id', employee.id, 'name', employee.name, 'position', employee.employee_position, 'workplace', employee.workplace) order by employee.name) from public.factory_eligible_employees() employee),'[]'::jsonb));
end $$;

create or replace function public.factory_mesti_save_operator_hygiene(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
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
    join public.factory_eligible_employees() eligible on eligible.id = employee.id
    where employee.id = v_employee_id
    on conflict (session_id, employee_id) do update set
      clothing_result = excluded.clothing_result,
      hygiene_result = excluded.hygiene_result,
      overall_result = excluded.overall_result,
      issue = excluded.issue,
      action_taken = excluded.action_taken,
      notes = excluded.notes,
      updated_at = now();

    if not found then
      raise exception 'Selected employee is not eligible for Factory hygiene inspection.';
    end if;
  end loop;

  return to_jsonb(v_session);
end
$$;

create or replace function public.factory_mesti_operator_hygiene_daily(p_date date)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_operator_hygiene.view') or public.current_user_has_permission('factory_mesti_operator_hygiene.manage')) then
    raise exception using errcode = '42501', message = 'Missing hygiene view permission.';
  end if;

  return jsonb_build_object(
    'session', (
      select to_jsonb(session) || jsonb_build_object('submitted_by_name', coalesce(submitted_by.nickname, submitted_by.full_name), 'verified_by_name', coalesce(verified_by.nickname, verified_by.full_name))
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
      select jsonb_agg(jsonb_build_object('id', employee.id, 'name', employee.name, 'position', employee.employee_position, 'workplace', employee.workplace) order by employee.name)
      from public.factory_eligible_employees() employee
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.factory_mesti_operator_hygiene_monthly(p_month date)
returns setof jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_operator_hygiene.view') or public.current_user_has_permission('factory_mesti_operator_hygiene.manage')) then
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
  where exists (select 1 from public.factory_eligible_employees() eligible where eligible.id = employee.id)
    or exists (
      select 1
      from public.factory_mesti_operator_hygiene_entries historical_entry
      join public.factory_mesti_operator_hygiene_sessions historical_session on historical_session.id = historical_entry.session_id
      where historical_entry.employee_id = employee.id
        and historical_session.inspection_date >= date_trunc('month', p_month)::date
        and historical_session.inspection_date < (date_trunc('month', p_month)::date + interval '1 month')
    )
  group by employee.id, employee.nickname, employee.full_name, employee.position
  order by coalesce(employee.nickname, employee.full_name);
end
$$;

revoke all on function public.factory_mesti_submit_health_declaration(jsonb), public.factory_mesti_health_declaration_options(), public.factory_mesti_save_operator_hygiene(jsonb), public.factory_mesti_operator_hygiene_daily(date), public.factory_mesti_operator_hygiene_monthly(date) from public, anon;
grant execute on function public.factory_mesti_submit_health_declaration(jsonb), public.factory_mesti_health_declaration_options(), public.factory_mesti_save_operator_hygiene(jsonb), public.factory_mesti_operator_hygiene_daily(date), public.factory_mesti_operator_hygiene_monthly(date) to authenticated;
