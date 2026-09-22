-- FeedX Crew unified Task sample library.
-- STAGING ONLY. This is reusable QA seed data, never a production migration.
-- Idempotency key: Friends Corner + exact [QA] task name + active/draft status.

begin;

create or replace function pg_temp.seed_crew_sample_task(p_outlet_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_payload jsonb := p_payload;
begin
  select t.id
    into v_id
  from public.crew_operation_templates t
  where t.outlet_id = p_outlet_id
    and t.name = p_payload->>'name'
    and t.status = 'active'
  order by t.revision desc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select t.id
    into v_id
  from public.crew_operation_templates t
  where t.outlet_id = p_outlet_id
    and t.name = p_payload->>'name'
    and t.status = 'draft'
  order by t.revision desc
  limit 1;

  if v_id is not null then
    v_payload := jsonb_set(v_payload, '{id}', to_jsonb(v_id::text), true);
  end if;

  v_id := public.crew_tasks_save(p_outlet_id, v_payload);
  perform public.crew_operations_activate_template(v_id);
  return v_id;
end;
$$;

do $$
declare
  v_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  v_outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  v_today date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_future date := timezone('Asia/Kuala_Lumpur', now())::date + 3;
  v_qa_employee uuid;
  v_service_position text;
  v_kitchen_position text;
  v_supervisor_position text;
  v_cashier_position text;
  v_opening_sop uuid;
  v_cleaning_sop uuid;
  v_general_sop uuid;
  v_blocks jsonb;
begin
  if not exists (
    select 1 from public.outlets
    where id = v_outlet and name = 'Friends Corner' and is_active
  ) then
    raise exception 'Friends Corner Staging outlet is unavailable.';
  end if;

  select e.id, e.position
    into v_qa_employee, v_service_position
  from public.employees e
  join public.crew_access ca on ca.employee_id = e.id
  where ca.primary_outlet_id = v_outlet
    and ca.access_state = 'active'
    and e.is_active
    and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
    and e.employee_code like 'QA-%'
    and lower(coalesce(e.position, '')) like '%service%'
  order by (e.employee_code = 'QA-CREW-NS-01') desc, e.created_at
  limit 1;

  if v_qa_employee is null then
    raise exception 'A safe active Friends Corner QA Crew employee is required.';
  end if;

  select e.position
    into v_kitchen_position
  from public.employees e
  join public.crew_access ca on ca.employee_id = e.id
  where ca.primary_outlet_id = v_outlet
    and ca.access_state = 'active'
    and e.is_active
    and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
    and lower(coalesce(e.position, '')) similar to '%(kitchen|cook|chef)%'
  order by e.created_at
  limit 1;

  select e.position
    into v_supervisor_position
  from public.employees e
  join public.crew_access ca on ca.employee_id = e.id
  where ca.primary_outlet_id = v_outlet
    and ca.access_state = 'active'
    and e.is_active
    and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
    and lower(coalesce(e.position, '')) similar to '%(supervisor|manager|captain)%'
  order by e.created_at
  limit 1;

  select e.position
    into v_cashier_position
  from public.employees e
  join public.crew_access ca on ca.employee_id = e.id
  where ca.primary_outlet_id = v_outlet
    and ca.access_state = 'active'
    and e.is_active
    and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
    and lower(coalesce(e.position, '')) like '%cashier%'
  order by e.created_at
  limit 1;

  v_kitchen_position := coalesce(v_kitchen_position, v_service_position);
  v_supervisor_position := coalesce(v_supervisor_position, v_service_position);
  v_cashier_position := coalesce(v_cashier_position, v_service_position);

  select v.id into v_opening_sop
  from public.crew_sops s
  join public.crew_sop_versions v on v.sop_id = s.id
  where v.status = 'published'
    and (s.outlet_id is null or s.outlet_id = v_outlet)
  order by (lower(s.title) like '%opening%') desc, v.version desc
  limit 1;

  select v.id into v_cleaning_sop
  from public.crew_sops s
  join public.crew_sop_versions v on v.sop_id = s.id
  where v.status = 'published'
    and (s.outlet_id is null or s.outlet_id = v_outlet)
  order by (lower(s.title) similar to '%(clean|workstation)%') desc, v.version desc
  limit 1;

  select v.id into v_general_sop
  from public.crew_sops s
  join public.crew_sop_versions v on v.sop_id = s.id
  where v.status = 'published'
    and (s.outlet_id is null or s.outlet_id = v_outlet)
  order by v.version desc, s.title
  limit 1;

  if v_general_sop is null then
    raise exception 'At least one published Friends Corner SOP is required.';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  if not public.current_user_has_permission('crew_operations.manage')
     or not public.current_user_can_access_outlet(v_outlet) then
    raise exception 'Crew Admin QA lacks crew_operations.manage or Friends Corner scope.';
  end if;

  v_blocks := jsonb_build_array(
    jsonb_build_object('block_type','checklist_item','title','Unlock entrance','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
    jsonb_build_object('block_type','checklist_item','title','Switch on dining lights','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
    jsonb_build_object('block_type','checklist_item','title','Prepare cashier/POS area','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
    jsonb_build_object('block_type','checklist_item','title','Check table cleanliness','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
    jsonb_build_object('block_type','checklist_item','title','Confirm condiment station ready','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
    jsonb_build_object('block_type','key_point','title','Opening readiness','description','Guest-facing areas must be ready before opening.','is_required',false,'evidence_requirement','none','config','{}'::jsonb)
  );
  if v_opening_sop is not null then
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('block_type','sop_reference','title','Review opening standard','sop_version_id',v_opening_sop,'is_required',false,'evidence_requirement','none','config','{}'::jsonb));
  end if;
  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] Opening Checklist','task_type','checklist','schedule_type','recurring','effective_date',v_today,
    'start_time','09:30','due_time','10:00','schedule_config',jsonb_build_object('frequency','every_day'),
    'assignment_type','all_crew','applicable_positions','[]'::jsonb,'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',true,
    'priority','important','completion_rule','one_for_team','allow_exception',true,'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,'blocks',v_blocks
  ));

  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] Closing Checklist','task_type','checklist','schedule_type','shift_based','effective_date',v_today,
    'schedule_config',jsonb_build_object('shift_phase','end_of_shift'),
    'assignment_type','all_crew','applicable_positions','[]'::jsonb,'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',true,
    'priority','important','completion_rule','one_for_team','allow_exception',true,'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','checklist_item','title','Clean dining area','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Switch off non-essential equipment','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Confirm rubbish disposed','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Refill next-day essentials','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Lock entrance','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','confirmation','title','Closing completed','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','key_point','title','Closing handover','description','Report unresolved issues before leaving.','is_required',false,'evidence_requirement','none','config','{}'::jsonb)
    )
  ));

  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] Fridge Temperature Check','task_type','health_check','schedule_type','recurring','effective_date',v_today,
    'start_time','10:00','due_time','10:30','schedule_config',jsonb_build_object('frequency','every_day'),
    'assignment_type','position','applicable_positions',jsonb_build_array(v_kitchen_position),'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','critical','completion_rule','any_assigned','allow_exception',true,'exception_requires_reason',true,'manager_review_required',true,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','text','title','Check chiller before service','description','Check all cold-storage equipment before food preparation begins.','is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','temperature','title','Chiller 1','is_required',true,'evidence_requirement','none','config',jsonb_build_object('min',0,'max',4,'unit','°C')),
      jsonb_build_object('block_type','temperature','title','Freezer','is_required',true,'evidence_requirement','none','config',jsonb_build_object('max',-18,'unit','°C')),
      jsonb_build_object('block_type','yes_no','title','Any unusual smell or leakage?','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','short_text','title','Corrective action if outside range','is_required',true,'evidence_requirement','none','config','{}'::jsonb)
    )
  ));

  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] Store Health Check','task_type','health_check','schedule_type','recurring','effective_date',v_today,
    'start_time','15:00','due_time','16:00','schedule_config',jsonb_build_object('frequency','every_day'),
    'assignment_type','position','applicable_positions',jsonb_build_array(v_supervisor_position),'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','normal','completion_rule','one_for_team','allow_exception',true,'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','health_rating','title','Floor','health_category','cleanliness','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','health_rating','title','Restroom','health_category','cleanliness','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','health_rating','title','Service Area','health_category','front_of_house','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','health_rating','title','Counter','health_category','front_of_house','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','health_rating','title','Kitchen visible area','health_category','cleanliness','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','health_rating','title','Supplies','health_category','stock_setup','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','health_rating','title','Equipment condition','health_category','equipment','is_required',true,'evidence_requirement','none','config','{}'::jsonb)
    )
  ));

  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] Customer Complaint Follow-up','task_type','instruction','schedule_type','one_time','effective_date',v_today,
    'start_time','00:00','due_time','23:59','schedule_config','{}'::jsonb,
    'assignment_type','specific_crew','applicable_positions','[]'::jsonb,'applicable_employee_ids',jsonb_build_array(v_qa_employee),'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','important','completion_rule','every_assigned','allow_exception',true,'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','text','title','Follow up on guest complaint','description','Review the complaint and contact the guest using the approved service recovery approach.','is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','short_text','title','What happened?','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','single_choice','title','Outcome','is_required',true,'evidence_requirement','none','config',jsonb_build_object('options',jsonb_build_array('Resolved','Follow-up needed','Escalated'))),
      jsonb_build_object('block_type','short_text','title','Action taken','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','confirmation','title','Guest follow-up completed','is_required',true,'evidence_requirement','none','config','{}'::jsonb)
    )
  ));

  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] Cashier Float Verification','task_type','confirmation','schedule_type','shift_based','effective_date',v_today,
    'schedule_config',jsonb_build_object('shift_phase','start_of_shift'),
    'assignment_type','position','applicable_positions',jsonb_build_array(v_cashier_position),'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',true,
    'priority','critical','completion_rule','every_assigned','allow_exception',true,'exception_requires_reason',true,'manager_review_required',true,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','number','title','Opening cash float','is_required',true,'evidence_requirement','none','config',jsonb_build_object('min',0,'unit','RM')),
      jsonb_build_object('block_type','yes_no','title','Float matches expected amount?','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','short_text','title','Difference reason','is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','confirmation','title','Cash drawer verified','is_required',true,'evidence_requirement','none','config','{}'::jsonb)
    )
  ));

  v_blocks := jsonb_build_array(
    jsonb_build_object('block_type','text','title','Cleaning instruction','description','Follow safe shutdown and cleaning steps before touching the machine.','is_required',false,'evidence_requirement','none','config','{}'::jsonb),
    jsonb_build_object('block_type','checklist_item','title','Flush group heads','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
    jsonb_build_object('block_type','checklist_item','title','Clean steam wand','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
    jsonb_build_object('block_type','checklist_item','title','Wash drip tray','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
    jsonb_build_object('block_type','checklist_item','title','Wipe exterior','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
    jsonb_build_object('block_type','yes_no','title','Machine functioning normally?','is_required',true,'evidence_requirement','none','config','{}'::jsonb)
  );
  if v_cleaning_sop is not null then
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('block_type','sop_reference','title','Review cleaning SOP','sop_version_id',v_cleaning_sop,'is_required',false,'evidence_requirement','none','config','{}'::jsonb));
  end if;
  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] Coffee Machine Cleaning','task_type','checklist','schedule_type','recurring','effective_date',v_today,
    'start_time','16:00','due_time','17:00','schedule_config',jsonb_build_object('frequency','specific_weekdays','weekdays',jsonb_build_array(1,2,3,4,5)),
    'assignment_type','position','applicable_positions',jsonb_build_array(v_service_position),'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','normal','completion_rule','any_assigned','allow_exception',true,'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,'blocks',v_blocks
  ));

  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] Stock Shelving','task_type','checklist','schedule_type','recurring','effective_date',v_today,
    'start_time','11:00','due_time','12:00','schedule_config',jsonb_build_object('frequency','every_day'),
    'assignment_type','all_crew','applicable_positions','[]'::jsonb,'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',true,
    'priority','normal','completion_rule','one_for_team','allow_exception',true,'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','checklist_item','title','Beverage station','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Cutlery','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Tissue','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Takeaway packaging','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','number','title','Missing critical items count','is_required',true,'evidence_requirement','none','config',jsonb_build_object('min',0,'unit','items')),
      jsonb_build_object('block_type','short_text','title','Missing item note','is_required',false,'evidence_requirement','none','config','{}'::jsonb)
    )
  ));

  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] New Menu Briefing','task_type','sop_review','schedule_type','one_time','effective_date',v_future,
    'start_time','09:00','due_time','18:00','schedule_config','{}'::jsonb,
    'assignment_type','all_crew','applicable_positions','[]'::jsonb,'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','important','completion_rule','every_assigned','allow_exception',false,'exception_requires_reason',false,'manager_review_required',false,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','text','title','New menu launch information','description','Review the launch date, key products and guest communication points.','is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','key_point','title','Effective date','description',('New menu becomes effective on ' || v_future::text || '.'),'is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','sop_reference','title','Review related published SOP','sop_version_id',v_general_sop,'is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','yes_no','title','I understand the new procedure','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','confirmation','title','Briefing acknowledged','is_required',true,'evidence_requirement','none','config','{}'::jsonb)
    )
  ));

  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] Pest Safety Incident Check','task_type','health_check','schedule_type','one_time','effective_date',v_today,
    'start_time','00:00','due_time','23:59','schedule_config','{}'::jsonb,
    'assignment_type','position','applicable_positions',jsonb_build_array(v_supervisor_position),'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','critical','completion_rule','any_assigned','allow_exception',true,'exception_requires_reason',true,'manager_review_required',true,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','yes_no','title','Pest activity observed?','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','single_choice','title','Severity','is_required',true,'evidence_requirement','none','config',jsonb_build_object('options',jsonb_build_array('None','Minor','Significant'))),
      jsonb_build_object('block_type','short_text','title','Location','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','short_text','title','Immediate action taken','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','confirmation','title','Escalation completed','is_required',true,'evidence_requirement','none','config','{}'::jsonb)
    )
  ));

  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] Weekly Deep Cleaning','task_type','checklist','schedule_type','recurring','effective_date',v_today,
    'start_time','14:00','due_time','17:00','schedule_config',jsonb_build_object('frequency','specific_weekdays','weekdays',jsonb_build_array(1)),
    'assignment_type','position','applicable_positions',jsonb_build_array(v_service_position),'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','important','completion_rule','one_for_team','allow_exception',true,'exception_requires_reason',true,'manager_review_required',false,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','checklist_item','title','Clean fan','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Clean walls','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Clean under tables','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Clean shelving','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Clean fridge exterior','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Clean storage corner','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Clean drains','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Clean glass and doors','is_required',true,'evidence_requirement','none','config','{}'::jsonb)
    )
  ));

  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] Monthly Equipment Inspection','task_type','health_check','schedule_type','recurring','effective_date',v_today,
    'start_time','10:00','due_time','18:00','schedule_config',jsonb_build_object('frequency','monthly','day',extract(day from v_today)::int),
    'assignment_type','position','applicable_positions',jsonb_build_array(v_supervisor_position),'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','important','completion_rule','any_assigned','allow_exception',true,'exception_requires_reason',true,'manager_review_required',true,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','health_rating','title','Coffee machine','health_category','equipment','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','health_rating','title','Chiller','health_category','equipment','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','health_rating','title','Freezer','health_category','equipment','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','health_rating','title','POS equipment','health_category','equipment','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','health_rating','title','Lighting','health_category','equipment','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','short_text','title','Maintenance required','is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','confirmation','title','Inspection completed','is_required',true,'evidence_requirement','none','config','{}'::jsonb)
    )
  ));

  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] SOP Acknowledgement Task','task_type','sop_review','schedule_type','one_time','effective_date',v_today,
    'start_time','00:00','due_time','23:59','schedule_config','{}'::jsonb,
    'assignment_type','specific_crew','applicable_positions','[]'::jsonb,'applicable_employee_ids',jsonb_build_array(v_qa_employee),'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','important','completion_rule','every_assigned','allow_exception',false,'exception_requires_reason',false,'manager_review_required',false,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','sop_reference','title','Read the current published SOP','sop_version_id',v_general_sop,'is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','key_point','title','Important reminder','description','Apply the published procedure exactly as shown.','is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','yes_no','title','Have you read and understood this SOP?','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','confirmation','title','SOP acknowledgement confirmed','is_required',true,'evidence_requirement','none','config','{}'::jsonb)
    )
  ));

  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] Simple Reminder Task','task_type','instruction','schedule_type','one_time','effective_date',v_today,
    'start_time','14:30','due_time','15:30','schedule_config','{}'::jsonb,
    'assignment_type','all_crew','applicable_positions','[]'::jsonb,'applicable_employee_ids','[]'::jsonb,'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','normal','completion_rule','any_assigned','allow_exception',false,'exception_requires_reason',false,'manager_review_required',false,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','text','title','Team briefing','description','Team briefing at 3:00 PM near the counter.','is_required',false,'evidence_requirement','none','config','{}'::jsonb)
    )
  ));

  perform pg_temp.seed_crew_sample_task(v_outlet, jsonb_build_object(
    'name','[QA] Complex 15-block QA Task','task_type','health_check','schedule_type','one_time','effective_date',v_today,
    'start_time','00:00','due_time','23:59','schedule_config','{}'::jsonb,
    'assignment_type','specific_crew','applicable_positions','[]'::jsonb,'applicable_employee_ids',jsonb_build_array(v_qa_employee),'applicable_group_names','[]'::jsonb,'on_duty_only',false,
    'priority','important','completion_rule','every_assigned','allow_exception',true,'exception_requires_reason',true,'manager_review_required',true,'allow_late_completion',true,
    'blocks',jsonb_build_array(
      jsonb_build_object('block_type','text','title','Complex task introduction','description','Complete each required field to verify the full Crew Task renderer.','is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','key_point','title','Safety first','description','Stop and record an exception if any unsafe condition is found.','is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Inspect entrance','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Inspect counter','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','checklist_item','title','Inspect service station','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','yes_no','title','Guest area ready?','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','single_choice','title','Overall readiness','is_required',true,'evidence_requirement','none','config',jsonb_build_object('options',jsonb_build_array('Ready','Needs attention','Not ready'))),
      jsonb_build_object('block_type','number','title','Missing supply count','is_required',true,'evidence_requirement','none','config',jsonb_build_object('min',0,'max',99,'unit','items')),
      jsonb_build_object('block_type','temperature','title','Chiller reading','is_required',true,'evidence_requirement','none','config',jsonb_build_object('min',0,'max',4,'unit','°C')),
      jsonb_build_object('block_type','short_text','title','Observation note','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','health_rating','title','Floor condition','health_category','cleanliness','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','health_rating','title','Equipment condition','health_category','equipment','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','sop_reference','title','Pinned published SOP','sop_version_id',v_general_sop,'is_required',false,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','confirmation','title','Supervisor informed if needed','is_required',true,'evidence_requirement','none','config','{}'::jsonb),
      jsonb_build_object('block_type','confirmation','title','Complex QA task completed','is_required',true,'evidence_requirement','none','config','{}'::jsonb)
    )
  ));

  perform public.crew_tasks_admin_data(v_outlet, v_today, v_today + 7);
  execute 'reset role';
end;
$$;

select jsonb_build_object(
  'target', 'fnb-system-staging',
  'outlet', 'Friends Corner',
  'active_sample_tasks', count(*),
  'sample_task_names', jsonb_agg(t.name order by t.name),
  'positions_used', (
    select jsonb_agg(distinct position)
    from public.crew_operation_templates x,
         unnest(x.applicable_positions) position
    where x.outlet_id = 'e804c48d-6343-4bf8-99d7-9893c473948f'::uuid
      and x.status = 'active'
      and x.name like '[QA] %'
  )
) as seed_result
from public.crew_operation_templates t
where t.outlet_id = 'e804c48d-6343-4bf8-99d7-9893c473948f'::uuid
  and t.status = 'active'
  and t.name in (
    '[QA] Opening Checklist','[QA] Closing Checklist','[QA] Fridge Temperature Check','[QA] Store Health Check',
    '[QA] Customer Complaint Follow-up','[QA] Cashier Float Verification','[QA] Coffee Machine Cleaning','[QA] Stock Shelving',
    '[QA] New Menu Briefing','[QA] Pest Safety Incident Check','[QA] Weekly Deep Cleaning','[QA] Monthly Equipment Inspection',
    '[QA] SOP Acknowledgement Task','[QA] Simple Reminder Task','[QA] Complex 15-block QA Task'
  );

commit;
