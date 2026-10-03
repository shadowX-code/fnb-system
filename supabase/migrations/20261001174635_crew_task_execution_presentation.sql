-- Resolve execution progress from existing assigned-Crew evidence without rewriting it.
do $guard$ begin
  if to_regprocedure('public.crew_tasks_execution_status(uuid,uuid)') is not null then raise exception 'Unexpected Task execution projection already exists.'; end if;
  if md5(pg_get_functiondef('public.crew_tasks_today(text,date)'::regprocedure)) <> '626c00655fa3bb3c670065699ca63cf8' then raise exception 'Reviewed Task baseline drift: crew_tasks_today'; end if;
  if md5(pg_get_functiondef('public.crew_tasks_for_crew(text,date,date)'::regprocedure)) <> '00bb8aef055aaa446765a554d1905a32' then raise exception 'Reviewed Task baseline drift: crew_tasks_for_crew'; end if;
  if md5(pg_get_functiondef('public.crew_tasks_detail(text,uuid)'::regprocedure)) <> '058b6f4ccad74eec9e1df9dfefefd525' then raise exception 'Reviewed Task baseline drift: crew_tasks_detail'; end if;
  if md5(pg_get_functiondef('public.crew_tasks_update_block_unlocked(text,uuid,text,jsonb,text,text)'::regprocedure)) <> '6351a495656439d894f3a5d4896019a2' then raise exception 'Reviewed Task baseline drift: crew_tasks_update_block_unlocked'; end if;
  if md5(pg_get_functiondef('public.crew_task_history_for_crew(text)'::regprocedure)) <> 'c04456e29220f9c4ed0982f5c4744d9f' then raise exception 'Reviewed Task baseline drift: crew_task_history_for_crew'; end if;
end $guard$;

create function public.crew_tasks_execution_status(p_instance_id uuid, p_employee_id uuid)
returns text language sql stable set search_path=public as $$
  select case when a.status='not_started' and exists(
    select 1 from public.crew_task_item_responses r
    join public.crew_operation_instance_items x on x.id=r.instance_item_id
    join public.crew_task_instance_assignees contributor
      on contributor.instance_id=x.instance_id and contributor.employee_id=r.employee_id
    where x.instance_id=i.id and r.status in ('completed','exception','good','needs_attention')
      and (i.completion_rule='one_for_team' or r.employee_id=p_employee_id)
  ) then 'in_progress' else a.status end
  from public.crew_operation_instances i
  join public.crew_task_instance_assignees a on a.instance_id=i.id and a.employee_id=p_employee_id
  where i.id=p_instance_id and i.is_operational;
$$;
revoke all on function public.crew_tasks_execution_status(uuid,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.crew_tasks_today(p_token text, p_business_date date DEFAULT (timezone('Asia/Kuala_Lumpur'::text, now()))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; v_employee uuid; v_outlet uuid; v_role uuid; v_position text; tasks jsonb; legacy jsonb; attendance jsonb;
begin
 ctx:=public.crew_operations_employee_context(p_token); v_employee:=(ctx->>'employee_id')::uuid; v_outlet:=(ctx->>'outlet_id')::uuid; v_role:=nullif(ctx->>'role_id','')::uuid; v_position:=ctx->>'position';
 perform public.crew_operations_ensure_instances(v_outlet,p_business_date);
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'template_id',i.template_id,'source','instance','name',i.name,'task_type',i.task_type,'schedule_type',i.schedule_type,'priority',i.priority,'status',case when public.crew_tasks_execution_status(i.id,v_employee)='not_started' and i.available_until<now() then 'overdue' else public.crew_tasks_execution_status(i.id,v_employee) end,'available_from',i.available_from,'due_at',i.available_until,'completed_at',a.completed_at,'block_count',(select count(*) from public.crew_operation_instance_items x where x.instance_id=i.id),'completed_count',(select count(distinct x.id) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id=r.instance_item_id where x.instance_id=i.id and (i.completion_rule='one_for_team' or r.employee_id=v_employee) and r.status not in ('not_checked')),'exception_count',(select count(distinct x.id) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id=r.instance_item_id where x.instance_id=i.id and (i.completion_rule='one_for_team' or r.employee_id=v_employee) and r.status in ('exception','needs_attention'))) order by case i.priority when 'critical' then 1 when 'important' then 2 else 3 end,i.available_until,i.name),'[]'::jsonb) into tasks
 from public.crew_operation_instances i join public.crew_task_instance_assignees a on a.instance_id=i.id and a.employee_id=v_employee where i.is_operational and i.outlet_id=v_outlet and i.business_date=p_business_date;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'source','legacy_daily','name',t.title,'description',t.description,'task_type','instruction','schedule_type','one_time','priority',case t.priority when 'high' then 'critical' else 'normal' end,'status',case when t.status='pending' and t.due_at<now() then 'overdue' else t.status end,'due_at',t.due_at,'sop_reference',t.sop_snapshot,'completed_at',t.completed_at) order by t.due_at nulls last,t.title),'[]'::jsonb) into legacy from public.crew_daily_tasks t where t.outlet_id=v_outlet and t.task_date=p_business_date and public.crew_operations_applicable(v_role,v_position,t.applicable_role_ids,t.applicable_positions);
 select jsonb_build_object('on_shift',exists(select 1 from public.crew_attendance_records a where a.employee_id=v_employee and a.outlet_id=v_outlet and a.status='open'),'clock_in_at',(select max(a.clock_in_at) from public.crew_attendance_records a where a.employee_id=v_employee and a.outlet_id=v_outlet and a.status='open')) into attendance;
 return jsonb_build_object('date',p_business_date,'outlet',jsonb_build_object('id',v_outlet,'name',(select name from public.outlets where id=v_outlet)),'employee',jsonb_build_object('id',v_employee,'name',ctx->>'employee_name','position',v_position),'attendance_context',attendance,'tasks',tasks||legacy);
