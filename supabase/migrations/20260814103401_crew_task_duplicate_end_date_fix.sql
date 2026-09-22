-- Preserve recurrence end dates when an Admin duplicates a Task definition.
create or replace function public.crew_tasks_duplicate(p_template_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  source public.crew_operation_templates%rowtype;
  target uuid;
begin
  select * into source
  from public.crew_operation_templates
  where id=p_template_id;

  if source.id is null
     or not public.current_user_has_permission('crew_operations.manage')
     or not public.current_user_can_access_outlet(source.outlet_id) then
    raise exception using errcode='42501',message='Task duplication is unavailable.';
  end if;

  insert into public.crew_operation_templates(
    series_id,outlet_id,revision,name,operation_type,status,
    applicable_role_ids,applicable_positions,effective_date,available_from,available_until,
    created_by,task_type,schedule_type,schedule_config,schedule_end_date,
    assignment_type,applicable_employee_ids,applicable_group_names,on_duty_only,
    priority,completion_rule,allow_exception,exception_requires_reason,
    manager_review_required,allow_late_completion
  )
  values(
    gen_random_uuid(),source.outlet_id,1,source.name||' Copy',source.operation_type,'draft',
    source.applicable_role_ids,source.applicable_positions,source.effective_date,
    source.available_from,source.available_until,auth.uid(),source.task_type,
    source.schedule_type,source.schedule_config,source.schedule_end_date,
    source.assignment_type,source.applicable_employee_ids,source.applicable_group_names,
    source.on_duty_only,source.priority,source.completion_rule,source.allow_exception,
    source.exception_requires_reason,source.manager_review_required,source.allow_late_completion
  )
  returning id into target;

  insert into public.crew_operation_template_items(
    template_id,title,description,is_required,sort_order,evidence_requirement,
    health_category,sop_id,sop_version_id,sop_snapshot,block_type,block_config
  )
  select target,title,description,is_required,sort_order,evidence_requirement,
    health_category,sop_id,sop_version_id,sop_snapshot,block_type,block_config
  from public.crew_operation_template_items
  where template_id=source.id;

  return target;
end;
$$;

revoke all on function public.crew_tasks_duplicate(uuid) from public,anon,authenticated;
grant execute on function public.crew_tasks_duplicate(uuid) to authenticated;
