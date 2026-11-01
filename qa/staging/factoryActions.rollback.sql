-- Staging only. Uses the approved disposable Agent pair; every fixture/write below rolls back.
begin;
create temp table factory_action_qa_keys(identity_id uuid primary key,token text);
create temp table factory_action_qa_results(test text,result text);
insert into factory_action_qa_keys select id,'fxm_'||rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=')
from feedx_integrations.machine_identities where name in ('QA Factory Actions Operator 20261101','QA Factory Actions Reviewer 20261101');
insert into feedx_integrations.machine_credentials(identity_id,token_hash,expires_at)
select identity_id,encode(extensions.digest(token,'sha256'),'hex'),clock_timestamp()+interval '20 minutes' from factory_action_qa_keys;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select e.auth_user_id from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null and e.enable_system_login and e.access_state='active' limit 1),'role','authenticated')::text,true);

create function pg_temp.factory_action_qa(p_identity uuid,p_action text,p_target uuid,p_input jsonb) returns jsonb language plpgsql as $$
declare token_value text; version_value text; request_value uuid:=gen_random_uuid(); r jsonb; replay jsonb;
 owner_claims text:=current_setting('request.jwt.claims',true);
begin
 select token into strict token_value from factory_action_qa_keys where identity_id=p_identity;
 perform set_config('request.jwt.claims','{}',true);
 set local role anon;
 version_value:=public.factory_agent_action_context(token_value,p_action,p_target)->>'expected_version';
 r:=public.factory_agent_execute_action(token_value,request_value,p_action,p_target,version_value,p_input);
 if r->>'status'='awaiting_confirmation' then
  assert public.factory_agent_action_context(token_value,p_action,p_target)->>'expected_version' is not distinct from version_value,'Unconfirmed intent changed business evidence';
  reset role;
  perform set_config('request.jwt.claims',owner_claims,true);
  set local role authenticated;
  begin perform public.external_agents_confirm_factory_action(p_identity,request_value,'');raise exception 'Missing physical evidence reference accepted';exception when invalid_parameter_value then null;end;
  perform public.external_agents_confirm_factory_action(p_identity,request_value,'Disposable rollback QA simulation only; no real physical work claimed.');
  replay:=public.external_agents_confirm_factory_action(p_identity,request_value,'Disposable rollback QA simulation only; no real physical work claimed.');
  assert (replay->>'replayed')::boolean,'Confirmation retry did not return its existing receipt';
  reset role;
  perform set_config('request.jwt.claims','{}',true);
  set local role anon;
  r:=public.factory_agent_execute_action(token_value,request_value,p_action,p_target,version_value,p_input);
 end if;
 assert r->>'status'='completed','Canonical action did not complete';
 replay:=public.factory_agent_execute_action(token_value,request_value,p_action,p_target,version_value,p_input);
 assert (replay->>'replayed')::boolean and replay->>'completed_at'=r->>'completed_at','Replay changed the result';
 reset role;
 perform set_config('request.jwt.claims',owner_claims,true);
 insert into factory_action_qa_results values(p_action,'PASS');return r;
exception when others then
 reset role;
 perform set_config('request.jwt.claims',owner_claims,true);
 raise;
end $$;

do $$
declare op uuid;reviewer uuid; location uuid; supplier uuid; category uuid; material uuid; sku uuid;
 receiving uuid; receiving_cancel uuid; product_check uuid; raw_check uuid; equipment uuid; eq_req uuid; eq_occ uuid; cal_req uuid; cal_record uuid;
 family uuid; recipe uuid; sop uuid; job uuid; step_id uuid; qc_id uuid; raw_batch uuid; production uuid; human_actor uuid;
 area_req uuid; area_occ uuid; legacy_location uuid; legacy_occ uuid;
 token_value text; second_token text; role_value uuid; permission_value uuid; version_value text; saved_request record; count_before integer;
 suffix text:=replace(gen_random_uuid()::text,'-',''); item jsonb; input_value jsonb; rows_value jsonb; result_value jsonb; before_hash text; after_hash text;
