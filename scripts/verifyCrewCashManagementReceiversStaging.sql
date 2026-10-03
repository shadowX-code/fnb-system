-- Staging only. All fixture/configuration/financial writes roll back together.
-- Run with: supabase db query --linked --project-ref ujkzdaaadnvcfayuldmh --file <this file>
do $qa$
declare
 outlet constant uuid:='e804c48d-6343-4bf8-99d7-9893c473948f';
 other_outlet constant uuid:='3765b7c2-af02-4fef-8a20-fd326ae50f64';
 crew constant uuid:='241e226a-b8b8-4b8c-8249-5c99d2bbfb2a';
 admin_id constant uuid:='266912cf-0e84-4074-82b5-0fc483080741';
 management uuid:=gen_random_uuid(); unauthorized uuid:=gen_random_uuid();
 management_token text:=gen_random_uuid()::text; unauthorized_token text:=gen_random_uuid()::text; crew_token text:=gen_random_uuid()::text;
 version integer; payload jsonb; receipt jsonb; original_balance numeric; original_collections bigint; prior_ids uuid[];
begin
 original_balance:=public.crew_cash_balance(outlet);
 select count(*) into original_collections from public.crew_cash_collections;
 begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  -- New disposable employees use EXISTING Role outlet scope, with no initiation grant.
  -- No existing employee/Role/Special Access is changed.
  insert into public.employees(id,full_name,workplace,role_id) values
   (management,'Rollback QA Cash Management','Management','fe3bd933-c86e-4c92-be6a-bc56cfc48ef3'),
   (unauthorized,'Rollback QA Cash Unauthorized','Management','25fe9c29-c161-453b-8280-305a1ae1a4bf');
  insert into public.crew_access(employee_id,mobile_number,passcode_hash) values
   (management,'qa-'||management::text,'unusable-rollback-fixture'),(unauthorized,'qa-'||unauthorized::text,'unusable-rollback-fixture');
  insert into public.crew_sessions(employee_id,token_hash,expires_at) values
   (management,encode(extensions.digest(management_token,'sha256'),'hex'),now()+interval '10 minutes'),
   (unauthorized,encode(extensions.digest(unauthorized_token,'sha256'),'hex'),now()+interval '10 minutes'),
   (crew,encode(extensions.digest(crew_token,'sha256'),'hex'),now()+interval '10 minutes');
  if not public.crew_cash_receiver_candidate_is_eligible(outlet,crew)
   or not public.crew_cash_receiver_candidate_is_eligible(outlet,management)
   or public.crew_cash_receiver_candidate_is_eligible(outlet,unauthorized)
   or public.crew_cash_receiver_candidate_is_eligible(other_outlet,management)
  then raise exception 'Candidate outlet eligibility failed'; end if;
  payload:=public.crew_cash_admin_context(outlet);
  if not exists(select 1 from jsonb_array_elements(payload->'employees') e where e->>'id'=management::text and e->>'workplace'='Management')
   or exists(select 1 from jsonb_array_elements(payload->'employees') e where e->>'id'=unauthorized::text)
  then raise exception 'Admin selector candidate scope failed'; end if;
  if public.crew_cash_receiver_is_eligible(outlet,management) then raise exception 'Role scope automatically granted receiving'; end if;
  begin
   perform public.crew_management_cash_mobile(management_token,outlet,current_date);
   raise exception 'Unselected Management cash read accepted';
  exception when insufficient_privilege then null; end;
  insert into public.crew_cash_handover_receiver_configs(outlet_id) values(outlet) on conflict do nothing;
  select c.version into version from public.crew_cash_handover_receiver_configs c where c.outlet_id=outlet;
  select coalesce(array_agg(employee_id),'{}') into prior_ids from public.crew_cash_handover_receivers where outlet_id=outlet;
  perform public.crew_cash_save_handover_receivers(outlet,array[crew,management],version);
  begin
   perform public.crew_cash_save_handover_receivers(outlet,array[management],version);
   raise exception 'Stale config version accepted';
  exception when serialization_failure then null; end;
  begin
   perform public.crew_cash_save_handover_receivers(outlet,array[unauthorized],version+1);
   raise exception 'Unauthorized Management receiver save accepted';
  exception when invalid_parameter_value then null; end;
  payload:=public.crew_cash_admin_context(outlet);
  if jsonb_array_length(payload->'eligible_receivers')<>2 then raise exception 'Receiver save/readback failed'; end if;
  if public.crew_can_initiate_cash_handover(management,outlet) then raise exception 'Receiving implies initiation'; end if;
  payload:=public.crew_outlet_scope(management_token);
  if not exists(select 1 from jsonb_array_elements(payload->'outlets') o where o->>'id'=outlet::text and (o->>'is_cash_handover_receiver')::boolean)
  then raise exception 'Management Me receipt entry unavailable'; end if;
  payload:=public.crew_management_cash_mobile(management_token,outlet,current_date);
  if (payload->>'can_initiate_handover')::boolean or (payload->>'can_perform')::boolean or payload->'deposit'<>'null'::jsonb
  then raise exception 'Receiver-only projection leaks cash authority'; end if;
  begin
   perform public.crew_management_cash_mobile(unauthorized_token,outlet,current_date);
   raise exception 'Unauthorized Management outlet read accepted';
  exception when insufficient_privilege then null; end;
  begin
   perform public.crew_management_cash_scope(management_token,outlet);
   raise exception 'Receiver-only initiation accepted';
  exception when insufficient_privilege then null; end;
  -- Require receipt only in this rollback transaction; preserve real settings.
  insert into public.crew_cash_settings(outlet_id,require_receiver_confirmation) values(outlet,true)
   on conflict(outlet_id) do update set require_receiver_confirmation=true;
  receipt:=public.crew_cash_record_collection(crew_token,jsonb_build_object('request_id',gen_random_uuid(),'receiver_employee_id',management,'amount',1,'purpose','Rollback receiver authority QA'));
  if receipt->>'status'<>'pending_receipt' or (receipt->>'receiver_employee_id')::uuid<>management then raise exception 'Crew to Management handover failed'; end if;
  payload:=public.crew_management_cash_mobile(management_token,outlet,current_date);
  if not exists(select 1 from jsonb_array_elements(payload->'pending_receipts') r where r->>'id'=receipt->>'id') then raise exception 'Assigned receipt absent'; end if;
  begin
   perform public.crew_cash_confirm_collection(unauthorized_token,(receipt->>'id')::uuid,1);
   raise exception 'Wrong receiver confirmation accepted';
  exception when insufficient_privilege then null; end;
  begin
   perform public.crew_cash_confirm_collection(management_token,(receipt->>'id')::uuid,2);
   raise exception 'Incorrect amount accepted';
  exception when invalid_parameter_value then null; end;
  -- Removing future eligibility must not discard an existing assignment.
  perform public.crew_cash_save_handover_receivers(outlet,array[crew],version+1);
  payload:=public.crew_management_cash_mobile(management_token,outlet,current_date);
  if jsonb_array_length(payload->'pending_receipts')<>1 then raise exception 'Existing receiver assignment lost'; end if;
  payload:=public.crew_cash_confirm_collection(management_token,(receipt->>'id')::uuid,1);
  if payload->>'status'<>'completed' or (payload->>'received_by_employee_id')::uuid<>management
   or public.crew_cash_balance(outlet)<>original_balance-1
   or (select count(*) from public.crew_cash_ledger_entries where collection_id=(receipt->>'id')::uuid)<>1
  then raise exception 'Management confirmation or financial evidence changed'; end if;
  payload:=public.crew_cash_admin_record_collection(outlet,jsonb_build_object('request_id',gen_random_uuid(),'receiver_employee_id',crew,'amount',1,'purpose','Rollback Crew receiver regression QA'));
  perform public.crew_cash_confirm_collection(crew_token,(payload->>'id')::uuid,1);
  if public.crew_cash_balance(outlet)<>original_balance-2 then raise exception 'Crew receiver regression'; end if;
  begin
   perform public.crew_cash_admin_record_collection(outlet,jsonb_build_object('request_id',gen_random_uuid(),'receiver_employee_id',unauthorized,'amount',1,'purpose','Rollback denied receiver QA'));
   raise exception 'Unauthorized receiver handover accepted';
  exception when insufficient_privilege then null; end;
  raise exception 'qa_receiver_rollback';
 exception when others then
  if sqlerrm<>'qa_receiver_rollback' then raise; end if;
 end;
 if public.crew_cash_balance(outlet)<>original_balance
  or (select count(*) from public.crew_cash_collections)<>original_collections
  or exists(select 1 from public.employees where id in (management,unauthorized))
 then raise exception 'QA rollback did not restore operational state'; end if;
end $qa$;
select 'PASS: Crew, explicitly selected Role-authorized Management, unauthorized Management, concurrency, receipt confirmation, independent initiation and rollback' as result;
