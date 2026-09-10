-- Real Staging behavior/security verification for Factory MeSTI Operator Hygiene.
-- All fixture data rolls back.
begin;

do $$
declare
  recorder public.employees%rowtype;
  verifier public.employees%rowtype;
  operator_one public.employees%rowtype;
  operator_two public.employees%rowtype;
  qa_date date := current_date + 137;
  saved jsonb;
  daily jsonb;
  monthly_row jsonb;
  self_blocked boolean := false;
  immutable_blocked boolean := false;
begin
  select * into recorder
  from public.employees
  where auth_user_id is not null
    and is_active
    and coalesce(employment_status, 'active') = 'active'
  order by created_at
  limit 1;

  select * into verifier
  from public.employees
  where auth_user_id is not null
    and is_active
    and coalesce(employment_status, 'active') = 'active'
    and id <> recorder.id
  order by created_at desc
  limit 1;

  select * into operator_one
  from public.employees
  where is_active
    and coalesce(employment_status, 'active') = 'active'
  order by full_name
  limit 1;

  select * into operator_two
  from public.employees
  where is_active
    and coalesce(employment_status, 'active') = 'active'
    and id <> operator_one.id
  order by full_name desc
  limit 1;

  if recorder.id is null or verifier.id is null or operator_one.id is null or operator_two.id is null then
    raise exception 'FAIL staging needs two authenticated active employees and two active employees for operator hygiene QA.';
  end if;

  insert into public.role_permissions(role_id, permission_id)
  select roles.role_id, permission.id
  from (
    values (recorder.role_id), (verifier.role_id)
  ) as roles(role_id)
  cross join public.permissions permission
  where permission.code in (
    'factory_mesti_operator_hygiene.view',
    'factory_mesti_operator_hygiene.manage',
    'factory_mesti_operator_hygiene.submit',
    'factory_mesti_operator_hygiene.verify'
  )
  on conflict do nothing;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', recorder.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    perform public.factory_mesti_save_operator_hygiene(jsonb_build_object(
      'inspection_date', qa_date::text,
      'entries', jsonb_build_array(jsonb_build_object(
        'employee_id', operator_one.id::text,
        'clothing_result', 'fail',
        'hygiene_result', 'pass',
        'issue', 'Rollback QA missing action'
      ))
    ));
  exception when others then
    if sqlerrm like '%Issue and Action%' then
      self_blocked := true;
    else
      raise;
    end if;
  end;
  if not self_blocked then
    raise exception 'FAIL non-compliant entry without Action was accepted.';
  end if;
  self_blocked := false;

  saved := public.factory_mesti_save_operator_hygiene(jsonb_build_object(
    'inspection_date', qa_date::text,
    'entries', jsonb_build_array(
      jsonb_build_object(
        'employee_id', operator_one.id::text,
        'clothing_result', 'pass',
        'hygiene_result', 'pass'
      ),
      jsonb_build_object(
        'employee_id', operator_two.id::text,
        'clothing_result', 'fail',
        'hygiene_result', 'pass',
        'issue', 'Rollback QA clothing issue',
        'action_taken', 'Rollback QA replacement issued'
      )
    )
  ));

  daily := public.factory_mesti_operator_hygiene_daily(qa_date);
  if jsonb_array_length(daily->'entries') <> 2 then
    raise exception 'FAIL expected two inspection entries.';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(daily->'entries') entry
    where entry->>'overall_result' = 'non_compliant'
      and entry->>'issue' = 'Rollback QA clothing issue'
      and entry->>'action_taken' = 'Rollback QA replacement issued'
  ) then
    raise exception 'FAIL derived Overall or issue/action evidence is missing.';
  end if;

  perform public.factory_mesti_submit_operator_hygiene(qa_date);

  begin
    perform public.factory_mesti_save_operator_hygiene(jsonb_build_object('inspection_date', qa_date::text, 'entries', jsonb_build_array()));
  exception when others then
    if sqlerrm like '%immutable%' then
      immutable_blocked := true;
    else
      raise;
    end if;
  end;
  if not immutable_blocked then
    raise exception 'FAIL submitted session remained editable.';
  end if;

  begin
    perform public.factory_mesti_verify_operator_hygiene(qa_date);
  exception when others then
    if sqlerrm like '%Self-verification%' then
      self_blocked := true;
    else
      raise;
    end if;
  end;
  if not self_blocked then
    raise exception 'FAIL self-verification was not blocked.';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', verifier.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.factory_mesti_verify_operator_hygiene(qa_date);

  daily := public.factory_mesti_operator_hygiene_daily(qa_date);
  if daily->'session'->>'status' <> 'verified' or nullif(daily->'session'->>'verified_by_name', '') is null then
    raise exception 'FAIL verified session evidence is missing.';
  end if;

  select row into monthly_row
  from public.factory_mesti_operator_hygiene_monthly(date_trunc('month', qa_date)::date) row
  where row->>'employee_id' = operator_two.id::text;
  if monthly_row is null
    or monthly_row->'days'->qa_date::text->>'state' <> 'non_compliant'
    or monthly_row->'days'->qa_date::text->>'verified_by_name' is null then
    raise exception 'FAIL monthly Employee-centric evidence is missing verified day detail.';
  end if;

  execute 'reset role';
end
$$;

select 'PASS factory_mesti_operator_hygiene_lifecycle_staging' as result;

rollback;
