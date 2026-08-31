-- Crew receives a bounded execution-history projection. The existing Admin
-- history remains deliberately unbounded and is not part of this contract.
create or replace function public.crew_task_history_for_crew(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_today date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_from date := v_today - 29;
  v_read jsonb;
  v_tasks jsonb;
begin
  -- Revalidate the opaque Crew session before delegating to the approved list
  -- read authority. The caller cannot widen this window.
  perform public.crew_operations_employee_context(p_token);
  v_read := public.crew_tasks_for_crew(p_token, v_from, v_today);

  select coalesce(
    jsonb_agg(task order by task->>'business_date' desc, task->>'completed_at' desc nulls last),
    '[]'::jsonb
  )
  into v_tasks
  from jsonb_array_elements(coalesce(v_read->'tasks', '[]'::jsonb)) task
  where (task->>'business_date')::date between v_from and v_today
    and coalesce(task->>'status', 'not_started') in (
      'completed', 'completed_with_exceptions', 'review_required', 'overdue', 'exception'
    );

  return (v_read - 'tasks') || jsonb_build_object(
    'from', v_from,
    'to', v_today,
    'history_window_days', 30,
    'tasks', v_tasks
  );
end;
$$;

revoke all on function public.crew_task_history_for_crew(text) from public, anon, authenticated;
grant execute on function public.crew_task_history_for_crew(text) to anon, authenticated;

-- Extend the existing token-bound detail projection only. Assignment and
-- completion evidence already exist in frozen instances and response rows;
-- this does not alter assignment, scheduling, or completion lifecycle logic.
create or replace function public.crew_tasks_detail(p_token text, p_instance_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  ctx jsonb;
  v_employee uuid;
  instance public.crew_operation_instances%rowtype;
  assignee public.crew_task_instance_assignees%rowtype;
  blocks jsonb;
  v_assignment jsonb;
  v_completion jsonb;
begin
  ctx := public.crew_operations_employee_context(p_token);
  v_employee := (ctx->>'employee_id')::uuid;

  select i.* into instance
  from public.crew_operation_instances i
  join public.crew_task_instance_assignees a
    on a.instance_id = i.id and a.employee_id = v_employee
  where i.id = p_instance_id;

  if instance.id is null or instance.outlet_id <> (ctx->>'outlet_id')::uuid then
    raise exception using errcode = '42501', message = 'Task is unavailable.';
  end if;

  select a.* into assignee
  from public.crew_task_instance_assignees a
  where a.instance_id = instance.id and a.employee_id = v_employee;

  v_assignment := case instance.assignment_type
    when 'specific_crew' then jsonb_build_object(
      'kind', 'individual',
      'employee_id', v_employee,
      'employee_name', ctx->>'employee_name',
      'is_current_employee', true
    )
    when 'position' then jsonb_build_object(
      'kind', 'position',
      'label', array_to_string(coalesce(instance.applicable_positions, '{}'::text[]), ', ')
    )
    when 'group' then jsonb_build_object(
      'kind', 'group',
      'label', array_to_string(coalesce(instance.applicable_group_names, '{}'::text[]), ', ')
    )
    else jsonb_build_object('kind', 'outlet', 'label', (select o.name from public.outlets o where o.id = instance.outlet_id))
  end;

  -- The response row is immutable execution evidence. It identifies the actor
  -- who finished a shared task rather than inferring the actor from the viewer.
  select jsonb_build_object(
    'employee_id', r.employee_id,
    'employee_name', e.full_name,
    'completed_at', r.completed_at
  )
  into v_completion
  from public.crew_task_item_responses r
  join public.crew_operation_instance_items item on item.id = r.instance_item_id
  join public.employees e on e.id = r.employee_id
  where item.instance_id = instance.id
    and r.status in ('completed', 'exception', 'needs_attention')
  order by r.completed_at desc nulls last
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item.id,
    'title', item.title,
    'description', item.description,
    'block_type', item.block_type,
    'config', item.block_config,
    'required', item.is_required,
    'sort_order', item.sort_order,
    'evidence_requirement', item.evidence_requirement,
    'health_category', item.health_category,
    'sop_reference', item.sop_reference,
    'status', coalesce(response.status, nullif(item.status, 'pending'), 'pending'),
    'response', coalesce(response.response, item.evidence, '{}'::jsonb),
    'exception_reason', coalesce(response.exception_reason, item.exception_reason),
    'note', coalesce(response.note, item.note),
    'completed_at', coalesce(response.completed_at, item.completed_at)
  ) order by item.sort_order), '[]'::jsonb)
  into blocks
  from public.crew_operation_instance_items item
  left join public.crew_task_item_responses response
    on response.instance_item_id = item.id and response.employee_id = v_employee
  where item.instance_id = instance.id;

  return jsonb_build_object(
    'id', instance.id,
    'template_id', instance.template_id,
    'name', instance.name,
    'task_type', instance.task_type,
    'schedule_type', instance.schedule_type,
    'priority', instance.priority,
    'status', assignee.status,
    'completed_at', assignee.completed_at,
    'assignment', v_assignment,
    'completion_audit', v_completion,
    'available_from', instance.available_from,
    'due_at', instance.available_until,
    'allow_exception', instance.allow_exception,
    'exception_requires_reason', instance.exception_requires_reason,
    'manager_review_required', instance.manager_review_required,
    'completion_rule', instance.completion_rule,
    'blocks', blocks
  );
end;
$$;

revoke all on function public.crew_tasks_detail(text, uuid) from public, anon, authenticated;
grant execute on function public.crew_tasks_detail(text, uuid) to anon, authenticated;
