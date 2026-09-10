-- Preserve historical symptom values while restricting new submissions to the
-- expanded, separately identifiable Factory Health Declaration taxonomy.
alter table public.factory_mesti_health_declarations
  add column if not exists other_symptom_detail text;

alter table public.factory_mesti_health_declarations
  drop constraint if exists factory_mesti_health_declarations_symptoms_check;

alter table public.factory_mesti_health_declarations
  add constraint factory_mesti_health_declarations_symptoms_check check (
    symptoms <@ array[
      'diarrhea',
      'vomiting',
      'fever',
      'jaundice',
      'sore_throat',
      'skin_infection_open_wound',
      'eye_infection_discharge',
      'ear_infection_discharge',
      'nose_infection_discharge',
      'other',
      'visible_skin_infection',
      'ear_nose_eye_infection'
    ]
  );

create or replace function public.factory_mesti_submit_health_declaration(p_declaration jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := public.factory_current_active_employee_id();
  kind text := lower(btrim(p_declaration->>'declaration_type'));
  symptom_values text[] := coalesce(array(
    select distinct lower(btrim(value))
    from jsonb_array_elements_text(coalesce(p_declaration->'symptoms', '[]'::jsonb)) value
    where btrim(value) <> ''
    order by lower(btrim(value))
  ), '{}'::text[]);
  allowed_symptoms constant text[] := array[
    'diarrhea', 'vomiting', 'fever', 'jaundice', 'sore_throat',
    'skin_infection_open_wound', 'eye_infection_discharge',
    'ear_infection_discharge', 'nose_infection_discharge', 'other'
  ];
  other_detail text := nullif(left(btrim(p_declaration->>'other_symptom_detail'), 2000), '');
  employee public.employees%rowtype;
  row public.factory_mesti_health_declarations%rowtype;
  request uuid := nullif(p_declaration->>'request_id','')::uuid;
  visitor text := nullif(left(btrim(p_declaration->>'visitor_name'), 200), '');
begin
  if not (public.current_user_has_permission('factory_mesti_health_declaration.create') or public.current_user_has_permission('factory_mesti_health_declaration.manage')) then
    raise exception using errcode='42501', message='Missing Health Declaration record permission.';
  end if;
  if kind not in ('employee','visitor') then
    raise exception using errcode='22023', message='Declaration type must be Employee or Visitor.';
  end if;
  if not (symptom_values <@ allowed_symptoms) then
    raise exception using errcode='22023', message='One or more symptoms are invalid.';
  end if;
  if 'other' = any(symptom_values) and other_detail is null then
    raise exception using errcode='22023', message='Please specify the Other symptom.';
  end if;
  if 'other' <> all(symptom_values) and other_detail is not null then
    raise exception using errcode='22023', message='Other symptom details require Other to be selected.';
  end if;
  if request is not null then
    select * into row from public.factory_mesti_health_declarations where created_by=actor and request_id=request;
    if row.id is not null then
      return to_jsonb(row) || jsonb_build_object('idempotent', true);
    end if;
  end if;
  if kind = 'employee' then
    select e.* into employee
    from public.employees e
    join public.factory_eligible_employees() eligible on eligible.id = e.id
    where e.id = nullif(p_declaration->>'employee_id','')::uuid;
    if employee.id is null then
      raise exception using errcode='22023', message='Select an eligible Factory Employee.';
    end if;
    insert into public.factory_mesti_health_declarations(
      declaration_type, health_status, symptoms, other_symptom_detail, notes, employee_id, employee_snapshot, created_by, request_id
    ) values (
      'employee', case when cardinality(symptom_values)=0 then 'fit_for_work' else 'health_issue_declared' end,
      symptom_values, other_detail, nullif(left(btrim(p_declaration->>'notes'), 2000), ''), employee.id,
      public.factory_mesti_health_declaration_employee_snapshot(employee), actor, request
    ) returning * into row;
  else
    if visitor is null then
      raise exception using errcode='22023', message='Visitor Name is required.';
    end if;
    insert into public.factory_mesti_health_declarations(
      declaration_type, health_status, symptoms, other_symptom_detail, notes, visitor_name, visitor_company, visitor_purpose,
      visitor_host, visitor_contact, entry_decision, created_by, request_id
    ) values (
      'visitor', case when cardinality(symptom_values)=0 then 'cleared' else 'health_issue_declared' end,
      symptom_values, other_detail, nullif(left(btrim(p_declaration->>'notes'), 2000), ''), visitor,
      nullif(left(btrim(p_declaration->>'company'), 200), ''), nullif(left(btrim(p_declaration->>'purpose'), 300), ''),
      nullif(left(btrim(p_declaration->>'host'), 200), ''), nullif(left(btrim(p_declaration->>'contact'), 200), ''),
      case when lower(p_declaration->>'entry_decision') = 'entry_restricted' then 'entry_restricted' else 'allowed' end, actor, request
    ) returning * into row;
  end if;
  return to_jsonb(row) || jsonb_build_object('idempotent', false);
end
$$;

create or replace function public.factory_mesti_health_declaration_records(
  p_date_from date default null,
  p_date_to date default null,
  p_type text default null,
  p_health_status text default null,
  p_symptom text default null,
  p_search text default null
)
returns setof jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_health_declaration.view') or public.current_user_has_permission('factory_mesti_health_declaration.manage')) then
    raise exception using errcode='42501', message='Missing Health Declaration view permission.';
  end if;
  return query
  select jsonb_build_object(
    'id', d.id, 'declaration_type', d.declaration_type, 'declared_at', d.declared_at, 'health_status', d.health_status,
    'symptoms', d.symptoms, 'other_symptom_detail', d.other_symptom_detail, 'notes', d.notes, 'employee_id', d.employee_id,
    'employee_snapshot', d.employee_snapshot, 'visitor_name', d.visitor_name, 'visitor_company', d.visitor_company,
    'visitor_purpose', d.visitor_purpose, 'visitor_host', d.visitor_host, 'visitor_contact', d.visitor_contact,
    'work_action', d.work_action, 'action_notes', d.action_notes, 'entry_decision', d.entry_decision,
    'recorded_by_name', coalesce(recorder.nickname, recorder.full_name), 'reviewed_by_name', coalesce(reviewer.nickname, reviewer.full_name),
    'reviewed_at', d.reviewed_at, 'created_at', d.created_at
  )
  from public.factory_mesti_health_declarations d
  left join public.employees recorder on recorder.id=d.created_by
  left join public.employees reviewer on reviewer.id=d.reviewed_by
  where (p_date_from is null or d.declared_at::date >= p_date_from)
    and (p_date_to is null or d.declared_at::date <= p_date_to)
    and (p_type is null or d.declaration_type=p_type)
    and (p_health_status is null or d.health_status=p_health_status)
    and (p_symptom is null or (p_symptom = 'no_symptoms' and cardinality(d.symptoms) = 0) or p_symptom=any(d.symptoms))
    and (p_search is null or lower(concat_ws(' ',d.employee_snapshot->>'employee_name',d.visitor_name,d.visitor_company)) like '%'||lower(p_search)||'%')
  order by d.declared_at desc, d.created_at desc;
end
$$;

revoke all on function public.factory_mesti_submit_health_declaration(jsonb), public.factory_mesti_health_declaration_records(date,date,text,text,text,text) from public, anon;
grant execute on function public.factory_mesti_submit_health_declaration(jsonb), public.factory_mesti_health_declaration_records(date,date,text,text,text,text) to authenticated;
