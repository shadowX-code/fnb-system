-- FeedX Crew Operations: token-bound current and upcoming Task list for Mobile.
-- Home remains on crew_tasks_today; this read model only expands the Operations list.

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

  -- Only create frozen instances for today and future dates. Historical data is
  -- read as-is, so simply opening All Tasks never manufactures past obligations.
  for v_date in select generate_series(greatest(v_from, v_today), v_to, interval '1 day')::date loop
    perform public.crew_operations_ensure_instances(v_outlet_id, v_date);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'source', 'instance',
    'name', i.name,
    'task_type', i.task_type,
    'schedule_type', i.schedule_type,
    'schedule_config', coalesce(i.template_snapshot->'schedule_config', '{}'::jsonb),
    'priority', i.priority,
    'business_date', i.business_date,
    'available_from', i.available_from,
    'due_at', i.available_until,
    'completed_at', a.completed_at,
    'status', case when a.status = 'not_started' and i.available_until < now() then 'overdue' else a.status end,
    'block_count', (select count(*) from public.crew_operation_instance_items x where x.instance_id = i.id),
    'completed_count', (select count(*) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id = r.instance_item_id where x.instance_id = i.id and r.employee_id = v_employee_id and r.status <> 'not_checked'),
    'exception_count', (select count(*) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id = r.instance_item_id where x.instance_id = i.id and r.employee_id = v_employee_id and r.status in ('exception', 'needs_attention'))
  ) order by i.business_date, i.available_from, i.name), '[]'::jsonb)
  into v_tasks
  from public.crew_operation_instances i
  join public.crew_task_instance_assignees a on a.instance_id = i.id and a.employee_id = v_employee_id
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
