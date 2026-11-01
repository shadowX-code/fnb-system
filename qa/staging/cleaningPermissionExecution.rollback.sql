-- Staging only. Approved ephemeral QA Executive key; no grant changes.
-- Synthetic transitions are a rolled-back contract simulation, not physical-work attestations.
begin;
create temp table cleaning_permission_results(test text primary key, result text);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select e.auth_user_id from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null and e.enable_system_login and e.access_state='active' limit 1),'role','authenticated')::text,true);
do $$
declare actor uuid; agent uuid; location uuid; req uuid; human_occ uuid; agent_occ uuid; pending_occ uuid;
 equipment uuid; eq_req uuid; eq_occ uuid; token_value text; version_value text; request_value uuid;
 result_value jsonb; replay jsonb; preview jsonb; expected jsonb; human_claims text:=current_setting('request.jwt.claims');
 suffix text:=replace(gen_random_uuid()::text,'-','');
begin
 actor:=public.factory_current_active_employee_id();
 assert actor is not null,'Authorized Human QA context unavailable';
 select id into strict agent from feedx_integrations.machine_identities where id='a8fe4694-93e2-4f27-b87d-e49d30ca245a' and enabled;
 token_value:='fxm_'||rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
 insert into feedx_integrations.machine_credentials(identity_id,token_hash,expires_at)
 values(agent,encode(extensions.digest(token_value,'sha256'),'hex'),clock_timestamp()+interval '5 minutes');
 insert into public.factory_storage_locations(location_name,status,is_storage_location) values('QA rollback Cleaning permissions '||suffix,'active',false) returning id into location;
 insert into public.factory_mesti_cleaning_requirements(task_name,recurrence_type,status,effective_from,logical_requirement_id,cleaning_method)
 values('QA rollback Cleaning permissions '||suffix,'daily','inactive',current_date,gen_random_uuid(),public.factory_mesti_cleaning_methods()->0->>'code') returning id into req;
 insert into public.factory_mesti_cleaning_occurrences(requirement_id,logical_requirement_id,location_id,due_date,status,requirement_snapshot)
 select id,logical_requirement_id,location,current_date,'pending',jsonb_build_object('qa_fixture',suffix) from public.factory_mesti_cleaning_requirements where id=req returning id into human_occ;
 begin perform public.factory_mesti_verify_cleaning_occurrence(human_occ,'verified',null);raise exception 'Verify before Complete accepted';exception when object_not_in_prerequisite_state then null;end;
 perform public.factory_mesti_complete_cleaning_occurrence(human_occ,'Rollback-only synthetic QA, not physical work');
 begin perform public.factory_mesti_verify_cleaning_occurrence(human_occ,'invented',null);raise exception 'Invalid result accepted';exception when invalid_parameter_value then null;end;
 preview:=public.factory_mesti_cleaning_task_action(req,current_date,'preview');
 assert preview->>'verify_count'='1' and (preview->'records'->0->>'self_completed')::boolean,'Own completion not eligible for Monthly Verify';
 expected:=jsonb_build_object(human_occ::text,preview->'records'->0->>'token');
 result_value:=public.factory_mesti_cleaning_task_action(req,current_date,'verify',expected);
 assert result_value->>'affected_count'='1' and result_value->>'failed_count'='0','Same-Human bulk Verify failed';
 assert (select completed_by=actor and verified_by=actor and completed_at is not null and verified_at is not null and requirement_snapshot->>'qa_fixture'=suffix from public.factory_mesti_cleaning_occurrences where id=human_occ),'Human evidence/actor lost';
 assert exists(select 1 from public.audit_logs where metadata->>'target'=human_occ::text and action='factory_mesti_cleaning_verified' and metadata->'before'->>'status'='completed' and metadata->'after'->>'status'='verified'),'Bulk before/after audit missing';
 insert into cleaning_permission_results values('Human same-actor Area Complete / Monthly Verify + audit','PASS');
 insert into public.factory_equipment(equipment_code,name,current_location_id,status) values('QA-'||suffix,'QA rollback equipment '||suffix,location,'active') returning id into equipment;
 insert into public.factory_mesti_equipment_cleaning_requirements(logical_requirement_id,task_name,cleaning_method,status,effective_from)
 values(gen_random_uuid(),'QA rollback Cleaning equipment '||suffix,public.factory_mesti_cleaning_methods()->0->>'code','inactive',current_date) returning id into eq_req;
 insert into public.factory_mesti_equipment_cleaning_occurrences(requirement_id,logical_requirement_id,equipment_id,due_date,status,requirement_snapshot)
 select id,logical_requirement_id,equipment,current_date,'pending',jsonb_build_object('qa_fixture',suffix) from public.factory_mesti_equipment_cleaning_requirements where id=eq_req returning id into eq_occ;
 begin perform public.factory_mesti_verify_equipment_cleaning_occurrence(eq_occ,'verified',null);raise exception 'Equipment Verify before Complete accepted';exception when object_not_in_prerequisite_state then null;end;
 perform public.factory_mesti_complete_equipment_cleaning_occurrence(eq_occ,'Rollback-only synthetic QA');
 perform public.factory_mesti_verify_equipment_cleaning_occurrence(eq_occ,'verified','Rollback-only synthetic QA');
 assert (select completed_by=actor and verified_by=actor and status='verified' from public.factory_mesti_equipment_cleaning_occurrences where id=eq_occ),'Equipment same-Human Verify failed';
 insert into cleaning_permission_results values('Human same-actor Equipment Complete / Verify','PASS');
 -- Separate fixture/date prevents duplicate issuance for the Human row.
 insert into public.factory_mesti_cleaning_occurrences(requirement_id,logical_requirement_id,location_id,due_date,status,requirement_snapshot)
 select id,logical_requirement_id,location,current_date-1,'pending',jsonb_build_object('qa_fixture',suffix) from public.factory_mesti_cleaning_requirements where id=req returning id into agent_occ;
 perform set_config('request.jwt.claims','{}',true);
 set local role anon;
 begin perform public.factory_mesti_complete_cleaning_occurrence(agent_occ,null);raise exception 'Anonymous Human authority accepted';exception when insufficient_privilege then null;end;
 begin perform public.factory_agent_action_context(token_value,'equipment_cleaning.verify',eq_occ);raise exception 'Ungranted Equipment capability accepted';exception when insufficient_privilege then null;end;
 result_value:=public.factory_agent_action_context(token_value,'area_cleaning.verify',agent_occ);
 version_value:=result_value->>'expected_version';
 begin perform public.factory_agent_execute_action(token_value,gen_random_uuid(),'area_cleaning.verify',agent_occ,version_value,'{}');raise exception 'Agent Verify before Complete accepted';exception when object_not_in_prerequisite_state then null;end;
 result_value:=public.factory_agent_action_context(token_value,'area_cleaning.complete',agent_occ);
 assert result_value->'execution'->>'execution_policy'='autonomous','Cleaning still demands confirmation';
 version_value:=result_value->>'expected_version';request_value:=gen_random_uuid();
 result_value:=public.factory_agent_execute_action(token_value,request_value,'area_cleaning.complete',agent_occ,version_value,'{"note":"Rollback-only synthetic QA, not physical work"}');
 assert result_value->>'status'='completed','Agent Complete demanded Human confirmation';
 replay:=public.factory_agent_execute_action(token_value,request_value,'area_cleaning.complete',agent_occ,version_value,'{"note":"Rollback-only synthetic QA, not physical work"}');
 assert (replay->>'replayed')::boolean,'Complete retry not idempotent';
 begin perform public.factory_agent_execute_action(token_value,request_value,'area_cleaning.complete',agent_occ,version_value,'{"note":"changed"}');raise exception 'Request ID reused with changed intent';exception when invalid_parameter_value then null;end;
 version_value:=public.factory_agent_action_context(token_value,'area_cleaning.verify',agent_occ)->>'expected_version';
 begin perform public.factory_agent_execute_action(token_value,gen_random_uuid(),'area_cleaning.verify',agent_occ,version_value,'{"result":"invented"}');raise exception 'Agent invalid evidence accepted';exception when invalid_parameter_value then null;end;
 request_value:=gen_random_uuid();
 result_value:=public.factory_agent_execute_action(token_value,request_value,'area_cleaning.verify',agent_occ,version_value,'{"result":"verified","note":"Rollback-only synthetic QA"}');
 assert result_value->>'status'='completed' and result_value->'actor'->>'identity_id'=agent::text,'Same-Agent Verify failed';
 replay:=public.factory_agent_execute_action(token_value,request_value,'area_cleaning.verify',agent_occ,version_value,'{"result":"verified","note":"Rollback-only synthetic QA"}');
 assert (replay->>'replayed')::boolean,'Verify retry duplicated a mutation';
 reset role;
 perform set_config('request.jwt.claims',human_claims,true);
 assert (select count(*)=2 and bool_and(status='completed' and confirmed_by is null and receipt->'actor'->>'identity_id'=agent::text) from feedx_integrations.factory_action_requests where identity_id=agent and target_id=agent_occ),'Direct receipts/identity were not preserved';
 assert (select status='verified' and completed_by is null and verified_by is null and completed_at is not null and verified_at is not null and requirement_snapshot->>'qa_fixture'=suffix from public.factory_mesti_cleaning_occurrences where id=agent_occ),'Machine fabricated Employee or lost evidence';
 assert (select count(*)=2 from public.audit_logs where action='external_agent_factory_action_completed' and metadata->'actor'->>'identity_id'=agent::text and metadata->>'target_id'=agent_occ::text),'Machine audit missing';
 assert feedx_integrations.factory_execution_policy('calibration.verify')->>'execution_policy'='human_approval','Calibration policy changed';
 assert feedx_integrations.factory_execution_policy('production.verify')->>'execution_policy'='conditional','Production policy changed';
 insert into cleaning_permission_results values('Agent direct same-identity Complete / Verify, immutable receipts and audits','PASS'),('Permission denial / lifecycle / result validation / changed-intent denial / retries','PASS'),('Unrelated execution policies retained','PASS');
end $$;
select * from cleaning_permission_results order by test;
rollback;
