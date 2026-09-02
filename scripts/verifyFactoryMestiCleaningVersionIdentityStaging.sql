-- Real Staging behavior/security verification for MeSTI version identity.
-- All fixture data and temporary grants roll back.
begin;

create temporary table factory_mesti_cleaning_version_identity_results(
  test_count int,
  requirement_id uuid,
  logical_requirement_id uuid,
  version_no int,
  occurrence_count int,
  final_status text
) on commit drop;

do $$
declare
  qa_admin constant uuid := 'b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd';
  qa_employee public.employees%rowtype;
  qa_role uuid;
  first_location uuid;
  second_location uuid;
  created jsonb;
  unchanged jsonb;
  edited jsonb;
  created_id uuid;
  created_logical_id uuid;
  occurrence_id uuid;
  occurrence_count int;
  version_count int;
  final_status text;
  daily_count int;
  monthly_count int;
begin
  select * into qa_employee
  from public.employees
  where auth_user_id = qa_admin and is_active;
  if qa_employee.id is null then
    raise exception 'FAIL QA admin employee is missing.';
  end if;
  qa_role := qa_employee.role_id;

  insert into public.role_permissions(role_id, permission_id)
  select qa_role, id
  from public.permissions
  where code in (
    'factory_mesti_cleaning.view',
    'factory_mesti_cleaning.create',
    'factory_mesti_cleaning.edit',
    'factory_mesti_cleaning.complete',
    'factory_mesti_cleaning.review',
    'factory_mesti_cleaning.manage'
  )
  on conflict do nothing;

  select id into first_location
  from public.factory_storage_locations
  where status = 'active'
  order by location_name
  limit 1;
  select id into second_location
  from public.factory_storage_locations
  where status = 'active' and id <> first_location
  order by location_name
  limit 1;
  if first_location is null or second_location is null then
    raise exception 'FAIL Staging needs two active Factory Locations.';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', qa_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  perform public.factory_save_mesti_cleaning_settings(jsonb_build_object(
    'responsible_role_id', qa_role::text,
    'verifier_role_id', qa_role::text
  ));

  created := public.factory_save_mesti_cleaning_requirement(jsonb_build_object(
    'task_name', 'QA Version Identity Rollback',
    'location_ids', jsonb_build_array(second_location::text, first_location::text),
    'recurrence_type', 'daily',
    'recurrence_weekdays', jsonb_build_array(),
    'status', 'active',
    'effective_from', current_date::text
  ));
  created_id := (created->>'id')::uuid;
  created_logical_id := (created->>'logical_requirement_id')::uuid;
  if coalesce((created->>'version_created')::boolean, false) is not true then
    raise exception 'FAIL initial save did not create a version.';
  end if;

  unchanged := public.factory_save_mesti_cleaning_requirement(jsonb_build_object(
    'id', created_id::text,
    'task_name', 'QA Version Identity Rollback',
    'location_ids', jsonb_build_array(first_location::text, second_location::text),
    'recurrence_type', 'daily',
    'recurrence_weekdays', jsonb_build_array(),
    'status', 'active',
    'effective_from', current_date::text
  ));
  if (unchanged->>'id')::uuid <> created_id
    or coalesce((unchanged->>'version_created')::boolean, true) then
    raise exception 'FAIL identical save created a new version.';
  end if;

  select count(*) into version_count
  from public.factory_mesti_cleaning_requirements
  where logical_requirement_id = created_logical_id;
  if version_count <> 1 then
    raise exception 'FAIL identical save created % versions.', version_count;
  end if;
  select count(*) into occurrence_count
  from public.factory_mesti_cleaning_requirement_locations
  where requirement_id = created_id;
  if occurrence_count <> 2 then
    raise exception 'FAIL identical save created duplicate Location links.';
  end if;

  perform public.factory_mesti_materialize_cleaning_occurrences(current_date, current_date);
  perform public.factory_mesti_materialize_cleaning_occurrences(current_date, current_date);
  select count(*) into occurrence_count
  from public.factory_mesti_cleaning_occurrences
  where logical_requirement_id = created_logical_id and due_date = current_date;
  if occurrence_count <> 2 then
    raise exception 'FAIL repeated materialization created % occurrences.', occurrence_count;
  end if;

  edited := public.factory_save_mesti_cleaning_requirement(jsonb_build_object(
    'id', created_id::text,
    'task_name', 'QA Version Identity Rollback',
    'location_ids', jsonb_build_array(first_location::text, second_location::text),
    'recurrence_type', 'weekly',
    'recurrence_weekdays', jsonb_build_array(extract(isodow from current_date + 1)::int),
    'status', 'active',
    'effective_from', (current_date + 1)::text
  ));
  if coalesce((edited->>'version_created')::boolean, false) is not true
    or (edited->>'logical_requirement_id')::uuid <> created_logical_id
    or (edited->>'version_no')::int <> 2 then
    raise exception 'FAIL real edit did not create exactly one logical version transition.';
  end if;

  select count(*) into version_count
  from public.factory_mesti_cleaning_requirements
  where logical_requirement_id = created_logical_id;
  if version_count <> 2 then
    raise exception 'FAIL real edit created % versions.', version_count;
  end if;
  if exists (
    select 1
    from public.factory_mesti_cleaning_requirements
    where logical_requirement_id = created_logical_id
      and version_no = 1
      and effective_until <> current_date + 1
  ) then
    raise exception 'FAIL old version did not stop at the edit boundary.';
  end if;

  perform public.factory_mesti_materialize_cleaning_occurrences(current_date + 1, current_date + 1);
  select count(*) into occurrence_count
  from public.factory_mesti_cleaning_occurrences
  where logical_requirement_id = created_logical_id and due_date = current_date + 1;
  if occurrence_count <> 2 then
    raise exception 'FAIL edited multi-Location schedule did not produce one row per Location.';
  end if;

  select id into occurrence_id
  from public.factory_mesti_cleaning_occurrences
  where logical_requirement_id = created_logical_id and due_date = current_date
  order by location_id
  limit 1;
  perform public.factory_mesti_complete_cleaning_occurrence(occurrence_id, 'rollback QA completion');
  perform public.factory_mesti_verify_cleaning_occurrence(occurrence_id, 'verified', 'rollback QA verification');
  execute 'reset role';

  select status into final_status
  from public.factory_mesti_cleaning_occurrences
  where id = occurrence_id;
  if final_status <> 'verified' then
    raise exception 'FAIL completion/verification lifecycle ended at %.', final_status;
  end if;

  execute 'set local role authenticated';
  edited := public.factory_save_mesti_cleaning_requirement(jsonb_build_object(
    'id', (edited->>'id'),
    'task_name', 'QA Version Identity Rollback Revised',
    'location_ids', jsonb_build_array(first_location::text, second_location::text),
    'recurrence_type', 'weekly',
    'recurrence_weekdays', jsonb_build_array(extract(isodow from current_date + 2)::int),
    'status', 'active',
    'effective_from', (current_date + 2)::text
  ));
  execute 'reset role';
  if (edited->>'version_no')::int <> 3 then
    raise exception 'FAIL later real edit did not create exactly one next version.';
  end if;
  select status into final_status
  from public.factory_mesti_cleaning_occurrences
  where id = occurrence_id;
  if final_status <> 'verified' then
    raise exception 'FAIL later edit rewrote verified historical occurrence.';
  end if;

  select count(*) into daily_count
  from jsonb_array_elements(public.factory_mesti_cleaning_day(current_date)) row(value)
  where row.value->>'task_name' = 'QA Version Identity Rollback';
  select count(*) into monthly_count
  from jsonb_array_elements(public.factory_mesti_cleaning_month(date_trunc('month', current_date)::date)) requirement(value)
  cross join lateral jsonb_array_elements(requirement.value->'days') day(value)
  where requirement.value->>'logical_requirement_id' = created_logical_id::text
    and day.value->>'due_date' = current_date::text
    and jsonb_array_length(day.value->'occurrences') = 2;
  if daily_count <> 2 or monthly_count <> 1 then
    raise exception 'FAIL Daily/Monthly did not return canonical Task/Location/date evidence.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(public.factory_mesti_cleaning_month(date_trunc('month', current_date)::date)) requirement(value)
    cross join lateral jsonb_array_elements(requirement.value->'days') day(value)
    where requirement.value->>'logical_requirement_id' = created_logical_id::text
      and day.value->>'due_date' = current_date::text
      and day.value->>'status' <> 'mixed'
  ) then
    raise exception 'FAIL Monthly did not aggregate Location states under the logical requirement.';
  end if;

  insert into factory_mesti_cleaning_version_identity_results
  values (14, created_id, created_logical_id, (edited->>'version_no')::int, occurrence_count, final_status);
  raise notice 'FACTORY_MESTI_CLEANING_VERSION_IDENTITY_PASS 14/14 requirement=% logical_requirement=%', created_id, created_logical_id;
end $$;

select * from factory_mesti_cleaning_version_identity_results;
rollback;
