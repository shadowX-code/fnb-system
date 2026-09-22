-- FeedX Crew Operations: definition lifecycle, server-derived scheduling truth,
-- and immutable instance result reads for the Admin Tasks workspace.

alter table public.crew_operation_templates
  drop constraint if exists crew_operation_templates_status_check;

alter table public.crew_operation_templates
  add column if not exists schedule_end_date date,
  add column if not exists paused_at timestamptz,
  add column if not exists ended_at timestamptz,
  add constraint crew_operation_templates_status_check
    check (status in ('draft','active','paused','ended','archived')),
  add constraint crew_operation_templates_schedule_end_check
    check (schedule_end_date is null or schedule_end_date >= effective_date);

create index if not exists crew_operation_templates_series_created_idx
  on public.crew_operation_templates(series_id,created_at);
create index if not exists crew_operation_templates_lifecycle_idx
  on public.crew_operation_templates(outlet_id,status,schedule_end_date)
  where status in ('active','paused');
create index if not exists crew_operation_instances_series_date_idx
  on public.crew_operation_instances(template_series_id,business_date desc,created_at desc);

create or replace function public.crew_operations_template_guard()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if current_setting('feedx.operation_lifecycle',true) in ('activate','archive','schedule') then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_table_name='crew_operation_templates' and old.status<>'draft' then
    raise exception using errcode='55000',message='Active and historical Task revisions are immutable.';
  end if;
  if tg_table_name='crew_operation_template_items' and exists(
    select 1 from public.crew_operation_templates t
    where t.id=old.template_id and t.status<>'draft'
  ) then
    raise exception using errcode='55000',message='Active and historical Task content is immutable.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function public.crew_operations_template_guard() from public,anon,authenticated;

