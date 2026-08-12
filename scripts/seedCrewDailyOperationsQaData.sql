-- FeedX Daily Operations QA data. STAGING ONLY; never a migration.
-- Idempotent for the current business date and explicit QA Crew only.
begin;
do $$
declare
  qa_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  qa_completed constant uuid := '066594d7-800c-4b61-8de9-9de4efd57fe3';
  qa_attention constant uuid := '841521c8-31d3-4fb0-914b-256188712001';
  qa_role uuid; opening uuid; closing uuid; health uuid; instance uuid; item record; index int; task uuid; sop_version uuid;
  v_business_date date := timezone('Asia/Kuala_Lumpur',now())::date;
  token_completed constant text := 'ops-seed-completed-session'; token_attention constant text := 'ops-seed-attention-session';
  completed_hash text:=encode(extensions.digest(token_completed,'sha256'),'hex'); attention_hash text:=encode(extensions.digest(token_attention,'sha256'),'hex');
begin
  if not exists(select 1 from public.outlets where id=outlet and name='Friends Corner') then raise exception 'Friends Corner Staging outlet is unavailable.'; end if;
  if not exists(select 1 from public.employees where id=qa_completed and employee_code='QA-CREW-CO-01') or not exists(select 1 from public.employees where id=qa_attention and employee_code='QA-CREW-NA-01') then raise exception 'Explicit Staging QA Crew are unavailable.'; end if;
  select role_id into qa_role from public.employees where auth_user_id=qa_admin and is_active;
  if qa_role is null or not exists(select 1 from public.role_outlets where role_id=qa_role and outlet_id=outlet) then raise exception 'Crew Admin QA Friends Corner scope is unavailable.'; end if;
  insert into public.role_permissions(role_id,permission_id) select qa_role,id from public.permissions where code in ('crew_operations.view','crew_operations.manage','crew_operations.review') on conflict do nothing;
  select v.id into sop_version from public.crew_sops s join public.crew_sop_versions v on v.sop_id=s.id where v.status='published' and (s.outlet_id is null or s.outlet_id=outlet) order by (s.title='Workstation Cleanliness') desc,v.version desc limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_admin,'role','authenticated')::text,true);

  select id into opening from public.crew_operation_templates where outlet_id=outlet and name='Opening Checklist' and status='active' order by revision desc limit 1;
  if opening is null then
    execute 'set local role authenticated';
    opening:=public.crew_operations_save_template(outlet,jsonb_build_object('name','Opening Checklist','operation_type','opening','effective_date',v_business_date,'items',jsonb_build_array(
      jsonb_build_object('title','Unlock and inspect guest entrance','description','Confirm doors, entrance lights and welcome signage are ready.','is_required',true),
      jsonb_build_object('title','Switch on dining area lighting','description','Check all guest-facing lights.','is_required',true),
      jsonb_build_object('title','Prepare cashier station','description','Verify POS, receipt paper and float handover.','is_required',true),
      jsonb_build_object('title','Check coffee and beverage equipment','description','Run the opening equipment check.','is_required',true,'evidence_requirement','note'),
      jsonb_build_object('title','Set tables and service stations','description','Prepare menus, cutlery and condiments.','is_required',true),
      jsonb_build_object('title','Inspect guest washroom','description','Confirm cleanliness and supplies.','is_required',true),
      jsonb_build_object('title','Review reservations and special requests','description','Share important notes with the shift team.','is_required',true),
      jsonb_build_object('title','Opening manager handover','description','Optional final readiness review.','is_required',false,'sop_version_id',coalesce(sop_version::text,''))
    )));
    perform public.crew_operations_activate_template(opening);
    execute 'reset role';
  end if;

  select id into closing from public.crew_operation_templates where outlet_id=outlet and name='Closing Checklist' and status='active' order by revision desc limit 1;
  if closing is null then
    execute 'set local role authenticated';
    closing:=public.crew_operations_save_template(outlet,jsonb_build_object('name','Closing Checklist','operation_type','closing','effective_date',v_business_date,'items',jsonb_build_array(
      jsonb_build_object('title','Clear and reset dining tables','is_required',true),jsonb_build_object('title','Clean cashier and service counters','is_required',true),
      jsonb_build_object('title','Complete POS closing check','is_required',true),jsonb_build_object('title','Switch off beverage equipment safely','is_required',true),
      jsonb_build_object('title','Dispose waste and replace liners','is_required',true),jsonb_build_object('title','Restock opening essentials','is_required',true),
      jsonb_build_object('title','Secure windows and guest entrance','is_required',true),jsonb_build_object('title','Closing manager handover','is_required',true)
    )));
    perform public.crew_operations_activate_template(closing);
    execute 'reset role';
  end if;

  select id into health from public.crew_operation_templates where outlet_id=outlet and name='Store Health Check' and status='active' order by revision desc limit 1;
  if health is null then
    execute 'set local role authenticated';
    health:=public.crew_operations_save_template(outlet,jsonb_build_object('name','Store Health Check','operation_type','health','effective_date',v_business_date,'items',jsonb_build_array(
      jsonb_build_object('title','Guest entrance condition','health_category','front_of_house','is_required',true),jsonb_build_object('title','Dining tables and chairs','health_category','front_of_house','is_required',true),
      jsonb_build_object('title','Dining floor cleanliness','health_category','cleanliness','is_required',true),jsonb_build_object('title','Guest washroom cleanliness','health_category','cleanliness','is_required',true),
      jsonb_build_object('title','POS and printer condition','health_category','equipment','is_required',true),jsonb_build_object('title','Beverage equipment condition','health_category','equipment','is_required',true),
      jsonb_build_object('title','Emergency exits clear','health_category','safety','is_required',true),jsonb_build_object('title','Floor and trip hazards','health_category','safety','is_required',true),
      jsonb_build_object('title','Service station stock setup','health_category','stock_setup','is_required',true),jsonb_build_object('title','Takeaway packaging setup','health_category','stock_setup','is_required',false)
    )));
    perform public.crew_operations_activate_template(health);
    execute 'reset role';
  end if;

  for item in select * from (values
    ('Prepare today''s reservation board','high','Confirm bookings, large groups and special requests.'),
    ('Check takeaway packaging level','normal','Top up bags, cups and containers for service.'),
    ('Brief Crew on today''s focus','normal','Share one service and one safety priority.'),
    ('Confirm promotional display','low','Check the current promotion is visible and accurate.')
  ) x(title,priority,description) loop
    if not exists(select 1 from public.crew_daily_tasks where outlet_id=outlet and task_date=v_business_date and crew_daily_tasks.title=item.title) then
      execute 'set local role authenticated';
      perform public.crew_operations_save_daily_task(outlet,jsonb_build_object('task_date',v_business_date,'title',item.title,'priority',item.priority,'description',item.description,'due_at',(v_business_date+time '16:00') at time zone 'Asia/Kuala_Lumpur'));
      execute 'reset role';
    end if;
  end loop;
  for item in select * from (values
    ('Check staff noticeboard','normal','Remove expired notices and confirm today''s updates.'),
    ('Verify handwash supplies','high','Confirm soap and paper supplies are available before service.')
  ) x(title,priority,description) loop
    if not exists(select 1 from public.crew_daily_tasks where outlet_id=outlet and task_date=v_business_date and crew_daily_tasks.title=item.title) then
      execute 'set local role authenticated';
      perform public.crew_operations_save_daily_task(outlet,jsonb_build_object('task_date',v_business_date,'title',item.title,'priority',item.priority,'description',item.description));
      execute 'reset role';
    end if;
  end loop;
  execute 'set local role authenticated';
  perform public.crew_operations_admin_data(outlet,v_business_date);
  execute 'reset role';

  insert into public.crew_sessions(employee_id,token_hash,expires_at) values(qa_completed,completed_hash,now()+interval '1 hour') on conflict(token_hash) do update set employee_id=excluded.employee_id,expires_at=excluded.expires_at,revoked_at=null;
  insert into public.crew_sessions(employee_id,token_hash,expires_at) values(qa_attention,attention_hash,now()+interval '1 hour') on conflict(token_hash) do update set employee_id=excluded.employee_id,expires_at=excluded.expires_at,revoked_at=null;

  -- Completed Closing scenario.
  select id into instance from public.crew_operation_instances where template_id=closing and business_date=v_business_date;
  for item in select id from public.crew_operation_instance_items where instance_id=instance order by sort_order loop execute 'set local role anon'; perform public.crew_operations_update_item(token_completed,item.id,'completed',null,null,null); execute 'reset role'; end loop;
  execute 'set local role anon'; perform public.crew_operations_complete_checklist(token_completed,instance); execute 'reset role';

  -- Opening contains Completed + Exception + Pending states.
  select id into instance from public.crew_operation_instances where template_id=opening and business_date=v_business_date;
  index:=0;
  for item in select id from public.crew_operation_instance_items where instance_id=instance order by sort_order loop
    index:=index+1;
    if index<=4 then execute 'set local role anon'; perform public.crew_operations_update_item(token_completed,item.id,'completed',null,case when index=4 then 'Machine opening check completed' else null end,null); execute 'reset role';
    elsif index=5 then execute 'set local role anon'; perform public.crew_operations_update_item(token_attention,item.id,'exception','stock_unavailable','Condiment refill pending delivery',null); execute 'reset role'; end if;
  end loop;

  -- Health contains Good + Needs Attention + Not Checked/Pending states.
  select id into instance from public.crew_operation_instances where template_id=health and business_date=v_business_date;
  index:=0;
  for item in select id from public.crew_operation_instance_items where instance_id=instance order by sort_order loop
    index:=index+1;
    if index<=3 then execute 'set local role anon'; perform public.crew_operations_update_item(token_completed,item.id,'good',null,null,null); execute 'reset role';
    elsif index=4 then execute 'set local role anon'; perform public.crew_operations_update_item(token_attention,item.id,'needs_attention',null,'Soap dispenser needs refill',null); execute 'reset role'; end if;
  end loop;

  select id into task from public.crew_daily_tasks where outlet_id=outlet and task_date=v_business_date and title='Prepare today''s reservation board'; execute 'set local role anon'; perform public.crew_operations_update_daily_task(token_completed,task,'completed',null,'Board updated before service'); execute 'reset role';
  select id into task from public.crew_daily_tasks where outlet_id=outlet and task_date=v_business_date and title='Check takeaway packaging level'; execute 'set local role anon'; perform public.crew_operations_update_daily_task(token_attention,task,'exception','stock_unavailable','Large cup lids are awaiting delivery'); execute 'reset role';
  delete from public.crew_sessions where token_hash in (completed_hash,attention_hash);
end $$;
commit;
