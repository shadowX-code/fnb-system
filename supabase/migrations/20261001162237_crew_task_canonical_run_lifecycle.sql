-- One canonical execution per series/outlet/business date across revisions.
-- Incomplete responses are working state; completed executions stay frozen.
-- No response evidence is copied during occurrence reconciliation.
alter table public.crew_operation_instances
  add column is_operational boolean not null default true,
  add column execution_started_at timestamptz,
  add column superseded_at timestamptz,
  add column superseded_by uuid references public.crew_operation_instances(id) on delete restrict,
  add column supersession_reason text;

update public.crew_operation_instances i
set execution_started_at = evidence.started_at
from (
  select x.instance_id, min(r.completed_at) started_at
  from public.crew_task_item_responses r
  join public.crew_operation_instance_items x on x.id=r.instance_item_id
  group by x.instance_id
) evidence where i.id=evidence.instance_id;

-- A reset does not unpin a run that has started. Backfill existing resets too.
update public.crew_operation_instances i
set execution_started_at=coalesce(i.execution_started_at, evidence.started_at)
from (
  select (metadata->>'task_instance_id')::uuid instance_id, min(created_at) started_at
  from public.audit_logs where action='crew_task_reset'
    and coalesce((metadata->>'cleared_response_count')::integer,0)>0
  group by metadata->>'task_instance_id'
) evidence where i.id=evidence.instance_id;

create function public.crew_tasks_reconcile_run(p_canonical_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare canonical public.crew_operation_instances%rowtype; old record; ids uuid[]:='{}';
begin
  if char_length(btrim(coalesce(p_reason,'')))<3 then
    raise exception using errcode='22023',message='A reconciliation reason is required.';
  end if;
  select * into canonical from public.crew_operation_instances where id=p_canonical_id;
  if canonical.id is null then raise exception 'Canonical Task occurrence is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crew-task-series:'||canonical.template_series_id,0));
  perform 1 from public.crew_operation_instances
  where template_series_id=canonical.template_series_id and outlet_id=canonical.outlet_id
    and business_date=canonical.business_date order by id for update;
  select * into canonical from public.crew_operation_instances where id=p_canonical_id;
  if not canonical.is_operational then raise exception 'Canonical Task occurrence is superseded.'; end if;
  for old in select * from public.crew_operation_instances
    where template_series_id=canonical.template_series_id and outlet_id=canonical.outlet_id
      and business_date=canonical.business_date and id<>canonical.id and is_operational
  loop
    if old.status in ('completed','completed_with_exceptions') or old.completed_at is not null
      or exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=old.id
                and a.status in ('completed','completed_with_exceptions','review_required')) then
      raise exception 'A finalized/reviewing execution cannot be superseded automatically.';
    end if;
    update public.crew_operation_instances set is_operational=false,superseded_at=now(),
      superseded_by=canonical.id,supersession_reason=btrim(p_reason),updated_at=now() where id=old.id;
    ids:=array_append(ids,old.id);
    insert into public.audit_logs(action,module,description,metadata)
    values('crew_task_run_superseded','crew','A duplicate Task execution was made non-operational.',
      jsonb_build_object('task_instance_id',old.id,'canonical_instance_id',canonical.id,
        'series_id',canonical.template_series_id,'outlet_id',canonical.outlet_id,
        'business_date',canonical.business_date,'reason',btrim(p_reason),
        'actor_auth_user_id',auth.uid(),'response_evidence_unchanged',true,'responses_transferred',false));
  end loop;
  return jsonb_build_object('canonical_instance_id',canonical.id,'superseded_instance_ids',ids);
end; $$;
revoke all on function public.crew_tasks_reconcile_run(uuid,text) from public,anon,authenticated;
grant execute on function public.crew_tasks_reconcile_run(uuid,text) to service_role;

