-- Real Staging behavior/security verification for Factory MeSTI Cleaning.
-- All fixture data rolls back.
begin;

create temporary table factory_mesti_cleaning_location_direct_results(
  test_count int,
  requirement_id uuid,
  occurrence_count int,
  non_storage_location uuid,
  storage_location uuid,
  final_status text
) on commit drop;

do $$
declare
  qa_admin constant uuid := 'b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd';
  qa_employee public.employees%rowtype;
  qa_role uuid;
  non_storage uuid;
  storage uuid;
  saved jsonb;
  saved_id uuid;
  occurrence_id uuid;
  occurrence_count int;
  final_status text;
  old_area_tables int;
  location_unique int;
begin
  select * into qa_employee
  from public.employees
  where auth_user_id=qa_admin and is_active;
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

  select count(*) into old_area_tables
  from information_schema.tables
  where table_schema='public'
    and table_name in ('factory_mesti_cleaning_areas','factory_mesti_cleaning_requirement_areas');
  if old_area_tables <> 0 then
    raise exception 'FAIL redundant Cleaning Area tables still exist.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='factory_mesti_cleaning_occurrences'
      and column_name='area_id'
  ) then
    raise exception 'FAIL occurrence area_id column still exists.';
  end if;

  select count(*) into location_unique
  from pg_indexes
  where schemaname='public'
    and tablename='factory_mesti_cleaning_occurrences'
    and indexname='factory_mesti_cleaning_occurrences_logical_location_due_key';
  if location_unique <> 1 then
    raise exception 'FAIL logical requirement/location/due date unique index is missing.';
  end if;

  select id into non_storage
  from public.factory_storage_locations
  where status='active' and coalesce(is_storage_location,false)=false
  order by location_name
  limit 1;
  select id into storage
  from public.factory_storage_locations
  where status='active' and is_storage_location=true and id is distinct from non_storage
  order by location_name
  limit 1;
  if non_storage is null or storage is null then
    raise exception 'FAIL staging needs active storage and non-storage Factory Locations.';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', qa_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  saved := public.factory_save_mesti_cleaning_requirement(jsonb_build_object(
    'task_name', 'QA Location Direct Rollback',
    'location_ids', jsonb_build_array(non_storage::text, storage::text),
    'recurrence_type', 'daily',
    'recurrence_weekdays', jsonb_build_array(),
    'status', 'active',
    'effective_from', current_date::text
  ));
  saved_id := (saved->>'id')::uuid;

  perform public.factory_mesti_materialize_cleaning_occurrences(current_date, current_date);
  select count(*) into occurrence_count
  from public.factory_mesti_cleaning_occurrences
  where requirement_id=saved_id and due_date=current_date;
  if occurrence_count <> 2 then
    raise exception 'FAIL expected one occurrence per selected Location, got %.', occurrence_count;
  end if;

  if exists (
    select 1
    from public.factory_mesti_cleaning_occurrences
    where requirement_id=saved_id
      and due_date=current_date
      and (
        requirement_snapshot ? 'area_id'
        or requirement_snapshot ? 'area_name'
        or requirement_snapshot->>'location_id' is null
        or requirement_snapshot->>'location_name' is null
      )
  ) then
    raise exception 'FAIL occurrence snapshot is not Location-direct.';
  end if;

  if jsonb_array_length(public.factory_mesti_cleaning_day(current_date)) < 2 then
    raise exception 'FAIL daily RPC did not return Location-direct occurrences.';
  end if;
  if jsonb_array_length(public.factory_mesti_cleaning_month(date_trunc('month', current_date)::date)) < 2 then
    raise exception 'FAIL monthly RPC did not return Location-direct occurrences.';
  end if;

  select id into occurrence_id
  from public.factory_mesti_cleaning_occurrences
  where requirement_id=saved_id and due_date=current_date
  order by location_id
  limit 1;
  perform public.factory_mesti_complete_cleaning_occurrence(occurrence_id, 'rollback QA completion');
  execute 'reset role';

  select status into final_status
  from public.factory_mesti_cleaning_occurrences
  where id=occurrence_id;
  if final_status <> 'completed' then
    raise exception 'FAIL canonical completion lifecycle ended at %.', final_status;
  end if;

  insert into factory_mesti_cleaning_location_direct_results
  values (7, saved_id, occurrence_count, non_storage, storage, final_status);
  raise notice 'FACTORY_MESTI_CLEANING_LOCATION_DIRECT_PASS 7/7 requirement=% occurrences=% final_status=%', saved_id, occurrence_count, final_status;
end $$;

select * from factory_mesti_cleaning_location_direct_results;
rollback;
