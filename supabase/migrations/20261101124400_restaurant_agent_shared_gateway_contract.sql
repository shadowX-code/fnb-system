-- Integrate Restaurant through the existing fixed dispatcher, discovery and receipt/read authority.
do $$ begin if md5(pg_get_functiondef('feedx_integrations.factory_action_authorize(text,text)'::regprocedure))<>'6ff676af8ae006fe03bfa0010bd9a885' then raise exception 'Agent authority changed: feedx_integrations.factory_action_authorize';end if;end $$;
CREATE OR REPLACE FUNCTION feedx_integrations.factory_action_authorize(p_token text, p_action text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare permission text; view_permission text; m uuid; module text;
begin
 if p_action like 'restaurant_%' then
  select c.permission_code,v.permission_code into strict permission,view_permission from feedx_integrations.factory_actions a
  join feedx_integrations.capabilities c on c.tool_id=a.key and c.workspace='Restaurant' and c.implemented
  join feedx_integrations.capabilities v on v.navigation_module_id=a.module_id and v.action_type='view' and v.workspace='Restaurant'
  where a.key=p_action;
  m:=feedx_integrations.authorize(p_token,'factory_mesti_inspection.view');
  if feedx_integrations.authorize(p_token,permission) is distinct from m or feedx_integrations.authorize(p_token,view_permission) is distinct from m then raise exception using errcode='42501',message='Restaurant Action and View grants are required';end if;
  return m;
 end if;
 select module_id into strict module from feedx_integrations.factory_actions where key=p_action;
 m:=feedx_integrations.authorize(p_token,'factory_mesti_inspection.view');
 if feedx_integrations.authorize(p_token,'factory_agent_action_'||p_action) is distinct from m
 or feedx_integrations.authorize(p_token,'factory_agent_nav_'||module||'.view') is distinct from m then
 raise exception using errcode='42501',message='Factory action and business-module View access are required.'; end if;
 return m;
end $function$
;
do $$ begin if md5(pg_get_functiondef('feedx_integrations.factory_action_state(text,uuid,boolean)'::regprocedure))<>'734d28a787a35f1bda7eaa9b4ac8d4a7' then raise exception 'Agent authority changed: feedx_integrations.factory_action_state';end if;end $$;
CREATE OR REPLACE FUNCTION feedx_integrations.factory_action_state(p_action text, p_id uuid, p_lock boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare a feedx_integrations.factory_actions%rowtype; value jsonb; child jsonb:='{}'; t text; fk text;
begin
 select * into strict a from feedx_integrations.factory_actions where key=p_action;
 if p_id is null then return null; end if;
 if p_lock then execute format('select to_jsonb(t) from %s t where id=$1 for update',a.target_table) into value using p_id;
 else execute format('select to_jsonb(t) from %s t where id=$1',a.target_table) into value using p_id; end if;
 if value is null then raise exception using errcode='P0002',message='Factory action target was not found.'; end if;
 for t,fk in select child_table,foreign_key from (values
 ('factory_job_orders','factory_production_step_executions','job_order_id'),
 ('factory_job_orders','factory_production_qc_results','job_order_id'),
 ('factory_raw_material_receiving_batches','factory_raw_material_receivings','batch_id'),
 ('factory_product_stock_checks','factory_product_stock_check_items','stock_check_id'),
 ('factory_raw_material_stock_checks','factory_raw_material_stock_check_items','stock_check_id')
 ) x(parent,child_table,foreign_key) where parent=a.target_table::text
 loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by id),''[]''::jsonb) from public.%I t where %I=$1',t,fk) into child using p_id;
  value:=value||jsonb_build_object(t,child);
 end loop;
 if a.target_table='public.factory_product_stock_checks'::regclass then
  select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]'::jsonb) into child
  from public.factory_product_stock_check_batch_adjustments b join public.factory_product_stock_check_items i on i.id=b.stock_check_item_id where i.stock_check_id=p_id;
  value:=value||jsonb_build_object('batch_adjustments',child);
 elsif a.target_table='public.factory_raw_material_stock_checks'::regclass then
  select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]'::jsonb) into child
  from public.factory_raw_material_stock_check_batch_allocations b join public.factory_raw_material_stock_check_items i on i.id=b.stock_check_item_id where i.stock_check_id=p_id;
  value:=value||jsonb_build_object('batch_allocations',child);
 end if;

 if p_action like 'restaurant_%' then
  for t,fk in select child_table,foreign_key from (values
   ('inventory_stock_checks','inventory_stock_check_items','stock_check_id'),
   ('inventory_purchase_orders','inventory_purchase_order_items','purchase_order_id'),
   ('inventory_purchase_orders','inventory_purchase_receipts','purchase_order_id'),
   ('inventory_recipes','inventory_recipe_items','recipe_id'),
   ('asset_inspections','asset_inspection_items','inspection_id')
  ) x(parent,child_table,foreign_key) where parent=a.target_table::text
  loop
   execute format('select coalesce(jsonb_agg(to_jsonb(t) order by id),''[]''::jsonb) from public.%I t where %I=$1',t,fk) into child using p_id;
   value:=value||jsonb_build_object(t,child);
  end loop;
 end if;
 return value;