-- Existing duplicates: preserve a completed/started snapshot; otherwise use
-- the newest revision effective for that run. Abort ambiguous final evidence.
-- Explicitly requested historical exception: JYMT Closing Duties 1 Oct uses v2,
-- with v1 retained for audit and no incomplete answers transferred.
do $$
declare run record; winner uuid; finals integer;
begin
  for run in select template_series_id,outlet_id,business_date
    from public.crew_operation_instances group by template_series_id,outlet_id,business_date having count(*)>1
  loop
    select count(*) into finals from public.crew_operation_instances i
      where i.template_series_id=run.template_series_id and i.outlet_id=run.outlet_id
        and i.business_date=run.business_date and (i.completed_at is not null
          or i.status in ('completed','completed_with_exceptions')
          or exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=i.id
                    and a.status in ('completed','completed_with_exceptions','review_required')));
    if finals>1 then raise exception 'Multiple finalized Task executions require explicit review: %',run; end if;
    select i.id into winner from public.crew_operation_instances i
      join public.crew_operation_templates t on t.id=i.template_id
      join public.outlets o on o.id=i.outlet_id
      where i.template_series_id=run.template_series_id and i.outlet_id=run.outlet_id and i.business_date=run.business_date
      order by (i.completed_at is not null or i.status in ('completed','completed_with_exceptions')
                or exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=i.id
                          and a.status in ('completed','completed_with_exceptions','review_required'))) desc,
        (i.name='Closing Duties' and o.name='JYMT Kopitiam' and i.business_date=date '2026-10-01' and i.template_revision=2) desc,
        (i.execution_started_at is not null) desc,i.execution_started_at asc nulls last,
        (t.effective_date<=i.business_date) desc,i.template_revision desc,i.created_at,i.id limit 1;
    perform public.crew_tasks_reconcile_run(winner,'Canonical scheduled-run reconciliation; incomplete responses remain on their original audit occurrence.');
  end loop;
end; $$;

create unique index crew_task_one_operational_run
  on public.crew_operation_instances(template_series_id,outlet_id,business_date) where is_operational;

