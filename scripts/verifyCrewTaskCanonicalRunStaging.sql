-- Rollback-only Staging contract: revision/run pinning, 3/11 versus 1/12
-- reconciliation without response transfer, Reset and shared completion.
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
  v2 uuid; v3 uuid; old_run uuid; v_started timestamptz; denied boolean; v_future uuid; old_evidence text;
  a_detail jsonb;
  b_detail jsonb;
  b_today jsonb;
  b_list jsonb;
  personal_detail jsonb;
  v_before_ids uuid[];
  v_after_ids uuid[];
  v_reconcile jsonb;
  v_repeat jsonb;
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
    'name','Rollback Twelve Item Team Projection QA','task_type','checklist','schedule_type','recurring',
    'effective_date',v_today,'start_time','00:00','due_time','23:59',
    'schedule_config',jsonb_build_object('frequency','every_day'),
    'assignment_type','specific_crew','applicable_employee_ids',jsonb_build_array(employee_a,employee_b),
    'applicable_positions','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','normal','completion_rule','one_for_team','allow_exception',true,
    'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,
    'blocks',(select jsonb_agg(jsonb_build_object('block_type','checklist_item','title','Item '||n,
      'is_required',true,'evidence_requirement','none','config','{}'::jsonb) order by n)
      from generate_series(1,11) n)));
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
  -- Pre-start revision adopts v2 atomically, with only one operational run.
  old_run:=team_instance;
  execute 'set local role authenticated';
  v2:=(public.crew_tasks_ensure_draft(team_task)->>'id')::uuid;
  execute 'reset role';
  insert into public.crew_operation_template_items(template_id,title,is_required,sort_order,block_type,block_config,evidence_requirement)
  values(v2,'Counter Closing & Cash Reconciliation',true,12,'checklist_item','{}','none');
  execute 'set local role authenticated';
  perform public.crew_operations_activate_template(v2);
  execute 'reset role';
  select id into team_instance from public.crew_operation_instances where template_id=v2 and business_date=v_today and is_operational;
  if team_instance is null or team_instance=old_run or (select is_operational from public.crew_operation_instances where id=old_run)
    or (select count(*) from public.crew_operation_instances where template_series_id=(select series_id from public.crew_operation_templates where id=team_task) and business_date=v_today and is_operational)<>1
  then raise exception 'Pre-start replacement/run identity failed'; end if;
  denied:=false;
  begin perform public.crew_tasks_detail('team-projection-actor',old_run); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Superseded detail exposed'; end if;
  select id into item from public.crew_operation_instance_items where instance_id=old_run order by sort_order limit 1;
  denied:=false;
  begin perform public.crew_tasks_update_block('team-projection-actor',item.id,'completed'); exception when insufficient_privilege or object_not_in_prerequisite_state then denied:=true; end;
  if not denied then raise exception 'Superseded write allowed'; end if;

  -- Reproduce a legacy split run inside this rollback-only transaction.
  -- This temporary index removal is fixture setup, never shared-environment DDL.
  drop index public.crew_task_one_operational_run;
  update public.crew_operation_instances set is_operational=true,superseded_at=null,superseded_by=null where id=old_run;
  for item in select id from public.crew_operation_instance_items where instance_id=old_run order by sort_order limit 3 loop
    perform public.crew_tasks_update_block('team-projection-actor',item.id,'completed');
  end loop;
  select md5(string_agg(row_to_json(r)::text,'|' order by r.id)) into old_evidence
  from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id=r.instance_item_id where x.instance_id=old_run;
  select id into item from public.crew_operation_instance_items where instance_id=team_instance order by sort_order limit 1;
  perform public.crew_tasks_update_block('team-projection-viewer',item.id,'completed');
  perform public.crew_tasks_reconcile_run(team_instance,'Explicit split-run fixture reconciliation; retain old answers only for audit.');
  create unique index crew_task_one_operational_run on public.crew_operation_instances(template_series_id,outlet_id,business_date) where is_operational;
  if (select count(*) from public.crew_operation_instance_items where instance_id=old_run)<>11
    or (select count(*) from public.crew_operation_instance_items where instance_id=team_instance)<>12
    or (select md5(string_agg(row_to_json(r)::text,'|' order by r.id)) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id=r.instance_item_id where x.instance_id=old_run) is distinct from old_evidence
    or (select count(*) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id=r.instance_item_id where x.instance_id=team_instance)<>1
    or (select is_operational from public.crew_operation_instances where id=old_run)
    or (select count(*) from jsonb_array_elements(public.crew_tasks_detail('team-projection-viewer',team_instance)->'blocks') x where x->>'status'='completed')<>1
  then raise exception 'Reconciliation merged or lost incomplete evidence'; end if;
  if not exists(select 1 from jsonb_array_elements(public.crew_tasks_today('team-projection-viewer',v_today)->'tasks') x where x->>'id'=team_instance::text and (x->>'completed_count')::integer=1)
    or exists(select 1 from jsonb_array_elements(public.crew_tasks_today('team-projection-viewer',v_today)->'tasks') x where x->>'id'=old_run::text)
  then raise exception 'Crew split-run Home projection failed'; end if;

  -- Partial responses by both Crew; Reset clears shared state on the same run.
  for item in select id,sort_order from public.crew_operation_instance_items where instance_id=team_instance and sort_order<=2 order by sort_order loop
    perform public.crew_tasks_update_block(case when item.sort_order=1 then 'team-projection-viewer' else 'team-projection-actor' end,item.id,'completed');
  end loop;
  select execution_started_at into v_started from public.crew_operation_instances where id=team_instance;
  perform public.crew_tasks_reset('team-projection-actor',team_instance);
  if exists(select 1 from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id=r.instance_item_id where x.instance_id=team_instance)
    or exists(select 1 from public.crew_task_instance_assignees where instance_id=team_instance and status<>'not_started')
    or (select execution_started_at from public.crew_operation_instances where id=team_instance) is distinct from v_started
    or (select status from public.crew_operation_instances where id=team_instance)<>'not_started'
  then raise exception 'Shared reset did not restart same pinned run'; end if;

  -- Even after Reset, v3 cannot replace a run that previously had responses.
  execute 'set local role authenticated';
  v3:=(public.crew_tasks_ensure_draft(v2)->>'id')::uuid;
  perform public.crew_operations_activate_template(v3);
  execute 'reset role';
  perform public.crew_operations_ensure_instances(outlet,v_today);
  if not (select is_operational from public.crew_operation_instances where id=team_instance)
    or exists(select 1 from public.crew_operation_instances where template_id=v3 and business_date=v_today and is_operational)
  then raise exception 'Started/reset run lost its pinned snapshot'; end if;
  perform public.crew_operations_ensure_instances(outlet,v_today+1);
  select id into v_future from public.crew_operation_instances where template_id=v3 and business_date=v_today+1 and is_operational;
  if v_future is null then raise exception 'Future run failed to adopt new revision'; end if;

  for item in select id, sort_order from public.crew_operation_instance_items where instance_id=team_instance order by sort_order loop
    execute 'set local role anon';
    perform public.crew_tasks_update_block(
      case when item.sort_order = 1 then 'team-projection-viewer' else 'team-projection-actor' end,
      item.id,'completed');
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
    or (select count(*) from jsonb_array_elements(b_detail->'blocks') x where x->>'status'='completed')<>12
    or (select count(*) from jsonb_array_elements(a_detail->'blocks') x where x->>'status'='completed')<>12
    or b_detail#>>'{completion_audit,employee_id}'<>employee_a::text
    or (select count(*) from public.crew_task_item_responses r join public.crew_operation_instance_items i on i.id=r.instance_item_id where i.instance_id=team_instance and r.employee_id=employee_a)<>11
    or (select count(*) from public.crew_task_item_responses r join public.crew_operation_instance_items i on i.id=r.instance_item_id where i.instance_id=team_instance and r.employee_id=employee_b)<>1
  then raise exception 'Shared Detail/evidence projection failed'; end if;
  if not exists(select 1 from jsonb_array_elements(b_today->'tasks') x where x->>'id'=team_instance::text and x->>'status'='completed' and (x->>'completed_count')::int=12 and (x->>'block_count')::int=12)
    or not exists(select 1 from jsonb_array_elements(b_list->'tasks') x where x->>'id'=team_instance::text and x->>'status'='completed' and (x->>'completed_count')::int=12 and (x->>'block_count')::int=12)
  then raise exception 'Shared Home/List count projection failed'; end if;
  if not exists (select 1 from public.audit_logs l where l.action='crew_task_team_completed'
      and l.metadata->>'task_instance_id'=team_instance::text
      and l.metadata->>'completion_actor_employee_id'=employee_a::text)
  then raise exception 'Completion actor audit missing'; end if;
  if personal_detail->>'status'<> 'not_started' or personal_detail#>>'{blocks,0,status}'<>'pending'
    or not exists(select 1 from jsonb_array_elements(b_today->'tasks') x where x->>'id'=personal_instance::text and (x->>'completed_count')::int=0)
  then raise exception 'Every-assigned isolation regressed'; end if;
  perform public.crew_operations_refresh_instance(team_instance);
  if (select status from public.crew_operation_instances where id=team_instance)<>'completed' then raise exception 'Legacy refresh rewrote completed Task'; end if;
  if jsonb_array_length(b_detail->'completion_contributors')<>2 then raise exception 'Actual contributors not projected'; end if;
  denied:=false;
  begin perform public.crew_tasks_reset('team-projection-viewer',team_instance); exception when object_not_in_prerequisite_state then denied:=true; end;
  if not denied then raise exception 'Completed execution allowed reset'; end if;
  select id into item from public.crew_operation_instance_items where instance_id=team_instance order by sort_order limit 1;
  denied:=false;
  begin perform public.crew_tasks_update_block('team-projection-viewer',item.id,'completed'); exception when object_not_in_prerequisite_state then denied:=true; end;
  if not denied then raise exception 'Completed execution allowed edit'; end if;
  insert into crew_task_team_projection_result(result) values(jsonb_build_object('shared_completion',true,'split_run',jsonb_build_object('old_responses',3,'old_items',11,'canonical_responses',1,'canonical_items',12,'incomplete_responses_transferred',false),'contributors',b_detail->'completion_contributors','completion_actor',b_detail->'completion_audit'));
end; $$;
select result from crew_task_team_projection_result;
rollback;