end $function$
;
do $$ begin if md5(pg_get_functiondef('public.factory_agent_action_context(text,text,uuid)'::regprocedure))<>'113be42cf64b71e4f0762a22a0f940fb' then raise exception 'Agent authority changed: public.factory_agent_action_context';end if;end $$;
CREATE OR REPLACE FUNCTION public.factory_agent_action_context(p_token text, p_action text, p_target_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare m uuid; a feedx_integrations.factory_actions%rowtype; value jsonb;
begin
 if p_action like 'restaurant_%' then raise exception using errcode='22023',message='Use Restaurant action context with an explicit outlet';end if;
 m:=feedx_integrations.factory_action_authorize(p_token,p_action);
 select * into strict a from feedx_integrations.factory_actions where key=p_action;
 if a.target_required and p_target_id is null then raise exception using errcode='22023',message='Target is required.'; end if;
 value:=feedx_integrations.factory_action_state(p_action,p_target_id);
 -- Context is concurrency metadata, never a second unrestricted business read.
 return jsonb_build_object('action',p_action,'target_id',p_target_id,'expected_version',feedx_integrations.factory_action_version(value),
 'status',value->>'status','requires_human_confirmation',not coalesce((feedx_integrations.factory_execution_policy(p_action,value)->>'eligible_without_confirmation')::boolean,false),'input_fields',a.input_fields,
 'execution',feedx_integrations.factory_execution_policy(p_action,value),'lifecycle_requirement',case when p_action in ('area_cleaning.verify','equipment_cleaning.verify') then feedx_integrations.cleaning_verify_requirement(value->>'status',null,case when p_action='area_cleaning.verify' then 'Cleaning' else 'Equipment Cleaning' end,false) end,'instruction',feedx_integrations.factory_execution_policy(p_action,value)->>'execution_reason');
end $function$
;
do $$ begin if md5(pg_get_functiondef('public.factory_agent_execute_action(text,uuid,text,uuid,text,jsonb)'::regprocedure))<>'7ea3e911dd0fd7e72981d3904bb6ad03' then raise exception 'Agent authority changed: public.factory_agent_execute_action';end if;end $$;
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
 update feedx_integrations.factory_action_requests set status='completed',completed_at=clock_timestamp(),receipt=result
 where identity_id=m and request_id=p_request_id;
 insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
 select 'external_agent_factory_action_completed',case when p_action like 'restaurant_%' then a.module_id else 'factory' end,null,name,case when p_action like 'restaurant_%' then 'Restaurant business action executed by External Agent.' else 'Factory action executed by External Agent.' end,
 result||jsonb_build_object('workspace',case when p_action like 'restaurant_%' then 'Restaurant' else 'Factory' end,'business_module',a.module_id,'source_before',before_value,'source_after',after_value,'payload_hash',fingerprint)
 from feedx_integrations.machine_identities where id=m;
 return result;
end $function$
;
do $$ begin if md5(pg_get_functiondef('public.external_agents_factory_action_requests(uuid)'::regprocedure))<>'5f5d30a33e8a58dbafe83547ce333be4' then raise exception 'Agent authority changed: public.external_agents_factory_action_requests';end if;end $$;
CREATE OR REPLACE FUNCTION public.external_agents_factory_action_requests(p_identity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r record; a feedx_integrations.factory_actions%rowtype; item jsonb; output jsonb:='[]';
 source_value jsonb; policy jsonb; inspect boolean; reason text; reason_code text; state text; next_action text;
begin
 if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Agent management authority is required.';end if;
 -- Open work cannot be displaced by a burst of completed operations. History stays bounded.
 for r in with history as (
  select * from feedx_integrations.factory_action_requests where identity_id=p_identity_id and status='completed' order by requested_at desc,request_id limit 50
 ) select * from feedx_integrations.factory_action_requests where identity_id=p_identity_id and status<>'completed'
 union all select * from history order by requested_at desc,request_id
 loop
  select * into strict a from feedx_integrations.factory_actions where key=r.action;
  inspect:=feedx_integrations.factory_human_action_can(a.key);
  if a.key like 'restaurant_%' then inspect:=inspect and public.current_user_can_access_outlet((r.input->>'outlet_id')::uuid);end if;
  source_value:=null;reason:=null;reason_code:=null;next_action:=null;
  policy:=feedx_integrations.factory_execution_policy(a.key);
  if r.status='completed' then state:='completed';
  elsif not a.requires_confirmation then
   -- An awaiting/confirmed intent under a now-direct policy is historical, not new work.
   state:='legacy_pending';reason_code:='policy_now_direct';
   reason:='Saved under the previous confirmation policy. This action now executes directly when authorized.';
   next_action:='If the work is still needed, review current Factory evidence and give the Agent a new instruction. Do not replay this old intent blindly.';
  elsif r.status='confirmed' and (r.confirmed_at is null or r.confirmed_at < clock_timestamp()-interval '30 minutes') then
   state:='expired';reason_code:='confirmation_expired';reason:='The approval window has expired.';
   next_action:='If still needed, ask the Agent to read current evidence and submit a new intent.';
  else
   state:=case when r.status='confirmed' then 'awaiting_execution' else 'pending_approval' end;
   if not inspect then
    state:='needs_resolution';reason_code:='review_access_required';reason:='Your corresponding business permission is required to inspect this request.';
    next_action:='Ask an authorized business reviewer to inspect the request.';
   else
    begin
     source_value:=feedx_integrations.factory_action_state(a.key,r.target_id);
     if a.target_required and (source_value is null or source_value->>'id' is null) then
      reason_code:='source_unavailable';reason:='The Factory record is no longer available.';
     elsif a.target_required and feedx_integrations.factory_action_version(source_value) is distinct from r.expected_version then
      reason_code:='source_changed';reason:='Factory evidence changed after this request was saved.';
     elsif a.key in ('area_cleaning.verify','equipment_cleaning.verify') then
      reason:=feedx_integrations.cleaning_verify_requirement(source_value->>'status',r.input->>'result','Cleaning',false);
      if reason is not null then reason_code:='cleaning_lifecycle';end if;
     end if;
     policy:=feedx_integrations.factory_execution_policy(a.key,source_value);
    exception when others then
     reason_code:='source_unavailable';reason:='Current Factory evidence could not be read. Inspect the record before continuing.';
    end;
    if reason is not null then
     state:='needs_resolution';next_action:='Review the current Factory record, resolve the evidence requirement, then ask the Agent to submit a new intent.';
    elsif state='pending_approval' and coalesce((policy->>'eligible_without_confirmation')::boolean,false) then
     state:='awaiting_execution';reason_code:='eligible_continuation';reason:='Current canonical evidence permits execution without another approval.';
     next_action:='Continue this saved request with the Agent. Access and evidence are revalidated on execution.';
    elsif state='awaiting_execution' then
     reason:='Human approval is recorded; the Agent has not executed this request.';
     next_action:='Continue this approved request with the Agent before its approval expires. Approval does not execute the action.';
    else
     reason:=policy->>'execution_reason';next_action:='Review the exact intent and genuine evidence before approving. Approval authorizes Agent execution; it does not execute the action.';
    end if;
   end if;
  end if;
  item:=jsonb_build_object('request_id',r.request_id,'identity_id',r.identity_id,'action',r.action,'status',r.status,
   'workspace',case when a.key like 'restaurant_%' then 'Restaurant' else 'Factory' end,'business_module',a.module_id,'requested_at',r.requested_at,'confirmed_at',r.confirmed_at,'label',a.label,'requires_confirmation',a.requires_confirmation,
   'execution_policy',policy->>'execution_policy','queue_state',state,'reason_code',reason_code,'resolution_reason',reason,'next_action',next_action,
   'can_confirm',inspect and state='pending_approval','can_continue',inspect and state='awaiting_execution');
  if inspect then item:=item||jsonb_build_object('target_id',r.target_id,'input',r.input,'expected_version',r.expected_version,
   'confirmed_by',r.confirmed_by,'evidence_reference',r.evidence_reference,'receipt',r.receipt);end if;
  output:=output||jsonb_build_array(item);
 end loop;
 return output;
end $function$
;
do $$ begin if md5(pg_get_functiondef('feedx_integrations.factory_action_catalog(uuid)'::regprocedure))<>'176d491a06890b7d578d096ee5b2b0ed' then raise exception 'Agent authority changed: feedx_integrations.factory_action_catalog';end if;end $$;
CREATE OR REPLACE FUNCTION feedx_integrations.factory_action_catalog(p_identity uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('name',c.tool_id,'label',a.label,'description',a.description,'workspace',n.workspace,
 'domain',n.section,'module_id',a.module_id,'capability',a.action,'permission',c.permission_code,'mcp_tool',c.mcp_tool,
 'implemented',true,'retained_only',false,'read_only',false,'requires_human_approval',a.requires_confirmation,
 'execution_policy',feedx_integrations.factory_execution_policy(a.key)->>'execution_policy','execution_reason',feedx_integrations.factory_execution_policy(a.key)->>'execution_reason','execution_requirement',case when a.requires_confirmation then 'Authorized human confirmation of the exact intent and physical/business evidence is required.' else 'Autonomous with explicit action and module View grants.' end,
 'required_view_permission',(select v.permission_code from feedx_integrations.capabilities v where v.navigation_module_id=a.module_id and v.action_type='view' and v.implemented),
 'view_granted',exists(select 1 from feedx_integrations.machine_identities m join public.role_permissions rp on rp.role_id=m.role_id join public.permissions vp on vp.id=rp.permission_id where m.id=p_identity and vp.code=(select v.permission_code from feedx_integrations.capabilities v where v.navigation_module_id=a.module_id and v.action_type='view' and v.implemented)),
 'granted',exists(select 1 from feedx_integrations.machine_identities m join public.role_permissions rp on rp.role_id=m.role_id where m.id=p_identity and rp.permission_id=p.id),
 'can_assign',public.current_user_can_assign_permission(p.id),
 'scope',jsonb_build_array(jsonb_build_object('label',a.label,'scope_note',a.description||' Module View access is required. Existing lifecycle and evidence validation remain enforced.')))
 order by c.sort_order),'[]')
 from feedx_integrations.factory_actions a join feedx_integrations.capabilities c on c.tool_id=a.key
 join public.permissions p on p.code=c.permission_code join feedx_integrations.navigation_modules n on n.id=a.module_id;
$function$
;
do $$ begin if md5(pg_get_functiondef('feedx_integrations.discovery(uuid)'::regprocedure))<>'d4e90a153ea758b0fa3cba9a7952e741' then raise exception 'Agent authority changed: feedx_integrations.discovery';end if;end $$;
CREATE OR REPLACE FUNCTION feedx_integrations.discovery(p_identity uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $function$
 with actions as(select c from jsonb_array_elements(feedx_integrations.factory_action_catalog(p_identity)) c
 where (c->>'granted')::boolean and (c->>'view_granted')::boolean),base as(select feedx_integrations.factory_read_discovery(p_identity) v),
 reads as(select c.*,r.slug,b.allowed_fields from feedx_integrations.capabilities c join feedx_integrations.machine_identities m on m.adapter_key=c.adapter_key join public.role_permissions rp on rp.role_id=m.role_id join public.permissions p on p.id=rp.permission_id and p.code=c.permission_code join feedx_integrations.navigation_resources b on b.module_id=c.navigation_module_id join feedx_integrations.resources r on r.key=b.resource_key where m.id=p_identity and c.workspace='Restaurant' and c.action_type='view' and c.implemented),
 outlets as(select o.id,o.name from public.outlets o where feedx_integrations.restaurant_actor_outlet(p_identity,o.id))
 select v||jsonb_build_object('tools',coalesce(v->'tools','[]')
 ||case when exists(select 1 from actions where c->>'workspace'='Factory') then '["factory_action_context","execute_factory_action"]'::jsonb else '[]' end
 ||case when exists(select 1 from reads) then '["query_restaurant_resources"]'::jsonb else '[]' end
 ||case when exists(select 1 from actions where c->>'workspace'='Restaurant') then '["restaurant_action_context","execute_restaurant_action"]'::jsonb else '[]' end,
 'factory_actions',coalesce((select jsonb_agg(c) from actions where c->>'workspace'='Factory'),'[]'),
 'restaurant_actions',coalesce((select jsonb_agg(c) from actions where c->>'workspace'='Restaurant'),'[]'),
 'restaurant_outlets',case when exists(select 1 from reads) then coalesce((select jsonb_agg(to_jsonb(outlets) order by id) from outlets),'[]') else '[]' end,
 'restaurant_resource_catalog',coalesce((select jsonb_agg(jsonb_build_object('resource',slug,'business_module',navigation_module_id,'fields',allowed_fields,'outlet_required',true)) from reads),'[]'),
 'restaurant_resource_actions',coalesce((select jsonb_agg(jsonb_build_object('resource',slug,'business_module',navigation_module_id,'action','view')) from reads),'[]')) from base;
$function$;
do $$ begin if md5(pg_get_functiondef('feedx_integrations.review_effective_paths(text[])'::regprocedure))<>'2d773792f36153c2cb86193237c54576' then raise exception 'Agent authority changed: feedx_integrations.review_effective_paths';end if;end $$;
CREATE OR REPLACE FUNCTION feedx_integrations.review_effective_paths(p_names text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select feedx_integrations.factory_read_effective_paths(p_names)||coalesce((select jsonb_agg(jsonb_build_object(
 'key','action:'||a.key,'grant_name',c.tool_id,'owner',a.label,'label',a.action,'module_id',a.module_id,'resource','action:'||a.key,
 'actions',jsonb_build_array(a.action),'row_scope','{}'::jsonb,'requires_human_confirmation',a.requires_confirmation,
 'required_view_permission',(select v.permission_code from feedx_integrations.capabilities v where v.navigation_module_id=a.module_id and v.action_type='view' and v.implemented),'audit_modules','[]'::jsonb))
 from feedx_integrations.factory_actions a join feedx_integrations.capabilities c on c.tool_id=a.key where c.tool_id=any(p_names) and exists(select 1 from feedx_integrations.capabilities view_cap where view_cap.navigation_module_id=a.module_id and view_cap.action_type='view' and view_cap.tool_id=any(p_names))),'[]') || coalesce((select jsonb_agg(jsonb_build_object('key','restaurant:'||r.slug,'grant_name',c.tool_id,'owner',n.label,'module_id',n.id,'resource',r.slug,'label',r.label,'actions',jsonb_build_array('view'),'row_scope',jsonb_build_object('scope','Canonical Agent role outlets'),'fields',b.allowed_fields)) from feedx_integrations.capabilities c join feedx_integrations.navigation_modules n on n.id=c.navigation_module_id join feedx_integrations.navigation_resources b on b.module_id=n.id join feedx_integrations.resources r on r.key=b.resource_key where c.tool_id=any(p_names) and c.workspace='Restaurant' and c.action_type='view'),'[]');
$function$
;
update feedx_integrations.adapters set tools=tools||'[{"name":"restaurant_action_context","description":"Current outlet-scoped Restaurant action version"},{"name":"execute_restaurant_action","description":"Explicitly granted canonical Restaurant commands"}]'::jsonb where key='factory_mesti';
notify pgrst,'reload schema';
