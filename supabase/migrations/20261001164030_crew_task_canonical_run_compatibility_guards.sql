-- Compatibility endpoints share the canonical run and frozen-evidence boundary.

CREATE OR REPLACE FUNCTION public.crew_management_tasks(p_token text, p_outlet_id uuid, p_business_date date DEFAULT (timezone('Asia/Kuala_Lumpur'::text, now()))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_employee_id uuid:=public.crew_session_employee(p_token); v_tasks jsonb;
begin
  if not exists(select 1 from public.employees where id=v_employee_id and lower(btrim(workplace))='management') then
    raise exception using errcode='42501',message='Management task view is unavailable.';
  end if;
  perform public.crew_selected_outlet(p_token,p_outlet_id);
  if p_business_date is null then raise exception using errcode='22023',message='Business date is required.'; end if;
  select coalesce(jsonb_agg(task order by task->>'due_at',task->>'name'),'[]'::jsonb) into v_tasks from (
    select jsonb_build_object('id',i.id,'source','instance','name',i.name,'task_type',i.task_type,
      'business_date',i.business_date,'due_at',i.available_until,'status',i.status,
      'block_count',(select count(*) from public.crew_operation_instance_items item where item.instance_id=i.id),
      'completed_count',case when i.completion_rule='one_for_team' then (select count(distinct item.id) from public.crew_operation_instance_items item join public.crew_task_item_responses r on r.instance_item_id=item.id join public.crew_task_instance_assignees a on a.instance_id=i.id and a.employee_id=r.employee_id where item.instance_id=i.id and r.status<>'not_checked') else (select count(*) from public.crew_operation_instance_items item where item.instance_id=i.id and item.status in ('completed','good')) end,
      'read_only',true) task
    from public.crew_operation_instances i where i.is_operational and i.outlet_id=p_outlet_id and i.business_date=p_business_date
    union all
    select jsonb_build_object('id',t.id,'source','legacy_daily','name',t.title,'description',t.description,
      'business_date',t.task_date,'due_at',t.due_at,'status',t.status,'read_only',true) task
    from public.crew_daily_tasks t where t.outlet_id=p_outlet_id and t.task_date=p_business_date
  ) visible;
  return jsonb_build_object('outlet',jsonb_build_object('id',p_outlet_id,
    'name',(select name from public.outlets where id=p_outlet_id)),
    'business_date',p_business_date,'read_only',true,'tasks',v_tasks);
end; $function$;

CREATE OR REPLACE FUNCTION public.crew_operations_today(p_token text, p_business_date date DEFAULT (timezone('Asia/Kuala_Lumpur'::text, now()))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; outlet uuid; employee uuid; role_id uuid; position text; instances jsonb; tasks jsonb; shift jsonb; schedule jsonb;
begin
  ctx:=public.crew_operations_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; role_id:=nullif(ctx->>'role_id','')::uuid; schedule:=public.crew_roster_employee_day(employee,p_business_date);
  outlet:=case when schedule is not null and schedule->>'entry_type'='working' then (schedule->>'outlet_id')::uuid else (ctx->>'outlet_id')::uuid end;
  position:=case when schedule is not null and schedule->>'entry_type'='working' then coalesce(nullif(schedule->>'position',''),ctx->>'position') else ctx->>'position' end;
  perform public.crew_operations_ensure_instances(outlet,p_business_date);
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'type',i.operation_type,'status',public.crew_operations_refresh_instance(i.id),'available_from',i.available_from,'available_until',i.available_until,'completed_at',i.completed_at,'item_count',(select count(*) from public.crew_operation_instance_items x where x.instance_id=i.id),'completed_count',(select count(*) from public.crew_operation_instance_items x where x.instance_id=i.id and x.status not in ('pending','not_checked')),'exception_count',(select count(*) from public.crew_operation_instance_items x where x.instance_id=i.id and x.status in ('exception','needs_attention'))) order by case i.operation_type when 'opening' then 1 when 'daily' then 2 when 'health' then 3 else 4 end,i.name),'[]'::jsonb) into instances from public.crew_operation_instances i where i.is_operational and i.outlet_id=outlet and i.business_date=p_business_date and public.crew_operations_applicable(role_id,position,i.applicable_role_ids,i.applicable_positions);
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'description',t.description,'priority',t.priority,'due_at',t.due_at,'status',case when t.status='pending' and t.due_at<now() then 'overdue' else t.status end,'sop_reference',t.sop_snapshot,'completed_at',t.completed_at) order by case t.priority when 'high' then 1 when 'normal' then 2 else 3 end,t.due_at nulls last,t.title),'[]'::jsonb) into tasks from public.crew_daily_tasks t where t.outlet_id=outlet and t.task_date=p_business_date and public.crew_operations_applicable(role_id,position,t.applicable_role_ids,t.applicable_positions);
  select jsonb_build_object('on_shift',exists(select 1 from public.crew_attendance_records a where a.employee_id=employee and a.outlet_id=outlet and a.status='open'),'clock_in_at',(select max(a.clock_in_at) from public.crew_attendance_records a where a.employee_id=employee and a.outlet_id=outlet and a.status='open')) into shift;
  return jsonb_build_object('date',p_business_date,'outlet',jsonb_build_object('id',outlet,'name',(select name from public.outlets where id=outlet)),'employee',jsonb_build_object('id',employee,'name',ctx->>'employee_name','position',position),'roster_context',schedule,'attendance_context',shift,'checklists',instances,'daily_tasks',tasks);