CREATE OR REPLACE FUNCTION public.crew_operations_ensure_instances(p_outlet_id uuid, p_business_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_template public.crew_operation_templates%rowtype;
  v_instance_id uuid;
  v_snapshot jsonb;
  v_shift_start time;
  v_shift_end time;
  v_existing public.crew_operation_instances%rowtype;
  v_candidate_id uuid;
begin
  perform public.crew_tasks_refresh_lifecycle(p_outlet_id);
  for v_template in
    select * from public.crew_operation_templates t
    where t.outlet_id=p_outlet_id
      and t.status='active'

  loop
    v_candidate_id:=v_template.id;
    perform pg_advisory_xact_lock(hashtextextended('crew-task-series:'||v_template.series_id,0));
    select * into v_template from public.crew_operation_templates
      where id=v_candidate_id and status='active';
    if v_template.id is null then continue; end if;
    if v_template.effective_date>p_business_date then
      select * into v_template from public.crew_operation_templates t
        where t.series_id=v_template.series_id and t.outlet_id=p_outlet_id
          and t.status='archived' and t.activated_at is not null and t.effective_date<=p_business_date
        order by t.revision desc limit 1;
    end if;
    if v_template.id is null or not public.crew_tasks_schedule_matches(v_template,p_business_date)
      or (v_template.schedule_end_date is not null and p_business_date>v_template.schedule_end_date) then continue; end if;
    select * into v_existing from public.crew_operation_instances
      where template_series_id=v_template.series_id and outlet_id=p_outlet_id
        and business_date=p_business_date and is_operational for update;
    if v_existing.id is not null then
      if v_existing.template_id=v_template.id or v_existing.execution_started_at is not null
        or v_existing.completed_at is not null or v_existing.status in ('completed','completed_with_exceptions')
        or exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=v_existing.id
                  and a.status in ('completed','completed_with_exceptions','review_required')) then
        perform public.crew_tasks_sync_open_instance_assignees(v_existing.id);
        continue;
      end if;
      update public.crew_operation_instances set is_operational=false,superseded_at=now(),
        supersession_reason='Latest revision activated before execution started.',updated_at=now()
        where id=v_existing.id;
    end if;
    select min(r.start_time),max(r.end_time) into v_shift_start,v_shift_end
    from public.duty_roster_published_entries r
    where r.outlet_id=p_outlet_id and r.roster_date=p_business_date and r.entry_type='working';

    select jsonb_build_object(
      'template_id',v_template.id,'series_id',v_template.series_id,'revision',v_template.revision,
      'name',v_template.name,'task_type',v_template.task_type,'schedule_type',v_template.schedule_type,
      'schedule_config',v_template.schedule_config,'schedule_end_date',v_template.schedule_end_date,
      'priority',v_template.priority,'completion_rule',v_template.completion_rule,
      'assignment_type',v_template.assignment_type,'applicable_employee_ids',v_template.applicable_employee_ids,
      'applicable_positions',v_template.applicable_positions,'applicable_group_names',v_template.applicable_group_names,
      'on_duty_only',v_template.on_duty_only,'allow_exception',v_template.allow_exception,
      'exception_requires_reason',v_template.exception_requires_reason,'manager_review_required',v_template.manager_review_required,
      'allow_late_completion',v_template.allow_late_completion,
      'items',coalesce(jsonb_agg(jsonb_build_object(
        'id',i.id,'title',i.title,'description',i.description,'is_required',i.is_required,
        'sort_order',i.sort_order,'block_type',i.block_type,'block_config',i.block_config,
        'evidence_requirement',i.evidence_requirement,'health_category',i.health_category,'sop_reference',i.sop_snapshot
      ) order by i.sort_order),'[]'::jsonb)
    ) into v_snapshot
    from public.crew_operation_template_items i
    where i.template_id=v_template.id;

    insert into public.crew_operation_instances(
      template_id,template_series_id,template_revision,outlet_id,business_date,operation_type,name,
      applicable_role_ids,applicable_positions,available_from,available_until,template_snapshot,
      task_type,schedule_type,priority,completion_rule,assignment_type,applicable_employee_ids,
      applicable_group_names,on_duty_only,allow_exception,exception_requires_reason,manager_review_required,allow_late_completion
    ) values(
      v_template.id,v_template.series_id,v_template.revision,v_template.outlet_id,p_business_date,v_template.operation_type,v_template.name,
      v_template.applicable_role_ids,v_template.applicable_positions,
      (p_business_date+coalesce(v_template.available_from,case v_template.schedule_config->>'shift_phase' when 'before_shift' then coalesce(v_shift_start,time '09:00')-interval '2 hours' else coalesce(v_shift_start,time '00:00') end)) at time zone 'Asia/Kuala_Lumpur',
      (p_business_date+coalesce(v_template.available_until,case v_template.schedule_config->>'shift_phase' when 'end_of_shift' then coalesce(v_shift_end,time '23:59') else time '23:59:59' end)) at time zone 'Asia/Kuala_Lumpur',
      v_snapshot,v_template.task_type,v_template.schedule_type,v_template.priority,v_template.completion_rule,
      v_template.assignment_type,v_template.applicable_employee_ids,v_template.applicable_group_names,v_template.on_duty_only,
      v_template.allow_exception,v_template.exception_requires_reason,v_template.manager_review_required,v_template.allow_late_completion
    ) on conflict(template_id,business_date) do nothing returning id into v_instance_id;

    if v_instance_id is not null then
      insert into public.crew_operation_instance_items(
        instance_id,snapshot_item_id,title,description,is_required,sort_order,evidence_requirement,
        health_category,sop_reference,block_type,block_config
      )
      select v_instance_id,i.id,i.title,i.description,i.is_required,i.sort_order,i.evidence_requirement,
             i.health_category,i.sop_snapshot,i.block_type,i.block_config
      from public.crew_operation_template_items i
      where i.template_id=v_template.id
      order by i.sort_order;
    else
      select id into v_instance_id
      from public.crew_operation_instances
      where template_id=v_template.id and business_date=p_business_date;
    end if;

    if v_existing.id is not null then
      update public.crew_operation_instances set superseded_by=v_instance_id where id=v_existing.id;
      insert into public.audit_logs(action,module,description,metadata)
      values('crew_task_run_superseded','crew','An unstarted Task run adopted its latest revision.',
        jsonb_build_object('task_instance_id',v_existing.id,'canonical_instance_id',v_instance_id,
          'series_id',v_template.series_id,'outlet_id',p_outlet_id,'business_date',p_business_date,
          'actor_auth_user_id',auth.uid(),'response_evidence_unchanged',true,'responses_transferred',false));
    end if;
    perform public.crew_tasks_sync_open_instance_assignees(v_instance_id);
    v_instance_id:=null;
  end loop;

  update public.crew_daily_tasks set status='overdue',updated_at=now()
  where outlet_id=p_outlet_id and task_date=p_business_date and status='pending' and due_at<now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.crew_operations_activate_template(p_template_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_task public.crew_operation_templates%rowtype; v_run record;
begin
  select * into v_task from public.crew_operation_templates where id=p_template_id;
  if v_task.id is not null then
    perform pg_advisory_xact_lock(hashtextextended('crew-task-series:'||v_task.series_id,0));
  end if;
  select * into v_task from public.crew_operation_templates where id=p_template_id for update;
  if v_task.id is null or v_task.status<>'draft'
     or not public.current_user_has_permission('crew_operations.manage')
     or not public.current_user_can_access_outlet(v_task.outlet_id) then
    raise exception using errcode='42501',message='Draft Task activation is unavailable.';
  end if;
  if not exists(select 1 from public.crew_operation_template_items where template_id=v_task.id) then
    raise exception using errcode='22023',message='Task needs at least one content block.';
  end if;
  perform set_config('feedx.operation_lifecycle','activate',true);
  update public.crew_operation_templates
  set status='archived',archived_at=now(),updated_at=now()
  where series_id=v_task.series_id and id<>v_task.id and status in ('active','paused','ended');
  update public.crew_operation_templates
  set status='active',activated_at=now(),paused_at=null,ended_at=null,archived_at=null,updated_at=now()
  where id=v_task.id returning * into v_task;
  perform set_config('feedx.operation_lifecycle','',true);
  for v_run in select i.id,i.business_date from public.crew_operation_instances i
    where i.template_series_id=v_task.series_id and i.outlet_id=v_task.outlet_id
      and i.is_operational and i.business_date>=v_task.effective_date
      and i.execution_started_at is null and i.completed_at is null
      and i.status not in ('completed','completed_with_exceptions')
      order by i.business_date
  loop
    if public.crew_tasks_schedule_matches(v_task,v_run.business_date)
      and (v_task.schedule_end_date is null or v_run.business_date<=v_task.schedule_end_date) then
      perform public.crew_operations_ensure_instances(v_task.outlet_id,v_run.business_date);
    else
      -- Schedule removal only retires an untouched run; recheck after locking.
      perform 1 from public.crew_operation_instances where id=v_run.id for update;
      update public.crew_operation_instances set is_operational=false,superseded_at=now(),
        supersession_reason='Unstarted run removed by the effective Task schedule revision.',updated_at=now()
      where id=v_run.id and execution_started_at is null and completed_at is null
        and status not in ('completed','completed_with_exceptions');
      if found then
        insert into public.audit_logs(action,module,description,metadata)
        values('crew_task_run_superseded','crew','An unstarted Task run was removed by a schedule revision.',
          jsonb_build_object('task_instance_id',v_run.id,'replacement_template_id',v_task.id,
            'actor_auth_user_id',auth.uid(),'responses_transferred',false));
      end if;
    end if;
  end loop;
  return jsonb_build_object('id',v_task.id,'status',v_task.status,'revision',v_task.revision,'activated_at',v_task.activated_at);
end;
$function$;

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
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'source','instance','name',i.name,'task_type',i.task_type,'schedule_type',i.schedule_type,'priority',i.priority,'status',case when a.status='not_started' and i.available_until<now() then 'overdue' else a.status end,'available_from',i.available_from,'due_at',i.available_until,'completed_at',a.completed_at,'block_count',(select count(*) from public.crew_operation_instance_items x where x.instance_id=i.id),'completed_count',(select count(distinct x.id) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id=r.instance_item_id where x.instance_id=i.id and (i.completion_rule='one_for_team' or r.employee_id=v_employee) and r.status not in ('not_checked')),'exception_count',(select count(distinct x.id) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id=r.instance_item_id where x.instance_id=i.id and (i.completion_rule='one_for_team' or r.employee_id=v_employee) and r.status in ('exception','needs_attention'))) order by case i.priority when 'critical' then 1 when 'important' then 2 else 3 end,i.available_until,i.name),'[]'::jsonb) into tasks
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
    'status', assignee.status,
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

