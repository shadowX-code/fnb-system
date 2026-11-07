-- Keep Draft execution receipts fast. Read current financial evidence separately.
CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_run_calculate_core(p_machine uuid, p_run_id uuid, p_only_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=case when p_machine is null then public.payroll_admin_actor() else null end; v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_employee_id uuid; v_projection jsonb;
  v_members uuid[]; v_latest public.payroll_run_calculation_versions%rowtype;
  v_created integer:=0; v_unchanged integer:=0; v_blocked integer:=0;
begin
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not (case when p_machine is null then public.payroll_can_recalculate_entity(v_period.legal_entity_id) else feedx_integrations.hr_actor_entity(p_machine,v_period.legal_entity_id,'payroll.prepare') end) then
    raise exception using errcode='42501',message='Payroll calculation authority denied.';
  end if;
  if v_run.foundation_only or v_run.status not in ('draft','review_required') then
    raise exception using errcode='55000',message='Only an open calculation Run can be recalculated.';
  end if;
  select coalesce(array_agg(employee_id order by employee_id),'{}'::uuid[]) into v_members from public.payroll_run_employee_ids(p_run_id);
  if p_only_employee_id is not null and not (p_only_employee_id=any(v_members)) then
    raise exception using errcode='42501',message='Employee is not included in this Payroll Run.';
  end if;
  for v_employee_id in select id from unnest(v_members) id where p_only_employee_id is null or id=p_only_employee_id loop
    v_projection:=public.payroll_calculation_project(p_run_id,v_employee_id);
    select * into v_latest from public.payroll_run_calculation_versions
      where run_id=p_run_id and employee_id=v_employee_id order by revision desc limit 1 for update;
    -- Review evidence is not a completed financial version. Keep the last valid version.
    if not public.payroll_calculation_has_totals(v_projection) then
      v_blocked:=v_blocked+1; continue;
    end if;
    if v_latest.id is not null and v_latest.input_fingerprint=v_projection->>'input_fingerprint' then
      v_unchanged:=v_unchanged+1; continue;
    end if;
    perform set_config('feedx.payroll_command','yes',true);
    insert into public.payroll_run_calculation_versions
      (run_id,employee_id,revision,supersedes_id,input_fingerprint,status,pay_basis,
       basic_or_hours,lines,issues,inputs,gross_earnings,non_statutory_deductions,
       reimbursements,pre_statutory_pay,calculated_by_employee_id,calculated_by_machine_id)
    values(p_run_id,v_employee_id,coalesce(v_latest.revision,0)+1,v_latest.id,
      v_projection->>'input_fingerprint',v_projection->>'status',v_projection->>'pay_basis',
      v_projection->>'basic_or_hours',v_projection->'lines',
      array(select jsonb_array_elements_text(v_projection->'issues')),
      v_projection->'inputs',(v_projection->>'gross_earnings')::numeric,
      (v_projection->>'non_statutory_deductions')::numeric,
      (v_projection->>'reimbursements')::numeric,
      (v_projection->>'pre_statutory_pay')::numeric,v_actor,p_machine);
    v_created:=v_created+1;
  end loop;
  if v_created>0 then
    insert into public.payroll_events(event_type,run_id,actor_employee_id,actor_machine_id,details)
    values('run_calculated',p_run_id,v_actor,p_machine,
      jsonb_build_object('new_versions',v_created,'unchanged',v_unchanged));
  end if;
  return jsonb_build_object('created',v_created,'unchanged',v_unchanged,'blocked',v_blocked);
end; $function$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_run_statutory_calculate_core(p_machine uuid, p_run_id uuid, p_only_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=case when p_machine is null then public.payroll_admin_actor() else null end; v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_employee_id uuid; v_project jsonb;
  v_members uuid[]; v_latest public.payroll_run_statutory_versions%rowtype; v_created integer:=0; v_unchanged integer:=0; v_blocked integer:=0;
begin
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not (case when p_machine is null then public.payroll_can_recalculate_entity(v_period.legal_entity_id) else feedx_integrations.hr_actor_entity(p_machine,v_period.legal_entity_id,'payroll.prepare') end) then
    raise exception using errcode='42501',message='Payroll statutory calculation authority denied.';
  end if;
  if v_run.foundation_only or v_run.status not in ('draft','review_required') then
    raise exception using errcode='55000',message='Only an open Payroll Run can calculate statutory results.';
  end if;
  select coalesce(array_agg(employee_id order by employee_id),'{}'::uuid[]) into v_members from public.payroll_run_employee_ids(p_run_id);
  if p_only_employee_id is not null and not (p_only_employee_id=any(v_members)) then
    raise exception using errcode='42501',message='Employee is not included in this Payroll Run.';
  end if;
  for v_employee_id in select id from unnest(v_members) id where p_only_employee_id is null or id=p_only_employee_id loop
    -- Never calculate contributions from a retained but superseded wage result.
    if not public.payroll_calculation_has_totals(public.payroll_calculation_project(p_run_id,v_employee_id)) then
      v_blocked:=v_blocked+1; continue;
    end if;
    v_project:=public.payroll_statutory_project(p_run_id,v_employee_id);
    select * into v_latest from public.payroll_run_statutory_versions
      where run_id=p_run_id and employee_id=v_employee_id order by revision desc limit 1 for update;
    if v_latest.id is not null and v_latest.input_fingerprint=v_project->>'input_fingerprint' then
      v_unchanged:=v_unchanged+1; continue;
    end if;
    perform set_config('feedx.payroll_command','yes',true);
    insert into public.payroll_run_statutory_versions(run_id,employee_id,revision,supersedes_id,
      calculation_version_id,input_fingerprint,status,lines,issues,inputs,gross_earnings,
      non_statutory_deductions,reimbursements,net_pay,employer_statutory_cost,
      total_employer_cost,calculated_by_employee_id,calculated_by_machine_id)
    values(p_run_id,v_employee_id,coalesce(v_latest.revision,0)+1,v_latest.id,
      (v_project->>'calculation_version_id')::uuid,v_project->>'input_fingerprint',v_project->>'status',
      v_project->'lines',array(select jsonb_array_elements_text(v_project->'issues')),
      v_project->'inputs',(v_project->>'gross_earnings')::numeric,
      (v_project->>'non_statutory_deductions')::numeric,(v_project->>'reimbursements')::numeric,
      (v_project->>'net_pay')::numeric,(v_project->>'employer_statutory_cost')::numeric,
      (v_project->>'total_employer_cost')::numeric,v_actor,p_machine);
    v_created:=v_created+1;
  end loop;
  if v_created>0 then
    insert into public.payroll_events(event_type,run_id,actor_employee_id,actor_machine_id,details)
    values('run_statutory_calculated',p_run_id,v_actor,p_machine,
      jsonb_build_object('new_versions',v_created,'unchanged',v_unchanged));
  end if;
  return jsonb_build_object('created',v_created,'unchanged',v_unchanged,'blocked',v_blocked);
end; $function$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_run_preparation_read(p_machine uuid, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_member record; v_projection jsonb; v_setup jsonb; v_employment jsonb; v_rows jsonb:='[]'::jsonb;
begin
  if p_machine is null then perform public.payroll_admin_actor();end if;
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not feedx_integrations.hr_actor_entity(p_machine,v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority denied.';
  end if;
  for v_member in select m.employee_id,p.id profile_id from public.payroll_run_employee_ids(p_run_id) m
    left join public.payroll_profiles p on p.employee_id=m.employee_id loop
    -- Machine company-wide View was checked above, and this loop only receives canonical members.
    if p_machine is null then
    if (v_run.status in ('finalized','paid')
        and not public.payroll_can_access_employee(v_member.employee_id,'payroll.view'))
      or (v_run.status not in ('finalized','paid')
        and not public.payroll_can_access_run_employee(p_run_id,v_member.employee_id,'payroll.view')) then
      raise exception using errcode='42501',message='Payroll Run employee view authority denied.';
    end if;
    end if;
    if v_run.status in ('finalized','paid') then
      select s.calculation into v_projection from public.payroll_run_calculation_snapshots s
        where s.run_id=p_run_id and s.employee_id=v_member.employee_id;
      v_setup:=null; v_employment:=null;
    else
      v_projection:=public.payroll_calculation_project(p_run_id,v_member.employee_id);
      -- Statutory setup internals remain Human-only; canonical statutory calculation/readiness is shared.
      v_setup:=case when p_machine is null and v_member.profile_id is not null then
        public.payroll_statutory_setup_resolve(v_member.profile_id,
          public.payroll_employee_period_start(p_run_id,v_member.employee_id),null) else null end;
      v_employment:=public.payroll_period_employment_resolve(v_member.employee_id,v_period.id);
    end if;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('employee_id',v_member.employee_id,
      'projection',v_projection,'statutory_setup',v_setup,'employment',v_employment,
      'time_review',coalesce(v_projection->'time_review','[]'::jsonb),
      'time_exception_count',(select count(*) from jsonb_array_elements(coalesce(v_projection->'time_review','[]'::jsonb)) day
        where (day->>'required')::boolean and day->>'state'<>'ready'),
      'time_relevant',exists(select 1 from jsonb_array_elements(coalesce(v_projection->'time_review','[]'::jsonb)) day
        where (day->>'required')::boolean and day->>'state'<>'ready')));
  end loop;
  return jsonb_build_object('results',v_rows,'employment_population',case when v_run.status in ('finalized','paid') then null else
      jsonb_build_object('unresolved_count',(select count(*) from public.payroll_period_population_gaps(v_period.id)),
        'records',coalesce((select jsonb_agg(jsonb_build_object('employee_id',g.employee_id,
          'employee_name',e.full_name,'date_from',g.date_from,'date_to',g.date_to,
          'employment',jsonb_build_object('state','review_required','issue',g.issue,'missing_field',g.missing_field)))
          from public.payroll_period_population_gaps(v_period.id) g join public.employees e on e.id=g.employee_id
          where case when p_machine is null then public.payroll_can_access_employee(g.employee_id,'payroll.view') else feedx_integrations.hr_actor_employee(p_machine,g.employee_id) end), '[]'::jsonb)) end,'period_start',v_period.period_start,
    'period_end',v_period.period_end,'employment_issue',
    case when v_run.status in ('finalized','paid') then null
      else public.payroll_period_employment_scope_issue(v_period.id) end);
end $function$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_run_time_readiness(p_machine uuid, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r payroll_runs%rowtype; period payroll_periods%rowtype; member record;
 day date; source jsonb; t payroll_payable_time_versions%rowtype; requirement jsonb;
 hourly integer:=0; required integer:=0; missing integer:=0; stale integer:=0; unresolved integer:=0; future boolean;
begin
 if p_machine is null then perform payroll_admin_actor();end if; select * into r from payroll_runs where id=p_run_id;
 if r.id is null then raise exception using errcode='P0002',message='Payroll run not found.';end if;
 select * into period from payroll_periods where id=r.period_id;
 if not feedx_integrations.hr_actor_entity(p_machine,period.legal_entity_id,'payroll.view') then
  raise exception using errcode='42501',message='Payroll Run view authority required.';end if;
 if r.status in ('finalized','paid') then
  return jsonb_build_object('ready',true,'frozen',true,'required_days',0,'unreconciled',0,'stale',0,'unresolved',0,'period_in_progress',false);
 end if;
 for member in select m.employee_id,p.id profile_id from payroll_run_employee_ids(r.id) m
  join payroll_profiles p on p.employee_id=m.employee_id loop
  if p_machine is null then
   if not payroll_can_access_run_employee(r.id,member.employee_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run employee view authority denied.';end if;
  end if;
  for day in select generate_series(period.period_start,period.period_end,interval '1 day')::date loop
   source:=payroll_time_evidence(member.employee_id,day);
   if source is null or source->>'legal_entity_id' is distinct from period.legal_entity_id::text then continue;end if;
   if source->>'pay_basis'='hourly' then hourly:=hourly+1;end if;
   select * into t from payroll_payable_time_versions where profile_id=member.profile_id and work_date=day order by revision desc limit 1;
   requirement:=payroll_time_requirement(source,to_jsonb(t));
   if not (requirement->>'required')::boolean then continue;end if;
   required:=required+1;
   case requirement->>'state'
    when 'unreconciled' then missing:=missing+1;
    when 'source_updated' then stale:=stale+1;
    when 'review_required' then unresolved:=unresolved+1;
    else null;
   end case;
  end loop;
 end loop;
 future:=hourly>0 and period.period_end>=timezone('Asia/Kuala_Lumpur',now())::date;
 return jsonb_build_object('ready',not future and missing=0 and stale=0 and unresolved=0,
  'hourly_profile_days',hourly,'required_days',required,'unreconciled',missing,'stale',stale,'unresolved',unresolved,'period_in_progress',future);
end $function$;

CREATE OR REPLACE FUNCTION public.factory_agent_execute_action(p_token text, p_request_id uuid, p_action text, p_target_id uuid, p_expected_version text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare m uuid; a feedx_integrations.factory_actions%rowtype; req feedx_integrations.factory_action_requests%rowtype;
 before_value jsonb; after_value jsonb; result jsonb; v_id uuid; role_id_value uuid; fingerprint text; canonical_request uuid;
begin
 if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>65536 then
 raise exception using errcode='22023',message='Request ID and bounded action input are required.';end if;
 m:=feedx_integrations.factory_action_authorize(p_token,p_action);
 select role_id into role_id_value from feedx_integrations.machine_identities where id=m;
 -- Coordinate with access changes; reauthorize after acquiring the same role lock.
 perform pg_advisory_xact_lock(hashtext('role_configuration:'||role_id_value::text));
 perform 1 from feedx_integrations.machine_identities where id=m for update;
 if feedx_integrations.factory_action_authorize(p_token,p_action)<>m or
  (select role_id from feedx_integrations.machine_identities where id=m) is distinct from role_id_value then
 raise exception using errcode='40001',message='Agent access changed. Retry after reviewing access.';end if;
 select * into strict a from feedx_integrations.factory_actions where key=p_action;
 if (a.target_required and p_target_id is null) or (not a.target_required and p_target_id is not null) then
 raise exception using errcode='22023',message='Target does not match this action.';end if;
 if exists(select 1 from jsonb_object_keys(p_input)k where not k=any(a.input_fields)) then
 raise exception using errcode='22023',message='Unsupported action input. Actor and lifecycle state are server-owned.';end if;
 if p_action like 'hr_%' then perform feedx_integrations.hr_target_scope(m,p_action,p_target_id,p_input);end if;
 if p_action like 'restaurant_%' then perform feedx_integrations.restaurant_target_scope(m,p_action,p_target_id,(p_input->>'outlet_id')::uuid);end if;
 fingerprint:=feedx_integrations.factory_action_version(jsonb_build_object('action',p_action,'target',p_target_id,'version',p_expected_version,'input',p_input));
 perform pg_advisory_xact_lock(hashtextextended('factory-agent-request:'||m::text||':'||p_request_id::text,0));
 select * into req from feedx_integrations.factory_action_requests where identity_id=m and request_id=p_request_id for update;
 if found then
  if req.payload_hash<>fingerprint then raise exception using errcode='22023',message='Request ID was used for a different intent. Use a new request ID.';end if;
  if req.status='completed' then return req.receipt||jsonb_build_object('replayed',true);end if;
 end if;
 before_value:=feedx_integrations.factory_action_state(p_action,p_target_id,true);
 if feedx_integrations.factory_action_version(before_value) is distinct from p_expected_version then
 raise exception using errcode='40001',message='Factory evidence changed. Read current action context and review a new intent.';end if;
 -- Same machine, regardless of credential, cannot review its own recorded work.
 if p_action not in ('area_cleaning.verify','equipment_cleaning.verify') and a.action in ('verify','approve') and exists(
  select 1 from feedx_integrations.factory_action_requests r where r.identity_id=m and r.status='completed'
   and r.action not like '%.verify' and r.action not like '%.approve'
   and (r.target_id=p_target_id or r.receipt->>'target_id'=p_target_id::text or (p_action='production.verify' and r.target_id=(before_value->>'job_order_id')::uuid))
 ) then raise exception using errcode='42501',message='This Agent cannot verify or approve its own work. Use an independent reviewer.';end if;
 a.requires_confirmation:=a.requires_confirmation and not coalesce((feedx_integrations.factory_execution_policy(p_action,before_value)->>'eligible_without_confirmation')::boolean,false);
 if p_action in ('area_cleaning.verify','equipment_cleaning.verify') then
 perform feedx_integrations.cleaning_verify_requirement(before_value->>'status',p_input->>'result',case when p_action='area_cleaning.verify' then 'Cleaning' else 'Equipment Cleaning' end);end if;
 if req.request_id is null then
  insert into feedx_integrations.factory_action_requests(identity_id,request_id,action,target_id,expected_version,input,payload_hash,status)
  values(m,p_request_id,p_action,p_target_id,p_expected_version,p_input,fingerprint,case when a.requires_confirmation then 'awaiting_confirmation' else 'confirmed' end)
  returning * into req;
 end if;
 if a.requires_confirmation and req.status<>'confirmed' then
 return jsonb_build_object('status','awaiting_confirmation','request_id',p_request_id,'action',p_action,'target_id',p_target_id,
 'message',feedx_integrations.factory_execution_policy(p_action,before_value)->>'execution_reason','execution_policy',feedx_integrations.factory_execution_policy(p_action,before_value)->>'execution_policy');end if;
 if a.requires_confirmation and (req.confirmed_by is null or req.confirmed_at<clock_timestamp()-interval '30 minutes') then
 raise exception using errcode='55000',message='Human confirmation expired. Submit a new intent for review.';end if;
 -- Namespace inner canonical retry keys by stable Agent identity, never by credential.
 canonical_request:=md5(m::text||':'||p_request_id::text)::uuid;
 v_id:=p_target_id;
 case p_action
 when 'hr_payroll.prepare','hr_payroll.calculate','hr_payroll.update','hr_employment.update','hr_recruitment.shortlist','hr_recruitment.advance','hr_recruitment.reject','hr_payroll.create','hr_payroll_adjustment.create','hr_payroll_adjustment.reverse','hr_compliance.verify','hr_compliance.reject','hr_legal_entity.create','hr_legal_entity.update' then v_id:=feedx_integrations.hr_execute(m,canonical_request,p_action,p_target_id,p_input);
 when 'restaurant_asset.create','restaurant_asset.update','restaurant_inspection.create','restaurant_inspection.update','restaurant_inspection.complete','restaurant_maintenance.create','restaurant_maintenance.update','restaurant_maintenance.complete','restaurant_stock_check.create','restaurant_stock_check.update','restaurant_stock_check.submit','restaurant_purchase_order.create','restaurant_purchase_order.update','restaurant_purchase_order.submit','restaurant_purchase_order.confirm','restaurant_purchase_order.return_to_draft','restaurant_purchase_order.cancel','restaurant_purchase_order.complete','restaurant_purchase_order.receive','restaurant_movement.create','restaurant_waste.create','restaurant_recipe.create','restaurant_recipe.update' then v_id:=feedx_integrations.restaurant_execute(m,canonical_request,p_action,p_target_id,p_input);
 when 'job_order.create','job_order.update' then
  select to_jsonb(v),v.job_order_id into result,v_id from feedx_integrations.fa_save_job_order_structure(m,p_target_id,
   (p_input->>'finished_good_id')::uuid,(p_input->>'target_quantity')::numeric,p_input->>'uom',(p_input->>'planned_date')::date,
   (p_input->>'due_date')::date,p_input->>'priority',p_input->>'assigned_team',p_input->>'remarks',
   (p_input->>'target_pack_qty')::numeric,(p_input->>'target_production_qty')::numeric)v;
 when 'job_order.submit' then perform feedx_integrations.fa_release_job_order(m,p_target_id);
 when 'job_order.cancel' then perform feedx_integrations.fa_cancel_job_order(m,p_target_id);
 when 'production.update' then
  perform feedx_integrations.fa_save_production_qc_progress(m,p_target_id,coalesce(p_input->'step_rows','[]'),coalesce(p_input->'qc_rows','[]'),null,null);
 when 'production.complete' then
  v_id:=feedx_integrations.fa_complete_production_with_raw_batch_allocations(m,canonical_request,
   coalesce(p_input->'payload','{}')||jsonb_build_object('job_order_id',p_target_id));
 when 'production.verify' then perform feedx_integrations.fa_verify_production_record(m,p_target_id);
 when 'receiving.create','receiving.update','receiving.complete' then
  if p_target_id is not null then
   select coalesce(completion_request_id,canonical_request) into canonical_request from public.factory_raw_material_receiving_batches where id=p_target_id;
  end if;
  result:=feedx_integrations.fa_save_raw_material_receiving(m,p_target_id,canonical_request,(p_input->>'supplier_id')::uuid,
   p_input->>'reference_no',(p_input->>'received_date')::date,p_input->>'remarks',p_input->'items',p_action='receiving.complete');
  v_id:=coalesce((result->>'batch_id')::uuid,(result->>'id')::uuid,p_target_id);
 when 'receiving.verify' then result:=feedx_integrations.fa_verify_raw_material_receiving(m,p_target_id);
 when 'receiving.cancel' then result:=feedx_integrations.fa_cancel_raw_material_receiving(m,p_target_id);
 when 'product_stock_check.create','product_stock_check.update','product_stock_check.submit' then
  select to_jsonb(v),v.id into result,v_id from feedx_integrations.fa_save_product_stock_check_structure(m,p_target_id,
   (p_input->>'check_date')::date,p_input->>'notes',case when a.action='submit' then 'submitted' else 'draft' end,null,p_input->'rows')v;
 when 'product_stock_check.approve' then perform feedx_integrations.fa_approve_product_stock_check(m,p_target_id,null);
 when 'raw_stock_check.create','raw_stock_check.update','raw_stock_check.submit' then
  select to_jsonb(v),v.id into result,v_id from feedx_integrations.fa_save_raw_material_stock_check_structure(m,p_target_id,
   (p_input->>'category_id')::uuid,(p_input->>'check_date')::date,p_input->>'notes',case when a.action='submit' then 'submitted' else 'draft' end,p_input->'rows')v;
 when 'raw_stock_check.approve' then perform feedx_integrations.fa_approve_raw_material_stock_check(m,p_target_id,null);
 when 'area_cleaning.complete' then result:=feedx_integrations.fa_mesti_complete_cleaning_occurrence(m,p_target_id,p_input->>'note');
 when 'area_cleaning.verify' then result:=feedx_integrations.fa_mesti_verify_cleaning_occurrence(m,p_target_id,p_input->>'result',p_input->>'note');
 when 'equipment_cleaning.complete' then result:=feedx_integrations.fa_mesti_complete_equipment_cleaning_occurrence(m,p_target_id,p_input->>'note');
 when 'equipment_cleaning.verify' then result:=feedx_integrations.fa_mesti_verify_equipment_cleaning_occurrence(m,p_target_id,p_input->>'result',p_input->>'note');
 when 'calibration.create' then result:=feedx_integrations.fa_mesti_record_calibration(m,p_target_id,p_input->'record');v_id:=(result->>'id')::uuid;
 when 'calibration.verify' then result:=feedx_integrations.fa_mesti_verify_calibration(m,p_target_id);
 else raise exception using errcode='22023',message='Unsupported Factory action.';
 end case;
 if v_id is null then raise exception using errcode='55000',message='Canonical action did not return a target identity.';end if;
 after_value:=feedx_integrations.factory_action_state(
  case when p_action='production.complete' then 'production.verify' when p_action='calibration.create' then 'calibration.verify' else p_action end,v_id);
 result:=jsonb_build_object('status','completed','request_id',p_request_id,'action',p_action,'target_id',v_id,
  'actor',jsonb_build_object('type','machine','identity_id',m),'confirmed_by',req.confirmed_by,'confirmed_at',req.confirmed_at,
  'before_version',p_expected_version,'after_version',feedx_integrations.factory_action_version(after_value),
  'completed_at',clock_timestamp(),'replayed',false);
 -- Commit the audited operation without waiting for the expensive whole-Run read.
 if p_action in ('hr_payroll.create','hr_payroll.prepare','hr_payroll.calculate','hr_payroll.update') or p_action like 'hr_payroll_adjustment.%' then
  result:=result||jsonb_build_object('payroll',(select jsonb_build_object('run_id',r.id,'run_status',r.status,'legal_entity_id',p_input->>'legal_entity_id','readiness_tool','check_payroll_readiness')
    from public.payroll_runs r where r.id=case when p_action like 'hr_payroll_adjustment.%' then (select run_id from payroll_run_component_adjustments where id=v_id) else v_id end));
 end if;
 update feedx_integrations.factory_action_requests set status='completed',completed_at=clock_timestamp(),receipt=result
 where identity_id=m and request_id=p_request_id;
 insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
 select 'external_agent_factory_action_completed',case when p_action like 'restaurant_%' or p_action like 'hr_%' then a.module_id else 'factory' end,null,name,case when p_action like 'restaurant_%' then 'Restaurant business action executed by External Agent.' when p_action like 'hr_%' then 'HR business action executed by External Agent.' else 'Factory action executed by External Agent.' end,
 result||jsonb_build_object('workspace',case when p_action like 'hr_%' then 'HR' when p_action like 'restaurant_%' then 'Restaurant' else 'Factory' end,'business_module',a.module_id,'source_before',before_value,'source_after',after_value,'payload_hash',fingerprint)
 from feedx_integrations.machine_identities where id=m;
 return result;
end $function$;
notify pgrst,'reload schema';
