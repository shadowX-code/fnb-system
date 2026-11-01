-- Projection-only synthetic request fixtures. No credentials, grants or business transitions.
begin;
create temp table factory_queue_results(test text,result text);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select e.auth_user_id from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null and e.enable_system_login and e.access_state='active' limit 1),'role','authenticated')::text,true);
do $$
declare agent uuid:='a8fe4694-93e2-4f27-b87d-e49d30ca245a'; location uuid; equipment uuid; req uuid; record_id uuid;
 legacy uuid:=gen_random_uuid(); legacy2 uuid:=gen_random_uuid(); approval uuid:=gen_random_uuid(); continuation uuid:=gen_random_uuid(); expired uuid:=gen_random_uuid(); stale uuid:=gen_random_uuid(); done uuid:=gen_random_uuid();
 expected text; data jsonb; item jsonb; original_hash text; actor uuid:=public.factory_current_active_employee_id();
 suffix text:=replace(gen_random_uuid()::text,'-','');
begin
 insert into public.factory_storage_locations(location_name,status,is_storage_location) values('QA rollback queue '||suffix,'active',false) returning id into location;
 insert into public.factory_equipment(equipment_code,name,current_location_id,status) values('QA-'||suffix,'QA rollback queue '||suffix,location,'active') returning id into equipment;
 insert into public.factory_mesti_calibration_requirements(equipment_id,calibration_type,interval_months,effective_from,status)
 values(equipment,'QA read projection only',1,current_date,'active') returning id into req;
 -- Calibration Create uses requirement evidence; no measurement or inspection is asserted.
 expected:=feedx_integrations.factory_action_version(feedx_integrations.factory_action_state('calibration.create',req));
 insert into feedx_integrations.factory_action_requests(identity_id,request_id,action,target_id,expected_version,input,payload_hash,status,confirmed_by,confirmed_at,receipt)
 values
 (agent,legacy,'area_cleaning.complete',null,null,jsonb_build_object('qa_fixture',suffix),'QA-'||suffix,'awaiting_confirmation',null,null,null),
 (agent,legacy2,'area_cleaning.complete',null,'different-source',jsonb_build_object('qa_fixture',suffix),'QA-'||suffix,'awaiting_confirmation',null,null,null),
 (agent,approval,'calibration.create',req,expected,jsonb_build_object('qa_fixture',suffix),'QA-'||suffix,'awaiting_confirmation',null,null,null),
 (agent,continuation,'calibration.create',req,expected,jsonb_build_object('qa_fixture',suffix),'QA-'||suffix,'confirmed',actor,clock_timestamp(),null),
 (agent,expired,'calibration.create',req,expected,jsonb_build_object('qa_fixture',suffix),'QA-'||suffix,'confirmed',actor,clock_timestamp()-interval '31 minutes',null),
 (agent,stale,'calibration.create',req,'stale-source',jsonb_build_object('qa_fixture',suffix),'QA-'||suffix,'awaiting_confirmation',null,null,null),
 (agent,done,'area_cleaning.complete',null,null,jsonb_build_object('qa_fixture',suffix),'QA-'||suffix,'completed',null,null,jsonb_build_object('status','completed','request_id',done,'completed_at',clock_timestamp()));
 select md5(string_agg(to_jsonb(r)::text,'' order by request_id)) into original_hash from feedx_integrations.factory_action_requests r where input->>'qa_fixture'=suffix;
 set local role authenticated;
 data:=public.external_agents_factory_action_requests(agent);
 reset role;
 for item in select * from jsonb_array_elements(data) loop
  if item->>'request_id' in (legacy::text,legacy2::text) then assert item->>'queue_state'='legacy_pending' and not (item->>'can_confirm')::boolean and not (item->>'can_continue')::boolean,'Legacy intent became an approval/continuation';
  elsif item->>'request_id'=approval::text then assert item->>'queue_state'='pending_approval' and (item->>'can_confirm')::boolean,'Valid approval missing';
  elsif item->>'request_id'=continuation::text then assert item->>'queue_state'='awaiting_execution' and (item->>'can_continue')::boolean,'Approved continuation missing';
  elsif item->>'request_id'=expired::text then assert item->>'queue_state'='expired' and not (item->>'can_continue')::boolean,'Expired approval actionable';
  elsif item->>'request_id'=stale::text then assert item->>'queue_state'='needs_resolution' and item->>'reason_code'='source_changed' and item->>'next_action' is not null and not (item->>'can_confirm')::boolean,'Stale evidence not explained';
  elsif item->>'request_id'=done::text then assert item->>'queue_state'='completed','Receipt absent from history';end if;
 end loop;
 assert (select count(*)=7 from jsonb_array_elements(data) as entries(value) where entries.value->'input'->>'qa_fixture'=suffix),'Requests combined or lost';
 assert original_hash=(select md5(string_agg(to_jsonb(r)::text,'' order by request_id)) from feedx_integrations.factory_action_requests r where input->>'qa_fixture'=suffix),'Read projection mutated request evidence';
 insert into factory_queue_results values('Legacy / approval / continuation / expired / stale / completed projections','PASS'),('Exact request identity and source distinctions retained','PASS'),('Read-only projection preserves saved intent, approval and receipt','PASS');
 perform set_config('request.jwt.claims','{}',true);
 set local role anon;
 begin perform public.external_agents_factory_action_requests(agent);raise exception 'Anonymous request history accepted';exception when insufficient_privilege then null;end;
 reset role;
 insert into factory_queue_results values('Anonymous history denied','PASS');
end $$;
select * from factory_queue_results order by test;
rollback;
