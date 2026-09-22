-- Rollback-only Staging verification for Crew-localized content boundaries.
-- Uses the dedicated QA-CREW-IP-01 fixture and controlled Admin/Crew
-- authorities. No QA Task, source, translation, assignment or instance stays
-- after this script completes.

begin;

do $$
declare
  v_outlet uuid;
  v_admin uuid;
  v_access_admin uuid;
  v_employee uuid;
  v_task uuid;
  v_next_task uuid;
  v_instance uuid;
  v_token text;
  v_before jsonb;
  v_after jsonb;
  v_admin_content jsonb;
  v_unit_id uuid;
  v_assignment_snapshot jsonb;
begin
  select ca.primary_outlet_id, e.id
    into v_outlet, v_employee
  from public.employees e
  join public.crew_access ca on ca.employee_id=e.id
  where e.employee_code='QA-CREW-IP-01'
    and ca.access_state='active';
  select auth_user_id into v_admin
  from public.employees
  where auth_user_id='266912cf-0e84-4074-82b5-0fc483080741'::uuid;
  select e.auth_user_id into v_access_admin
  from public.employees e
  join public.role_permissions rp on rp.role_id=e.role_id
  join public.permissions p on p.id=rp.permission_id
  where e.auth_user_id is not null and p.code='crew_employees.manage'
  order by e.created_at limit 1;
  if v_outlet is null or v_employee is null or v_admin is null or v_access_admin is null then
    raise exception 'Dedicated Staging QA Crew/Admin fixtures are unavailable.';
  end if;

  -- The approved QA-only identity may have an expired demo passcode. Reset it
  -- through the existing authority inside this rolled-back transaction only.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_access_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform public.manage_crew_access(v_employee,'reset_passcode','7392');
  execute 'reset role';

  -- Exercise the normal scoped Admin Task lifecycle, not direct table writes.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  v_task:=public.crew_tasks_save(v_outlet,jsonb_build_object(
    'name','[QA rollback] localized frozen Task',
    'task_type','confirmation',
    'schedule_type','one_time',
    'effective_date',timezone('Asia/Kuala_Lumpur',now())::date::text,
    'assignment_type','specific_crew',
    'applicable_employee_ids',jsonb_build_array(v_employee),
    'priority','normal',
    'completion_rule','any_assigned',
    'allow_exception',true,
    'exception_requires_reason',true,
    'manager_review_required',false,
    'allow_late_completion',true,
    'blocks',jsonb_build_array(jsonb_build_object(
      'block_type','confirmation','title','Confirm food-safety check','description','Confirm the counter is ready.','is_required',true,'config','{}'::jsonb
    ))
  ));
  perform public.crew_save_localized_content_units('task',v_task,jsonb_build_array(
    jsonb_build_object('unit_key','task.name','field_kind','plain_text','source_language','en','source_value',to_jsonb('[QA rollback] localized frozen Task'::text)),
    jsonb_build_object('unit_key','blocks.0.title','field_kind','plain_text','source_language','en','source_value',to_jsonb('Confirm food-safety check'::text)),
    jsonb_build_object('unit_key','blocks.0.description','field_kind','plain_text','source_language','en','source_value',to_jsonb('Confirm the counter is ready.'::text))
  ));
  v_admin_content:=public.crew_admin_localized_content('task',v_task);
  v_unit_id:=(v_admin_content->'units'->'task.name'->>'id')::uuid;
  perform public.crew_edit_localized_translation(
    v_unit_id,
    'zh-CN',to_jsonb('[QA 回滚] 冻结任务'::text)
  );
  perform public.crew_operations_activate_template(v_task);
  -- Admin list authority generates the scheduled instance through its internal
  -- helper; do not grant or call that helper directly from the QA actor.
  perform public.crew_tasks_admin_data(
    v_outlet,
    timezone('Asia/Kuala_Lumpur',now())::date,
    timezone('Asia/Kuala_Lumpur',now())::date
  );
  execute 'reset role';

  select i.id into v_instance
  from public.crew_operation_instances i
  join public.crew_task_instance_assignees a on a.instance_id=i.id
  where i.template_id=v_task and a.employee_id=v_employee;
  if v_instance is null or not exists(
    select 1 from public.crew_operation_instances i
    where i.id=v_instance and i.template_snapshot ? 'localized_content'
  ) then
    raise exception 'New Task instance did not receive a localized frozen snapshot.';
  end if;

  select public.crew_authenticate(ca.mobile_number,'7392','localized-crew-rollback')->>'token'
    into v_token
  from public.crew_access ca where ca.employee_id=v_employee;
  if v_token is null then raise exception 'QA Crew authentication failed.'; end if;

  v_before:=public.crew_localized_content(v_token,'task',array[v_task],'zh-CN')->v_task::text;
  if v_before->>'task.name' <> '[QA 回滚] 冻结任务' then
    raise exception 'Crew did not resolve the selected-language Task translation.';
  end if;

  -- A new revision changes future content only. The existing instance keeps the
  -- prior version/snapshot and its Crew result must remain byte-for-byte stable.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  v_next_task:=(public.crew_tasks_ensure_draft(v_task)->>'id')::uuid;
  v_admin_content:=public.crew_clone_localized_content('task',v_task,v_next_task);
  v_unit_id:=(v_admin_content->'units'->'task.name'->>'id')::uuid;
  perform public.crew_edit_localized_translation(
    v_unit_id,
    'zh-CN',to_jsonb('[QA 回滚] 新版本任务'::text)
  );
  execute 'reset role';
  v_after:=public.crew_localized_content(v_token,'task',array[v_task],'zh-CN')->v_task::text;
  if v_after is distinct from v_before then
    raise exception 'Frozen Task instance localization changed after a new revision.';
  end if;

  -- The legacy onboarding assignment has been backfilled with an explicit
  -- snapshot key. An empty historic localized snapshot is intentionally stable
  -- rather than falling through to mutable live units.
  select a.journey_snapshot->'localized_content' into v_assignment_snapshot
  from public.crew_journey_assignments a
  where a.employee_id=v_employee
  order by a.assigned_at desc limit 1;
  if v_assignment_snapshot is null then
    raise exception 'Legacy onboarding assignment did not receive a frozen localized snapshot key.';
  end if;
end;
$$;

rollback;
