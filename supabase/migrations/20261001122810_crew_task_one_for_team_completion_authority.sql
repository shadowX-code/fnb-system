-- A one_for_team occurrence is satisfied by one valid response per required
-- actionable item from any frozen assignee. Response rows retain their actors.
create or replace function public.crew_tasks_team_evidence(p_instance_id uuid)
returns table (
  required_count bigint,
  answered_count bigint,
  has_exception boolean,
  final_actor_employee_id uuid,
  final_response_id uuid,
  final_response_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with items as (
    select i.id, i.is_required,
      i.block_type not in ('text', 'key_point', 'image', 'sop_reference') as actionable,
      response.id as response_id, response.employee_id, response.status,
      response.completed_at
    from public.crew_operation_instance_items i
    left join lateral (
      select r.id, r.employee_id, r.status, r.completed_at
      from public.crew_task_item_responses r
      join public.crew_task_instance_assignees a
        on a.instance_id = p_instance_id and a.employee_id = r.employee_id
      where r.instance_item_id = i.id and r.status <> 'not_checked'
      order by r.completed_at, r.id
      limit 1
    ) response on true
    where i.instance_id = p_instance_id
  ), counts as (
    select count(*) filter (where is_required and actionable) as required_count,
      count(*) filter (where is_required and actionable and response_id is not null) as answered_count,
      coalesce(bool_or(status in ('exception', 'needs_attention')), false) as has_exception
    from items
  ), last_required as (
    select employee_id, response_id, completed_at
    from items
    where is_required and actionable and response_id is not null
    order by completed_at desc, response_id desc
    limit 1
  ), last_any as (
    select employee_id, response_id, completed_at
    from items
    where response_id is not null
    order by completed_at desc, response_id desc
    limit 1
  )
  select c.required_count, c.answered_count, c.has_exception,
    coalesce(lr.employee_id, la.employee_id),
    coalesce(lr.response_id, la.response_id),
    coalesce(lr.completed_at, la.completed_at)
  from counts c
  left join last_required lr on true
  left join last_any la on true;
$$;

revoke all on function public.crew_tasks_team_evidence(uuid) from public, anon, authenticated;

-- The public token-bound write path and the internal writer take the occurrence
-- lock before reading or adding responses. Reset/review/completion use the same
-- instance-first lock order, so concurrent final submissions cannot both miss
-- the transition.
create or replace function public.crew_tasks_update_block(
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

  perform 1 from public.crew_operation_instances
  where id = v_instance_id for update;

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


revoke all on function public.crew_tasks_update_block(text, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.crew_tasks_update_block(text, uuid, text, jsonb, text, text) to anon, authenticated;

create or replace function public.crew_tasks_update_block_unlocked(
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
  block public.crew_operation_instance_items%rowtype;
  instance public.crew_operation_instances%rowtype;
  normalized text;
  numeric_value numeric;
  choices text[];
  inserted_count integer;
  completion_result jsonb := null;
  assignee_status text;
begin
  ctx := public.crew_operations_employee_context(p_token);
  v_employee := (ctx->>'employee_id')::uuid;

  select * into block
  from public.crew_operation_instance_items
  where id = p_block_id;

  select * into instance
  from public.crew_operation_instances
  where id = block.instance_id
  for update;

  if block.id is null
    or instance.outlet_id <> (ctx->>'outlet_id')::uuid
    or not exists (
      select 1
      from public.crew_task_instance_assignees a
      where a.instance_id = instance.id
        and a.employee_id = v_employee
    )
  then
    raise exception using errcode = '42501', message = 'Task content is unavailable.';
  end if;

  if now() < instance.available_from then
    raise exception using errcode = '22023', message = 'This Task is not available yet.';
  end if;

  if block.block_type in ('text', 'key_point', 'image', 'sop_reference') then
    raise exception using errcode = '22023', message = 'This content block does not require a response.';
  end if;

  if instance.completion_rule = 'one_for_team'
    and exists (
      select 1
      from public.crew_task_item_responses r
      where r.instance_item_id = block.id
        and r.employee_id <> v_employee
    )
  then
    raise exception using errcode = '55000', message = 'A teammate has already completed this item.';
  end if;

  if p_action = 'exception' then
    if not instance.allow_exception then
      raise exception using errcode = '22023', message = 'This Task does not allow exceptions.';
    end if;
    if instance.exception_requires_reason
      and coalesce(p_reason, '') not in ('equipment_issue', 'stock_unavailable', 'area_unavailable', 'manager_instruction', 'other')
    then
      raise exception using errcode = '22023', message = 'Choose an exception reason.';
    end if;
    normalized := 'exception';
  elsif block.block_type = 'health_rating' then
    if p_action not in ('good', 'needs_attention', 'not_checked') then
      raise exception using errcode = '22023', message = 'Health rating is invalid.';
    end if;
    if p_action = 'needs_attention' and char_length(btrim(coalesce(p_note, ''))) < 3 then
      raise exception using errcode = '22023', message = 'A note is required when attention is needed.';
    end if;
    normalized := p_action;
  elsif block.block_type in ('number', 'temperature') then
    begin
      numeric_value := (p_response->>'value')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'A valid measurement is required.';
    end;
    if (block.block_config ? 'min' and numeric_value < (block.block_config->>'min')::numeric)
      or (block.block_config ? 'max' and numeric_value > (block.block_config->>'max')::numeric)
    then
      raise exception using errcode = '22023', message = 'Measurement is outside the allowed range. Record an exception with a reason.';
    end if;
    normalized := 'completed';
  elsif block.block_type = 'yes_no' then
    if coalesce(p_response->>'value', '') not in ('yes', 'no') then
      raise exception using errcode = '22023', message = 'Choose Yes or No.';
    end if;
    normalized := 'completed';
  elsif block.block_type = 'single_choice' then
    select coalesce(array_agg(value), '{}')
    into choices
    from jsonb_array_elements_text(coalesce(block.block_config->'options', '[]'::jsonb));
    if not (p_response->>'value' = any(choices)) then
      raise exception using errcode = '22023', message = 'Choose an available option.';
    end if;
    normalized := 'completed';
  elsif block.block_type = 'short_text' then
    if char_length(btrim(coalesce(p_response->>'value', ''))) < 1 then
      raise exception using errcode = '22023', message = 'A response is required.';
    end if;
    normalized := 'completed';
  else
    if p_action <> 'completed' then
      raise exception using errcode = '22023', message = 'Task action is invalid.';
    end if;
    normalized := 'completed';
  end if;

  if block.evidence_requirement = 'note'
    and char_length(btrim(coalesce(p_note, ''))) < 3
  then
    raise exception using errcode = '22023', message = 'A note is required for this item.';
  end if;

  insert into public.crew_task_item_responses(
    instance_item_id, employee_id, status, response, exception_reason, note, completed_at
  )
  values (
    block.id,
    v_employee,
    normalized,
    coalesce(p_response, '{}'::jsonb),
    case when normalized = 'exception' then p_reason end,
    nullif(btrim(p_note), ''),
    now()
  )
  on conflict(instance_item_id, employee_id) do nothing;

  get diagnostics inserted_count = row_count;

  update public.crew_task_instance_assignees a
  set status = 'in_progress', updated_at = now()
  where a.instance_id = instance.id
    and a.employee_id = v_employee
    and a.status = 'not_started';

  -- The final required response completes a shared occurrence in this same
  -- transaction. Other rules retain their original actor-specific predicate.
  if not exists (
    select 1
    from public.crew_operation_instance_items i
    where i.instance_id = instance.id
      and i.is_required
      and i.block_type not in ('text', 'key_point', 'image', 'sop_reference')
      and not exists (
        select 1
        from public.crew_task_item_responses r
        where r.instance_item_id = i.id
          and r.status not in ('not_checked')
          and (
            r.employee_id = v_employee
            or (instance.completion_rule = 'one_for_team' and exists (
              select 1 from public.crew_task_instance_assignees a
              where a.instance_id = instance.id and a.employee_id = r.employee_id
            ))
          )
      )
  ) then
    completion_result := public.crew_tasks_complete(p_token, instance.id);
  end if;

  select a.status
  into assignee_status
  from public.crew_task_instance_assignees a
  where a.instance_id = instance.id
    and a.employee_id = v_employee;

  return jsonb_build_object(
    'block_id', block.id,
    'status', (
      select r.status
      from public.crew_task_item_responses r
      where r.instance_item_id = block.id
        and r.employee_id = v_employee
    ),
    'idempotent', inserted_count = 0,
    'task_status', assignee_status,
    'task_completed_at', completion_result->>'completed_at'
  );
end;
$$;


revoke all on function public.crew_tasks_update_block_unlocked(text, uuid, text, jsonb, text, text) from public, anon, authenticated;

create or replace function public.crew_tasks_complete(p_token text, p_instance_id uuid)
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
  v_evidence record;
  final_status text;
  has_exception boolean;
  v_completed_at timestamptz := now();
begin
  ctx := public.crew_operations_employee_context(p_token);
  v_employee := (ctx->>'employee_id')::uuid;
  select * into instance from public.crew_operation_instances where id = p_instance_id for update;
  if instance.id is null
    or instance.outlet_id <> (ctx->>'outlet_id')::uuid
    or not exists (select 1 from public.crew_task_instance_assignees
                   where instance_id = instance.id and employee_id = v_employee)
  then
    raise exception using errcode = '42501', message = 'Task is unavailable.';
  end if;

  if instance.completion_rule = 'one_for_team'
    and instance.status in ('completed', 'completed_with_exceptions')
  then
    return jsonb_build_object('id', instance.id, 'status', instance.status,
                              'completed_at', instance.completed_at, 'idempotent', true);
  end if;
  if now() > instance.available_until and not instance.allow_late_completion then
    raise exception using errcode = '22023', message = 'This Task can no longer be completed.';
  end if;

  if instance.completion_rule = 'one_for_team' then
    select * into v_evidence from public.crew_tasks_team_evidence(instance.id);
    if v_evidence.required_count <> v_evidence.answered_count then
      raise exception using errcode = '22023', message = 'Complete every required Task item first.';
    end if;
    has_exception := v_evidence.has_exception;
  else
    -- Preserve the existing actor-specific authority for other rules.
    if exists (
      select 1 from public.crew_operation_instance_items i
      where i.instance_id = instance.id and i.is_required
        and i.block_type not in ('text', 'key_point', 'image', 'sop_reference')
        and not exists (
          select 1 from public.crew_task_item_responses r
          where r.instance_item_id = i.id and r.employee_id = v_employee
            and r.status not in ('not_checked')
        )
    ) then
      raise exception using errcode = '22023', message = 'Complete every required Task item first.';
    end if;
    select exists (
      select 1 from public.crew_task_item_responses r
      join public.crew_operation_instance_items i on i.id = r.instance_item_id
      where i.instance_id = instance.id and r.employee_id = v_employee
        and r.status in ('exception', 'needs_attention')
    ) into has_exception;
  end if;

  final_status := case when instance.manager_review_required then 'review_required'
                       when has_exception then 'completed_with_exceptions'
                       else 'completed' end;
  update public.crew_task_instance_assignees
  set status = final_status,
      completed_at = case when final_status <> 'review_required' then v_completed_at end,
      updated_at = v_completed_at
  where instance_id = instance.id and employee_id = v_employee;

  if instance.completion_rule = 'one_for_team' and final_status <> 'review_required' then
    update public.crew_task_instance_assignees
    set status = final_status, completed_at = coalesce(completed_at, v_completed_at),
        updated_at = v_completed_at
    where instance_id = instance.id and employee_id <> v_employee
      and status in ('not_started', 'in_progress', 'overdue');
  elsif instance.completion_rule = 'any_assigned' and final_status <> 'review_required' then
    update public.crew_task_instance_assignees
    set status = final_status, completed_at = coalesce(completed_at, v_completed_at),
        updated_at = v_completed_at
    where instance_id = instance.id and employee_id <> v_employee
      and status in ('not_started', 'in_progress');
  end if;

  if (instance.completion_rule in ('any_assigned', 'one_for_team') and final_status <> 'review_required')
    or not exists (select 1 from public.crew_task_instance_assignees
                   where instance_id = instance.id and status not in ('completed', 'completed_with_exceptions'))
  then
    update public.crew_operation_instances
    set status = case when has_exception then 'completed_with_exceptions' else 'completed' end,
        completed_at = v_completed_at, updated_at = v_completed_at
    where id = instance.id;
  end if;

  if instance.completion_rule = 'one_for_team' and final_status <> 'review_required' then
    insert into public.audit_logs(action, module, description, metadata)
    values ('crew_task_team_completed', 'crew', 'A Crew team Task was completed from shared item evidence.',
      jsonb_build_object(
        'task_instance_id', instance.id,
        'outlet_id', instance.outlet_id,
        'completion_actor_employee_id', coalesce(v_evidence.final_actor_employee_id, v_employee),
        'trigger_employee_id', v_employee,
        'final_response_id', v_evidence.final_response_id,
        'final_response_at', v_evidence.final_response_at,
        'completed_at', v_completed_at,
        'required_count', v_evidence.required_count,
        'source', 'crew_response'
      ));
  end if;

  return jsonb_build_object('id', instance.id, 'status', final_status,
                            'completed_at', case when final_status <> 'review_required' then v_completed_at end);
end;
$$;

revoke all on function public.crew_tasks_complete(text, uuid) from public, anon, authenticated;
grant execute on function public.crew_tasks_complete(text, uuid) to anon, authenticated;

-- Maintenance-only correction for already-stranded occurrences. The source
-- timestamp and actor come from the last required response, while this
-- reconciliation gets its own append-only audit event at the current time.
create or replace function public.crew_tasks_reconcile_stranded_team(p_instance_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  instance public.crew_operation_instances%rowtype;
  v_evidence record;
  v_status text;
  v_assignees integer;
  v_audit_id uuid;
begin
  select * into instance from public.crew_operation_instances
  where id = p_instance_id for update;
  if instance.id is null or instance.completion_rule <> 'one_for_team' then
    raise exception using errcode = '22023', message = 'This is not a team Task occurrence.';
  end if;
  if instance.status in ('completed', 'completed_with_exceptions') then
    return jsonb_build_object('id', instance.id, 'reconciled', false,
                              'status', instance.status, 'completed_at', instance.completed_at);
  end if;
  if instance.status not in ('not_started', 'in_progress', 'overdue')
    or instance.completed_at is not null or instance.manager_review_required
  then
    raise exception using errcode = '55000', message = 'Task is not eligible for automatic reconciliation.';
  end if;
  select count(*) into v_assignees from public.crew_task_instance_assignees
  where instance_id = instance.id;
  if v_assignees = 0 or exists (
    select 1 from public.crew_task_instance_assignees
    where instance_id = instance.id
      and status not in ('not_started', 'in_progress', 'overdue')
  ) then
    raise exception using errcode = '55000', message = 'Task assignee state is not eligible for reconciliation.';
  end if;
  select * into v_evidence from public.crew_tasks_team_evidence(instance.id);
  if v_evidence.required_count = 0
    or v_evidence.required_count <> v_evidence.answered_count
    or v_evidence.final_actor_employee_id is null
    or v_evidence.final_response_at is null
    or (not instance.allow_late_completion and v_evidence.final_response_at > instance.available_until)
  then
    raise exception using errcode = '55000', message = 'Task lacks qualifying complete evidence.';
  end if;

  v_status := case when v_evidence.has_exception then 'completed_with_exceptions' else 'completed' end;
  update public.crew_task_instance_assignees
  set status = v_status, completed_at = v_evidence.final_response_at, updated_at = now()
  where instance_id = instance.id;
  update public.crew_operation_instances
  set status = v_status, completed_at = v_evidence.final_response_at, updated_at = now()
  where id = instance.id;
  insert into public.audit_logs(action, module, description, metadata)
  values ('crew_task_team_reconciled', 'crew',
          'A stranded Crew team Task was reconciled from existing required-item responses.',
          jsonb_build_object(
            'task_instance_id', instance.id,
            'outlet_id', instance.outlet_id,
            'status_before', instance.status,
            'status_after', v_status,
            'completion_actor_employee_id', v_evidence.final_actor_employee_id,
            'final_response_id', v_evidence.final_response_id,
            'final_response_at', v_evidence.final_response_at,
            'required_count', v_evidence.required_count,
            'assignee_count', v_assignees,
            'reconciled_at', now(),
            'response_evidence_unchanged', true
          )) returning id into v_audit_id;
  return jsonb_build_object('id', instance.id, 'reconciled', true,
                            'status', v_status, 'completed_at', v_evidence.final_response_at,
                            'completion_actor_employee_id', v_evidence.final_actor_employee_id,
                            'audit_id', v_audit_id);
end;
$$;

revoke all on function public.crew_tasks_reconcile_stranded_team(uuid) from public, anon, authenticated;
grant execute on function public.crew_tasks_reconcile_stranded_team(uuid) to service_role;

-- Manager review remains a gate. For team Tasks, approval rechecks the shared
-- evidence and exception state; other rules keep their actor-specific review.
create or replace function public.crew_tasks_review(
  p_instance_id uuid, p_employee_id uuid, p_decision text, p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  instance public.crew_operation_instances%rowtype;
  assignee public.crew_task_instance_assignees%rowtype;
  v_evidence record;
  approved_status text;
  has_exception boolean;
begin
  select * into instance from public.crew_operation_instances where id = p_instance_id for update;
  select * into assignee from public.crew_task_instance_assignees
  where instance_id = p_instance_id and employee_id = p_employee_id for update;
  if instance.id is null or assignee.instance_id is null or assignee.status <> 'review_required'
    or p_decision not in ('approved', 'changes_required')
    or not public.current_user_has_permission('crew_operations.review')
    or not public.current_user_can_access_outlet(instance.outlet_id)
  then
    raise exception using errcode = '42501', message = 'Task review is unavailable.';
  end if;
  if p_decision = 'changes_required' and char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Explain the required changes.';
  end if;
  if instance.completion_rule = 'one_for_team' and p_decision = 'approved' then
    select * into v_evidence from public.crew_tasks_team_evidence(instance.id);
    if v_evidence.required_count <> v_evidence.answered_count then
      raise exception using errcode = '22023', message = 'Complete every required Task item first.';
    end if;
    has_exception := v_evidence.has_exception;
  else
    select exists (
      select 1 from public.crew_task_item_responses r
      join public.crew_operation_instance_items i on i.id = r.instance_item_id
      where i.instance_id = instance.id and r.employee_id = p_employee_id
        and r.status in ('exception', 'needs_attention')
    ) into has_exception;
  end if;
  approved_status := case when has_exception then 'completed_with_exceptions' else 'completed' end;
  insert into public.crew_task_reviews(instance_id, employee_id, decision, note, reviewed_by)
  values (instance.id, p_employee_id, p_decision, nullif(btrim(p_note), ''), auth.uid());
  update public.crew_task_instance_assignees
  set status = case when p_decision = 'approved' then approved_status else 'in_progress' end,
      completed_at = case when p_decision = 'approved' then now() end,
      updated_at = now()
  where instance_id = instance.id and employee_id = p_employee_id;
  if p_decision = 'approved' and instance.completion_rule = 'one_for_team' then
    update public.crew_task_instance_assignees
    set status = approved_status, completed_at = coalesce(completed_at, now()), updated_at = now()
    where instance_id = instance.id
      and status in ('not_started', 'in_progress', 'review_required', 'overdue');
  elsif p_decision = 'approved' and instance.completion_rule = 'any_assigned' then
    update public.crew_task_instance_assignees
    set status = approved_status, completed_at = coalesce(completed_at, now()), updated_at = now()
    where instance_id = instance.id
      and status in ('not_started', 'in_progress', 'review_required');
  end if;
  if p_decision = 'approved' and (
    instance.completion_rule in ('any_assigned', 'one_for_team')
    or not exists (select 1 from public.crew_task_instance_assignees
                   where instance_id = instance.id and status not in ('completed', 'completed_with_exceptions'))
  ) then
    update public.crew_operation_instances
    set status = approved_status, completed_at = now(), updated_at = now()
    where id = instance.id;
  end if;
  if p_decision = 'approved' and instance.completion_rule = 'one_for_team' then
    insert into public.audit_logs(action, module, description, metadata)
    values ('crew_task_team_completed', 'crew', 'A reviewed Crew team Task was completed from shared item evidence.',
      jsonb_build_object(
        'task_instance_id', instance.id,
        'outlet_id', instance.outlet_id,
        'completion_actor_employee_id', coalesce(v_evidence.final_actor_employee_id, p_employee_id),
        'final_response_id', v_evidence.final_response_id,
        'final_response_at', v_evidence.final_response_at,
        'reviewed_by', auth.uid(),
        'required_count', v_evidence.required_count,
        'source', 'manager_review'
      ));
  end if;
  return jsonb_build_object('instance_id', instance.id, 'employee_id', p_employee_id,
                            'decision', p_decision,
                            'status', case when p_decision = 'approved' then approved_status else 'in_progress' end);
end;
$$;

revoke all on function public.crew_tasks_review(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.crew_tasks_review(uuid, uuid, text, text) to authenticated;

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
  v_team_evidence record;
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

  if instance.completion_rule = 'one_for_team'
    and assignee.status in ('completed', 'completed_with_exceptions', 'review_required')
  then
    select * into v_team_evidence from public.crew_tasks_team_evidence(instance.id);
    if v_team_evidence.final_actor_employee_id is not null then
      select jsonb_build_object(
        'employee_id', e.id,
        'employee_name', e.full_name,
        'completed_at', v_team_evidence.final_response_at
      ) into v_completion
      from public.employees e where e.id = v_team_evidence.final_actor_employee_id;
    end if;
  end if;

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
  left join lateral (
    select r.* from public.crew_task_item_responses r
    where r.instance_item_id = item.id
      and (instance.completion_rule = 'one_for_team' or r.employee_id = v_employee)
    order by r.completed_at desc, r.id desc
    limit 1
  ) response on true
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
