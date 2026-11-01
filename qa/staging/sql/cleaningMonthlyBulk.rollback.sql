-- Staging-only regression, all evidence/audit changes roll back. Requires two issued Pending rows.
begin;
select set_config('request.jwt.claim.sub', (select e.auth_user_id::text from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null limit 1), true);
do $qa$
declare
  v_requirement uuid; v_date date; v_id uuid; v_other uuid;
  v_preview jsonb; v_expected jsonb; v_result jsonb; v_audits integer;
begin
  select requirement_id,due_date into v_requirement,v_date from public.factory_mesti_cleaning_occurrences
  where status='pending' and due_date <= (now() at time zone 'Asia/Kuala_Lumpur')::date
  group by requirement_id,due_date having count(*)>=2 order by due_date desc limit 1;
  if v_requirement is null then raise exception 'Regression requires a disposable task/date with two Pending Locations.'; end if;
  v_preview := public.factory_mesti_cleaning_task_action(v_requirement,v_date);
  assert (v_preview->>'complete_count')::integer>=2, 'Pending eligibility';
  select jsonb_object_agg(r->>'id',r->>'token') into v_expected from jsonb_array_elements(v_preview->'records') r;
  select (r->>'id')::uuid into v_id from jsonb_array_elements(v_preview->'records') r where (r->>'can_complete')::boolean limit 1;
  perform public.factory_mesti_complete_cleaning_occurrence(v_id,null);
  select count(*) into v_audits from public.audit_logs where metadata->>'bulk_task_action'='true';
  v_result := public.factory_mesti_cleaning_task_action(v_requirement,v_date,'complete',v_expected);
  assert (v_result->>'affected_count')::integer=(v_preview->>'complete_count')::integer-1, 'Concurrent record was skipped';
  assert (v_result->>'skipped_count')::integer>=1 and (v_result->>'failed_count')::integer=0, 'Exact partial outcomes';
  assert (select count(*) from public.audit_logs where metadata->>'bulk_task_action'='true')=v_audits+(v_result->>'affected_count')::integer, 'Per-record atomic audit';
  v_result := public.factory_mesti_cleaning_task_action(v_requirement,v_date,'complete',v_expected);
  assert (v_result->>'affected_count')::integer=0, 'Repeated confirmed payload cannot complete again';
  v_preview := public.factory_mesti_cleaning_task_action(v_requirement,v_date);
  assert (v_preview->>'verify_count')::integer=0, 'Self-verification excluded even for Owner';
  select jsonb_object_agg(r->>'id',r->>'token') into v_expected from jsonb_array_elements(v_preview->'records') r;
  v_result := public.factory_mesti_cleaning_task_action(v_requirement,v_date,'verify',v_expected);
  assert (v_result->>'affected_count')::integer=0, 'Server rejects self-verification';
  select id into v_other from public.employees where id<>public.factory_current_active_employee_id() limit 1;
  assert v_other is not null, 'Independent actor fixture';
  -- Transient alternate completer fixture; no evidence survives the rollback.
  update public.factory_mesti_cleaning_occurrences set completed_by=v_other where id=v_id;
  v_preview := public.factory_mesti_cleaning_task_action(v_requirement,v_date);
  assert (v_preview->>'verify_count')::integer=1, 'Independent Completed eligibility';
  select jsonb_object_agg(r->>'id',r->>'token') into v_expected from jsonb_array_elements(v_preview->'records') r;
  v_result := public.factory_mesti_cleaning_task_action(v_requirement,v_date,'verify',v_expected);
  assert (v_result->>'affected_count')::integer=1 and (v_result->>'skipped_count')::integer>=1, 'Mixed independent/self outcomes';
  assert (select status from public.factory_mesti_cleaning_occurrences where id=v_id)='verified', 'Canonical Verify transition';
  update public.factory_mesti_cleaning_occurrences set status='unsatisfactory' where requirement_id=v_requirement and due_date=v_date;
  v_preview := public.factory_mesti_cleaning_task_action(v_requirement,v_date);
  assert (v_preview->>'complete_count')::integer=0, 'Bulk Complete excludes Unsatisfactory';
  select jsonb_object_agg(r->>'id',r->>'token') into v_expected from jsonb_array_elements(v_preview->'records') r;
  v_result := public.factory_mesti_cleaning_task_action(v_requirement,v_date,'complete',v_expected);
  assert (v_result->>'affected_count')::integer=0, 'Unsatisfactory cannot be bulk completed';
  begin
    perform public.factory_mesti_cleaning_task_action(v_requirement,(now() at time zone 'Asia/Kuala_Lumpur')::date+1,'complete','{}');
    raise exception 'Future bulk action unexpectedly allowed';
  exception when invalid_parameter_value then null; end;
  assert not has_function_privilege('anon','public.factory_mesti_cleaning_task_action(uuid,date,text,jsonb)','EXECUTE'), 'No anonymous execution';
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
  begin
    perform public.factory_mesti_cleaning_task_action(v_requirement,v_date);
    raise exception 'Missing authenticated employee unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $qa$;
select 'Cleaning task bulk rollback regression passed' as result;
rollback;
