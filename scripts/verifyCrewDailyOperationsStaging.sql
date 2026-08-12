-- Real FeedX Staging Daily Operations behavior/security verification.
-- All fixtures and grants are rollback-only.
begin;
create temporary table crew_operations_test_results(passed int,total int,detail jsonb) on commit drop;

do $$
declare
  qa_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  qa_role uuid; employee_a uuid; employee_b uuid; other_employee uuid; other_outlet uuid;
  opening uuid; health uuid; v_instance_id uuid; v_health_instance uuid; item_a uuid; item_b uuid; health_item uuid; task_id uuid;
  payload jsonb; detail jsonb; result jsonb; denied boolean; pass int:=0; total constant int:=22;
begin
  if not exists(select 1 from public.outlets where id=outlet and name='Friends Corner') then raise exception 'Friends Corner Staging outlet is unavailable.'; end if;
  select role_id into qa_role from public.employees where auth_user_id=qa_admin and is_active;
  if qa_role is null then raise exception 'Crew Admin QA identity is unavailable.'; end if;
  insert into public.role_permissions(role_id,permission_id) select qa_role,id from public.permissions where code in ('crew_operations.view','crew_operations.manage','crew_operations.review') on conflict do nothing;
  select e.id into employee_a from public.employees e join public.crew_access a on a.employee_id=e.id where a.primary_outlet_id=outlet and a.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') order by (e.employee_code like 'QA-%') desc,e.created_at limit 1;
  select e.id into employee_b from public.employees e join public.crew_access a on a.employee_id=e.id where a.primary_outlet_id=outlet and a.access_state='active' and e.is_active and e.id<>employee_a order by (e.employee_code like 'QA-%') desc,e.created_at limit 1;
  if employee_a is null or employee_b is null then raise exception 'Two safe active Friends Corner QA Crew are required for shared checklist verification.'; end if;
  insert into public.crew_sessions(employee_id,token_hash,expires_at) values(employee_a,encode(extensions.digest('operations-test-token-a','sha256'),'hex'),now()+interval '1 hour');
  if employee_b is not null then insert into public.crew_sessions(employee_id,token_hash,expires_at) values(employee_b,encode(extensions.digest('operations-test-token-b','sha256'),'hex'),now()+interval '1 hour'); end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  opening:=public.crew_operations_save_template(outlet,jsonb_build_object('name','Rollback Opening QA','operation_type','opening','effective_date',current_date,'items',jsonb_build_array(jsonb_build_object('title','Unlock guest entrance','is_required',true,'evidence_requirement','none'),jsonb_build_object('title','Check coffee machine','is_required',true,'evidence_requirement','none'))));
  perform public.crew_operations_activate_template(opening); pass:=pass+1;
  health:=public.crew_operations_save_template(outlet,jsonb_build_object('name','Rollback Health QA','operation_type','health','effective_date',current_date,'items',jsonb_build_array(jsonb_build_object('title','Dining floor condition','is_required',true,'health_category','front_of_house'),jsonb_build_object('title','Equipment condition','is_required',false,'health_category','equipment'))));
  perform public.crew_operations_activate_template(health); pass:=pass+1;
  task_id:=public.crew_operations_save_daily_task(outlet,jsonb_build_object('task_date',current_date,'title','Rollback reservation board check','priority','high')); pass:=pass+1;
  payload:=public.crew_operations_admin_data(outlet,current_date);
  execute 'reset role';
  if jsonb_array_length(payload->'instances')<2 then raise exception 'FAIL frozen daily instances'; end if; pass:=pass+1;
  select oi.id into v_instance_id from public.crew_operation_instances oi where oi.template_id=opening and oi.business_date=current_date;
  select oi.id into v_health_instance from public.crew_operation_instances oi where oi.template_id=health and oi.business_date=current_date;
  if (select oi.template_snapshot->>'revision' from public.crew_operation_instances oi where oi.id=v_instance_id)<>'1' then raise exception 'FAIL immutable template snapshot'; end if; pass:=pass+1;

  execute 'set local role anon'; payload:=public.crew_operations_today('operations-test-token-a',current_date); execute 'reset role';
  if payload->'employee'->>'id'<>employee_a::text or payload->'outlet'->>'id'<>outlet::text then raise exception 'FAIL token identity/outlet'; end if; pass:=pass+1;
  if jsonb_array_length(payload->'checklists')<2 or jsonb_array_length(payload->'daily_tasks')<1 then raise exception 'FAIL applicable today payload'; end if; pass:=pass+1;
  execute 'set local role anon'; detail:=public.crew_operations_detail('operations-test-token-a',v_instance_id); execute 'reset role';
  if jsonb_array_length(detail->'items')<>2 or detail ? 'template_snapshot' then raise exception 'FAIL Crew safe detail'; end if; pass:=pass+1;

  denied:=false; execute 'set local role anon'; begin perform public.crew_operations_complete_checklist('operations-test-token-a',v_instance_id); exception when invalid_parameter_value then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL required item gating'; end if; pass:=pass+1;
  select oi.id into item_a from public.crew_operation_instance_items oi where oi.instance_id=v_instance_id order by oi.sort_order limit 1;
  select oi.id into item_b from public.crew_operation_instance_items oi where oi.instance_id=v_instance_id order by oi.sort_order offset 1 limit 1;
  execute 'set local role anon'; result:=public.crew_operations_update_item('operations-test-token-a',item_a,'completed',null,null,null); execute 'reset role';
  if result->>'status'<>'completed' then raise exception 'FAIL item complete'; end if; pass:=pass+1;
  execute 'set local role anon'; result:=public.crew_operations_update_item('operations-test-token-b',item_a,'exception','manager_instruction','Concurrent retry',null); execute 'reset role';
  if coalesce((result->>'idempotent')::boolean,false) is not true or (result->>'completed_by')::uuid<>employee_a then raise exception 'FAIL shared checklist first-writer evidence'; end if; pass:=pass+1;
  execute 'set local role anon'; result:=public.crew_operations_update_item('operations-test-token-a',item_a,'completed',null,null,null); execute 'reset role';
  if coalesce((result->>'idempotent')::boolean,false) is not true then raise exception 'FAIL idempotency'; end if; pass:=pass+1;
  execute 'set local role anon'; result:=public.crew_operations_update_item('operations-test-token-a',item_b,'exception','equipment_issue','Machine needs service',null); execute 'reset role';
  if result->>'instance_status'<>'completed_with_exceptions' then raise exception 'FAIL exception status'; end if; pass:=pass+1;
  execute 'set local role anon'; result:=public.crew_operations_complete_checklist('operations-test-token-a',v_instance_id); execute 'reset role';
  if result->>'status'<>'completed_with_exceptions' then raise exception 'FAIL checklist completion'; end if; pass:=pass+1;
  if (select completed_by from public.crew_operation_instance_items where id=item_a)<>employee_a then raise exception 'FAIL completed_by evidence'; end if; pass:=pass+1;

  select oi.id into health_item from public.crew_operation_instance_items oi where oi.instance_id=v_health_instance and oi.is_required order by oi.sort_order limit 1;
  denied:=false; execute 'set local role anon'; begin perform public.crew_operations_update_item('operations-test-token-a',health_item,'needs_attention',null,null,null); exception when invalid_parameter_value then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL Health note requirement'; end if; pass:=pass+1;
  execute 'set local role anon'; result:=public.crew_operations_update_item('operations-test-token-a',health_item,'needs_attention',null,'Floor requires cleaning',null); execute 'reset role';
  if result->>'status'<>'needs_attention' then raise exception 'FAIL Health result'; end if; pass:=pass+1;
  execute 'set local role anon'; result:=public.crew_operations_update_daily_task('operations-test-token-a',task_id,'completed',null,null); execute 'reset role';
  if result->>'status'<>'completed' then raise exception 'FAIL Daily Task complete'; end if; pass:=pass+1;

  denied:=false; execute 'set local role anon'; begin perform * from public.crew_operation_instances; exception when insufficient_privilege then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL direct table read'; end if; pass:=pass+1;
  denied:=false; begin update public.crew_operation_templates set name='Unsafe rewrite' where id=opening; exception when sqlstate '55000' then denied:=true; end;
  if not denied then raise exception 'FAIL active revision immutability'; end if; pass:=pass+1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-000000000099','role','authenticated')::text,true);
  denied:=false; execute 'set local role authenticated'; begin perform public.crew_operations_admin_data(outlet,current_date); exception when insufficient_privilege then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL unauthorized Admin'; end if; pass:=pass+1;
  select a.primary_outlet_id,e.id into other_outlet,other_employee from public.crew_access a join public.employees e on e.id=a.employee_id where a.primary_outlet_id<>outlet and a.access_state='active' and e.is_active limit 1;
  if other_employee is not null then
    insert into public.crew_sessions(employee_id,token_hash,expires_at) values(other_employee,encode(extensions.digest('operations-test-token-other','sha256'),'hex'),now()+interval '1 hour');
    denied:=false; execute 'set local role anon'; begin perform public.crew_operations_detail('operations-test-token-other',v_instance_id); exception when insufficient_privilege then denied:=true; end; execute 'reset role';
    if not denied then raise exception 'FAIL cross-outlet Crew isolation'; end if;
  end if; pass:=pass+1;
  insert into crew_operations_test_results values(pass,total,jsonb_build_object('opening_instance',v_instance_id,'health_instance',v_health_instance,'crew',employee_a));
  raise notice 'CREW_DAILY_OPERATIONS_BEHAVIOR_PASS %/%',pass,total;
end $$;
table crew_operations_test_results;
rollback;
