-- Shared one_for_team item results are projected to every assigned Crew member.
-- Response rows and their employee_id remain the original actor evidence.
-- Other completion rules retain their existing viewer-specific projections.

create or replace function public.crew_tasks_today(p_token text,p_business_date date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; v_employee uuid; v_outlet uuid; v_role uuid; v_position text; tasks jsonb; legacy jsonb; attendance jsonb;
begin
 ctx:=public.crew_operations_employee_context(p_token); v_employee:=(ctx->>'employee_id')::uuid; v_outlet:=(ctx->>'outlet_id')::uuid; v_role:=nullif(ctx->>'role_id','')::uuid; v_position:=ctx->>'position';
 perform public.crew_operations_ensure_instances(v_outlet,p_business_date);
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'source','instance','name',i.name,'task_type',i.task_type,'schedule_type',i.schedule_type,'priority',i.priority,'status',case when a.status='not_started' and i.available_until<now() then 'overdue' else a.status end,'available_from',i.available_from,'due_at',i.available_until,'completed_at',a.completed_at,'block_count',(select count(*) from public.crew_operation_instance_items x where x.instance_id=i.id),'completed_count',(select count(distinct x.id) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id=r.instance_item_id where x.instance_id=i.id and (i.completion_rule='one_for_team' or r.employee_id=v_employee) and r.status not in ('not_checked')),'exception_count',(select count(distinct x.id) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id=r.instance_item_id where x.instance_id=i.id and (i.completion_rule='one_for_team' or r.employee_id=v_employee) and r.status in ('exception','needs_attention'))) order by case i.priority when 'critical' then 1 when 'important' then 2 else 3 end,i.available_until,i.name),'[]'::jsonb) into tasks
 from public.crew_operation_instances i join public.crew_task_instance_assignees a on a.instance_id=i.id and a.employee_id=v_employee where i.outlet_id=v_outlet and i.business_date=p_business_date;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'source','legacy_daily','name',t.title,'description',t.description,'task_type','instruction','schedule_type','one_time','priority',case t.priority when 'high' then 'critical' else 'normal' end,'status',case when t.status='pending' and t.due_at<now() then 'overdue' else t.status end,'due_at',t.due_at,'sop_reference',t.sop_snapshot,'completed_at',t.completed_at) order by t.due_at nulls last,t.title),'[]'::jsonb) into legacy from public.crew_daily_tasks t where t.outlet_id=v_outlet and t.task_date=p_business_date and public.crew_operations_applicable(v_role,v_position,t.applicable_role_ids,t.applicable_positions);
 select jsonb_build_object('on_shift',exists(select 1 from public.crew_attendance_records a where a.employee_id=v_employee and a.outlet_id=v_outlet and a.status='open'),'clock_in_at',(select max(a.clock_in_at) from public.crew_attendance_records a where a.employee_id=v_employee and a.outlet_id=v_outlet and a.status='open')) into attendance;
 return jsonb_build_object('date',p_business_date,'outlet',jsonb_build_object('id',v_outlet,'name',(select name from public.outlets where id=v_outlet)),'employee',jsonb_build_object('id',v_employee,'name',ctx->>'employee_name','position',v_position),'attendance_context',attendance,'tasks',tasks||legacy);
end; $$;
revoke all on function public.crew_tasks_today(text,date) from public,anon,authenticated;
grant execute on function public.crew_tasks_today(text,date) to anon,authenticated;

-- Expose the frozen Task definition identifier in the existing, token-bound
-- Crew read model. This supports client-side presentation grouping only; the
-- RPC still obtains task visibility exclusively from instance assignees.
create or replace function public.crew_tasks_for_crew(
  p_token text,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public
as $$
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
    'status', case when a.status = 'not_started' and i.available_until < now() then 'overdue' else a.status end,
    'block_count', (select count(*) from public.crew_operation_instance_items x where x.instance_id = i.id),
    'completed_count', (select count(distinct x.id) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id = r.instance_item_id where x.instance_id = i.id and (i.completion_rule = 'one_for_team' or r.employee_id = v_employee_id) and r.status <> 'not_checked'),
    'exception_count', (select count(distinct x.id) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id = r.instance_item_id where x.instance_id = i.id and (i.completion_rule = 'one_for_team' or r.employee_id = v_employee_id) and r.status in ('exception', 'needs_attention'))
  ) order by i.business_date, i.available_from, i.name), '[]'::jsonb)
  into v_tasks
  from public.crew_operation_instances i
  join public.crew_task_instance_assignees a on a.instance_id = i.id and a.employee_id = v_employee_id
  left join public.crew_operation_templates template on template.id = i.template_id
  where i.outlet_id = v_outlet_id
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
$$;

revoke all on function public.crew_tasks_for_crew(text, date, date) from public, anon, authenticated;
grant execute on function public.crew_tasks_for_crew(text, date, date) to anon, authenticated;

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