end; $function$;

CREATE OR REPLACE FUNCTION public.crew_operations_detail(p_token text, p_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; instance public.crew_operation_instances%rowtype; items jsonb;
begin
 ctx:=public.crew_operations_employee_context(p_token); select * into instance from public.crew_operation_instances where id=p_instance_id;
 if instance.id is null or not instance.is_operational or instance.outlet_id<>(ctx->>'outlet_id')::uuid or not public.crew_operations_applicable(nullif(ctx->>'role_id','')::uuid,ctx->>'position',instance.applicable_role_ids,instance.applicable_positions) then raise exception using errcode='42501',message='Checklist is unavailable.'; end if;
 perform public.crew_operations_refresh_instance(instance.id); select * into instance from public.crew_operation_instances where id=instance.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'title',i.title,'description',i.description,'required',i.is_required,'sort_order',i.sort_order,'evidence_requirement',i.evidence_requirement,'health_category',i.health_category,'sop_reference',i.sop_reference,'status',i.status,'exception_reason',i.exception_reason,'note',i.note,'completed_by',case when e.id is null then null else jsonb_build_object('id',e.id,'name',e.full_name) end,'completed_at',i.completed_at) order by i.sort_order),'[]'::jsonb) into items from public.crew_operation_instance_items i left join public.employees e on e.id=i.completed_by where i.instance_id=instance.id;
 return jsonb_build_object('id',instance.id,'name',instance.name,'type',instance.operation_type,'date',instance.business_date,'status',instance.status,'available_from',instance.available_from,'available_until',instance.available_until,'items',items);
end; $function$;

