-- Read projections only. No Task execution, reset, roster or attendance write authority changes.
do $$ begin
  if md5(pg_get_functiondef('public.crew_tasks_detail(text,uuid)'::regprocedure)) <> '40d6aff43bd758058bb9807eda3f3178'
    or md5(pg_get_functiondef('public.crew_management_tasks(text,uuid,date)'::regprocedure)) <> 'cf2b6539b3b4a5aa40b0a878f5a3814b'
    or md5(pg_get_functiondef('public.crew_localized_content(text,text,uuid[],text)'::regprocedure)) <> 'd5782fdd9e86c175c7e586ac0b66a27f'
  then raise exception 'Reviewed Management Task read baseline drift'; end if;
end; $$;
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
    select jsonb_build_object('id',i.id,'source','instance','template_id',i.template_id,'available_from',i.available_from,'priority',i.priority,'name',i.name,'task_type',i.task_type,
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
CREATE OR REPLACE FUNCTION public.crew_tasks_detail_projection(p_instance_id uuid, p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare

  v_employee uuid := p_employee_id;
  instance public.crew_operation_instances%rowtype;
  assignee public.crew_task_instance_assignees%rowtype;
  blocks jsonb;
  v_assignment jsonb;
  v_completion jsonb;
  v_team_evidence record;
  v_contributors jsonb;
begin
  select * into instance from public.crew_operation_instances where id=p_instance_id and is_operational;
  if instance.id is null or (v_employee is not null and not exists(
    select 1 from public.crew_task_instance_assignees where instance_id=instance.id and employee_id=v_employee
  )) then raise exception using errcode='42501',message='Task is unavailable.'; end if;

  select a.* into assignee
  from public.crew_task_instance_assignees a
  where a.instance_id = instance.id and a.employee_id = v_employee;

  v_assignment := case instance.assignment_type
    when 'specific_crew' then jsonb_build_object(
      'kind', 'individual',
      'employee_id', v_employee,
      'employee_name', (select full_name from public.employees where id=v_employee),
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
    'status', case when v_employee is null then instance.status else public.crew_tasks_execution_status(instance.id,v_employee) end,
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


revoke all on function public.crew_tasks_detail_projection(uuid,uuid) from public,anon,authenticated;

-- Preserve the existing assigned-Crew authorization and payload projection.
create or replace function public.crew_tasks_detail(p_token text,p_instance_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ctx jsonb:=public.crew_operations_employee_context(p_token); v_employee uuid:=(ctx->>'employee_id')::uuid;
begin
  if not exists(select 1 from public.crew_operation_instances i join public.crew_task_instance_assignees a on a.instance_id=i.id
    where i.id=p_instance_id and i.is_operational and a.employee_id=v_employee and i.outlet_id=(ctx->>'outlet_id')::uuid)
  then raise exception using errcode='42501',message='Task is unavailable.'; end if;
  return public.crew_tasks_detail_projection(p_instance_id,v_employee);
end; $$;
revoke all on function public.crew_tasks_detail(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_tasks_detail(text,uuid) to anon,authenticated;

create function public.crew_management_task_detail(p_token text,p_outlet_id uuid,p_instance_id uuid,p_source text default 'instance')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid:=public.crew_session_employee(p_token); i public.crew_operation_instances%rowtype;
  v_assignee uuid; v_detail jsonb; v_executions jsonb;
begin
  if not exists(select 1 from public.employees where id=v_employee and lower(btrim(workplace))='management') then
    raise exception using errcode='42501',message='Management task view is unavailable.'; end if;
  perform public.crew_selected_outlet(p_token,p_outlet_id);
  if p_source='legacy_daily' then
    select jsonb_build_object('id',t.id,'name',t.title,'description',t.description,'status',t.status,
      'due_at',t.due_at,'note',t.note,'exception_reason',t.exception_reason,'completed_at',t.completed_at,
      'completion_actor',(select full_name from public.employees where id=t.completed_by),'blocks','[]'::jsonb,'read_only',true)
    into v_detail from public.crew_daily_tasks t where t.id=p_instance_id and t.outlet_id=p_outlet_id;
    if v_detail is null then raise exception using errcode='42501',message='Task is unavailable.'; end if;
    return v_detail;
  elsif p_source<>'instance' then raise exception using errcode='22023',message='Unsupported Task source.'; end if;
  select * into i from public.crew_operation_instances where id=p_instance_id and outlet_id=p_outlet_id and is_operational;
  if i.id is null then raise exception using errcode='42501',message='Task is unavailable.'; end if;
  select employee_id into v_assignee from public.crew_task_instance_assignees where instance_id=i.id order by employee_id limit 1;
  v_detail:=public.crew_tasks_detail_projection(i.id,v_assignee);
  -- Individual rules remain individual. Management can inspect each actual assignee's execution,
  -- rather than collapse unrelated responses into a synthetic shared checklist.
  if i.completion_rule<>'one_for_team' then
    select coalesce(jsonb_agg(jsonb_build_object('employee_id',a.employee_id,'employee_name',e.full_name,
      'detail',public.crew_tasks_detail_projection(i.id,a.employee_id)) order by e.full_name,e.id),'[]'::jsonb)
    into v_executions from public.crew_task_instance_assignees a join public.employees e on e.id=a.employee_id where a.instance_id=i.id;
  end if;
  return v_detail || jsonb_build_object('read_only',true,'outlet_id',i.outlet_id,'executions',coalesce(v_executions,'[]'::jsonb));
end; $$;
revoke all on function public.crew_management_task_detail(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.crew_management_task_detail(text,uuid,uuid,text) to anon,authenticated;

create function public.crew_management_today_team(p_token text,p_outlet_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid:=public.crew_session_employee(p_token); v_date date:=timezone('Asia/Kuala_Lumpur',now())::date;
  v_rows jsonb; v_summary jsonb;
begin
  if not exists(select 1 from public.employees where id=v_employee and lower(btrim(workplace))='management') then
    raise exception using errcode='42501',message='Management team view is unavailable.'; end if;
  perform public.crew_selected_outlet(p_token,p_outlet_id);
  with candidates as (
    select distinct employee_id from public.duty_roster_published_entries where outlet_id=p_outlet_id and roster_date=v_date
  ), scheduled as (
    select c.employee_id,e.full_name,e.nickname,s.shift from candidates c join public.employees e on e.id=c.employee_id
    cross join lateral (select public.crew_roster_employee_day(c.employee_id,v_date) shift) s
    where s.shift->>'entry_type'='working' and (s.shift->>'outlet_id')::uuid=p_outlet_id
  ), rows as (
    select s.*,a.id attendance_id,a.clock_in_at,a.clock_out_at,
      case when a.clock_in_at is not null and a.clock_out_at is null then 'clocked_in'
        when a.clock_out_at is not null then 'completed'
        when s.shift->>'start_time' is not null and now()<((v_date+(s.shift->>'start_time')::time) at time zone 'Asia/Kuala_Lumpur') then 'upcoming'
        else 'not_clocked_in' end state
    from scheduled s left join lateral (
      select a.* from public.crew_attendance_records a
      left join public.duty_roster_published_entries pe on pe.id=a.scheduled_roster_entry_id
      where a.employee_id=s.employee_id and a.outlet_id=p_outlet_id
        and coalesce(pe.roster_date,timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date)=v_date
      order by (a.clock_out_at is null) desc,a.clock_in_at desc,a.id desc limit 1
    ) a on true
  ) select coalesce(jsonb_agg(jsonb_build_object('employee_id',employee_id,'employee_name',full_name,'nickname',nickname,
    'shift',shift,'state',state,'attendance_id',attendance_id,'clock_in_at',clock_in_at,'clock_out_at',clock_out_at)
    order by shift->>'start_time',full_name,employee_id),'[]'::jsonb),
    jsonb_build_object('scheduled',count(*),'clocked_in',count(*) filter(where state='clocked_in'),
      'not_clocked_in',count(*) filter(where state in ('not_clocked_in','upcoming')),'completed',count(*) filter(where state='completed'))
    into v_rows,v_summary from rows;
  return jsonb_build_object('outlet_id',p_outlet_id,'outlet_name',(select name from public.outlets where id=p_outlet_id),
    'business_date',v_date,'as_of',now(),'summary',v_summary,'employees',v_rows,'read_only',true);
end; $$;
revoke all on function public.crew_management_today_team(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_management_today_team(text,uuid) to anon,authenticated;

-- Task translations are read evidence under the same outlet authority.
create or replace function public.crew_localized_content(p_token text,p_domain text,p_version_ids uuid[],p_language text)
returns jsonb language plpgsql volatile security definer set search_path=public,extensions as $$
declare v_employee_id uuid; v_employee_outlet uuid; v_management boolean; v_version_id uuid;
  allowed boolean; snapshot jsonb; unit_entry record; resolved jsonb; value jsonb; result jsonb:='{}'::jsonb;
begin
  if p_language not in ('en','zh-CN','ms') then p_language:='en'; end if;
  if coalesce(cardinality(p_version_ids),0)>100 then raise exception using errcode='22023',message='Too many localized content versions requested.'; end if;
  v_employee_id:=public.crew_session_employee(p_token);
  select ca.primary_outlet_id,lower(btrim(coalesce(e.workplace,'')))='management'
  into v_employee_outlet,v_management from public.crew_access ca join public.employees e on e.id=ca.employee_id
  where ca.employee_id=v_employee_id and ca.access_state='active';
  if v_employee_outlet is null and not v_management then
    raise exception using errcode='42501',message='Crew access is unavailable.';
  end if;
  foreach v_version_id in array coalesce(p_version_ids,'{}'::uuid[]) loop
    allowed:=false;
    if p_domain='sop' then
      allowed:=exists(select 1 from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id
        where v.id=v_version_id and v.status='published'
          and ((v_management and s.status='published' and s.outlet_id=any(public.crew_authorized_outlet_ids(v_employee_id)))
            or (not v_management and s.outlet_id=v_employee_outlet)));
    elsif p_domain='onboarding' then
      allowed:=exists(select 1 from public.crew_journey_assignments a where a.employee_id=v_employee_id and a.journey_id=v_version_id);
    elsif p_domain='task' then
      allowed:=exists(select 1 from public.crew_operation_instances i
        where i.template_id=v_version_id and (
          (v_management and i.is_operational and i.outlet_id=any(public.crew_authorized_outlet_ids(v_employee_id)))
          or (not v_management and exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=i.id and a.employee_id=v_employee_id))));
    else raise exception using errcode='22023',message='Unsupported localized content domain.'; end if;
    if not allowed then raise exception using errcode='42501',message='Localized content is unavailable for this Crew session.'; end if;
    if p_domain='sop' then
      select v.localized_content_snapshot into snapshot from public.crew_sop_versions v where v.id=v_version_id;
    elsif p_domain='onboarding' then
      select a.journey_snapshot->'localized_content' into snapshot from public.crew_journey_assignments a
      where a.employee_id=v_employee_id and a.journey_id=v_version_id order by a.assigned_at desc limit 1;
    else
      select i.template_snapshot->'localized_content' into snapshot from public.crew_operation_instances i
      where i.template_id=v_version_id and (
        (v_management and i.is_operational and i.outlet_id=any(public.crew_authorized_outlet_ids(v_employee_id)))
        or (not v_management and exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=i.id and a.employee_id=v_employee_id))) order by i.business_date desc,i.created_at desc limit 1;
    end if;
    snapshot:=coalesce(snapshot,public.crew_localization_snapshot(p_domain,v_version_id));
    resolved:='{}'::jsonb;
    for unit_entry in select key,entry.value from jsonb_each(snapshot) entry loop
      value:=coalesce(
        case when unit_entry.value->'translations'->p_language->>'status' in ('ai_translated','reviewed')
          then unit_entry.value->'translations'->p_language->'value' end,
        case when unit_entry.value->>'source_language'=p_language then unit_entry.value->'source_value' end,
        case when unit_entry.value->'translations'->'en'->>'status' in ('ai_translated','reviewed')
          then unit_entry.value->'translations'->'en'->'value' end,
        case when unit_entry.value->>'source_language'='en' then unit_entry.value->'source_value' end,
        unit_entry.value->'source_value',
        (select candidate.value->'value' from jsonb_each(unit_entry.value->'translations') candidate
          where candidate.value->>'status' in ('ai_translated','reviewed') limit 1));
      if value is not null then resolved:=resolved||jsonb_build_object(unit_entry.key,value); end if;
    end loop;
    result:=result||jsonb_build_object(v_version_id::text,resolved);
  end loop;
  return result;
end; $$;
revoke all on function public.crew_localized_content(text,text,uuid[],text) from public;
grant execute on function public.crew_localized_content(text,text,uuid[],text) to anon,authenticated;