end; $function$;

CREATE OR REPLACE FUNCTION public.crew_tasks_for_crew(p_token text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_context jsonb;
  v_employee_id uuid;
  v_outlet_id uuid;
  v_today date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_from date := coalesce(p_from, v_today - 7);
  v_to date := coalesce(p_to, v_today + 14);
  v_date date;
  v_tasks jsonb;
  v_legacy jsonb;
begin
  if v_from > v_to or v_to - v_from > 31 then
    raise exception using errcode = '22023', message = 'Task list date range is invalid.';
  end if;

  v_context := public.crew_operations_employee_context(p_token);
  v_employee_id := (v_context->>'employee_id')::uuid;
  v_outlet_id := (v_context->>'outlet_id')::uuid;

  for v_date in select generate_series(greatest(v_from, v_today), v_to, interval '1 day')::date loop
    perform public.crew_operations_ensure_instances(v_outlet_id, v_date);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'template_id', i.template_id,
    'series_id', i.template_series_id,
    'source', 'instance',
    'name', i.name,
    'task_type', i.task_type,
    'schedule_type', i.schedule_type,
    'schedule_config', coalesce(i.template_snapshot->'schedule_config', '{}'::jsonb),
    'start_time', template.available_from,
    'due_time', template.available_until,
    'priority', i.priority,
    'business_date', i.business_date,
    'available_from', i.available_from,
    'due_at', i.available_until,
    'completed_at', a.completed_at,
    'status', case when public.crew_tasks_execution_status(i.id,v_employee_id) = 'not_started' and i.available_until < now() then 'overdue' else public.crew_tasks_execution_status(i.id,v_employee_id) end,
    'block_count', (select count(*) from public.crew_operation_instance_items x where x.instance_id = i.id),
    'completed_count', (select count(distinct x.id) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id = r.instance_item_id where x.instance_id = i.id and (i.completion_rule = 'one_for_team' or r.employee_id = v_employee_id) and r.status <> 'not_checked'),
    'exception_count', (select count(distinct x.id) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id = r.instance_item_id where x.instance_id = i.id and (i.completion_rule = 'one_for_team' or r.employee_id = v_employee_id) and r.status in ('exception', 'needs_attention'))
  ) order by i.business_date, i.available_from, i.name), '[]'::jsonb)
  into v_tasks
  from public.crew_operation_instances i
  join public.crew_task_instance_assignees a on a.instance_id = i.id and a.employee_id = v_employee_id
  left join public.crew_operation_templates template on template.id = i.template_id
  where i.is_operational and i.outlet_id = v_outlet_id
    and i.business_date between v_from and v_to;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'source', 'legacy_daily',
    'name', t.title,
    'description', t.description,
    'task_type', 'instruction',
    'schedule_type', 'one_time',
    'schedule_config', '{}'::jsonb,
    'priority', case t.priority when 'high' then 'critical' else 'normal' end,
    'business_date', t.task_date,
    'due_at', t.due_at,
    'completed_at', t.completed_at,
    'status', case when t.status = 'pending' and t.due_at < now() then 'overdue' else t.status end
  ) order by t.task_date, t.due_at nulls last, t.title), '[]'::jsonb)
  into v_legacy
  from public.crew_daily_tasks t
  where t.outlet_id = v_outlet_id
    and t.task_date between v_from and v_to
    and public.crew_operations_applicable(
      nullif(v_context->>'role_id', '')::uuid,
      v_context->>'position',
      t.applicable_role_ids,
      t.applicable_positions
    );

  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'outlet', jsonb_build_object('id', v_outlet_id, 'name', (select name from public.outlets where id = v_outlet_id)),
    'employee', jsonb_build_object('id', v_employee_id, 'name', v_context->>'employee_name', 'position', v_context->>'position'),
    'tasks', v_tasks || v_legacy
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.crew_tasks_detail(p_token text, p_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ctx jsonb;
  v_employee uuid;
  instance public.crew_operation_instances%rowtype;
  assignee public.crew_task_instance_assignees%rowtype;
  blocks jsonb;
  v_assignment jsonb;
  v_completion jsonb;
  v_team_evidence record;
  v_contributors jsonb;
begin
  ctx := public.crew_operations_employee_context(p_token);
  v_employee := (ctx->>'employee_id')::uuid;

  select i.* into instance
  from public.crew_operation_instances i
  join public.crew_task_instance_assignees a
    on a.instance_id = i.id and a.employee_id = v_employee
  where i.id = p_instance_id and i.is_operational;

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
    and r.status in ('completed', 'exception', 'good', 'needs_attention')
    and exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=instance.id and a.employee_id=r.employee_id)
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
    'completed_at', coalesce(response.completed_at, item.completed_at),
    'response_actor', (select jsonb_build_object('employee_id',e.id,'employee_name',e.full_name) from public.employees e where e.id=response.employee_id)
  ) order by item.sort_order), '[]'::jsonb)
  into blocks
  from public.crew_operation_instance_items item
  left join lateral (
    select r.* from public.crew_task_item_responses r
    where r.instance_item_id = item.id
      and (instance.completion_rule = 'one_for_team' or r.employee_id = v_employee)
      and exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=instance.id and a.employee_id=r.employee_id)
    order by r.completed_at desc, r.id desc
    limit 1
  ) response on true
  where item.instance_id = instance.id;

  select coalesce(jsonb_agg(jsonb_build_object('employee_id',e.id,'employee_name',e.full_name) order by e.full_name,e.id),'[]'::jsonb)
  into v_contributors from public.employees e
  where exists(select 1 from public.crew_task_item_responses r
    join public.crew_operation_instance_items x on x.id=r.instance_item_id
    join public.crew_task_instance_assignees a on a.instance_id=x.instance_id and a.employee_id=r.employee_id
    where x.instance_id=instance.id and r.employee_id=e.id
      and r.status in ('completed','exception','good','needs_attention')
      and (instance.completion_rule<>'every_assigned' or r.employee_id=v_employee));

  return jsonb_build_object(
    'id', instance.id,
    'template_id', instance.template_id,
    'name', instance.name,
    'task_type', instance.task_type,
    'schedule_type', instance.schedule_type,
    'priority', instance.priority,
    'status', public.crew_tasks_execution_status(instance.id,v_employee),
    'completed_at', assignee.completed_at,
    'assignment', v_assignment,
    'completion_audit', v_completion,
    'completion_contributors', v_contributors,
    'available_from', instance.available_from,
    'due_at', instance.available_until,
    'allow_exception', instance.allow_exception,
    'exception_requires_reason', instance.exception_requires_reason,
    'manager_review_required', instance.manager_review_required,
    'completion_rule', instance.completion_rule,
    'blocks', blocks
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.crew_tasks_update_block_unlocked(p_token text, p_block_id uuid, p_action text, p_response jsonb DEFAULT '{}'::jsonb, p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if block.id is null or not instance.is_operational
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
  on conflict(instance_item_id, employee_id) do update
    set status=excluded.status,response=excluded.response,exception_reason=excluded.exception_reason,
        note=excluded.note,completed_at=excluded.completed_at;

  update public.crew_operation_instances set execution_started_at=coalesce(execution_started_at,now()),
    status=case when status='not_started' then 'in_progress' else status end,updated_at=now()
    where id=instance.id;

  get diagnostics inserted_count = row_count;

  update public.crew_task_instance_assignees a
  set status = 'in_progress', updated_at = now()
  where a.instance_id = instance.id
    and (instance.completion_rule='one_for_team' or a.employee_id = v_employee)
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
$function$;

CREATE OR REPLACE FUNCTION public.crew_task_history_for_crew(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'completed', 'completed_with_exceptions', 'review_required', 'overdue', 'exception', 'in_progress'
    );

  return (v_read - 'tasks') || jsonb_build_object(
    'from', v_from,
    'to', v_today,
    'history_window_days', 30,
    'tasks', v_tasks
  );
end;
$function$;

