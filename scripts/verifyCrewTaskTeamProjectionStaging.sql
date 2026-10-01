-- Rollback-only Staging contract: one Crew member's seven responses complete a
-- one_for_team occurrence for another assigned Crew member without copying evidence.
begin;
create temporary table crew_task_team_projection_result(result jsonb) on commit drop;
do $$
declare
  qa_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  employee_a uuid;
  employee_b uuid;
  team_task uuid;
  personal_task uuid;
  team_instance uuid;
  personal_instance uuid;
  item record;
  a_detail jsonb;
  b_detail jsonb;
  b_today jsonb;
  b_list jsonb;
  personal_detail jsonb;
  v_today date := timezone('Asia/Kuala_Lumpur', now())::date;
begin
  select e.id into employee_a
  from public.employees e join public.crew_access a on a.employee_id=e.id
  where a.primary_outlet_id=outlet and a.access_state='active' and e.is_active
    and coalesce(e.employment_status,'active') not in ('resigned','terminated')
  order by (e.employee_code like 'QA-%') desc,e.created_at limit 1;
  select e.id into employee_b
  from public.employees e join public.crew_access a on a.employee_id=e.id
  where a.primary_outlet_id=outlet and a.access_state='active' and e.is_active
    and coalesce(e.employment_status,'active') not in ('resigned','terminated') and e.id<>employee_a
  order by (e.employee_code like 'QA-%') desc,e.created_at limit 1;
  if employee_a is null or employee_b is null then raise exception 'Two active Staging QA Crew are required'; end if;
  insert into public.crew_sessions(employee_id,token_hash,expires_at)
  values (employee_a,encode(extensions.digest('team-projection-actor','sha256'),'hex'),now()+interval '1 hour'),
         (employee_b,encode(extensions.digest('team-projection-viewer','sha256'),'hex'),now()+interval '1 hour');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  team_task := public.crew_tasks_save(outlet,jsonb_build_object(
    'name','Rollback Seven Item Team Projection QA','task_type','checklist','schedule_type','one_time',
    'effective_date',v_today,'start_time','00:00','due_time','23:59',
    'schedule_config',jsonb_build_object('frequency','every_day'),
    'assignment_type','specific_crew','applicable_employee_ids',jsonb_build_array(employee_a,employee_b),
    'applicable_positions','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','normal','completion_rule','one_for_team','allow_exception',true,
    'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,
    'blocks',(select jsonb_agg(jsonb_build_object('block_type','checklist_item','title','Item '||n,
      'is_required',true,'evidence_requirement','none','config','{}'::jsonb) order by n)
      from generate_series(1,7) n)));
  perform public.crew_operations_activate_template(team_task);
  perform public.crew_tasks_admin_data(outlet,v_today,v_today);
  personal_task := public.crew_tasks_save(outlet,jsonb_build_object(
    'name','Rollback Personal Projection Control QA','task_type','checklist','schedule_type','one_time',
    'effective_date',v_today,'start_time','00:00','due_time','23:59',
    'schedule_config',jsonb_build_object('frequency','every_day'),
    'assignment_type','specific_crew','applicable_employee_ids',jsonb_build_array(employee_a,employee_b),
    'applicable_positions','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','normal','completion_rule','every_assigned','allow_exception',true,
    'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,
    'blocks',jsonb_build_array(jsonb_build_object('block_type','checklist_item','title','Individual item',
      'is_required',true,'evidence_requirement','none','config','{}'::jsonb))));
  perform public.crew_operations_activate_template(personal_task);
  perform public.crew_tasks_admin_data(outlet,v_today,v_today);
  execute 'reset role';
  select id into team_instance from public.crew_operation_instances where template_id=team_task and business_date=v_today;
  select id into personal_instance from public.crew_operation_instances where template_id=personal_task and business_date=v_today;
  if team_instance is null or personal_instance is null then raise exception 'Task instances not generated'; end if;
  for item in select id from public.crew_operation_instance_items where instance_id=team_instance order by sort_order loop
    execute 'set local role anon';
    perform public.crew_tasks_update_block('team-projection-actor',item.id,'completed');
    execute 'reset role';
  end loop;
  select id into item from public.crew_operation_instance_items where instance_id=personal_instance;
  execute 'set local role anon';
  perform public.crew_tasks_update_block('team-projection-actor',item.id,'completed');
  a_detail := public.crew_tasks_detail('team-projection-actor',team_instance);
  b_detail := public.crew_tasks_detail('team-projection-viewer',team_instance);
  b_today := public.crew_tasks_today('team-projection-viewer',v_today);
  b_list := public.crew_tasks_for_crew('team-projection-viewer',v_today,v_today);
  personal_detail := public.crew_tasks_detail('team-projection-viewer',personal_instance);
  execute 'reset role';
  if a_detail->>'status'<>'completed' or b_detail->>'status'<>'completed'
    or (select count(*) from jsonb_array_elements(b_detail->'blocks') x where x->>'status'='completed')<>7
    or (select count(*) from jsonb_array_elements(a_detail->'blocks') x where x->>'status'='completed')<>7
    or b_detail#>>'{completion_audit,employee_id}'<>employee_a::text
    or (select count(*) from public.crew_task_item_responses r join public.crew_operation_instance_items i on i.id=r.instance_item_id where i.instance_id=team_instance and r.employee_id=employee_a)<>7
    or (select count(*) from public.crew_task_item_responses r join public.crew_operation_instance_items i on i.id=r.instance_item_id where i.instance_id=team_instance and r.employee_id=employee_b)<>0
  then raise exception 'Shared Detail/evidence projection failed'; end if;
  if not exists(select 1 from jsonb_array_elements(b_today->'tasks') x where x->>'id'=team_instance::text and x->>'status'='completed' and (x->>'completed_count')::int=7 and (x->>'block_count')::int=7)
    or not exists(select 1 from jsonb_array_elements(b_list->'tasks') x where x->>'id'=team_instance::text and x->>'status'='completed' and (x->>'completed_count')::int=7 and (x->>'block_count')::int=7)
  then raise exception 'Shared Home/List count projection failed'; end if;
  if personal_detail->>'status'<> 'not_started' or personal_detail#>>'{blocks,0,status}'<>'pending'
    or not exists(select 1 from jsonb_array_elements(b_today->'tasks') x where x->>'id'=personal_instance::text and (x->>'completed_count')::int=0)
  then raise exception 'Every-assigned isolation regressed'; end if;
  insert into crew_task_team_projection_result(result) values(jsonb_build_object(
    'team_instance',team_instance,'actor',employee_a,'viewer',employee_b,
    'actor_status',a_detail->>'status','viewer_status',b_detail->>'status',
    'viewer_done_items',7,'today_count',7,'list_count',7,
    'completion_actor',b_detail#>>'{completion_audit,employee_id}',
    'every_assigned_viewer_status',personal_detail->>'status'));
end;
$$;
select result from crew_task_team_projection_result;
rollback;
