-- Task completion is server-authoritative: saving the final required response
-- atomically reuses crew_tasks_complete instead of requiring a client CTA.
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
  where id = block.instance_id;

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

  -- The same authority and exact required-block rule used by the former manual
  -- completion action now runs automatically after the final required response.
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
          and r.employee_id = v_employee
          and r.status not in ('not_checked')
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

revoke all on function public.crew_tasks_update_block(text, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.crew_tasks_update_block(text, uuid, text, jsonb, text, text) to anon, authenticated;

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
begin
  ctx := public.crew_operations_employee_context(p_token);
  v_employee := (ctx->>'employee_id')::uuid;

  select i.*
  into instance
  from public.crew_operation_instances i
  join public.crew_task_instance_assignees a
    on a.instance_id = i.id
   and a.employee_id = v_employee
  where i.id = p_instance_id;

  select a.*
  into assignee
  from public.crew_task_instance_assignees a
  where a.instance_id = instance.id
    and a.employee_id = v_employee;

  if instance.id is null or instance.outlet_id <> (ctx->>'outlet_id')::uuid then
    raise exception using errcode = '42501', message = 'Task is unavailable.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'title', i.title,
        'description', i.description,
        'block_type', i.block_type,
        'config', i.block_config,
        'required', i.is_required,
        'sort_order', i.sort_order,
        'evidence_requirement', i.evidence_requirement,
        'health_category', i.health_category,
        'sop_reference', i.sop_reference,
        'status', coalesce(r.status, nullif(i.status, 'pending'), 'pending'),
        'response', coalesce(r.response, i.evidence, '{}'::jsonb),
        'exception_reason', coalesce(r.exception_reason, i.exception_reason),
        'note', coalesce(r.note, i.note),
        'completed_at', coalesce(r.completed_at, i.completed_at)
      )
      order by i.sort_order
    ),
    '[]'::jsonb
  )
  into blocks
  from public.crew_operation_instance_items i
  left join public.crew_task_item_responses r
    on r.instance_item_id = i.id
   and r.employee_id = v_employee
  where i.instance_id = instance.id;

  return jsonb_build_object(
    'id', instance.id,
    'name', instance.name,
    'task_type', instance.task_type,
    'schedule_type', instance.schedule_type,
    'priority', instance.priority,
    'status', assignee.status,
    'completed_at', assignee.completed_at,
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