create or replace function public.crew_tasks_refresh_lifecycle(p_outlet_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  v_today date:=timezone('Asia/Kuala_Lumpur',now())::date;
begin
  perform set_config('feedx.operation_lifecycle','schedule',true);
  update public.crew_operation_templates t
  set status='ended',ended_at=coalesce(t.ended_at,now()),updated_at=now()
  where t.outlet_id=p_outlet_id
    and t.status='active'
    and (
      (t.schedule_end_date is not null and t.schedule_end_date<v_today)
      or (t.schedule_type='one_time' and t.effective_date<v_today)
    );
  perform set_config('feedx.operation_lifecycle','',true);
end;
$$;
revoke all on function public.crew_tasks_refresh_lifecycle(uuid) from public,anon,authenticated;

create or replace function public.crew_tasks_next_run(p_template public.crew_operation_templates)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_today date:=timezone('Asia/Kuala_Lumpur',now())::date;
  v_date date;
  v_start time;
  v_end time;
  v_at timestamptz;
  v_instance record;
begin
  if p_template.status='paused' then return jsonb_build_object('state','paused'); end if;
  if p_template.status='ended' then return jsonb_build_object('state','ended'); end if;
  if p_template.status='archived' then return jsonb_build_object('state','archived'); end if;
  if p_template.status='draft' then return jsonb_build_object('state','draft'); end if;

  if p_template.schedule_type='one_time' and p_template.effective_date<v_today then
    select i.status,i.business_date,i.available_from into v_instance
    from public.crew_operation_instances i
    where i.template_id=p_template.id
    order by i.business_date desc limit 1;
    return jsonb_build_object(
      'state',case
        when v_instance.status in ('completed','completed_with_exceptions') then 'completed'
        when v_instance.status is null then 'past'
        else v_instance.status
      end,
      'date',coalesce(v_instance.business_date,p_template.effective_date),
      'at',v_instance.available_from
    );
  end if;

  select d::date into v_date
  from generate_series(greatest(v_today,p_template.effective_date),
    least(greatest(v_today,p_template.effective_date)+366,coalesce(p_template.schedule_end_date,greatest(v_today,p_template.effective_date)+366)),
    interval '1 day') g(d)
  where public.crew_tasks_schedule_matches(p_template,d::date)
    and (
      p_template.schedule_type<>'shift_based'
      or exists(
        select 1 from public.duty_roster_published_entries r
        where r.outlet_id=p_template.outlet_id and r.roster_date=d::date and r.entry_type='working'
      )
    )
  order by d limit 1;

  if v_date is null then return jsonb_build_object('state','none'); end if;
  if p_template.schedule_type='shift_based' then
    select min(r.start_time),max(r.end_time) into v_start,v_end
    from public.duty_roster_published_entries r
    where r.outlet_id=p_template.outlet_id and r.roster_date=v_date and r.entry_type='working';
  end if;
  v_at:=(v_date+coalesce(p_template.available_from,
    case p_template.schedule_config->>'shift_phase'
      when 'before_shift' then coalesce(v_start,time '09:00')-interval '2 hours'
      when 'start_of_shift' then coalesce(v_start,time '09:00')
      when 'during_shift' then coalesce(v_start,time '09:00')
      when 'end_of_shift' then coalesce(v_end,time '17:00')
      else time '00:00'
    end)) at time zone 'Asia/Kuala_Lumpur';
  return jsonb_build_object('state','scheduled','date',v_date,'at',v_at,'shift_phase',p_template.schedule_config->>'shift_phase');
end;
$$;
revoke all on function public.crew_tasks_next_run(public.crew_operation_templates) from public,anon,authenticated;

create or replace function public.crew_tasks_manage_schedule(
  p_template_id uuid,
  p_action text,
  p_end_date date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  v_task public.crew_operation_templates%rowtype;
  v_today date:=timezone('Asia/Kuala_Lumpur',now())::date;
begin
  select * into v_task from public.crew_operation_templates where id=p_template_id for update;
  if v_task.id is null
     or not public.current_user_has_permission('crew_operations.manage')
     or not public.current_user_can_access_outlet(v_task.outlet_id) then
    raise exception using errcode='42501',message='Task schedule management is unavailable.';
  end if;
  if p_action not in ('pause','resume','end','set_end_date','archive') then
    raise exception using errcode='22023',message='Task lifecycle action is invalid.';
  end if;
  if p_action='pause' and v_task.status<>'active' then raise exception using errcode='55000',message='Only an Active Task can be paused.'; end if;
  if p_action='resume' and v_task.status<>'paused' then raise exception using errcode='55000',message='Only a Paused Task can be resumed.'; end if;
  if p_action='resume' and v_task.schedule_end_date is not null and v_task.schedule_end_date<v_today then raise exception using errcode='55000',message='This Task schedule has already ended.'; end if;
  if p_action='end' and v_task.status not in ('active','paused') then raise exception using errcode='55000',message='Only an Active or Paused Task can be ended.'; end if;
  if p_action='set_end_date' and (v_task.status not in ('active','paused') or v_task.schedule_type='one_time') then raise exception using errcode='55000',message='An end date can only be managed for an Active or Paused repeating Task.'; end if;
  if p_action='set_end_date' and p_end_date is not null and p_end_date<v_today then raise exception using errcode='22023',message='Task end date cannot be in the past.'; end if;
  if p_action='archive' and v_task.status<>'ended' then raise exception using errcode='55000',message='End the Task schedule before archiving it.'; end if;

  perform set_config('feedx.operation_lifecycle','schedule',true);
  update public.crew_operation_templates
  set status=case p_action when 'pause' then 'paused' when 'resume' then 'active' when 'end' then 'ended' when 'archive' then 'archived' else status end,
      paused_at=case when p_action='pause' then now() when p_action='resume' then null else paused_at end,
      ended_at=case when p_action='end' then now() else ended_at end,
      archived_at=case when p_action='archive' then now() else archived_at end,
      schedule_end_date=case when p_action='set_end_date' then p_end_date when p_action='end' then coalesce(schedule_end_date,v_today) else schedule_end_date end,
      updated_at=now()
  where id=v_task.id
  returning * into v_task;
  perform set_config('feedx.operation_lifecycle','',true);

  return jsonb_build_object('id',v_task.id,'status',v_task.status,'schedule_end_date',v_task.schedule_end_date,'next_run',public.crew_tasks_next_run(v_task));
end;
$$;
revoke all on function public.crew_tasks_manage_schedule(uuid,text,date) from public,anon,authenticated;
grant execute on function public.crew_tasks_manage_schedule(uuid,text,date) to authenticated;

create or replace function public.crew_operations_activate_template(p_template_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public
as $$
declare v_task public.crew_operation_templates%rowtype;
begin
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
  return jsonb_build_object('id',v_task.id,'status',v_task.status,'revision',v_task.revision,'activated_at',v_task.activated_at);
end;
$$;
revoke all on function public.crew_operations_activate_template(uuid) from public,anon,authenticated;
grant execute on function public.crew_operations_activate_template(uuid) to authenticated;

create or replace function public.crew_operations_archive_template(p_template_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path=public
as $$
  select public.crew_tasks_manage_schedule(p_template_id,'archive',null);
$$;
revoke all on function public.crew_operations_archive_template(uuid) from public,anon,authenticated;
grant execute on function public.crew_operations_archive_template(uuid) to authenticated;

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
  v_employee public.employees%rowtype;
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
    from public.crew_operation_template_items i where i.template_id=v_template.id;
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
      from public.crew_operation_template_items i where i.template_id=v_template.id order by i.sort_order;
      for v_employee in
        select e.* from public.employees e
        join public.crew_access ca on ca.employee_id=e.id and ca.access_state='active' and ca.primary_outlet_id=p_outlet_id
        where e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')
      loop
        if public.crew_tasks_employee_applies(v_template,v_employee,p_business_date) then
          insert into public.crew_task_instance_assignees(instance_id,employee_id)
          values(v_instance_id,v_employee.id) on conflict do nothing;
        end if;
      end loop;
    end if;
    v_instance_id:=null;
  end loop;
  update public.crew_daily_tasks set status='overdue',updated_at=now()
  where outlet_id=p_outlet_id and task_date=p_business_date and status='pending' and due_at<now();
end;
$$;
revoke all on function public.crew_operations_ensure_instances(uuid,date) from public,anon,authenticated;

create or replace function public.crew_tasks_save(p_outlet_id uuid,p_task jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  v_mapped jsonb;
  v_item jsonb;
  v_mapped_items jsonb:='[]'::jsonb;
  v_task_id uuid;
  v_operation text;
  v_employee_ids uuid[];
  v_group_names text[];
  v_end_date date;
begin
  if not public.current_user_has_permission('crew_operations.manage') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Task management is unavailable for this outlet.'; end if;
  if jsonb_typeof(p_task)<>'object' or char_length(btrim(coalesce(p_task->>'name','')))<2 or jsonb_typeof(p_task->'blocks')<>'array' or jsonb_array_length(p_task->'blocks')=0 then raise exception using errcode='22023',message='Task name and at least one content block are required.'; end if;
  if coalesce(p_task->>'task_type','') not in ('checklist','instruction','health_check','confirmation','sop_review') or coalesce(p_task->>'schedule_type','') not in ('one_time','recurring','shift_based') then raise exception using errcode='22023',message='Task type or schedule is invalid.'; end if;
  if coalesce(p_task->>'assignment_type','') not in ('all_crew','position','specific_crew','group') or coalesce(p_task->>'priority','') not in ('normal','important','critical') or coalesce(p_task->>'completion_rule','') not in ('any_assigned','every_assigned','one_for_team') then raise exception using errcode='22023',message='Task assignment, priority or completion rule is invalid.'; end if;
  if p_task->>'assignment_type'='position' and jsonb_array_length(coalesce(p_task->'applicable_positions','[]'::jsonb))=0 then raise exception using errcode='22023',message='Choose at least one position.'; end if;
  if p_task->>'assignment_type'='specific_crew' and jsonb_array_length(coalesce(p_task->'applicable_employee_ids','[]'::jsonb))=0 then raise exception using errcode='22023',message='Choose at least one Crew employee.'; end if;
  if p_task->>'assignment_type'='group' and jsonb_array_length(coalesce(p_task->'applicable_group_names','[]'::jsonb))=0 then raise exception using errcode='22023',message='Choose at least one Crew group.'; end if;
  if p_task->>'schedule_type'='recurring' and coalesce(p_task#>>'{schedule_config,frequency}','') not in ('every_day','specific_weekdays','weekly','monthly','custom_interval') then raise exception using errcode='22023',message='Recurring schedule is invalid.'; end if;
  if p_task#>>'{schedule_config,frequency}'='specific_weekdays' and jsonb_array_length(coalesce(p_task#>'{schedule_config,weekdays}','[]'::jsonb))=0 then raise exception using errcode='22023',message='Choose at least one weekday.'; end if;
  v_end_date:=nullif(p_task->>'schedule_end_date','')::date;
  if v_end_date is not null and (p_task->>'schedule_type'='one_time' or v_end_date<coalesce((p_task->>'effective_date')::date,timezone('Asia/Kuala_Lumpur',now())::date)) then raise exception using errcode='22023',message='Choose a valid repeating Task end date.'; end if;
  for v_item in select value from jsonb_array_elements(p_task->'blocks') loop
    if coalesce(v_item->>'block_type','') not in ('text','checklist_item','key_point','image','sop_reference','yes_no','single_choice','number','temperature','short_text','health_rating','confirmation') then raise exception using errcode='22023',message='Task content block type is invalid.'; end if;
    if v_item->>'block_type'='image' then raise exception using errcode='0A000',message='Photo content remains disabled until the Operations media store is available.'; end if;
    if v_item->>'block_type'='sop_reference' and nullif(v_item->>'sop_version_id','') is null then raise exception using errcode='22023',message='Choose a published SOP for every SOP Reference block.'; end if;
    if v_item->>'block_type'='single_choice' and jsonb_array_length(coalesce(v_item#>'{config,options}','[]'::jsonb))<2 then raise exception using errcode='22023',message='Single Choice needs at least two options.'; end if;
    if v_item->>'block_type' in ('number','temperature') and nullif(v_item#>>'{config,min}','') is not null and nullif(v_item#>>'{config,max}','') is not null and (v_item#>>'{config,min}')::numeric>(v_item#>>'{config,max}')::numeric then raise exception using errcode='22023',message='Measurement minimum cannot exceed maximum.'; end if;
    v_mapped_items:=v_mapped_items||jsonb_build_array(jsonb_build_object(
      'title',coalesce(nullif(btrim(v_item->>'title'),''),initcap(replace(v_item->>'block_type','_',' '))),
      'description',v_item->>'description','is_required',coalesce((v_item->>'is_required')::boolean,v_item->>'block_type' not in ('text','key_point','sop_reference')),
      'evidence_requirement',coalesce(v_item->>'evidence_requirement','none'),
      'health_category',case when v_item->>'block_type'='health_rating' then coalesce(v_item->>'health_category','front_of_house') end,
      'sop_version_id',coalesce(v_item->>'sop_version_id',''),'block_type',v_item->>'block_type','block_config',coalesce(v_item->'config','{}'::jsonb)
    ));
  end loop;
  v_operation:=case p_task->>'task_type' when 'health_check' then 'health' else 'daily' end;
  v_mapped:=jsonb_build_object(
    'id',p_task->>'id','series_id',p_task->>'series_id','name',p_task->>'name','operation_type',v_operation,
    'effective_date',coalesce(p_task->>'effective_date',timezone('Asia/Kuala_Lumpur',now())::date::text),
    'available_from',coalesce(p_task->>'start_time',''),'available_until',coalesce(p_task->>'due_time',''),
    'applicable_positions',coalesce(p_task->'applicable_positions','[]'::jsonb),'applicable_role_ids','[]'::jsonb,'items',v_mapped_items
  );
  v_task_id:=public.crew_operations_save_template(p_outlet_id,v_mapped);
  select coalesce(array_agg(value::uuid),'{}') into v_employee_ids from jsonb_array_elements_text(coalesce(p_task->'applicable_employee_ids','[]'::jsonb));
  select coalesce(array_agg(value),'{}') into v_group_names from jsonb_array_elements_text(coalesce(p_task->'applicable_group_names','[]'::jsonb));
  if p_task->>'assignment_type'='specific_crew' and exists(select 1 from unnest(v_employee_ids) employee_id where not exists(select 1 from public.crew_access ca join public.employees e on e.id=ca.employee_id where ca.employee_id=employee_id and ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated'))) then raise exception using errcode='22023',message='Specific Crew must belong to this outlet.'; end if;
  if p_task->>'assignment_type'='group' and exists(select 1 from unnest(v_group_names) group_name where lower(group_name) not in ('floor','kitchen','other')) then raise exception using errcode='22023',message='Crew group is invalid.'; end if;
  update public.crew_operation_templates set
    task_type=p_task->>'task_type',schedule_type=p_task->>'schedule_type',schedule_config=coalesce(p_task->'schedule_config','{}'::jsonb),
    schedule_end_date=v_end_date,assignment_type=coalesce(p_task->>'assignment_type','all_crew'),applicable_employee_ids=v_employee_ids,
    applicable_group_names=v_group_names,on_duty_only=coalesce((p_task->>'on_duty_only')::boolean,false),priority=coalesce(p_task->>'priority','normal'),
    completion_rule=coalesce(p_task->>'completion_rule','one_for_team'),allow_exception=coalesce((p_task->>'allow_exception')::boolean,true),
    exception_requires_reason=coalesce((p_task->>'exception_requires_reason')::boolean,true),manager_review_required=coalesce((p_task->>'manager_review_required')::boolean,false),
    allow_late_completion=coalesce((p_task->>'allow_late_completion')::boolean,true),updated_at=now()
  where id=v_task_id;
  update public.crew_operation_template_items i set block_type=x.block_type,block_config=x.config
  from (select value->>'block_type' block_type,coalesce(value->'config','{}'::jsonb) config,(ordinality-1)::int sort_order from jsonb_array_elements(p_task->'blocks') with ordinality)x
  where i.template_id=v_task_id and i.sort_order=x.sort_order;
  return v_task_id;
end;
$$;
revoke all on function public.crew_tasks_save(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_tasks_save(uuid,jsonb) to authenticated;

create or replace function public.crew_tasks_admin_data(
  p_outlet_id uuid,
  p_from date default timezone('Asia/Kuala_Lumpur',now())::date,
  p_to date default timezone('Asia/Kuala_Lumpur',now())::date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public
as $$
declare v_definitions jsonb; v_instances jsonb; v_sops jsonb; v_employees jsonb; v_review_queue jsonb;
begin
  if not public.current_user_has_permission('crew_operations.view') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Tasks are unavailable for this outlet.'; end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>92 then raise exception using errcode='22023',message='Choose a valid Task period of 93 days or fewer.'; end if;
  perform public.crew_tasks_refresh_lifecycle(p_outlet_id);
  perform public.crew_operations_ensure_instances(p_outlet_id,d::date) from generate_series(p_from,p_to,interval '1 day')g(d);
  select coalesce(jsonb_agg(
    (to_jsonb(t)-'created_by')||jsonb_build_object(
      'definition_status',t.status,
      'created_date',(select min(x.created_at)::date from public.crew_operation_templates x where x.series_id=t.series_id),
      'next_run',public.crew_tasks_next_run(t),
      'blocks',coalesce((select jsonb_agg((to_jsonb(i)-'sop_snapshot')||jsonb_build_object('sop_reference',i.sop_snapshot,'config',i.block_config) order by i.sort_order) from public.crew_operation_template_items i where i.template_id=t.id),'[]'::jsonb)
    ) order by t.updated_at desc
  ),'[]'::jsonb) into v_definitions
  from public.crew_operation_templates t where t.outlet_id=p_outlet_id;
  select coalesce(jsonb_agg(
    (to_jsonb(i)-'template_snapshot')||jsonb_build_object(
      'instance_status',case when i.status='completed_with_exceptions' then 'exception' when i.status='not_started' and i.available_until<now() then 'overdue' else i.status end,
      'assignee_count',(select count(*) from public.crew_task_instance_assignees a where a.instance_id=i.id),
      'completed_count',(select count(*) from public.crew_task_instance_assignees a where a.instance_id=i.id and a.status in ('completed','completed_with_exceptions'))
    ) order by i.business_date,i.available_from,i.name
  ),'[]'::jsonb) into v_instances
  from public.crew_operation_instances i where i.outlet_id=p_outlet_id and i.business_date between p_from and p_to;
  select coalesce(jsonb_agg(jsonb_build_object('sop_id',s.id,'title',s.title,'version_id',v.id,'version',v.version) order by s.title),'[]'::jsonb) into v_sops
  from public.crew_sops s join lateral(select * from public.crew_sop_versions v where v.sop_id=s.id and v.status='published' order by v.version desc limit 1)v on true
  where s.outlet_id is null or s.outlet_id=p_outlet_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name),'[]'::jsonb) into v_employees
  from public.employees e join public.crew_access ca on ca.employee_id=e.id and ca.primary_outlet_id=p_outlet_id and ca.access_state='active'
  where e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated');
  select coalesce(jsonb_agg(jsonb_build_object('instance_id',i.id,'employee_id',e.id,'task_name',i.name,'employee_name',e.full_name,'business_date',i.business_date,'status',a.status) order by i.business_date,e.full_name),'[]'::jsonb) into v_review_queue
  from public.crew_task_instance_assignees a join public.crew_operation_instances i on i.id=a.instance_id join public.employees e on e.id=a.employee_id
  where i.outlet_id=p_outlet_id and i.business_date between p_from and p_to and a.status='review_required';
  return jsonb_build_object('from',p_from,'to',p_to,'definitions',v_definitions,'instances',v_instances,'published_sops',v_sops,'employees',v_employees,'review_queue',v_review_queue);
end;
$$;
revoke all on function public.crew_tasks_admin_data(uuid,date,date) from public,anon,authenticated;
grant execute on function public.crew_tasks_admin_data(uuid,date,date) to authenticated;

create or replace function public.crew_tasks_admin_detail(p_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_task public.crew_operation_templates%rowtype; v_progress jsonb; v_history jsonb;
begin
  select * into v_task from public.crew_operation_templates where id=p_template_id;
  if v_task.id is null or not public.current_user_has_permission('crew_operations.view') or not public.current_user_can_access_outlet(v_task.outlet_id) then raise exception using errcode='42501',message='Task detail is unavailable.'; end if;
  select jsonb_build_object(
    'instances',count(*),
    'completed',count(*) filter(where i.status='completed'),
    'in_progress',count(*) filter(where i.status='in_progress'),
    'not_started',count(*) filter(where i.status='not_started' and i.available_until>=now()),
    'exception',count(*) filter(where i.status='completed_with_exceptions'),
    'overdue',count(*) filter(where i.status='overdue' or (i.status='not_started' and i.available_until<now()))
  ) into v_progress
  from public.crew_operation_instances i where i.template_series_id=v_task.series_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'instance_id',i.id,'date',i.business_date,'revision',i.template_revision,
    'status',case when i.status='completed_with_exceptions' then 'exception' when i.status='not_started' and i.available_until<now() then 'overdue' else i.status end,
    'available_from',i.available_from,'due_at',i.available_until,'completed_at',i.completed_at,
    'actors',coalesce((select jsonb_agg(distinct jsonb_build_object('id',e.id,'name',e.full_name)) from public.crew_task_item_responses r join public.crew_operation_instance_items ii on ii.id=r.instance_item_id join public.employees e on e.id=r.employee_id where ii.instance_id=i.id),'[]'::jsonb)
  ) order by i.business_date desc,i.available_from desc),'[]'::jsonb) into v_history
  from public.crew_operation_instances i where i.template_series_id=v_task.series_id;
  return jsonb_build_object(
    'definition',(to_jsonb(v_task)-'created_by')||jsonb_build_object(
      'created_date',(select min(x.created_at)::date from public.crew_operation_templates x where x.series_id=v_task.series_id),
      'next_run',public.crew_tasks_next_run(v_task),
      'block_count',(select count(*) from public.crew_operation_template_items x where x.template_id=v_task.id)
    ),
    'progress',v_progress,'history',v_history
  );
end;
$$;
revoke all on function public.crew_tasks_admin_detail(uuid) from public,anon,authenticated;
grant execute on function public.crew_tasks_admin_detail(uuid) to authenticated;

create or replace function public.crew_tasks_admin_result(p_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_instance public.crew_operation_instances%rowtype; v_blocks jsonb; v_assignees jsonb;
begin
  select * into v_instance from public.crew_operation_instances where id=p_instance_id;
  if v_instance.id is null or not public.current_user_has_permission('crew_operations.view') or not public.current_user_can_access_outlet(v_instance.outlet_id) then raise exception using errcode='42501',message='Task result is unavailable.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'title',i.title,'description',i.description,'block_type',i.block_type,
    'config',i.block_config,'required',i.is_required,'sort_order',i.sort_order,'sop_reference',i.sop_reference,
    'responses',coalesce((select jsonb_agg(jsonb_build_object(
      'employee_id',r.employee_id,'employee_name',e.full_name,'status',r.status,'response',r.response,
      'exception_reason',r.exception_reason,'note',r.note,'completed_at',r.completed_at
    ) order by r.completed_at,e.full_name) from public.crew_task_item_responses r join public.employees e on e.id=r.employee_id where r.instance_item_id=i.id),'[]'::jsonb)
  ) order by i.sort_order),'[]'::jsonb) into v_blocks
  from public.crew_operation_instance_items i where i.instance_id=v_instance.id;
  select coalesce(jsonb_agg(jsonb_build_object('employee_id',a.employee_id,'employee_name',e.full_name,'status',a.status,'completed_at',a.completed_at) order by e.full_name),'[]'::jsonb) into v_assignees
  from public.crew_task_instance_assignees a join public.employees e on e.id=a.employee_id where a.instance_id=v_instance.id;
  return jsonb_build_object(
    'instance',to_jsonb(v_instance)-'template_snapshot',
    'status',case when v_instance.status='completed_with_exceptions' then 'exception' when v_instance.status='not_started' and v_instance.available_until<now() then 'overdue' else v_instance.status end,
    'assignees',v_assignees,'blocks',v_blocks,
    'reviews',coalesce((select jsonb_agg(jsonb_build_object('employee_id',r.employee_id,'decision',r.decision,'note',r.note,'reviewed_at',r.reviewed_at) order by r.reviewed_at desc) from public.crew_task_reviews r where r.instance_id=v_instance.id),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.crew_tasks_admin_result(uuid) from public,anon,authenticated;
grant execute on function public.crew_tasks_admin_result(uuid) to authenticated;

-- Only trusted roles own the underlying tables. Admin and Crew clients continue
-- to use permission-scoped or token-bound authorities; frozen snapshots and
-- execution responses are never directly granted to browser roles.
revoke all on public.crew_operation_templates,public.crew_operation_template_items,
  public.crew_operation_instances,public.crew_operation_instance_items,
  public.crew_task_instance_assignees,public.crew_task_item_responses,
  public.crew_task_reviews from public,anon,authenticated;
