-- FeedX Crew Operations: controlled re-entry for unfinished personal Tasks.
-- Current responses are intentionally cleared only through this token-bound
-- authority; the append-only audit log retains reset evidence.
alter function public.crew_tasks_update_block(text, uuid, text, jsonb, text, text)
  rename to crew_tasks_update_block_unlocked;

create function public.crew_tasks_update_block(
  p_token text,
  p_block_id uuid,
  p_action text,
  p_response jsonb default '{}'::jsonb,
  p_reason text default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  ctx jsonb;
  v_employee uuid;
  v_instance_id uuid;
  v_status text;
begin
  ctx := public.crew_operations_employee_context(p_token);
  v_employee := (ctx->>'employee_id')::uuid;

  select i.instance_id
  into v_instance_id
  from public.crew_operation_instance_items i
  where i.id = p_block_id;

  select a.status
  into v_status
  from public.crew_task_instance_assignees a
  where a.instance_id = v_instance_id
    and a.employee_id = v_employee;

  if v_status not in ('not_started', 'in_progress') then
    raise exception using errcode = '55000', message = 'Completed or reviewing Tasks cannot be edited.';
  end if;

  return public.crew_tasks_update_block_unlocked(p_token, p_block_id, p_action, p_response, p_reason, p_note);
end;
$$;

revoke all on function public.crew_tasks_update_block_unlocked(text, uuid, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.crew_tasks_update_block(text, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.crew_tasks_update_block(text, uuid, text, jsonb, text, text) to anon, authenticated;

create or replace function public.crew_tasks_reset(
  p_token text,
  p_instance_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  ctx jsonb;
  v_employee uuid;
  v_instance public.crew_operation_instances%rowtype;
  v_assignee public.crew_task_instance_assignees%rowtype;
  v_cleared_count integer := 0;
begin
  ctx := public.crew_operations_employee_context(p_token);
  v_employee := (ctx->>'employee_id')::uuid;

  select i.*
  into v_instance
  from public.crew_operation_instances i
  where i.id = p_instance_id
  for update;

  select a.*
  into v_assignee
  from public.crew_task_instance_assignees a
  where a.instance_id = v_instance.id
    and a.employee_id = v_employee
  for update;

  if v_instance.id is null
    or v_instance.outlet_id <> (ctx->>'outlet_id')::uuid
    or v_assignee.instance_id is null
  then
    raise exception using errcode = '42501', message = 'Task reset is unavailable.';
  end if;

  if v_assignee.status not in ('not_started', 'in_progress') then
    raise exception using errcode = '55000', message = 'Only an unfinished Task can be redone.';
  end if;

  delete from public.crew_task_item_responses r
  using public.crew_operation_instance_items i
  where r.instance_item_id = i.id
    and i.instance_id = v_instance.id
    and r.employee_id = v_employee;
  get diagnostics v_cleared_count = row_count;

  update public.crew_task_instance_assignees
  set status = 'not_started',
      completed_at = null,
      updated_at = now()
  where instance_id = v_instance.id
    and employee_id = v_employee;

  insert into public.audit_logs(action, module, description, metadata)
  values (
    'crew_task_reset',
    'crew',
    'Crew Task answers were reset.',
    jsonb_build_object(
      'actor_employee_id', v_employee,
      'outlet_id', v_instance.outlet_id,
      'task_instance_id', v_instance.id,
      'status_before', v_assignee.status,
      'cleared_response_count', v_cleared_count
    )
  );

  return jsonb_build_object(
    'id', v_instance.id,
    'status', 'not_started',
    'cleared_response_count', v_cleared_count
  );
end;
$$;

revoke all on function public.crew_tasks_reset(text, uuid) from public, anon, authenticated;
grant execute on function public.crew_tasks_reset(text, uuid) to anon, authenticated;
