-- Keep physical performers distinct from the machine recording the intent.


CREATE OR REPLACE FUNCTION feedx_integrations.fa_complete_production_with_raw_batch_allocations(p_machine_identity_id uuid, p_request_id uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee_id uuid;
  v_employee_name text;
  v_production_id uuid;
  v_authoritative_payload jsonb;
  v_recipe_id uuid := nullif(p_payload->>'recipe_id', '')::uuid;
begin
  if p_machine_identity_id is not null and not exists(select 1 from public.factory_job_orders where id=(p_payload->>'job_order_id')::uuid and production_operator_id is not null) then
    raise exception using errcode='22023',message='Existing physical Production operator evidence is required. An Agent cannot be the physical operator.';
  end if;
  v_employee_id := feedx_integrations.fa_current_active_employee_id(p_machine_identity_id);
  v_employee_name := feedx_integrations.fa_current_active_employee_name(p_machine_identity_id);
  v_authoritative_payload := (p_payload - 'operator_id' - 'operator_name' - 'recipe_id') || jsonb_build_object('operator_id', v_employee_id, 'operator_name', case when p_machine_identity_id is null then v_employee_name else null end);
  perform public.factory_validate_production_usage_precision_internal(coalesce(v_authoritative_payload->'usage_items', '[]'::jsonb));
  if v_recipe_id is not null then
    perform public.factory_validate_production_recipe_usage_internal(v_recipe_id, nullif(v_authoritative_payload->>'actual_output_qty', '')::numeric, coalesce(v_authoritative_payload->'usage_items', '[]'::jsonb));
  end if;
  v_production_id := feedx_integrations.fa_complete_production_with_raw_batch_allocations_impl_050(p_machine_identity_id, p_request_id, v_authoritative_payload);
  perform public.factory_mesti_materialize_equipment_cleaning_after_production(v_production_id);
  return v_production_id;
end;
$function$;

CREATE OR REPLACE FUNCTION feedx_integrations.fa_save_production_qc_progress(p_machine_identity_id uuid, p_job_order_id uuid, p_steps jsonb, p_results jsonb, p_actor_id uuid DEFAULT NULL::uuid, p_actor_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job_order public.factory_job_orders%rowtype;
  v_item jsonb;
  v_status text;
  v_result text;
  v_remarks text;
  v_qc_type text;
  v_required boolean;
  v_existing_step_status text;
  v_existing_result text;
  v_existing_remarks text;
  v_changed boolean := false;
  v_previous_status text;
  v_current_status text;
  v_total integer;
  v_completed integer;
  v_failed integer;
  v_required_total integer;
  v_required_completed integer;
begin
  if not (
    feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_production.complete')
    or feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_production.edit')
  ) then
    raise exception 'Missing permission to update Production QC.';
  end if;

  select jo.* into v_job_order
  from public.factory_job_orders jo
  where jo.id = p_job_order_id
  for update;
  if not found then raise exception 'Job Order was not found.'; end if;
  if lower(coalesce(v_job_order.status, '')) <> 'in_progress' then
    raise exception 'Production QC can only be updated while the Job Order is In Progress.';
  end if;
  if v_job_order.qc_snapshot_created_at is null then
    raise exception 'This legacy production has no QC execution snapshot.';
  end if;

  v_previous_status := public.factory_get_production_qc_status(p_job_order_id, null);

  for v_item in select value from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
  loop
    v_status := lower(coalesce(v_item->>'status', 'pending'));
    if v_status not in ('pending', 'completed') then raise exception 'Invalid production step status.'; end if;

    select execution.status into v_existing_step_status
    from public.factory_production_step_executions execution
    where execution.id = nullif(v_item->>'id', '')::uuid
      and execution.job_order_id = p_job_order_id
    for update;
    if not found then raise exception 'Production step does not belong to this Job Order.'; end if;

    if v_existing_step_status is distinct from v_status then
      update public.factory_production_step_executions execution
      set status = v_status,
          completed_by = case when v_status = 'completed' then case when p_machine_identity_id is null then coalesce(feedx_integrations.fa_current_active_employee_id(p_machine_identity_id), execution.completed_by) else null end else null end,
          completed_at = case when v_status = 'completed' then coalesce(execution.completed_at, now()) else null end,
          updated_at = now()
      where execution.id = nullif(v_item->>'id', '')::uuid
        and execution.job_order_id = p_job_order_id;
      v_changed := true;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  loop
    select result.qc_type, result.is_required, result.checklist_result,
           nullif(btrim(coalesce(result.remarks, '')), '')
    into v_qc_type, v_required, v_existing_result, v_existing_remarks
    from public.factory_production_qc_results result
    where result.id = nullif(v_item->>'id', '')::uuid
      and result.job_order_id = p_job_order_id
    for update;
    if not found then raise exception 'QC result does not belong to this Job Order.'; end if;

    v_result := nullif(lower(btrim(coalesce(v_item->>'checklist_result', ''))), '');
    v_remarks := nullif(btrim(coalesce(v_item->>'remarks', '')), '');
    if v_qc_type = 'checklist' and v_result is not null and v_result not in ('pass', 'fail', 'na') then
      raise exception 'Checklist result must be Pass, Fail or N/A.';
    end if;
    if v_qc_type = 'remarks' then v_result := null; end if;
    if v_result = 'na' and v_remarks is null then
      raise exception 'Add a reason when selecting N/A.';
    end if;

    if v_existing_result is distinct from v_result or v_existing_remarks is distinct from v_remarks then
      update public.factory_production_qc_results result
      set checklist_result = v_result,
          remarks = v_remarks,
          checked_by = case when v_result is not null or v_remarks is not null then case when p_machine_identity_id is null then coalesce(feedx_integrations.fa_current_active_employee_id(p_machine_identity_id), result.checked_by) else null end else null end,
          checked_by_name = case when v_result is not null or v_remarks is not null then coalesce(nullif(btrim(coalesce(feedx_integrations.fa_current_active_employee_name(p_machine_identity_id), '')), ''), result.checked_by_name) else null end,
          checked_at = case when v_result is not null or v_remarks is not null then now() else null end,
          updated_at = now()
      where result.id = nullif(v_item->>'id', '')::uuid
        and result.job_order_id = p_job_order_id;
      v_changed := true;
    end if;
  end loop;

  select count(*),
         count(*) filter (where (qc_type = 'checklist' and checklist_result is not null) or (qc_type = 'remarks' and nullif(btrim(coalesce(remarks, '')), '') is not null)),
         count(*) filter (where qc_type = 'checklist' and checklist_result = 'fail'),
         count(*) filter (where is_required),
         count(*) filter (where is_required and (
           (qc_type = 'checklist' and checklist_result is not null and (checklist_result <> 'na' or nullif(btrim(coalesce(remarks, '')), '') is not null))
           or (qc_type = 'remarks' and nullif(btrim(coalesce(remarks, '')), '') is not null)
         ))
  into v_total, v_completed, v_failed, v_required_total, v_required_completed
  from public.factory_production_qc_results result
  where result.job_order_id = p_job_order_id;

  v_current_status := public.factory_get_production_qc_status(p_job_order_id, null);

  return jsonb_build_object(
    'changed', v_changed or v_previous_status is distinct from v_current_status,
    'previous_status', v_previous_status,
    'current_status', v_current_status,
    'total', v_total,
    'completed', v_completed,
    'failed', v_failed,
    'required_total', v_required_total,
    'required_completed', v_required_completed
  );
end;
$function$;

create or replace function public.factory_agent_execute_action(p_token text,p_request_id uuid,p_action text,p_target_id uuid,p_expected_version text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
 if a.action in ('verify','approve') and exists(
  select 1 from feedx_integrations.factory_action_requests r where r.identity_id=m and r.status='completed'
   and r.action not like '%.verify' and r.action not like '%.approve'
   and (r.target_id=p_target_id or r.receipt->>'target_id'=p_target_id::text or (p_action='production.verify' and r.target_id=(before_value->>'job_order_id')::uuid))
 ) then raise exception using errcode='42501',message='This Agent cannot verify or approve its own work. Use an independent reviewer.';end if;
 if req.request_id is null then
  insert into feedx_integrations.factory_action_requests(identity_id,request_id,action,target_id,expected_version,input,payload_hash,status)
  values(m,p_request_id,p_action,p_target_id,p_expected_version,p_input,fingerprint,case when a.requires_confirmation then 'awaiting_confirmation' else 'confirmed' end)
  returning * into req;
 end if;
 if a.requires_confirmation and req.status<>'confirmed' then
 return jsonb_build_object('status','awaiting_confirmation','request_id',p_request_id,'action',p_action,'target_id',p_target_id,
 'message','An authorized human must review this exact action and confirm existing physical evidence in AI Integrations. Nothing has been executed.');end if;
 if a.requires_confirmation and (req.confirmed_by is null or req.confirmed_at<clock_timestamp()-interval '30 minutes') then
 raise exception using errcode='55000',message='Human confirmation expired. Submit a new intent for review.';end if;
 -- Namespace inner canonical retry keys by stable Agent identity, never by credential.
 canonical_request:=md5(m::text||':'||p_request_id::text)::uuid;
 v_id:=p_target_id;
 case p_action
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
 update feedx_integrations.factory_action_requests set status='completed',completed_at=clock_timestamp(),receipt=result
 where identity_id=m and request_id=p_request_id;
 insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
 select 'external_agent_factory_action_completed','factory',null,name,'Factory action executed by External Agent.',
 result||jsonb_build_object('source_before',before_value,'source_after',after_value,'payload_hash',fingerprint)
 from feedx_integrations.machine_identities where id=m;
 return result;
end $$;

create function feedx_integrations.factory_human_action_can(p_action text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select (public.current_user_has_permission(a.human_permission)
 or (a.module_id in ('factory_mesti_cleaning','factory_mesti_equipment_cleaning','factory_mesti_calibration') and public.current_user_has_permission(a.module_id||'.manage'))
 or (a.key='production.update' and public.current_user_has_permission('factory_production.edit')))
 and (public.current_user_has_permission(split_part(a.human_permission,'.',1)||'.view')
 or (a.module_id in ('factory_mesti_cleaning','factory_mesti_equipment_cleaning','factory_mesti_calibration') and public.current_user_has_permission(a.module_id||'.manage')))
 from feedx_integrations.factory_actions a where a.key=p_action;
$$;
revoke all on function feedx_integrations.factory_human_action_can(text) from public,anon,authenticated;

create or replace function public.external_agents_confirm_factory_action(p_identity_id uuid,p_request_id uuid,p_evidence_reference text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare req feedx_integrations.factory_action_requests%rowtype; a feedx_integrations.factory_actions%rowtype; employee_id_value uuid; source_value jsonb;
begin
 if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Agent management authority is required.';end if;
 employee_id_value:=public.factory_current_active_employee_id();
 select * into strict req from feedx_integrations.factory_action_requests where identity_id=p_identity_id and request_id=p_request_id for update;
 select * into strict a from feedx_integrations.factory_actions where key=req.action;
 if not a.requires_confirmation or not feedx_integrations.factory_human_action_can(a.key) then raise exception using errcode='42501',message='The corresponding Factory business authority is required.';end if;
 if req.status<>'awaiting_confirmation' then raise exception using errcode='55000',message='This action is no longer awaiting confirmation.';end if;
 if nullif(btrim(p_evidence_reference),'') is null or length(p_evidence_reference)>1000 then raise exception using errcode='22023',message='Reference to observed physical or approved business evidence is required.';end if;
 source_value:=feedx_integrations.factory_action_state(req.action,req.target_id,true);
 if feedx_integrations.factory_action_version(source_value) is distinct from req.expected_version then raise exception using errcode='40001',message='Factory evidence changed. Ask the Agent to submit a new intent.';end if;
 if a.action in ('verify','approve') and employee_id_value::text in (source_value->>'created_by',source_value->>'completed_by',source_value->>'recorded_by',source_value->>'submitted_by',source_value->>'operator_id') then
 raise exception using errcode='42501',message='An independent reviewer must confirm this action.';end if;
 update feedx_integrations.factory_action_requests set status='confirmed',confirmed_by=employee_id_value,confirmed_at=clock_timestamp(),evidence_reference=btrim(p_evidence_reference)
 where identity_id=p_identity_id and request_id=p_request_id;
 insert into public.audit_logs(action,module,user_id,user_name,description,metadata) values('external_agent_factory_action_confirmed','factory',auth.uid(),'Authorized Factory reviewer',
 'Exact Agent action confirmed against existing evidence; execution remains pending.',jsonb_build_object('identity_id',p_identity_id,'request_id',p_request_id,'action',req.action,'payload_hash',req.payload_hash,'evidence_reference',btrim(p_evidence_reference)));
 return jsonb_build_object('status','confirmed','request_id',p_request_id);
end $$;

create or replace function public.external_agents_factory_action_requests(p_identity_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Agent management authority is required.';end if;
 return (select coalesce(jsonb_agg((case when feedx_integrations.factory_human_action_can(a.key) then to_jsonb(r) else to_jsonb(r)-'input'-'target_id'-'evidence_reference' end)||jsonb_build_object('label',a.label,'requires_confirmation',a.requires_confirmation,
 'can_confirm',feedx_integrations.factory_human_action_can(a.key)) order by r.requested_at desc),'[]')
 from (select request_id,identity_id,action,target_id,input,status,requested_at,confirmed_by,confirmed_at,evidence_reference,receipt
 from feedx_integrations.factory_action_requests where identity_id=p_identity_id order by requested_at desc limit 50)r
 join feedx_integrations.factory_actions a on a.key=r.action);
end $$;

notify pgrst,'reload schema';
