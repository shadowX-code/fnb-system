-- Rollback-only Staging behavior verification for Crew Task lifecycle/results.
begin;

create temporary table crew_task_lifecycle_checks(
  check_name text primary key,
  passed boolean not null,
  detail jsonb not null default '{}'::jsonb
) on commit drop;
grant select,insert,update on crew_task_lifecycle_checks to anon,authenticated;

do $$
declare
  v_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  v_outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  v_today date := timezone('Asia/Kuala_Lumpur',now())::date;
  v_role uuid;
  v_employee uuid;
  v_token constant text := 'crew-task-lifecycle-rollback-token';
  v_task uuid;
  v_revision uuid;
  v_duplicate uuid;
  v_end_task uuid;
  v_series uuid;
  v_instance uuid;
  v_number uuid;
  v_temperature uuid;
  v_check uuid;
  v_payload jsonb;
  v_detail jsonb;
  v_result jsonb;
  v_created date;
  v_denied boolean;
begin
  select role_id into v_role from public.employees where auth_user_id=v_admin and is_active;
  if v_role is null then raise exception 'Crew Admin QA identity is unavailable.'; end if;
  insert into public.role_permissions(role_id,permission_id)
  select v_role,id from public.permissions where code in ('crew_operations.view','crew_operations.manage','crew_operations.review')
  on conflict do nothing;
  select e.id into v_employee
  from public.employees e join public.crew_access ca on ca.employee_id=e.id
  where ca.primary_outlet_id=v_outlet and ca.access_state='active' and e.is_active
    and coalesce(e.employment_status,'active') not in ('resigned','terminated')
  order by (e.employee_code like 'QA-%') desc,e.created_at limit 1;
  if v_employee is null then raise exception 'Staging QA Crew is unavailable.'; end if;
  insert into public.crew_sessions(employee_id,token_hash,expires_at)
  values(v_employee,encode(extensions.digest(v_token,'sha256'),'hex'),now()+interval '1 hour');

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  v_task:=public.crew_tasks_save(v_outlet,jsonb_build_object(
    'name','Rollback Lifecycle Task','task_type','checklist','schedule_type','recurring','effective_date',v_today,
    'schedule_config',jsonb_build_object('frequency','every_day'),'assignment_type','specific_crew',
    'applicable_employee_ids',jsonb_build_array(v_employee),'applicable_positions','[]'::jsonb,'applicable_group_names','[]'::jsonb,
    'on_duty_only',false,'priority','important','completion_rule','every_assigned','allow_exception',true,
    'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','checklist_item','title','Visual condition','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','number','title','Item count','is_required',true,'evidence_requirement','none','config',jsonb_build_object('min',1,'max',20,'unit','items')),
      jsonb_build_object('block_type','temperature','title','Chiller temperature','is_required',true,'evidence_requirement','none','config',jsonb_build_object('min',0,'max',8,'unit','°C'))
    )
  ));
  perform public.crew_operations_activate_template(v_task);
  execute 'reset role';
  select series_id,created_at::date into v_series,v_created from public.crew_operation_templates where id=v_task;
  insert into crew_task_lifecycle_checks values('active_recurring',
    (select status='active' from public.crew_operation_templates where id=v_task),jsonb_build_object('task',v_task));

  execute 'set local role authenticated';
  v_payload:=public.crew_tasks_admin_data(v_outlet,v_today,v_today);
  insert into crew_task_lifecycle_checks values('server_next_run',
    exists(select 1 from jsonb_array_elements(v_payload->'definitions') x where x->>'id'=v_task::text and x#>>'{next_run,state}'='scheduled'),'{}');
  execute 'reset role';

  select id into v_instance from public.crew_operation_instances where template_id=v_task and business_date=v_today;
  insert into crew_task_lifecycle_checks values('initial_instance_created',v_instance is not null,jsonb_build_object('instance',v_instance));
  select id into v_check from public.crew_operation_instance_items where instance_id=v_instance and block_type='checklist_item';
  select id into v_number from public.crew_operation_instance_items where instance_id=v_instance and block_type='number';
  select id into v_temperature from public.crew_operation_instance_items where instance_id=v_instance and block_type='temperature';
  execute 'set local role anon';
  perform public.crew_tasks_update_block(v_token,v_check,'exception','{}'::jsonb,'other','Fixture exception evidence');
  perform public.crew_tasks_update_block(v_token,v_number,'completed',jsonb_build_object('value',7,'unit','items'));
  perform public.crew_tasks_update_block(v_token,v_temperature,'completed',jsonb_build_object('value',4.5,'unit','°C'));
  execute 'reset role';

  execute 'set local role authenticated';
  perform public.crew_tasks_manage_schedule(v_task,'pause',null);
  execute 'reset role';
  perform public.crew_operations_ensure_instances(v_outlet,v_today+1);
  insert into crew_task_lifecycle_checks values('pause_stops_generation',
    (select status='paused' from public.crew_operation_templates where id=v_task)
      and not exists(select 1 from public.crew_operation_instances where template_id=v_task and business_date=v_today+1),'{}');
  execute 'set local role authenticated';
  perform public.crew_tasks_manage_schedule(v_task,'resume',null);
  execute 'reset role';
  perform public.crew_operations_ensure_instances(v_outlet,v_today+1);
  insert into crew_task_lifecycle_checks values('resume_continues_generation',
    (select status='active' from public.crew_operation_templates where id=v_task)
      and exists(select 1 from public.crew_operation_instances where template_id=v_task and business_date=v_today+1),'{}');
  execute 'set local role authenticated';
  perform public.crew_tasks_manage_schedule(v_task,'end',null);
  execute 'reset role';
  perform public.crew_operations_ensure_instances(v_outlet,v_today+2);
  insert into crew_task_lifecycle_checks values('end_stops_future_generation',
    (select status='ended' from public.crew_operation_templates where id=v_task)
      and not exists(select 1 from public.crew_operation_instances where template_id=v_task and business_date=v_today+2),'{}');
  execute 'set local role authenticated';
  perform public.crew_tasks_manage_schedule(v_task,'archive',null);
  execute 'reset role';
  insert into crew_task_lifecycle_checks values('archive_preserves_history',
    (select status='archived' from public.crew_operation_templates where id=v_task)
      and exists(select 1 from public.crew_operation_instances where id=v_instance),'{}');

  execute 'set local role authenticated';
  v_revision:=public.crew_tasks_save(v_outlet,jsonb_build_object(
    'series_id',v_series,'name','Rollback Lifecycle Task v2','task_type','checklist','schedule_type','recurring','effective_date',v_today+2,
    'schedule_config',jsonb_build_object('frequency','every_day'),'assignment_type','specific_crew',
    'applicable_employee_ids',jsonb_build_array(v_employee),'applicable_positions','[]'::jsonb,'applicable_group_names','[]'::jsonb,
    'on_duty_only',false,'priority','important','completion_rule','every_assigned','allow_exception',true,
    'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,
    'blocks',jsonb_build_array(jsonb_build_object('block_type','checklist_item','title','Revision two item','is_required',true,'evidence_requirement','none','config','{}'::jsonb))
  ));
  perform public.crew_operations_activate_template(v_revision);
  execute 'reset role';
  perform public.crew_operations_ensure_instances(v_outlet,v_today+2);
  insert into crew_task_lifecycle_checks values('revision_created_date_stable',
    (select min(created_at)::date=v_created from public.crew_operation_templates where series_id=v_series),'{}');
  insert into crew_task_lifecycle_checks values('old_instance_frozen_on_v1',
    (select template_revision=1 and template_snapshot->>'name'='Rollback Lifecycle Task' from public.crew_operation_instances where id=v_instance)
      and exists(select 1 from public.crew_operation_instances where template_id=v_revision and business_date=v_today+2 and template_revision=2),'{}');

  execute 'set local role authenticated';
  v_detail:=public.crew_tasks_admin_detail(v_revision);
  v_result:=public.crew_tasks_admin_result(v_instance);
  execute 'reset role';
  insert into crew_task_lifecycle_checks values('admin_progress_history',
    (v_detail#>>'{progress,instances}')::int>=3 and jsonb_array_length(v_detail->'history')>=3,
    jsonb_build_object('progress',v_detail->'progress','history_count',jsonb_array_length(v_detail->'history')));
  insert into crew_task_lifecycle_checks values('result_answers_visible',
    exists(select 1 from jsonb_array_elements(v_result->'blocks') b,jsonb_array_elements(b->'responses') r where b->>'block_type'='number' and r#>>'{response,value}'='7')
      and exists(select 1 from jsonb_array_elements(v_result->'blocks') b,jsonb_array_elements(b->'responses') r where b->>'block_type'='temperature' and r#>>'{response,value}'='4.5'),'{}');
  insert into crew_task_lifecycle_checks values('result_exception_visible',
    exists(select 1 from jsonb_array_elements(v_result->'blocks') b,jsonb_array_elements(b->'responses') r where r->>'status'='exception' and r->>'exception_reason'='other'),'{}');
  insert into crew_task_lifecycle_checks values('result_hides_raw_snapshot',
    not (v_result->'instance' ? 'template_snapshot'),'{}');

  execute 'set local role authenticated';
  v_end_task:=public.crew_tasks_save(v_outlet,jsonb_build_object(
    'name','Rollback End Date Task','task_type','confirmation','schedule_type','recurring','effective_date',v_today-2,
    'schedule_end_date',v_today,'schedule_config',jsonb_build_object('frequency','every_day'),'assignment_type','all_crew',
    'applicable_positions','[]'::jsonb,'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','normal','completion_rule','one_for_team','allow_exception',true,'exception_requires_reason',true,
    'manager_review_required',false,'allow_late_completion',true,
    'blocks',jsonb_build_array(jsonb_build_object('block_type','confirmation','title','Confirm','is_required',true,'evidence_requirement','none','config','{}'::jsonb))
  ));
  perform public.crew_operations_activate_template(v_end_task);
  execute 'reset role';
  perform public.crew_operations_ensure_instances(v_outlet,v_today+1);
  insert into crew_task_lifecycle_checks values('end_date_blocks_future_instance',
    not exists(select 1 from public.crew_operation_instances where template_id=v_end_task and business_date=v_today+1),'{}');

  execute 'set local role authenticated';
  v_duplicate:=public.crew_tasks_duplicate(v_end_task);
  execute 'reset role';
  insert into crew_task_lifecycle_checks values('duplicate_preserves_end_date',
    (select status='draft' and schedule_end_date=v_today
       from public.crew_operation_templates where id=v_duplicate),
    jsonb_build_object('duplicate',v_duplicate));

  perform set_config('feedx.operation_lifecycle','schedule',true);
  update public.crew_operation_templates set schedule_end_date=v_today-1 where id=v_end_task;
  perform set_config('feedx.operation_lifecycle','',true);
  perform public.crew_tasks_refresh_lifecycle(v_outlet);
  insert into crew_task_lifecycle_checks values('expired_end_date_auto_ends',
    (select status='ended' from public.crew_operation_templates where id=v_end_task),'{}');
  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  v_denied:=false;
  execute 'set local role authenticated';
  begin perform public.crew_tasks_manage_schedule(v_revision,'pause',null); exception when insufficient_privilege then v_denied:=true; end;
  execute 'reset role';
  insert into crew_task_lifecycle_checks values('unauthorized_lifecycle_denied',v_denied,'{}');

  insert into crew_task_lifecycle_checks values('admin_authority_acl',
    not has_function_privilege('public','public.crew_tasks_manage_schedule(uuid,text,date)','execute')
      and not has_function_privilege('anon','public.crew_tasks_manage_schedule(uuid,text,date)','execute')
      and has_function_privilege('authenticated','public.crew_tasks_manage_schedule(uuid,text,date)','execute')
      and not has_function_privilege('public','public.crew_tasks_admin_detail(uuid)','execute')
      and not has_function_privilege('anon','public.crew_tasks_admin_detail(uuid)','execute')
      and has_function_privilege('authenticated','public.crew_tasks_admin_detail(uuid)','execute')
      and not has_function_privilege('public','public.crew_tasks_admin_result(uuid)','execute')
      and not has_function_privilege('anon','public.crew_tasks_admin_result(uuid)','execute')
      and has_function_privilege('authenticated','public.crew_tasks_admin_result(uuid)','execute'),'{}');
  insert into crew_task_lifecycle_checks values('internal_helper_acl',
    not has_function_privilege('public','public.crew_tasks_refresh_lifecycle(uuid)','execute')
      and not has_function_privilege('anon','public.crew_tasks_refresh_lifecycle(uuid)','execute')
      and not has_function_privilege('authenticated','public.crew_tasks_refresh_lifecycle(uuid)','execute')
      and not has_function_privilege('public','public.crew_tasks_next_run(public.crew_operation_templates)','execute')
      and not has_function_privilege('anon','public.crew_tasks_next_run(public.crew_operation_templates)','execute')
      and not has_function_privilege('authenticated','public.crew_tasks_next_run(public.crew_operation_templates)','execute'),'{}');
  insert into crew_task_lifecycle_checks values('lifecycle_search_path_fixed',
    not exists(
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public'
        and p.proname in ('crew_tasks_manage_schedule','crew_tasks_admin_detail','crew_tasks_admin_result','crew_tasks_refresh_lifecycle','crew_tasks_next_run','crew_tasks_duplicate')
        and not (coalesce(p.proconfig,'{}'::text[]) @> array['search_path=public'])
    ),'{}');
end;
$$;

select jsonb_build_object(
  'passed',count(*) filter(where passed),
  'total',count(*),
  'failed',coalesce(jsonb_agg(jsonb_build_object('check',check_name,'detail',detail)) filter(where not passed),'[]'::jsonb),
  'checks',jsonb_agg(jsonb_build_object('check',check_name,'passed',passed,'detail',detail) order by check_name)
) as verification_result
from crew_task_lifecycle_checks;

rollback;