CREATE OR REPLACE FUNCTION public.crew_operations_complete_checklist(p_token text, p_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; instance public.crew_operation_instances%rowtype; next_status text;
begin
 ctx:=public.crew_operations_employee_context(p_token); select * into instance from public.crew_operation_instances where id=p_instance_id for update;
 if instance.id is null or not instance.is_operational or instance.outlet_id<>(ctx->>'outlet_id')::uuid or not public.crew_operations_applicable(nullif(ctx->>'role_id','')::uuid,ctx->>'position',instance.applicable_role_ids,instance.applicable_positions) then raise exception using errcode='42501',message='Checklist is unavailable.'; end if;
 if exists(select 1 from public.crew_task_instance_assignees where instance_id=instance.id) then
   return public.crew_tasks_complete(p_token,instance.id);
 end if;
 if exists(select 1 from public.crew_operation_instance_items where instance_id=instance.id and is_required and status in ('pending','not_checked')) then raise exception using errcode='22023',message='Complete every required item before finishing this checklist.'; end if;
 next_status:=public.crew_operations_refresh_instance(instance.id);
 return jsonb_build_object('id',instance.id,'status',next_status,'completed_at',(select completed_at from public.crew_operation_instances where id=instance.id));
end; $function$;

CREATE OR REPLACE FUNCTION public.crew_operations_update_item(p_token text, p_item_id uuid, p_action text, p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_evidence jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; item public.crew_operation_instance_items%rowtype; instance public.crew_operation_instances%rowtype; employee uuid; next_status text; result jsonb;
begin
 ctx:=public.crew_operations_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid;
 select * into item from public.crew_operation_instance_items where id=p_item_id;
 select * into instance from public.crew_operation_instances where id=item.instance_id for update;
 select * into item from public.crew_operation_instance_items where id=p_item_id for update;
 if item.id is null or not instance.is_operational or instance.outlet_id<>(ctx->>'outlet_id')::uuid or not public.crew_operations_applicable(nullif(ctx->>'role_id','')::uuid,ctx->>'position',instance.applicable_role_ids,instance.applicable_positions) then raise exception using errcode='42501',message='Checklist item is unavailable.'; end if;
 if now()<instance.available_from then raise exception using errcode='22023',message='This checklist is not available yet.'; end if;
 if p_evidence is not null then raise exception using errcode='0A000',message='Photo evidence is not enabled for Daily Operations v1.'; end if;
 if instance.operation_type='health' then
   if p_action not in ('good','needs_attention','not_checked') then raise exception using errcode='22023',message='Health Check result is invalid.'; end if;
   if p_action='needs_attention' and char_length(btrim(coalesce(p_note,'')))<3 then raise exception using errcode='22023',message='A note is required when an area needs attention.'; end if;
 else
   if p_action not in ('completed','exception') then raise exception using errcode='22023',message='Checklist action is invalid.'; end if;
   if p_action='exception' and coalesce(p_reason,'') not in ('equipment_issue','stock_unavailable','area_unavailable','manager_instruction','other') then raise exception using errcode='22023',message='Choose a reason for Unable to Complete.'; end if;
   if item.evidence_requirement='note' and char_length(btrim(coalesce(p_note,'')))<3 then raise exception using errcode='22023',message='A note is required for this item.'; end if;
 end if;
 if exists(select 1 from public.crew_task_instance_assignees where instance_id=instance.id) then
   result:=public.crew_tasks_update_block(p_token,item.id,p_action,
     jsonb_build_object('value',case when p_action in ('good','needs_attention','not_checked') then to_jsonb(p_action) else 'true'::jsonb end),p_reason,p_note);
   return result||jsonb_build_object('item_id',item.id,'instance_status',result->>'task_status',
     'completed_by',employee,'completed_at',now());
 end if;
 if instance.completed_at is not null or instance.status in ('completed','completed_with_exceptions') then
   raise exception using errcode='55000',message='Completed Task evidence cannot be edited.';
 end if;
 update public.crew_operation_instances set execution_started_at=coalesce(execution_started_at,now()) where id=instance.id;
 if item.status not in ('pending','not_checked') then next_status:=public.crew_operations_refresh_instance(instance.id); return jsonb_build_object('item_id',item.id,'status',item.status,'instance_status',next_status,'completed_by',item.completed_by,'completed_at',item.completed_at,'idempotent',true); end if;
 update public.crew_operation_instance_items set status=p_action,exception_reason=case when p_action='exception' then p_reason else null end,note=nullif(btrim(p_note),''),evidence=null,completed_by=employee,completed_at=now(),updated_at=now() where id=item.id;
 next_status:=public.crew_operations_refresh_instance(instance.id);
 return jsonb_build_object('item_id',item.id,'status',p_action,'instance_status',next_status,'completed_by',employee,'completed_at',now(),'idempotent',false);
end; $function$;

CREATE OR REPLACE FUNCTION public.crew_operations_refresh_instance(p_instance_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare next_status text; instance public.crew_operation_instances%rowtype; required_pending int; touched int; exceptions int;
begin
 select * into instance from public.crew_operation_instances where id=p_instance_id for update;
 if instance.id is null then return null; end if;
 if not instance.is_operational or instance.completed_at is not null
   or instance.status in ('completed','completed_with_exceptions')
   or exists(select 1 from public.crew_task_instance_assignees where instance_id=instance.id) then
   return instance.status;
 end if;
 select count(*) filter(where is_required and status in ('pending','not_checked')),count(*) filter(where status<>'pending'),count(*) filter(where status in ('exception','needs_attention')) into required_pending,touched,exceptions from public.crew_operation_instance_items where instance_id=p_instance_id;
 next_status:=case when required_pending=0 then case when exceptions>0 then 'completed_with_exceptions' else 'completed' end when instance.available_until<now() then 'overdue' when touched>0 then 'in_progress' else 'not_started' end;
 update public.crew_operation_instances set status=next_status,completed_at=case when next_status in ('completed','completed_with_exceptions') then coalesce(completed_at,now()) else null end,updated_at=now() where id=p_instance_id;
 return next_status;
end; $function$;

CREATE OR REPLACE FUNCTION public.crew_tasks_reconcile_stranded_team(p_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  instance public.crew_operation_instances%rowtype;
  v_evidence record;
  v_status text;
  v_assignees integer;
  v_audit_id uuid;
begin
  select * into instance from public.crew_operation_instances
  where id = p_instance_id for update;
  if instance.id is null or not instance.is_operational or instance.completion_rule <> 'one_for_team' then
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
$function$;

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
    'status', case when a.status = 'not_started' and i.available_until < now() then 'overdue' else a.status end,
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
