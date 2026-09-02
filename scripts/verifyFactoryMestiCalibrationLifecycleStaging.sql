-- Real Staging Calibration lifecycle verification. Every fixture and permission change rolls back.
begin;

do $$
declare
  recorder public.employees%rowtype;
  verifier public.employees%rowtype;
  recorder_role uuid;
  verifier_role uuid;
  location_id uuid;
  category_id uuid;
  equipment_id uuid;
  requirement jsonb;
  unchanged jsonb;
  revised jsonb;
  pass_record jsonb;
  fail_record jsonb;
  recovery_record jsonb;
  pending_record jsonb;
  requirement_id uuid;
  logical_id uuid;
  first_version_id uuid;
  first_snapshot jsonb;
  schedule_row jsonb;
  expected_due date;
  version_count integer;
  duplicate_blocked boolean := false;
  self_blocked boolean := false;
  record_permission_blocked boolean := false;
  setup_permission_blocked boolean := false;
begin
  select * into recorder from public.employees where auth_user_id is not null and lower(coalesce(employment_status, ''))='active' and enable_system_login and access_state='active' and coalesce(is_active, true) order by created_at limit 1;
  select * into verifier from public.employees where auth_user_id is not null and lower(coalesce(employment_status, ''))='active' and enable_system_login and access_state='active' and coalesce(is_active, true) and id <> recorder.id order by created_at limit 1;
  if recorder.id is null or verifier.id is null then raise exception 'FAIL Staging needs two active authenticated employees.'; end if;
  select id into equipment_id from public.factory_equipment where status='active' order by equipment_code limit 1;
  if equipment_id is null then
    select id into location_id from public.factory_storage_locations where status='active' order by location_name limit 1;
    if location_id is null then raise exception 'FAIL Staging needs one active Factory Location.'; end if;
    insert into public.factory_equipment_categories(name, category_code, status) values ('QA Calibration Rollback', 'QA-CAL-RB-' || txid_current()::text, 'active') returning id into category_id;
    insert into public.factory_equipment(equipment_code, name, category_id, current_location_id, status) values ('QA-CAL-RB-' || txid_current()::text, 'QA Calibration Rollback Equipment', category_id, location_id, 'active') returning id into equipment_id;
  end if;

  insert into public.roles(name, description, is_active) values ('QA Calibration Recorder Rollback', 'Rollback-only Staging QA', true) returning id into recorder_role;
  insert into public.roles(name, description, is_active) values ('QA Calibration Verifier Rollback', 'Rollback-only Staging QA', true) returning id into verifier_role;
  update public.employees set role_id=recorder_role where id=recorder.id;
  update public.employees set role_id=verifier_role where id=verifier.id;
  insert into public.role_permissions(role_id, permission_id)
  select recorder_role, id from public.permissions
  where code in ('factory_mesti_calibration.view','factory_mesti_calibration.create','factory_mesti_calibration.edit','factory_mesti_calibration.complete','factory_mesti_calibration.review');
  insert into public.role_permissions(role_id, permission_id)
  select verifier_role, id from public.permissions
  where code in ('factory_mesti_calibration.view','factory_mesti_calibration.review');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', recorder.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  requirement := public.factory_save_mesti_calibration_requirement(jsonb_build_object('equipment_id', equipment_id::text, 'calibration_type', 'QA Rollback Calibration', 'interval_months', 1, 'effective_from', (current_date + 1)::text, 'status', 'active'));
  requirement_id := (requirement->>'id')::uuid;
  first_version_id := requirement_id;
  logical_id := (requirement->>'logical_requirement_id')::uuid;
  if coalesce((requirement->>'version_created')::boolean, false) is not true then raise exception 'FAIL create did not create Version 1.'; end if;
  unchanged := public.factory_save_mesti_calibration_requirement(jsonb_build_object('id', requirement_id::text, 'equipment_id', equipment_id::text, 'calibration_type', 'QA Rollback Calibration', 'interval_months', 1, 'effective_from', (current_date + 1)::text, 'status', 'active'));
  if (unchanged->>'id')::uuid <> requirement_id or coalesce((unchanged->>'version_created')::boolean, true) then raise exception 'FAIL unchanged Save created a version.'; end if;
  select count(*) into version_count from public.factory_mesti_calibration_requirements where logical_requirement_id=logical_id;
  if version_count <> 1 then raise exception 'FAIL unchanged Save created % versions.', version_count; end if;
  begin
    perform public.factory_save_mesti_calibration_requirement(jsonb_build_object('equipment_id', equipment_id::text, 'calibration_type', 'qa rollback calibration', 'interval_months', 3, 'effective_from', (current_date + 1)::text, 'status', 'active'));
  exception when unique_violation then duplicate_blocked := true;
  end;
  if not duplicate_blocked then raise exception 'FAIL duplicate active Equipment + Calibration Type was not blocked.'; end if;
  if public.factory_mesti_calibration_due_date('2024-01-31', 1) <> '2024-02-29'::date
    or public.factory_mesti_calibration_due_date('2024-11-30', 3) <> '2025-02-28'::date
    or public.factory_mesti_calibration_due_date('2024-08-31', 6) <> '2025-02-28'::date
    or public.factory_mesti_calibration_due_date('2024-02-29', 12) <> '2025-02-28'::date then raise exception 'FAIL month-end or leap-year due calculation.'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', verifier.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.factory_save_mesti_calibration_requirement(jsonb_build_object('id', requirement_id::text, 'equipment_id', equipment_id::text, 'calibration_type', 'QA Rollback Calibration', 'interval_months', 1, 'effective_from', (current_date + 1)::text, 'status', 'active'));
  exception when others then
    setup_permission_blocked := sqlerrm like '%Missing calibration setup permission%';
  end;
  execute 'reset role';
  if not setup_permission_blocked then raise exception 'FAIL setup management permission was not enforced.'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', recorder.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  pass_record := public.factory_mesti_record_calibration(requirement_id, jsonb_build_object('scheduled_due_date', (current_date + 1)::text, 'calibrated_date', (current_date + 1)::text, 'result', 'pass', 'provider_name', 'Rollback QA'));
  execute 'reset role';
  first_snapshot := pass_record->'equipment_snapshot';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', verifier.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.factory_mesti_verify_calibration((pass_record->>'id')::uuid);
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', verifier.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select value into schedule_row from public.factory_mesti_calibration_schedule() value where (value->>'logical_requirement_id')::uuid=logical_id;
  if not exists (select 1 from public.factory_mesti_calibration_records() value where (value->>'id')::uuid=(pass_record->>'id')::uuid) then raise exception 'FAIL authenticated record read-model omitted the verified Pass.'; end if;
  execute 'reset role';
  expected_due := public.factory_mesti_calibration_due_date(current_date + 1, 1);
  if schedule_row->>'status' not in ('current','due_soon','due','overdue') or (schedule_row->>'last_calibration')::date <> current_date + 1 or (schedule_row->>'next_due')::date <> expected_due then raise exception 'FAIL verified Pass did not advance Last Valid Calibration and Next Due.'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', recorder.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  fail_record := public.factory_mesti_record_calibration(requirement_id, jsonb_build_object('scheduled_due_date', expected_due::text, 'calibrated_date', expected_due::text, 'result', 'fail', 'provider_name', 'Rollback QA'));
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', verifier.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.factory_mesti_verify_calibration((fail_record->>'id')::uuid);
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', verifier.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select value into schedule_row from public.factory_mesti_calibration_schedule() value where (value->>'logical_requirement_id')::uuid=logical_id;
  execute 'reset role';
  if schedule_row->>'status' <> 'failed' or (schedule_row->>'last_calibration')::date <> current_date + 1 or (schedule_row->>'next_due')::date <> expected_due then raise exception 'FAIL verified Fail advanced validity or did not remain Failed.'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', recorder.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  recovery_record := public.factory_mesti_record_calibration(requirement_id, jsonb_build_object('scheduled_due_date', expected_due::text, 'calibrated_date', (expected_due + 1)::text, 'result', 'pass', 'provider_name', 'Rollback QA'));
  pending_record := public.factory_mesti_record_calibration(requirement_id, jsonb_build_object('scheduled_due_date', expected_due::text, 'calibrated_date', (expected_due + 2)::text, 'result', 'pass', 'provider_name', 'Rollback QA'));
  begin perform public.factory_mesti_verify_calibration((pending_record->>'id')::uuid); exception when others then self_blocked := sqlerrm like '%Self-verification%'; end;
  execute 'reset role';
  if not self_blocked then raise exception 'FAIL self-verification was not denied.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', verifier.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.factory_mesti_record_calibration(requirement_id, jsonb_build_object('scheduled_due_date', expected_due::text, 'calibrated_date', (expected_due + 3)::text, 'result', 'pass')); exception when others then record_permission_blocked := sqlerrm like '%Missing calibration record permission%'; end;
  perform public.factory_mesti_verify_calibration((recovery_record->>'id')::uuid);
  execute 'reset role';
  if not record_permission_blocked then raise exception 'FAIL calibration record permission was not enforced.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', verifier.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select value into schedule_row from public.factory_mesti_calibration_schedule() value where (value->>'logical_requirement_id')::uuid=logical_id;
  execute 'reset role';
  if schedule_row->>'status' in ('failed','inactive') or (schedule_row->>'last_calibration')::date <> expected_due + 1 or (schedule_row->>'next_due')::date <> public.factory_mesti_calibration_due_date(expected_due + 1, 1) then raise exception 'FAIL later verified Pass did not restore validity.'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', recorder.auth_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  revised := public.factory_save_mesti_calibration_requirement(jsonb_build_object('id', requirement_id::text, 'equipment_id', equipment_id::text, 'calibration_type', 'QA Rollback Calibration Revised', 'interval_months', 3, 'effective_from', (expected_due + 2)::text, 'status', 'active'));
  execute 'reset role';
  if coalesce((revised->>'version_created')::boolean, false) is not true or (revised->>'logical_requirement_id')::uuid <> logical_id or (revised->>'version_no')::integer <> 2 then raise exception 'FAIL real edit did not create one correct version transition.'; end if;
  if exists (select 1 from public.factory_mesti_calibration_records r where r.id=(pass_record->>'id')::uuid and (r.requirement_id <> first_version_id or r.equipment_snapshot <> first_snapshot)) then raise exception 'FAIL requirement edit rewrote historical calibration evidence.'; end if;
  if exists (select 1 from public.factory_mesti_calibration_requirements where logical_requirement_id=logical_id group by logical_requirement_id having count(*) <> 2 or count(*) filter(where effective_until is null) <> 1) then raise exception 'FAIL version effective boundaries are not canonical.'; end if;
  raise notice 'FACTORY_MESTI_CALIBRATION_LIFECYCLE_PASS requirement=% logical_requirement=%', requirement_id, logical_id;
end $$;

rollback;