begin
 select id into strict op from feedx_integrations.machine_identities where name='QA Factory Actions Operator 20261101';
 select id into strict reviewer from feedx_integrations.machine_identities where name='QA Factory Actions Reviewer 20261101';
 insert into public.factory_storage_locations(location_name,status,is_storage_location) values('QA Factory Actions rollback '||suffix,'active',true) returning id into location;
 insert into public.factory_suppliers(supplier_name,status) values('QA Factory Actions supplier '||suffix,'active') returning id into supplier;
 insert into public.factory_raw_material_categories(name,status) values('QA Factory Actions category '||suffix,'active') returning id into category;
 insert into public.factory_raw_materials(name,material_code,uom,status,category_id,current_balance,expiry_tracking_mode)
 values('QA Factory Actions raw '||suffix,'QA-'||suffix,'kg','active',category,0,'not_applicable') returning id into material;
 insert into public.factory_supplier_raw_material_links(supplier_id,raw_material_id) values(supplier,material);
 insert into public.factory_finished_goods(product_name,product_code,uom,status,current_balance,pack_size_qty,pack_size_uom)
 values('QA Factory Actions SKU '||suffix,'QA-'||suffix,'Packs','active',0,1,'kg') returning id into sku;
 item:=jsonb_build_object('raw_material_id',material,'received_qty',1,'uom','kg','storage_location_id',location,'supplier_lot_no','QA-'||suffix,'expiry_source','not_applicable','expiry_confirmed',true);
 input_value:=jsonb_build_object('supplier_id',supplier,'reference_no','QA Factory Actions rollback','received_date',current_date,'remarks','Disposable QA simulation','items',jsonb_build_array(item));
 result_value:=pg_temp.factory_action_qa(op,'receiving.create',null,input_value);receiving:=(result_value->>'target_id')::uuid;
 assert (select created_by is null from public.factory_raw_material_receiving_batches where id=receiving),'Machine Receiving borrowed the human JWT creator';
 perform pg_temp.factory_action_qa(op,'receiving.update',receiving,input_value);
 perform pg_temp.factory_action_qa(op,'receiving.complete',receiving,input_value);
 assert (select current_balance from public.factory_raw_materials where id=material)=1,'Receiving stock was not posted once';
 perform pg_temp.factory_action_qa(reviewer,'receiving.verify',receiving,'{}');
 result_value:=pg_temp.factory_action_qa(op,'receiving.create',null,input_value);receiving_cancel:=(result_value->>'target_id')::uuid;
 perform pg_temp.factory_action_qa(op,'receiving.cancel',receiving_cancel,'{}');
 assert (select current_balance from public.factory_raw_materials where id=material)=1,'Draft cancel changed stock';
 rows_value:=jsonb_build_array(jsonb_build_object('finished_good_id',sku,'physical_qty',0));
 input_value:=jsonb_build_object('check_date',current_date,'notes','QA Factory Actions rollback','rows',rows_value);
 result_value:=pg_temp.factory_action_qa(op,'product_stock_check.create',null,input_value);product_check:=(result_value->>'target_id')::uuid;
 perform pg_temp.factory_action_qa(op,'product_stock_check.update',product_check,input_value);
 perform pg_temp.factory_action_qa(op,'product_stock_check.submit',product_check,input_value);
 perform pg_temp.factory_action_qa(reviewer,'product_stock_check.approve',product_check,'{}');
 assert (select current_balance from public.factory_finished_goods where id=sku)=0,'Zero-variance Product approval changed stock';
 rows_value:=jsonb_build_array(jsonb_build_object('raw_material_id',material,'physical_qty',1,'count_status','counted'));
 input_value:=jsonb_build_object('category_id',category,'check_date',current_date,'notes','QA Factory Actions rollback','rows',rows_value);
 result_value:=pg_temp.factory_action_qa(op,'raw_stock_check.create',null,input_value);raw_check:=(result_value->>'target_id')::uuid;
 perform pg_temp.factory_action_qa(op,'raw_stock_check.update',raw_check,input_value);
 perform pg_temp.factory_action_qa(op,'raw_stock_check.submit',raw_check,input_value);
 perform pg_temp.factory_action_qa(reviewer,'raw_stock_check.approve',raw_check,'{}');
 assert (select current_balance from public.factory_raw_materials where id=material)=1,'Zero-variance Raw approval changed stock';
 insert into public.factory_equipment(equipment_code,name,current_location_id,status) values('QA-'||suffix,'QA Factory Actions equipment '||suffix,location,'active') returning id into equipment;
 insert into public.factory_mesti_equipment_cleaning_requirements(logical_requirement_id,task_name,cleaning_method,status,effective_from)
 values(gen_random_uuid(),'QA Factory Actions equipment cleaning '||suffix,public.factory_mesti_cleaning_methods()->0->>'code','inactive',current_date) returning id into eq_req;
 insert into public.factory_mesti_equipment_cleaning_occurrences(requirement_id,logical_requirement_id,equipment_id,due_date,status,requirement_snapshot)
 select id,logical_requirement_id,equipment,current_date,'pending',jsonb_build_object('qa_fixture',suffix) from public.factory_mesti_equipment_cleaning_requirements where id=eq_req returning id into eq_occ;
 perform pg_temp.factory_action_qa(op,'equipment_cleaning.complete',eq_occ,jsonb_build_object('note','QA simulation'));
 perform pg_temp.factory_action_qa(reviewer,'equipment_cleaning.verify',eq_occ,jsonb_build_object('result','verified','note','Independent QA simulation'));
 insert into public.factory_mesti_calibration_requirements(equipment_id,calibration_type,interval_months,effective_from,status)
 values(equipment,'QA simulation',1,current_date,'active') returning id into cal_req;
 result_value:=pg_temp.factory_action_qa(op,'calibration.create',cal_req,jsonb_build_object('record',jsonb_build_object('scheduled_due_date',current_date,'calibrated_date',current_date,'result','pass','reference_no','QA-'||suffix)));
 cal_record:=(result_value->>'target_id')::uuid;
 assert (select recorded_by is null and recorded_by_agent=op from public.factory_mesti_calibration_records where id=cal_record),'Calibration fabricated an Employee actor';
 perform pg_temp.factory_action_qa(reviewer,'calibration.verify',cal_record,'{}');
 assert exists(select 1 from public.audit_logs where action='external_agent_factory_action_completed' and trusted_external_agent and metadata->>'target_id'=cal_record::text),'Trusted business audit was not preserved';
 -- Production uses only this transaction's SKU/raw stock and a canonical human-started QA execution.
 insert into public.factory_product_families(name_en,status) values('QA Factory Actions family '||suffix,'active') returning id into family;
 update public.factory_finished_goods set shelf_life_days=1,product_family_id=family,storage_location_id=location where id=sku;
 insert into public.factory_product_recipes(recipe_code,recipe_name,product_name,finished_good_id,product_family_id,uom,yield_quantity,version,status)
 values('QA-'||suffix,'QA Factory Actions recipe','QA Factory Actions SKU '||suffix,sku,family,'kg',1,'v1','active') returning id into recipe;
 insert into public.factory_production_sops(sop_code,title,finished_good_id,recipe_id,status,effective_date)
 values('QA-'||suffix,'QA Factory Actions SOP',family,recipe,'draft',current_date) returning id into sop;
 insert into public.factory_production_sop_steps(sop_id,step_no,instruction,is_qc_checkpoint,qc_label,qc_required_before_completion)
 values(sop,1,'Disposable QA simulation only',true,'QA simulated evidence',true);
 update public.factory_production_sops set status='active' where id=sop;
 input_value:=jsonb_build_object('finished_good_id',sku,'target_production_qty',1,'uom','kg','planned_date',current_date,'due_date',current_date,'remarks','QA Factory Actions rollback Production');
 result_value:=pg_temp.factory_action_qa(op,'job_order.create',null,input_value);job:=(result_value->>'target_id')::uuid;
 perform pg_temp.factory_action_qa(op,'job_order.submit',job,'{}');
 human_actor:=public.factory_current_active_employee_id();
 perform public.factory_start_job_order(job,human_actor,'ignored client actor',current_date,'08:00','QA simulation',human_actor);
 select id into strict step_id from public.factory_production_step_executions where job_order_id=job;
 select id into strict qc_id from public.factory_production_qc_results where job_order_id=job;
 perform pg_temp.factory_action_qa(op,'production.update',job,jsonb_build_object('step_rows',jsonb_build_array(jsonb_build_object('id',step_id,'status','completed')),'qc_rows',jsonb_build_array(jsonb_build_object('id',qc_id,'checklist_result','pass'))));
 assert (select checked_by is null from public.factory_production_qc_results where id=qc_id),'Machine QC borrowed the human JWT actor';
 select id into strict raw_batch from public.factory_raw_material_batch_balances where raw_material_id=material and current_balance>0;
 input_value:=jsonb_build_object('payload',jsonb_build_object('finished_good_id',sku,'actual_pack_qty',1,'actual_output_qty',1,'uom','kg','end_date',current_date,'end_time','09:00','storage_location_id',location,'expiry_date',current_date+1,'production_no','QA-'||suffix,'notes','QA Factory Actions simulated Production',
 'usage_items',jsonb_build_array(jsonb_build_object('raw_material_id',material,'standard_usage',1,'actual_usage',1,'uom','kg','allocations',jsonb_build_array(jsonb_build_object('batch_balance_id',raw_batch,'allocated_qty',1))))));
 result_value:=pg_temp.factory_action_qa(op,'production.complete',job,input_value);production:=(result_value->>'target_id')::uuid;
 assert (select created_by is null and operator_id=human_actor and operator_name=(select production_operator_name from public.factory_job_orders where id=job) from public.factory_productions where id=production),'Production mixed machine recorder and physical operator';
 begin perform pg_temp.factory_action_qa(op,'production.verify',production,'{}');raise exception 'Agent verified its own Production';exception when insufficient_privilege then null;end;
 perform pg_temp.factory_action_qa(reviewer,'production.verify',production,'{}');
 assert (select current_balance from public.factory_raw_materials where id=material)=0,'Production usage/retry did not reconcile exactly';
 assert (select current_balance from public.factory_finished_goods where id=sku)=1,'Production output/retry did not reconcile exactly';
 select token into token_value from factory_action_qa_keys where identity_id=op;
 select role_id into role_value from feedx_integrations.machine_identities where id=op;
 second_token:='fxm_'||rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
 insert into feedx_integrations.machine_credentials(identity_id,token_hash,expires_at) values(op,encode(extensions.digest(second_token,'sha256'),'hex'),clock_timestamp()+interval '10 minutes');
 version_value:=public.factory_agent_action_context(second_token,'production.verify',production)->>'expected_version';
 begin perform public.factory_agent_execute_action(second_token,gen_random_uuid(),'production.verify',production,version_value,'{}');raise exception 'Second credential bypassed self-review';exception when insufficient_privilege then null;end;
 insert into factory_action_qa_results values('same_identity_second_credential_self_review','PASS');
 select id into permission_value from public.permissions where code='factory_agent_action_receiving.update';
 perform public.external_agents_set_capability(op,'receiving.update',false,true);
 begin perform public.factory_agent_action_context(token_value,'receiving.update',receiving);raise exception 'Missing action grant accepted through another Edit-like grant';exception when insufficient_privilege then null;end;
 perform public.external_agents_set_capability(op,'receiving.update',true,false);
 select id into permission_value from public.permissions where code='factory_agent_nav_factory_raw_receiving.view';
 perform public.external_agents_set_capability(op,'nav_factory_raw_receiving_view',false,true);
 begin perform public.factory_agent_action_context(token_value,'receiving.update',receiving);raise exception 'Missing View grant accepted';exception when insufficient_privilege then null;end;
 perform public.external_agents_set_capability(op,'nav_factory_raw_receiving_view',true,false);
 insert into factory_action_qa_results values('independent_action_and_view_denials_with_owner_jwt','PASS');
 select * into saved_request from feedx_integrations.factory_action_requests where identity_id=op and action='receiving.create' limit 1;
 begin perform public.factory_agent_execute_action(token_value,saved_request.request_id,saved_request.action,saved_request.target_id,saved_request.expected_version,saved_request.input||'{"remarks":"changed retry"}');raise exception 'Changed payload reused request ID';exception when invalid_parameter_value then null;end;
 begin perform public.factory_agent_execute_action(token_value,gen_random_uuid(),'receiving.cancel',receiving,'stale-version','{}');raise exception 'Stale version accepted';exception when serialization_failure then null;end;
 version_value:=public.factory_agent_action_context(token_value,'receiving.cancel',receiving)->>'expected_version';
 select count(*) into count_before from feedx_integrations.factory_action_requests where identity_id=op;
 begin perform public.factory_agent_execute_action(token_value,gen_random_uuid(),'receiving.cancel',receiving,version_value,'{}');raise exception using errcode='XX000',message='Completed Receiving cancelled';exception when raise_exception then null;end;
 assert (select count(*) from feedx_integrations.factory_action_requests where identity_id=op)=count_before,'Rejected transition left a request/receipt';
 insert into factory_action_qa_results values('payload_retry_stale_version_invalid_transition_atomicity','PASS');
 result_value:=feedx_integrations.review_effective_paths(array['receiving.update','nav_factory_raw_receiving_view']);
 assert exists(select 1 from jsonb_array_elements(result_value)v where v->>'resource'='action:receiving.update'),'Granted action path missing from review';
 assert not exists(select 1 from jsonb_array_elements(result_value)v where v->>'grant_name'='receiving.update' and v->>'resource'<>'action:receiving.update'),'Action falsely projected View authority';
 assert feedx_integrations.review_effective_paths(array['receiving.update'])='[]'::jsonb,'Missing View still projected executable action';
 insert into factory_action_qa_results values('action_view_access_projection','PASS');
 insert into public.factory_mesti_cleaning_requirements(task_name,recurrence_type,status,effective_from,logical_requirement_id,cleaning_method)
 values('QA Factory Actions Area '||suffix,'daily','inactive',current_date,gen_random_uuid(),public.factory_mesti_cleaning_methods()->0->>'code') returning id into area_req;
 insert into public.factory_mesti_cleaning_occurrences(requirement_id,logical_requirement_id,location_id,due_date,status,requirement_snapshot)
 select id,logical_requirement_id,location,current_date,'pending',jsonb_build_object('qa_fixture',suffix) from public.factory_mesti_cleaning_requirements where id=area_req returning id into area_occ;
 perform pg_temp.factory_action_qa(op,'area_cleaning.complete',area_occ,jsonb_build_object('note','Disposable QA simulation'));
 result_value:=public.factory_mesti_cleaning_task_action(area_req,current_date,'preview');
 assert result_value->>'verify_count'='1','Human task review did not recognize trusted Machine completion';
 select jsonb_build_object(id::text,md5(to_jsonb(o)::text)) into input_value from public.factory_mesti_cleaning_occurrences o where id=area_occ;
 result_value:=public.factory_mesti_cleaning_task_action(area_req,current_date,'verify',input_value);
 assert result_value->>'affected_count'='1','Human task verification of Machine evidence failed';
 insert into public.factory_storage_locations(location_name,status,is_storage_location) values('QA legacy unknown Actor '||suffix,'inactive',false) returning id into legacy_location;
 insert into public.factory_mesti_cleaning_occurrences(requirement_id,logical_requirement_id,location_id,due_date,status,completed_at,requirement_snapshot)
 select id,logical_requirement_id,legacy_location,current_date,'completed',now(),jsonb_build_object('qa_fixture',suffix) from public.factory_mesti_cleaning_requirements where id=area_req returning id into legacy_occ;
 assert not feedx_integrations.factory_cleaning_independent_verifier(legacy_occ,human_actor),'Unknown legacy Actor was treated as a Machine';
 assert not has_function_privilege('anon','public.factory_mesti_cleaning_task_action(uuid,date,text,jsonb)','execute'),'Machine acquired the human task action';
 insert into factory_action_qa_results values('human_cleaning_batch_machine_compatibility_legacy_denial','PASS');
end $$;
select * from factory_action_qa_results order by test;
rollback;
