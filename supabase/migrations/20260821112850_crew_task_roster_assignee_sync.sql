-- Keep the live assignment list aligned with the latest published roster.
-- This only changes untouched assignees on open instances. Historical results,
-- responses and completed assignees remain immutable.
create or replace function public.crew_tasks_sync_open_instance_assignees(
  p_instance_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  v_instance public.crew_operation_instances%rowtype;
  v_template public.crew_operation_templates%rowtype;
  v_employee public.employees%rowtype;
begin
  select * into v_instance
  from public.crew_operation_instances
  where id=p_instance_id
  for update;

  if v_instance.id is null or v_instance.status in ('completed','completed_with_exceptions') then
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
$$;
revoke all on function public.crew_tasks_sync_open_instance_assignees(uuid) from public,anon,authenticated;

create or replace function public.crew_operations_ensure_instances(p_outlet_id uuid,p_business_date date)
returns void
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  v_template public.crew_operation_templates%rowtype;
  v_instance_id uuid;
  v_snapshot jsonb;
  v_shift_start time;
  v_shift_end time;
begin
  perform public.crew_tasks_refresh_lifecycle(p_outlet_id);
  for v_template in
    select * from public.crew_operation_templates t
    where t.outlet_id=p_outlet_id
      and t.status='active'
      and (t.schedule_end_date is null or p_business_date<=t.schedule_end_date)
      and public.crew_tasks_schedule_matches(t,p_business_date)
  loop
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

    perform public.crew_tasks_sync_open_instance_assignees(v_instance_id);
    v_instance_id:=null;
  end loop;

  update public.crew_daily_tasks set status='overdue',updated_at=now()
  where outlet_id=p_outlet_id and task_date=p_business_date and status='pending' and due_at<now();
end;
$$;
revoke all on function public.crew_operations_ensure_instances(uuid,date) from public,anon,authenticated;
