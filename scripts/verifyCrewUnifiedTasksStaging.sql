-- Rollback-only Staging behavior/security verification for unified Crew Tasks.
begin;
create temporary table crew_tasks_verification_result(passed integer,total integer,detail jsonb) on commit drop;

do $$
declare
  qa_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  qa_role uuid; employee_a uuid; employee_b uuid; sop_version uuid;
  task_id uuid; task_series uuid; team_task uuid; review_task uuid; recurring_task uuid; shift_task uuid; overdue_task uuid; duplicate_id uuid; next_revision uuid;
  v_instance_id uuid; team_instance uuid; review_instance uuid; shift_instance uuid; publication_id uuid; block_id uuid; payload jsonb; detail jsonb; result jsonb; shift_date date:=timezone('Asia/Kuala_Lumpur',now())::date+60;
  denied boolean; pass integer:=0; total constant integer:=31;
begin
  if not exists(select 1 from public.outlets where id=outlet and name='Friends Corner') then raise exception 'Friends Corner Staging outlet is unavailable.'; end if;
  select role_id into qa_role from public.employees where auth_user_id=qa_admin and is_active;
  if qa_role is null then raise exception 'Crew Admin QA identity is unavailable.'; end if;
  insert into public.role_permissions(role_id,permission_id) select qa_role,id from public.permissions where code in ('crew_operations.view','crew_operations.manage','crew_operations.review') on conflict do nothing;
  select e.id into employee_a from public.employees e join public.crew_access a on a.employee_id=e.id where a.primary_outlet_id=outlet and a.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') order by (e.employee_code like 'QA-%') desc,e.created_at limit 1;
  select e.id into employee_b from public.employees e join public.crew_access a on a.employee_id=e.id where a.primary_outlet_id=outlet and a.access_state='active' and e.is_active and e.id<>employee_a and coalesce(e.employment_status,'active') not in ('resigned','terminated') order by (e.employee_code like 'QA-%') desc,e.created_at limit 1;
  select v.id into sop_version from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id where v.status='published' and (s.outlet_id is null or s.outlet_id=outlet) order by v.version desc limit 1;
  if employee_a is null or employee_b is null or sop_version is null then raise exception 'Unified Tasks verification needs two QA Crew and one published SOP.'; end if;
  insert into public.crew_sessions(employee_id,token_hash,expires_at) values(employee_a,encode(extensions.digest('unified-task-token-a','sha256'),'hex'),now()+interval '1 hour');
  insert into public.crew_sessions(employee_id,token_hash,expires_at) values(employee_b,encode(extensions.digest('unified-task-token-b','sha256'),'hex'),now()+interval '1 hour');
  insert into public.duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by) values(outlet,shift_date,shift_date+6,coalesce((select max(revision)+1 from public.duty_roster_publications where outlet_id=outlet and week_start_date=shift_date),1),qa_admin) returning id into publication_id;
  insert into public.duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,position_snapshot,group_snapshot,outlet_name_snapshot,shift_snapshot,published_at) values(publication_id,outlet,employee_a,shift_date,'10:00','17:00',30,'working',(select position from public.employees where id=employee_a),'floor','Friends Corner','{}',now());

  perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  task_id:=public.crew_tasks_save(outlet,jsonb_build_object(
    'name','Rollback Unified Task QA','task_type','health_check','schedule_type','one_time','effective_date',timezone('Asia/Kuala_Lumpur',now())::date,
    'start_time','00:00','due_time','23:59','schedule_config',jsonb_build_object('frequency','every_day'),
    'assignment_type','specific_crew','applicable_employee_ids',jsonb_build_array(employee_a),'applicable_positions','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','important','completion_rule','every_assigned','allow_exception',true,'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','text','title','Instruction','description','Prepare the outlet.','is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Opening check','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','health_rating','title','Floor condition','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','sop_reference','title','Review SOP','sop_version_id',sop_version,'is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','yes_no','title','Confirm ready','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','single_choice','title','Select condition','is_required',true,'evidence_requirement','none','config',jsonb_build_object('options',jsonb_build_array('Ready','Not Ready'))),
      jsonb_build_object('block_type','number','title','Counter count','is_required',true,'evidence_requirement','none','config',jsonb_build_object('min',1,'max',3)),
      jsonb_build_object('block_type','temperature','title','Chiller temperature','is_required',true,'evidence_requirement','none','config',jsonb_build_object('min',0,'max',10)),
      jsonb_build_object('block_type','short_text','title','Shift note','is_required',true,'evidence_requirement','none','config','{}'::jsonb)
    )));
  perform public.crew_operations_activate_template(task_id); pass:=pass+1;
  payload:=public.crew_tasks_admin_data(outlet,timezone('Asia/Kuala_Lumpur',now())::date,timezone('Asia/Kuala_Lumpur',now())::date);
  execute 'reset role';
  if not exists(select 1 from jsonb_array_elements(payload->'definitions') x where x->>'id'=task_id::text and jsonb_array_length(x->'blocks')=9) then raise exception 'FAIL Admin unified definition'; end if; pass:=pass+1;
  select id into v_instance_id from public.crew_operation_instances where template_id=task_id and business_date=timezone('Asia/Kuala_Lumpur',now())::date;
  if v_instance_id is null or not exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=v_instance_id and a.employee_id=employee_a) then raise exception 'FAIL frozen instance/assignment'; end if; pass:=pass+1;
  if (select template_snapshot#>>'{items,3,sop_reference,sop_version_id}' from public.crew_operation_instances where id=v_instance_id)<>sop_version::text then raise exception 'FAIL pinned SOP snapshot'; end if; pass:=pass+1;

  execute 'set local role anon'; payload:=public.crew_tasks_today('unified-task-token-a',timezone('Asia/Kuala_Lumpur',now())::date); execute 'reset role';
  if not exists(select 1 from jsonb_array_elements(payload->'tasks') x where x->>'id'=v_instance_id::text) then raise exception 'FAIL Crew Home Task payload'; end if; pass:=pass+1;
  execute 'set local role anon'; detail:=public.crew_tasks_detail('unified-task-token-a',v_instance_id); execute 'reset role';
  if jsonb_array_length(detail->'blocks')<>9 or detail ? 'template_snapshot' then raise exception 'FAIL safe Task detail'; end if; pass:=pass+1;
  select id into block_id from public.crew_operation_instance_items where instance_id=v_instance_id and block_type='text';
  denied:=false; execute 'set local role anon'; begin perform public.crew_tasks_update_block('unified-task-token-a',block_id,'completed'); exception when invalid_parameter_value then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL informational block response denial'; end if; pass:=pass+1;

  select id into block_id from public.crew_operation_instance_items where instance_id=v_instance_id and block_type='health_rating';
  denied:=false; execute 'set local role anon'; begin perform public.crew_tasks_update_block('unified-task-token-a',block_id,'needs_attention','{}',null,null); exception when invalid_parameter_value then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL Health note gating'; end if; pass:=pass+1;
  execute 'set local role anon'; perform public.crew_tasks_update_block('unified-task-token-a',block_id,'good'); execute 'reset role'; pass:=pass+1;
  select id into block_id from public.crew_operation_instance_items where instance_id=v_instance_id and block_type='yes_no';
  denied:=false; execute 'set local role anon'; begin perform public.crew_tasks_update_block('unified-task-token-a',block_id,'completed',jsonb_build_object('value','maybe')); exception when invalid_parameter_value then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL Yes/No validation'; end if; pass:=pass+1;
  execute 'set local role anon'; perform public.crew_tasks_update_block('unified-task-token-a',block_id,'completed',jsonb_build_object('value','yes')); execute 'reset role';
  select id into block_id from public.crew_operation_instance_items where instance_id=v_instance_id and block_type='single_choice';
  denied:=false; execute 'set local role anon'; begin perform public.crew_tasks_update_block('unified-task-token-a',block_id,'completed',jsonb_build_object('value','Unknown')); exception when invalid_parameter_value then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL choice validation'; end if; pass:=pass+1;
  execute 'set local role anon'; perform public.crew_tasks_update_block('unified-task-token-a',block_id,'completed',jsonb_build_object('value','Ready')); execute 'reset role';
  select id into block_id from public.crew_operation_instance_items where instance_id=v_instance_id and block_type='number';
  denied:=false; execute 'set local role anon'; begin perform public.crew_tasks_update_block('unified-task-token-a',block_id,'completed',jsonb_build_object('value','bad')); exception when invalid_parameter_value then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL number validation'; end if; pass:=pass+1;
  execute 'set local role anon'; perform public.crew_tasks_update_block('unified-task-token-a',block_id,'completed',jsonb_build_object('value',2)); execute 'reset role';
  select id into block_id from public.crew_operation_instance_items where instance_id=v_instance_id and block_type='temperature';
  denied:=false; execute 'set local role anon'; begin perform public.crew_tasks_update_block('unified-task-token-a',block_id,'completed',jsonb_build_object('value',15)); exception when invalid_parameter_value then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL measurement range gating'; end if; pass:=pass+1;
  execute 'set local role anon'; perform public.crew_tasks_update_block('unified-task-token-a',block_id,'completed',jsonb_build_object('value',5)); execute 'reset role';
  select id into block_id from public.crew_operation_instance_items where instance_id=v_instance_id and block_type='short_text';
  execute 'set local role anon'; perform public.crew_tasks_update_block('unified-task-token-a',block_id,'completed',jsonb_build_object('value','Ready for service')); execute 'reset role';
  select id into block_id from public.crew_operation_instance_items where instance_id=v_instance_id and block_type='checklist_item';
  execute 'set local role anon'; perform public.crew_tasks_update_block('unified-task-token-a',block_id,'completed'); result:=public.crew_tasks_complete('unified-task-token-a',v_instance_id); execute 'reset role';
  if result->>'status'<>'completed' then raise exception 'FAIL complete required blocks'; end if; pass:=pass+1;

  execute 'set local role authenticated';
  team_task:=public.crew_tasks_save(outlet,jsonb_build_object('name','Rollback Team Task','task_type','checklist','schedule_type','one_time','effective_date',timezone('Asia/Kuala_Lumpur',now())::date,'start_time','00:00','due_time','23:59','schedule_config',jsonb_build_object('frequency','every_day'),'assignment_type','all_crew','applicable_positions','[]'::jsonb,'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,'priority','normal','completion_rule','one_for_team','allow_exception',true,'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,'blocks',jsonb_build_array(jsonb_build_object('block_type','checklist_item','title','Team close','is_required',true,'evidence_requirement','none','config','{}'::jsonb))));
  perform public.crew_operations_activate_template(team_task); perform public.crew_tasks_admin_data(outlet,timezone('Asia/Kuala_Lumpur',now())::date,timezone('Asia/Kuala_Lumpur',now())::date); execute 'reset role';
  select id into team_instance from public.crew_operation_instances where template_id=team_task and business_date=timezone('Asia/Kuala_Lumpur',now())::date;
  select id into block_id from public.crew_operation_instance_items where instance_id=team_instance;
  execute 'set local role anon'; perform public.crew_tasks_update_block('unified-task-token-a',block_id,'completed'); execute 'reset role';
  denied:=false; execute 'set local role anon'; begin perform public.crew_tasks_update_block('unified-task-token-b',block_id,'completed'); exception when object_not_in_prerequisite_state then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL one-for-team first writer'; end if; pass:=pass+1;

  execute 'set local role authenticated';
  review_task:=public.crew_tasks_save(outlet,jsonb_build_object('name','Rollback Review Task','task_type','confirmation','schedule_type','one_time','effective_date',timezone('Asia/Kuala_Lumpur',now())::date,'start_time','00:00','due_time','23:59','schedule_config',jsonb_build_object('frequency','every_day'),'assignment_type','specific_crew','applicable_employee_ids',jsonb_build_array(employee_a),'applicable_positions','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,'priority','normal','completion_rule','every_assigned','allow_exception',true,'exception_requires_reason',true,'manager_review_required',true,'allow_late_completion',true,'blocks',jsonb_build_array(jsonb_build_object('block_type','confirmation','title','Manager review confirmation','is_required',true,'evidence_requirement','none','config','{}'::jsonb))));
  perform public.crew_operations_activate_template(review_task); perform public.crew_tasks_admin_data(outlet,timezone('Asia/Kuala_Lumpur',now())::date,timezone('Asia/Kuala_Lumpur',now())::date); execute 'reset role';
  select id into review_instance from public.crew_operation_instances where template_id=review_task and business_date=timezone('Asia/Kuala_Lumpur',now())::date;
  select id into block_id from public.crew_operation_instance_items where instance_id=review_instance;
  execute 'set local role anon'; perform public.crew_tasks_update_block('unified-task-token-a',block_id,'completed'); result:=public.crew_tasks_complete('unified-task-token-a',review_instance); execute 'reset role';
  if result->>'status'<>'review_required' then raise exception 'FAIL manager review gating'; end if; pass:=pass+1;
  execute 'set local role authenticated'; payload:=public.crew_tasks_admin_data(outlet,timezone('Asia/Kuala_Lumpur',now())::date,timezone('Asia/Kuala_Lumpur',now())::date); execute 'reset role';
  if not exists(select 1 from jsonb_array_elements(payload->'review_queue') x where x->>'instance_id'=review_instance::text and x->>'employee_id'=employee_a::text) then raise exception 'FAIL manager review queue'; end if; pass:=pass+1;
  execute 'set local role authenticated'; result:=public.crew_tasks_review(review_instance,employee_a,'approved'); execute 'reset role';
  if result->>'status'<>'completed' or (select status from public.crew_operation_instances where id=review_instance)<>'completed' then raise exception 'FAIL manager review approval'; end if; pass:=pass+1;

  execute 'set local role authenticated';
  recurring_task:=public.crew_tasks_save(outlet,jsonb_build_object('name','Rollback Weekday Task','task_type','instruction','schedule_type','recurring','effective_date',timezone('Asia/Kuala_Lumpur',now())::date,'schedule_config',jsonb_build_object('frequency','specific_weekdays','weekdays',jsonb_build_array(extract(isodow from timezone('Asia/Kuala_Lumpur',now())::date)::int)),'assignment_type','position','applicable_positions',jsonb_build_array((select position from public.employees where id=employee_a)),'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,'priority','normal','completion_rule','any_assigned','allow_exception',true,'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,'blocks',jsonb_build_array(jsonb_build_object('block_type','text','title','Weekday brief','is_required',false,'evidence_requirement','none','config','{}'::jsonb),jsonb_build_object('block_type','confirmation','title','Read briefing','is_required',true,'evidence_requirement','none','config','{}'::jsonb))));
  execute 'reset role';
  if not public.crew_tasks_schedule_matches((select t from public.crew_operation_templates t where id=recurring_task),timezone('Asia/Kuala_Lumpur',now())::date) or public.crew_tasks_schedule_matches((select t from public.crew_operation_templates t where id=recurring_task),timezone('Asia/Kuala_Lumpur',now())::date+1) then raise exception 'FAIL weekday recurrence'; end if; pass:=pass+1;
  execute 'set local role authenticated';
  shift_task:=public.crew_tasks_save(outlet,jsonb_build_object('name','Rollback Shift Task','task_type','checklist','schedule_type','shift_based','effective_date',shift_date,'schedule_config',jsonb_build_object('shift_phase','start_of_shift'),'assignment_type','all_crew','applicable_positions','[]'::jsonb,'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',true,'priority','important','completion_rule','one_for_team','allow_exception',true,'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,'blocks',jsonb_build_array(jsonb_build_object('block_type','checklist_item','title','Start shift check','is_required',true,'evidence_requirement','none','config','{}'::jsonb))));
  perform public.crew_operations_activate_template(shift_task); perform public.crew_tasks_admin_data(outlet,shift_date,shift_date); execute 'reset role';
  select id into shift_instance from public.crew_operation_instances where template_id=shift_task and business_date=shift_date;
  if shift_instance is null or not exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=shift_instance and a.employee_id=employee_a) or exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=shift_instance and a.employee_id=employee_b) then raise exception 'FAIL shift-based on-duty assignment'; end if; pass:=pass+1;
  if (select available_from at time zone 'Asia/Kuala_Lumpur' from public.crew_operation_instances where id=shift_instance)::time<>time '10:00' then raise exception 'FAIL shift start timing'; end if; pass:=pass+1;
  execute 'set local role authenticated';
  duplicate_id:=public.crew_tasks_duplicate(task_id);
  execute 'reset role';
  if (select status from public.crew_operation_templates where id=duplicate_id)<>'draft' or (select series_id from public.crew_operation_templates where id=duplicate_id)=(select series_id from public.crew_operation_templates where id=task_id) then raise exception 'FAIL duplicate Task'; end if; pass:=pass+1;
  select series_id into task_series from public.crew_operation_templates where id=task_id;
  execute 'set local role authenticated';
  next_revision:=public.crew_tasks_save(outlet,jsonb_build_object('series_id',task_series,'name','Rollback Unified Task QA v2','task_type','health_check','schedule_type','one_time','effective_date',timezone('Asia/Kuala_Lumpur',now())::date+1,'schedule_config',jsonb_build_object('frequency','every_day'),'assignment_type','specific_crew','applicable_employee_ids',jsonb_build_array(employee_a),'applicable_positions','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,'priority','important','completion_rule','every_assigned','allow_exception',true,'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,'blocks',jsonb_build_array(jsonb_build_object('block_type','checklist_item','title','New revision item','is_required',true,'evidence_requirement','none','config','{}'::jsonb))));
  execute 'reset role';
  if (select template_snapshot->>'name' from public.crew_operation_instances where id=v_instance_id)<>'Rollback Unified Task QA' or (select revision from public.crew_operation_templates where id=next_revision)<>2 then raise exception 'FAIL historical snapshot/new revision'; end if; pass:=pass+1;
  execute 'set local role authenticated';
  perform public.crew_tasks_manage_schedule(team_task,'end',null);
  perform public.crew_operations_archive_template(team_task);
  execute 'reset role';
  if (select status from public.crew_operation_templates where id=team_task)<>'archived' then raise exception 'FAIL archive'; end if; pass:=pass+1;
  execute 'set local role authenticated';
  overdue_task:=public.crew_tasks_save(outlet,jsonb_build_object('name','Rollback Overdue Task','task_type','confirmation','schedule_type','one_time','effective_date',timezone('Asia/Kuala_Lumpur',now())::date,'start_time','00:00','due_time','00:01','schedule_config',jsonb_build_object('frequency','every_day'),'assignment_type','specific_crew','applicable_employee_ids',jsonb_build_array(employee_a),'applicable_positions','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,'priority','critical','completion_rule','every_assigned','allow_exception',true,'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,'blocks',jsonb_build_array(jsonb_build_object('block_type','confirmation','title','Overdue confirmation','is_required',true,'evidence_requirement','none','config','{}'::jsonb))));
  perform public.crew_operations_activate_template(overdue_task); perform public.crew_tasks_admin_data(outlet,timezone('Asia/Kuala_Lumpur',now())::date,timezone('Asia/Kuala_Lumpur',now())::date);
  execute 'reset role'; execute 'set local role anon'; payload:=public.crew_tasks_today('unified-task-token-a',timezone('Asia/Kuala_Lumpur',now())::date); execute 'reset role';
  if not exists(select 1 from jsonb_array_elements(payload->'tasks') x where x->>'name'='Rollback Overdue Task' and x->>'status'='overdue') then raise exception 'FAIL overdue projection'; end if; pass:=pass+1;

  denied:=false; execute 'set local role anon'; begin perform * from public.crew_task_item_responses; exception when insufficient_privilege then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL direct table denial'; end if; pass:=pass+1;
  denied:=false; execute 'set local role anon'; begin perform public.crew_tasks_detail('unified-task-token-b',v_instance_id); exception when insufficient_privilege then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL cross-employee isolation'; end if; pass:=pass+1;
  if has_function_privilege('public','public.crew_tasks_today(text,date)','execute') or has_function_privilege('public','public.crew_tasks_save(uuid,jsonb)','execute') then raise exception 'FAIL PUBLIC execute revoke'; end if; pass:=pass+1;
  if has_function_privilege('anon','public.crew_tasks_save(uuid,jsonb)','execute') or not has_function_privilege('authenticated','public.crew_tasks_save(uuid,jsonb)','execute') then raise exception 'FAIL Admin ACL'; end if; pass:=pass+1;
  if has_function_privilege('anon','public.crew_tasks_employee_applies(public.crew_operation_templates,public.employees,date)','execute') or has_function_privilege('authenticated','public.crew_tasks_employee_applies(public.crew_operation_templates,public.employees,date)','execute') then raise exception 'FAIL internal helper ACL'; end if; pass:=pass+1;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'crew_tasks_%' and p.prosecdef and not (p.proconfig @> array['search_path=public'])) then raise exception 'FAIL fixed search_path'; end if; pass:=pass+1;

  insert into crew_tasks_verification_result values(pass,total,jsonb_build_object('task',task_id,'instance',v_instance_id,'employee_a',employee_a,'employee_b',employee_b));
  raise notice 'CREW_UNIFIED_TASKS_BEHAVIOR_PASS %/%',pass,total;
end $$;
table crew_tasks_verification_result;
rollback;