CREATE OR REPLACE FUNCTION public.crew_tasks_complete(p_token text, p_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if instance.id is null or not instance.is_operational
    or instance.outlet_id <> (ctx->>'outlet_id')::uuid
    or not exists (select 1 from public.crew_task_instance_assignees
                   where instance_id = instance.id and employee_id = v_employee)
  then
    raise exception using errcode = '42501', message = 'Task is unavailable.';
  end if;

  if exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=instance.id and a.employee_id=v_employee and a.status in ('completed','completed_with_exceptions')) then
    return jsonb_build_object('id',instance.id,'status',(select status from public.crew_task_instance_assignees where instance_id=instance.id and employee_id=v_employee),'completed_at',(select completed_at from public.crew_task_instance_assignees where instance_id=instance.id and employee_id=v_employee),'idempotent',true);
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
$function$;

CREATE OR REPLACE FUNCTION public.crew_tasks_review(p_instance_id uuid, p_employee_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if instance.id is null or not instance.is_operational or assignee.instance_id is null or assignee.status <> 'review_required'
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
$function$;

CREATE OR REPLACE FUNCTION public.crew_tasks_sync_open_instance_assignees(p_instance_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_instance public.crew_operation_instances%rowtype;
  v_template public.crew_operation_templates%rowtype;
  v_employee public.employees%rowtype;
begin
  select * into v_instance
  from public.crew_operation_instances
  where id=p_instance_id
  for update;

  if v_instance.id is null or not v_instance.is_operational or v_instance.execution_started_at is not null or v_instance.status in ('completed','completed_with_exceptions') then
    return;
  end if;

  -- An instance keeps the exact Task revision it was born with. The roster is
  -- deliberately live only for unstarted obligations so a latest publication
  -- can remove OFF/leave/no-shift Crew before anyone acts on the Task.
  select * into v_template
  from public.crew_operation_templates
  where id=v_instance.template_id;

  if v_template.id is null then
    return;
  end if;

  for v_employee in
    select e.*
    from public.employees e
    join public.crew_access ca
      on ca.employee_id=e.id
     and ca.access_state='active'
     and ca.primary_outlet_id=v_instance.outlet_id
    where e.is_active
      and coalesce(e.employment_status,'active') not in ('resigned','terminated')
  loop
    if public.crew_tasks_employee_applies(v_template,v_employee,v_instance.business_date) then
      insert into public.crew_task_instance_assignees(instance_id,employee_id)
      values(v_instance.id,v_employee.id)
      on conflict(instance_id,employee_id) do nothing;
    end if;
  end loop;

  -- Never remove someone who has started, completed, or recorded an exception:
  -- their audit trail and frozen execution result are retained intact.
  delete from public.crew_task_instance_assignees a
  where a.instance_id=v_instance.id
    and a.status='not_started'
    and not exists (
      select 1
      from public.employees e
      join public.crew_access ca
        on ca.employee_id=e.id
       and ca.access_state='active'
       and ca.primary_outlet_id=v_instance.outlet_id
      where e.id=a.employee_id
        and e.is_active
        and coalesce(e.employment_status,'active') not in ('resigned','terminated')
        and public.crew_tasks_employee_applies(v_template,e,v_instance.business_date)
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.crew_tasks_reset(p_token text, p_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    or not v_instance.is_operational
    or v_instance.outlet_id <> (ctx->>'outlet_id')::uuid
    or v_assignee.instance_id is null
  then
    raise exception using errcode = '42501', message = 'Task reset is unavailable.';
  end if;

  if v_assignee.status not in ('not_started', 'in_progress', 'overdue')
    or v_instance.completed_at is not null or v_instance.status in ('completed','completed_with_exceptions','review_required')
    or (v_instance.completion_rule='one_for_team' and exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=v_instance.id and a.status in ('completed','completed_with_exceptions','review_required'))) then
    raise exception using errcode = '55000', message = 'Only an unfinished Task can be redone.';
  end if;

  delete from public.crew_task_item_responses r
  using public.crew_operation_instance_items i
  where r.instance_item_id = i.id
    and i.instance_id = v_instance.id
    and (v_instance.completion_rule='one_for_team' or r.employee_id = v_employee);
  get diagnostics v_cleared_count = row_count;

  update public.crew_task_instance_assignees
  set status = 'not_started',
      completed_at = null,
      updated_at = now()
  where instance_id = v_instance.id
    and (v_instance.completion_rule='one_for_team' or employee_id = v_employee);

  if v_instance.completion_rule='one_for_team' then
    update public.crew_operation_instances set status='not_started',completed_at=null,updated_at=now()
      where id=v_instance.id;
  end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.crew_notification_source_available(p_notification crew_notifications)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  case p_notification.source_entity_type
    when 'disciplinary_warning' then
      return exists(select 1 from public.employee_disciplinary_warnings w where w.id=p_notification.source_entity_id and w.employee_id=p_notification.recipient_employee_id and w.status not in ('withdrawn','superseded'));
    when 'employment_document' then
      return exists(select 1 from public.employee_employment_documents d where d.id=p_notification.source_entity_id and d.employee_id=p_notification.recipient_employee_id and d.status not in ('withdrawn','superseded'));
    when 'compliance_submission' then
      return exists(select 1 from public.employee_compliance_submissions s where s.id=p_notification.source_entity_id and s.employee_id=p_notification.recipient_employee_id);
    when 'compliance_requirement' then
      return exists(select 1 from public.employee_compliance_requirements r where r.id=p_notification.source_entity_id and r.is_active);
    when 'leave_request' then
      return exists(select 1 from public.crew_leave_requests l where l.id=p_notification.source_entity_id and l.employee_id=p_notification.recipient_employee_id);
    when 'roster_publication' then
      return exists(select 1 from public.duty_roster_publications p where p.id=p_notification.source_entity_id);
    when 'task_occurrence' then
      return exists(select 1 from public.crew_task_instance_assignees a join public.crew_operation_instances i on i.id=a.instance_id where i.is_operational and a.instance_id=p_notification.source_entity_id and a.employee_id=p_notification.recipient_employee_id and a.status not in ('completed','completed_with_exceptions'));
    else return false;
  end case;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crew_notification_generate_scheduled()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_date date:=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date; v_now timestamptz:=clock_timestamp(); r record; v_prior text; v_fingerprint text; v_state public.crew_notification_task_state%rowtype; v_due_soon interval:=interval '1 hour';
begin
  -- Existing task authority materializes today's occurrences. This is scheduler
  -- work, never a Crew page-read side effect.
  perform public.crew_operations_ensure_instances(o.id,v_date)
  from public.outlets o where exists(select 1 from public.crew_access ca where ca.primary_outlet_id=o.id and ca.access_state='active');

  for r in
    select e.id employee_id, public.crew_resolve_employee_outlet(e.id) outlet_id, req.id requirement_id, req.code, req.name,
      public.employee_compliance_current(e.id,req.id,v_date) state
    from public.employees e cross join public.employee_compliance_requirements req
    where req.is_active and public.crew_notification_recipient_is_active(e.id)
  loop
    select effective_status into v_prior from public.crew_notification_compliance_state where employee_id=r.employee_id and requirement_id=r.requirement_id for update;
    if v_prior is not null and v_prior is distinct from r.state->>'effective_status' then
      if r.state->>'effective_status'='expiring_soon' then
        perform public.crew_notification_create(r.employee_id,r.outlet_id,'people','compliance_expiring_soon','compliance_requirement',r.requirement_id,'normal',
          'Document expires soon',r.name||' expires soon.',jsonb_build_object('version',1,'type','compliance_requirement','requirement_code',r.code),'compliance.expiring_soon:'||r.employee_id||':'||r.requirement_id||':'||v_date);
      elsif r.state->>'effective_status'='expired' then
        perform public.crew_notification_create(r.employee_id,r.outlet_id,'people','compliance_expired','compliance_requirement',r.requirement_id,'important',
          'Document expired',r.name||case when coalesce((r.state->>'replacement_pending')::boolean,false) then ' has expired while your renewal is awaiting verification.' else ' has expired. Please renew it.' end,
          jsonb_build_object('version',1,'type','compliance_requirement','requirement_code',r.code),'compliance.expired:'||r.employee_id||':'||r.requirement_id||':'||v_date);
      end if;
    end if;
    insert into public.crew_notification_compliance_state(employee_id,requirement_id,effective_status)
    values(r.employee_id,r.requirement_id,coalesce(r.state->>'effective_status','missing'))
    on conflict(employee_id,requirement_id) do update set effective_status=excluded.effective_status;
  end loop;

  for r in
    select i.id instance_id,a.employee_id,i.outlet_id,i.name,i.schedule_type,i.available_from,i.available_until,a.status,
      encode(extensions.digest(concat_ws('|',i.name,i.available_from,i.available_until,i.schedule_type,a.employee_id),'sha256'),'hex') fingerprint
    from public.crew_operation_instances i join public.crew_task_instance_assignees a on a.instance_id=i.id
    where i.is_operational and i.business_date>=v_date and i.available_from<=v_now and public.crew_notification_recipient_is_active(a.employee_id)
  loop
    select * into v_state from public.crew_notification_task_state where instance_id=r.instance_id and employee_id=r.employee_id for update;
    if v_state.instance_id is null then
      perform public.crew_notification_create(r.employee_id,r.outlet_id,'tasks','task_actionable','task_occurrence',r.instance_id,
        case when r.schedule_type='one_time' then 'important' else 'normal' end,'Task ready',left(r.name,500),
        jsonb_build_object('version',1,'type','task_occurrence','occurrence_id',r.instance_id),'task.actionable:'||r.instance_id||':'||r.employee_id);
    elsif v_state.execution_fingerprint is distinct from r.fingerprint and r.status not in ('completed','completed_with_exceptions') then
      perform public.crew_notification_create(r.employee_id,r.outlet_id,'tasks','task_changed','task_occurrence',r.instance_id,'important','Task changed',left(r.name||' has changed.',500),
        jsonb_build_object('version',1,'type','task_occurrence','occurrence_id',r.instance_id),'task.changed:'||r.instance_id||':'||r.employee_id||':'||r.fingerprint);
    end if;
    if r.status not in ('completed','completed_with_exceptions') and r.available_until is not null and r.available_until>v_now and r.available_until<=v_now+v_due_soon then
      perform public.crew_notification_create(r.employee_id,r.outlet_id,'tasks','task_due_soon','task_occurrence',r.instance_id,'normal','Task due soon',left(r.name||' is due soon.',500),jsonb_build_object('version',1,'type','task_occurrence','occurrence_id',r.instance_id),'task.due_soon:'||r.instance_id||':'||r.employee_id);
    elsif r.status not in ('completed','completed_with_exceptions') and r.available_until is not null and r.available_until<v_now then
      perform public.crew_notification_create(r.employee_id,r.outlet_id,'tasks','task_overdue','task_occurrence',r.instance_id,'important','Task overdue',left(r.name||' is overdue.',500),jsonb_build_object('version',1,'type','task_occurrence','occurrence_id',r.instance_id),'task.overdue:'||r.instance_id||':'||r.employee_id);
    end if;
    insert into public.crew_notification_task_state(instance_id,employee_id,execution_fingerprint,observed_status)
    values(r.instance_id,r.employee_id,r.fingerprint,r.status)
    on conflict(instance_id,employee_id) do update set execution_fingerprint=excluded.execution_fingerprint,observed_status=excluded.observed_status;
  end loop;
end;
$function$;

-- Defense in depth: every working-response write/delete takes the occurrence
-- lock, revalidates assignment, and cannot change completed/superseded evidence.
create function public.crew_tasks_response_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare item_id uuid; employee uuid; run public.crew_operation_instances%rowtype; state text;
begin
  if TG_OP='DELETE' then item_id:=old.instance_item_id; employee:=old.employee_id;
  else item_id:=new.instance_item_id; employee:=new.employee_id; end if;
  if TG_OP='UPDATE' and (new.instance_item_id<>old.instance_item_id or new.employee_id<>old.employee_id or new.id<>old.id) then
    raise exception using errcode='55000',message='Task response identity cannot be changed.';
  end if;
  select i.* into run from public.crew_operation_instances i
    join public.crew_operation_instance_items x on x.instance_id=i.id where x.id=item_id for update of i;
  select status into state from public.crew_task_instance_assignees where instance_id=run.id and employee_id=employee;
  if run.id is null or not run.is_operational or run.completed_at is not null
    or run.status in ('completed','completed_with_exceptions') or state is null
    or state not in ('not_started','in_progress','overdue') then
    raise exception using errcode='55000',message='Completed, reviewing or superseded Task evidence cannot be edited.';
  end if;
  if TG_OP<>'DELETE' then
    update public.crew_operation_instances set execution_started_at=coalesce(execution_started_at,now()) where id=run.id;
    return new;
  end if;
  return old;
end; $$;
revoke all on function public.crew_tasks_response_guard() from public,anon,authenticated;
create trigger crew_tasks_working_response_guard before insert or update or delete
  on public.crew_task_item_responses for each row execute function public.crew_tasks_response_guard();

revoke all on function public.crew_tasks_today(text,date) from public,anon,authenticated;
grant execute on function public.crew_tasks_today(text,date) to anon,authenticated;

revoke all on function public.crew_tasks_for_crew(text,date,date) from public,anon,authenticated;
grant execute on function public.crew_tasks_for_crew(text,date,date) to anon,authenticated;

revoke all on function public.crew_tasks_detail(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_tasks_detail(text,uuid) to anon,authenticated;

revoke all on function public.crew_tasks_reset(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_tasks_reset(text,uuid) to anon,authenticated;

revoke all on function public.crew_tasks_complete(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_tasks_complete(text,uuid) to anon,authenticated;

revoke all on function public.crew_tasks_review(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.crew_tasks_review(uuid,uuid,text,text) to authenticated;

revoke all on function public.crew_operations_activate_template(uuid) from public,anon,authenticated;
grant execute on function public.crew_operations_activate_template(uuid) to authenticated;

revoke all on function public.crew_tasks_update_block_unlocked(text,uuid,text,jsonb,text,text) from public,anon,authenticated;

revoke all on function public.crew_operations_ensure_instances(uuid,date) from public,anon,authenticated;

revoke all on function public.crew_tasks_sync_open_instance_assignees(uuid) from public,anon,authenticated;
