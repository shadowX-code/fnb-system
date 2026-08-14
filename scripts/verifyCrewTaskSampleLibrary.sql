-- Read-only/rollback verification for the Staging Crew Task sample library.

begin;

create temporary table crew_task_sample_verification(
  check_name text primary key,
  passed boolean not null,
  detail jsonb not null default '{}'::jsonb
) on commit drop;

do $$
declare
  v_outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  v_today date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_employee uuid;
  v_token constant text := 'crew-task-sample-verification-token';
  v_payload jsonb;
  v_instance uuid;
  v_pass boolean;
begin
  insert into crew_task_sample_verification
  select 'exact_15_active_tasks', count(*) = 15,
         jsonb_build_object('count', count(*), 'names', jsonb_agg(t.name order by t.name))
  from public.crew_operation_templates t
  where t.outlet_id = v_outlet
    and t.status = 'active'
    and t.name in (
      '[QA] Opening Checklist','[QA] Closing Checklist','[QA] Fridge Temperature Check','[QA] Store Health Check',
      '[QA] Customer Complaint Follow-up','[QA] Cashier Float Verification','[QA] Coffee Machine Cleaning','[QA] Stock Shelving',
      '[QA] New Menu Briefing','[QA] Pest Safety Incident Check','[QA] Weekly Deep Cleaning','[QA] Monthly Equipment Inspection',
      '[QA] SOP Acknowledgement Task','[QA] Simple Reminder Task','[QA] Complex 15-block QA Task'
    );

  insert into crew_task_sample_verification
  select 'all_5_task_types', count(distinct task_type) = 5,
         jsonb_build_object('types', jsonb_agg(distinct task_type))
  from public.crew_operation_templates
  where outlet_id = v_outlet and status = 'active' and name like '[QA] %';

  insert into crew_task_sample_verification
  select 'all_3_schedule_types', count(distinct schedule_type) = 3,
         jsonb_build_object('types', jsonb_agg(distinct schedule_type))
  from public.crew_operation_templates
  where outlet_id = v_outlet and status = 'active' and name like '[QA] %';

  insert into crew_task_sample_verification
  select 'schedule_frequency_coverage',
         actual_frequencies @> array['every_day','specific_weekdays','monthly'],
         jsonb_build_object('actual', actual_frequencies)
  from (
    select array_agg(distinct schedule_config->>'frequency') filter (where schedule_type = 'recurring') actual_frequencies
    from public.crew_operation_templates
    where outlet_id = v_outlet and status = 'active' and name like '[QA] %'
  ) x;

  insert into crew_task_sample_verification
  select 'assignment_coverage',
         count(distinct assignment_type) >= 3 and bool_or(on_duty_only),
         jsonb_build_object('types', jsonb_agg(distinct assignment_type), 'has_on_duty', bool_or(on_duty_only))
  from public.crew_operation_templates
  where outlet_id = v_outlet and status = 'active' and name like '[QA] %';

  insert into crew_task_sample_verification
  select 'content_block_coverage', count(distinct i.block_type) = 11,
         jsonb_build_object('types', jsonb_agg(distinct i.block_type))
  from public.crew_operation_template_items i
  join public.crew_operation_templates t on t.id = i.template_id
  where t.outlet_id = v_outlet and t.status = 'active' and t.name like '[QA] %';

  insert into crew_task_sample_verification
  select 'complex_task_15_blocks', count(i.id) = 15,
         jsonb_build_object('block_count', count(i.id), 'required_count', count(*) filter (where i.is_required))
  from public.crew_operation_template_items i
  join public.crew_operation_templates t on t.id = i.template_id
  where t.outlet_id = v_outlet and t.status = 'active' and t.name = '[QA] Complex 15-block QA Task';

  insert into crew_task_sample_verification
  select 'completion_rule_coverage', count(distinct completion_rule) = 3,
         jsonb_build_object('rules', jsonb_agg(distinct completion_rule), 'manager_review_tasks', count(*) filter (where manager_review_required), 'exception_tasks', count(*) filter (where allow_exception))
  from public.crew_operation_templates
  where outlet_id = v_outlet and status = 'active' and name like '[QA] %';

  insert into crew_task_sample_verification
  select 'pinned_published_sop_versions',
         count(*) >= 4 and bool_and(v.status = 'published'),
         jsonb_build_object('references', count(*), 'version_ids', jsonb_agg(distinct v.id))
  from public.crew_operation_template_items i
  join public.crew_operation_templates t on t.id = i.template_id
  join public.crew_sop_versions v on v.id = (i.sop_snapshot->>'sop_version_id')::uuid
  where t.outlet_id = v_outlet and t.status = 'active' and t.name like '[QA] %' and i.block_type = 'sop_reference';

  perform public.crew_operations_ensure_instances(v_outlet, v_today);
  perform public.crew_operations_ensure_instances(v_outlet, v_today + 3);

  insert into crew_task_sample_verification
  select 'instance_snapshots_created', count(*) >= 10 and bool_and(i.template_snapshot is not null),
         jsonb_build_object('today_and_future_instances', count(*))
  from public.crew_operation_instances i
  where i.outlet_id = v_outlet
    and i.business_date in (v_today, v_today + 3)
    and i.name like '[QA] %';

  select e.id into v_employee
  from public.employees e
  join public.crew_access ca on ca.employee_id = e.id
  where ca.primary_outlet_id = v_outlet
    and ca.access_state = 'active'
    and e.is_active
    and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
    and e.employee_code = 'QA-CREW-NS-01'
  limit 1;

  if v_employee is null then
    raise exception 'QA-CREW-NS-01 is unavailable.';
  end if;

  insert into public.crew_sessions(employee_id, token_hash, expires_at)
  values (v_employee, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '30 minutes')
  on conflict(token_hash) do update
    set employee_id = excluded.employee_id, expires_at = excluded.expires_at, revoked_at = null;

  execute 'set local role anon';
  v_payload := public.crew_tasks_today(v_token, v_today);
  execute 'reset role';

  insert into crew_task_sample_verification values (
    'crew_home_today_payload',
    exists(select 1 from jsonb_array_elements(v_payload->'tasks') x where x->>'name' like '[QA] %'),
    jsonb_build_object('qa_task_count', (select count(*) from jsonb_array_elements(v_payload->'tasks') x where x->>'name' like '[QA] %'))
  );

  select (x->>'id')::uuid into v_instance
  from jsonb_array_elements(v_payload->'tasks') x
  where x->>'name' = '[QA] Complex 15-block QA Task'
  limit 1;

  execute 'set local role anon';
  v_payload := public.crew_tasks_detail(v_token, v_instance);
  execute 'reset role';

  insert into crew_task_sample_verification values (
    'crew_mobile_safe_detail',
    v_instance is not null
      and jsonb_array_length(v_payload->'blocks') = 15
      and not (v_payload ? 'template_snapshot'),
    jsonb_build_object('instance_id', v_instance, 'block_count', coalesce(jsonb_array_length(v_payload->'blocks'), 0), 'raw_snapshot_exposed', v_payload ? 'template_snapshot')
  );

  insert into crew_task_sample_verification
  select 'fresh_manual_qa_state', count(*) = 0,
         jsonb_build_object('seeded_responses', count(*))
  from public.crew_task_item_responses r
  join public.crew_operation_instance_items i on i.id = r.instance_item_id
  join public.crew_operation_instances x on x.id = i.instance_id
  where x.outlet_id = v_outlet and x.name like '[QA] %';
end;
$$;

select jsonb_build_object(
  'passed', count(*) filter (where passed),
  'total', count(*),
  'failed', coalesce(jsonb_agg(jsonb_build_object('check', check_name, 'detail', detail)) filter (where not passed), '[]'::jsonb),
  'checks', jsonb_agg(jsonb_build_object('check', check_name, 'passed', passed, 'detail', detail) order by check_name)
) as verification_result
from crew_task_sample_verification;

rollback;
