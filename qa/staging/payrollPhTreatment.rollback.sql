-- STAGING ONLY: synthetic canonical commands, fully rolled back.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from employees e join roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
create temp table ph_treatment_documents(manifest jsonb);
create function pg_temp.confirm_ph(input jsonb) returns jsonb language plpgsql as $$declare fingerprint text; q jsonb; result jsonb; gross_before numeric; gross_after numeric; events_before bigint;begin
 select count(*) into events_before from payroll_events;
 q:=payroll_ph_treatment_preview(input);
 if (select count(*) from payroll_events)<>events_before then raise exception 'Preview wrote audit evidence';end if;
 gross_before:=(payroll_calculation_project((input->>'run_id')::uuid,(input->>'employee_id')::uuid)->>'gross_earnings')::numeric;
 select evidence#>>'{intent,quote_fingerprint}' into fingerprint from payroll_ph_eligibility_reviews where request_id=(input->>'request_id')::uuid;
 result:=payroll_ph_statutory_confirm(input||jsonb_build_object('quote_fingerprint',coalesce(fingerprint,q->>'quote_fingerprint')));
 gross_after:=(payroll_calculation_project((input->>'run_id')::uuid,(input->>'employee_id')::uuid)->>'gross_earnings')::numeric;
 if q#>>'{pay_preview,determinate}'='true' and gross_after-gross_before<>(q#>>'{pay_preview,payroll_change}')::numeric then raise exception 'Financial preview/Gross delta mismatch: % => % quote %',gross_before,gross_after,q;end if;
 return result;
end $$;
do $$
declare actor uuid:=payroll_admin_actor(); ent uuid; outlet uuid; emp uuid; profile uuid; run uuid; prior_run uuid; pub uuid; augpub uuid; calendar uuid; prev uuid; h uuid; h2 uuid; day date; i integer; basis text; category text; read jsonb; input jsonb; result jsonb; saved jsonb; before_hash text; evidence jsonb; t payroll_payable_time_versions%rowtype; snapshot_hash text; approved uuid; roster uuid; workplace text:='QA ONLY PH Treatment '||substr(gen_random_uuid()::text,1,8);
begin
 select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) into snapshot_hash from payroll_run_calculation_snapshots s;
 insert into legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id) values('QA ONLY PH Treatment','QA-PHP-'||substr(gen_random_uuid()::text,1,8),'STAGING ONLY',actor,actor) returning id into ent;
 insert into outlets(name,code,state_code) values(workplace,'QA-PHP-'||substr(gen_random_uuid()::text,1,8),'MY-08') returning id into outlet;
 perform set_config('feedx.payroll_command','yes',true);
 insert into payroll_outlet_state_versions(outlet_id,effective_from,state_code) values(outlet,'2026-08-01','MY-08');
 h:=payroll_holiday_save('2026-09-16','QA ONLY Profile PH one','national','QA ONLY synthetic fixture');
 h2:=payroll_holiday_save('2026-09-17','QA ONLY Profile PH two','national','QA ONLY synthetic fixture');
 select id into prev from payroll_holiday_calendar_versions where year=2026 order by revision desc limit 1;
 calendar:=payroll_holiday_calendar_save(2026,coalesce((select entries from payroll_holiday_calendar_versions where id=prev),'[]')||jsonb_build_array(jsonb_build_object('holiday_id',h,'kind','required','source_reference','QA ONLY'),jsonb_build_object('holiday_id',h2,'kind','required','source_reference','QA ONLY')),'QA ONLY',true,true,prev,gen_random_uuid());
 perform payroll_paid_holiday_policy_save('QA ONLY PH Treatment policy',calendar,(select array_agg((x->>'holiday_id')::uuid) from payroll_holiday_calendar_versions c cross join lateral jsonb_array_elements(c.entries) x where c.id=calendar and x->>'kind'='required'),array[ent],'{}',null,true,null,gen_random_uuid());
 insert into duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by) values(outlet,'2026-09-14','2026-09-20',1,auth.uid()) returning id into pub;
 insert into duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by) values(outlet,'2026-08-17','2026-08-23',1,auth.uid()) returning id into augpub;
 for i in 1..3 loop
  basis:=case when i=1 then 'monthly' else 'hourly' end;category:=case when i=3 then 'part_time' else 'full_time' end;
  insert into employees(full_name,employee_code,legal_entity_id,workplace,position,employment_type,employment_status,joined_date,birthday,nationality,enable_system_login,access_state) values('QA ONLY PH Treatment '||i,'QA-PHP-'||substr(gen_random_uuid()::text,1,8),ent,workplace,'Service Crew',category,'active','2026-08-01','1990-01-01','Malaysia',false,'no_access') returning id into emp;
  perform employee_employment_assignment_save(emp,'2026-08-01',jsonb_build_object('employment_type',category,'employment_status','active','position','Service Crew','workplace',workplace,'legal_entity_id',ent),'QA verified employment',null,'QA synthetic evidence');
  profile:=payroll_profile_create(emp,'2026-08-01',basis,case when basis='monthly' then 2600 else 8 end,'MYR','QA verified pay',null,outlet,false,false,false,false);
  if i=1 then run:=payroll_run_create(ent,'2026-09-01','2026-09-30','QA ONLY Profile review'); end if;
  read:=payroll_ph_profile_read(emp,'2026-09-16');
  if read->>'profile_status'<>'review_required' then raise exception 'Profile silently inferred'; end if;
  -- Missing reusable evidence is preserved; explicit custom resolves money only.
  read:=payroll_ph_statutory_project(run,emp,'2026-09-16');
  input:=jsonb_build_object('run_id',run,'employee_id',emp,'date','2026-09-16','decision','paid_not_worked','treatment','custom','amount',37.25,'reason','QA approved explicit allowance','request_id',gen_random_uuid(),'context_fingerprint',read->>'context_fingerprint');
  begin perform pg_temp.confirm_ph(input);raise exception 'Warning acknowledgement bypassed';exception when others then if sqlerrm<>'Acknowledge the compliance warning before confirming this override.' then raise;end if;end;
  input:=input||jsonb_build_object('acknowledge_warning',true);
  begin perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);perform payroll_ph_treatment_preview(input);raise exception 'Unauthorized PH preview';exception when insufficient_privilege then null;end;
  begin perform payroll_ph_statutory_confirm(input||jsonb_build_object('amount',39,'quote_fingerprint',payroll_ph_treatment_preview(input)->>'quote_fingerprint'));raise exception 'Stale amount quote accepted';exception when serialization_failure then null;end;
  perform pg_temp.confirm_ph(input);perform pg_temp.confirm_ph(input);
  read:=payroll_ph_statutory_project(run,emp,'2026-09-16');
  if jsonb_array_length(read->'issues')<>0 or (read#>>'{lines,0,amount}')::numeric<>37.25 or not (read->'warnings' ? 'ph_statutory_amount_undetermined') then raise exception 'Missing profile blocks explicit custom: %',read;end if;
  if (select count(*) from payroll_ph_profile_versions where profile_id=profile)<>0 then raise exception 'Override manufactured statutory evidence';end if;
  before_hash:=md5((read->'review')::text);
  result:=payroll_ph_treatment_preview(input||jsonb_build_object('amount',42.75));
  perform pg_temp.confirm_ph(input||jsonb_build_object('request_id',gen_random_uuid(),'amount',42.75,'context_fingerprint',read->>'context_fingerprint','reason','QA audited correction'));
  begin perform payroll_ph_statutory_confirm(input||jsonb_build_object('request_id',gen_random_uuid(),'amount',42.75,'quote_fingerprint',result->>'quote_fingerprint'));raise exception 'Obsolete prior-review quote accepted';exception when serialization_failure then null;end;
  read:=payroll_ph_statutory_project(run,emp,'2026-09-16');
  if (read#>>'{lines,0,amount}')::numeric<>42.75 or jsonb_array_length(read->'history')<>2 or md5((read#>'{history,1}')::text)<>before_hash then raise exception 'Correction did not append effective allowance';end if;
  begin perform pg_temp.confirm_ph(input||jsonb_build_object('request_id',gen_random_uuid(),'treatment','statutory'));raise exception 'Unknown statutory evidence accepted';exception when others then if sqlerrm<>'Statutory amount cannot be determined automatically.' then raise;end if;end;
  read:=payroll_ph_profile_read(emp,'2026-09-16');
  evidence:=jsonb_build_object('coverage',category,'schedule_category','general','normal_minutes',case when i=3 then 240 else 480 end,'normal_weekly_minutes',case when i=3 then 1200 else 2400 end,'schedule_monthly_wages',2600,'monthly_ordinary_wages',2600,'company_overlap','not_applicable');
  if i=3 then evidence:=evidence||jsonb_build_object('comparable_full_time_minutes',480,'part_time_weekly_minutes',1200,'comparable_weekly_minutes',2400,'regular_contract_not_home_or_casual',true); end if;
  input:=jsonb_build_object('employee_id',emp,'effective_from','2026-09-01','basis_fingerprint',read->>'basis_fingerprint','evidence',evidence,'reference','QA ONLY verified contract + category','reason','QA reusable coverage','request_id',gen_random_uuid());
  saved:=payroll_ph_profile_save(input); perform payroll_ph_profile_save(input);
  if (select count(*) from payroll_ph_profile_versions where profile_id=profile)<>1 then raise exception 'Profile retry duplicated'; end if;
  begin perform payroll_ph_profile_save(input||jsonb_build_object('reason','Changed')); raise exception 'Changed retry accepted'; exception when others then if sqlerrm<>'PH profile request changed' then raise; end if; end;
  begin perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);perform payroll_ph_profile_read(emp,'2026-09-16');raise exception 'Unauthorized profile read';exception when insufficient_privilege then null;end;
  if payroll_ph_profile_read(emp,'2026-08-31')->>'profile_status'<>'review_required' then raise exception 'Later profile proves earlier history'; end if;
  begin perform payroll_ph_profile_save(input||jsonb_build_object('employee_id',gen_random_uuid(),'request_id',gen_random_uuid()));raise exception 'Wrong employee scope accepted';exception when insufficient_privilege then null;end;
  read:=payroll_ph_profile_read(emp,'2026-09-17');
  if read#>>'{revision,id}'<>saved->>'id' or read->>'profile_status'<>'verified' then raise exception 'Dated profile not reused'; end if;
  if i>1 then
   if read->>'status'<>'review_required' or read#>>'{wages,status}'<>'review_required' then raise exception 'Historical wages inferred'; end if;
   perform payroll_ph_wage_evidence_save(jsonb_build_object('employee_id',emp,'legal_entity_id',ent,'period_start','2026-08-01','qualifying_wages',1040,'worked_days',20,'source_fingerprint',read#>>'{wages,source_fingerprint}','reference','QA ONLY missing August wage ledger','reason','QA explicit historical evidence','request_id',gen_random_uuid()));
  end if;
  foreach day in array array['2026-09-16'::date,'2026-09-17'::date] loop
   read:=payroll_ph_statutory_project(run,emp,day);
   input:=jsonb_build_object('run_id',run,'employee_id',emp,'date',day,'context_fingerprint',read->>'context_fingerprint','decision','paid_not_worked','treatment','statutory','reason','QA reviewed eligible paid day','request_id',gen_random_uuid());
   result:=pg_temp.confirm_ph(input); perform pg_temp.confirm_ph(input);
   read:=payroll_ph_statutory_project(run,emp,day);
   if jsonb_array_length(read->'issues')<>0 then raise exception 'Verified occurrence remains blocked: %',read; end if;
   if i>1 and (read#>>'{lines,0,amount}')::numeric<>52 then raise exception 'Hourly paid day wrong'; end if;
   if i=1 and jsonb_array_length(read->'lines')<>0 then raise exception 'Monthly basic duplicated'; end if;
  end loop;
  if (select count(*) from payroll_ph_profile_versions where profile_id=profile)<>1 or (i>1 and (select count(*) from payroll_ph_wage_evidence_versions where profile_id=profile)<>1) then raise exception 'Reusable setup repeated per day'; end if;
  -- Explicit work / correction uses the existing append-only time authority.
  insert into duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at) values(pub,outlet,emp,'2026-09-16','09:00',case when i=3 then '13:00'::time else '17:00'::time end,0,'working',workplace,now());
  perform payroll_time_reconcile(ent,'2026-09-16','2026-09-16');
  read:=payroll_ph_statutory_project(run,emp,'2026-09-16');
  input:=jsonb_build_object('run_id',run,'employee_id',emp,'date','2026-09-16','context_fingerprint',read->>'context_fingerprint','decision','approve_roster','treatment','statutory','reason','QA explicit roster after absence review','request_id',gen_random_uuid());
  perform pg_temp.confirm_ph(input);
  read:=payroll_ph_statutory_project(run,emp,'2026-09-16');
  if jsonb_array_length(read->'issues')<>0 then raise exception 'Worked profile pricing blocked: %',read;end if;
  select * into t from payroll_payable_time_versions where employee_id=emp and work_date='2026-09-16' order by revision desc limit 1;
  approved:=t.id;before_hash:=md5(to_jsonb(t)::text);
  perform pg_temp.confirm_ph(input||jsonb_build_object('request_id',gen_random_uuid(),'context_fingerprint',read->>'context_fingerprint','decision','adjust','approved_minutes',t.approved_minutes,'extra_minutes',60,'reason','QA explicit PH overtime correction'));
  if (select md5(to_jsonb(v)::text) from payroll_payable_time_versions v where id=approved)<>before_hash then raise exception 'Time history overwritten'; end if;
  read:=payroll_calculation_project(run,emp);
  if not exists(select 1 from jsonb_array_elements(read->'lines') x where x->>'code'='public_holiday_ot') then raise exception 'PH OT missing';end if;
  if (select sum((x->>'amount')::numeric) from jsonb_array_elements(payroll_earning_groups(read)) x)<>(read->>'gross_earnings')::numeric then raise exception 'Gross aggregation mismatch';end if;
  if i=2 then
   -- Real canonical Attendance + benefit authority, not a client-supplied amount.
   select id into roster from duty_roster_published_entries where publication_id=pub and employee_id=emp and roster_date='2026-09-16';
   insert into crew_attendance_records(employee_id,outlet_id,clock_in_at,clock_out_at,clock_in_source,clock_out_source,status,scheduled_roster_entry_id,scheduled_roster_publication_id,scheduled_start_at,scheduled_end_at,scheduled_published_at,scheduled_entry_type)
   values(emp,outlet,'2026-09-16 09:00+08','2026-09-16 17:00+08','admin','admin','completed',roster,pub,'2026-09-16 09:00+08','2026-09-16 17:00+08',now(),'working');
   perform payroll_ph_policy_save(ent,'2026-09-01','additional_pay','QA explicit independent company benefit');
   perform payroll_time_reconcile(ent,'2026-09-16','2026-09-16');
   select * into t from payroll_payable_time_versions where employee_id=emp and work_date='2026-09-16' order by revision desc limit 1;
   perform payroll_time_decision_save(jsonb_build_object('run_id',run,'time_version_id',t.id,'request_id',gen_random_uuid(),'correction',t.status<>'review_required','action','adjust','approved_minutes',480,'extra_minutes',0,'classification','public_holiday','reason','QA actual PH Attendance'));
   result:=payroll_ph_work_project(run,emp,'2026-09-16');
   if result is null then raise exception 'Canonical company evidence unavailable';end if;
   perform payroll_ph_work_confirm(run,emp,'2026-09-16','additional_pay',result->>'source_fingerprint',gen_random_uuid(),'QA company Additional Pay');
   read:=payroll_ph_statutory_project(run,emp,'2026-09-16');
   input:=jsonb_build_object('run_id',run,'employee_id',emp,'date','2026-09-16','decision','keep_approved','treatment','custom','amount',50,'acknowledge_warning',true,'reason','QA inclusive benefit avoids duplicate cash','request_id',gen_random_uuid(),'context_fingerprint',read->>'context_fingerprint','company_overlap','inclusive_top_up');
   perform pg_temp.confirm_ph(input);read:=payroll_ph_statutory_project(run,emp,'2026-09-16');
   if jsonb_array_length(read->'issues')<>0 or (select sum((x->>'amount')::numeric) from jsonb_array_elements(read->'lines') x)<>64 then raise exception 'Inclusive benefit duplicated: %',read;end if;
   perform pg_temp.confirm_ph(input||jsonb_build_object('request_id',gen_random_uuid(),'company_overlap','additional_to_statutory','reason','QA genuinely additional benefit'));
   read:=payroll_ph_statutory_project(run,emp,'2026-09-16');
   if (select sum((x->>'amount')::numeric) from jsonb_array_elements(read->'lines') x)<>114 then raise exception 'Independent additional benefit lost';end if;
   -- Restore PH OT through canonical decision for the following custom OT contract.
   select * into t from payroll_payable_time_versions where employee_id=emp and work_date='2026-09-16' order by revision desc limit 1;
   perform payroll_time_decision_save(jsonb_build_object('run_id',run,'time_version_id',t.id,'request_id',gen_random_uuid(),'correction',true,'action','adjust','approved_minutes',480,'extra_minutes',60,'classification','public_holiday_ot','reason','QA restored PH overtime'));
  end if;
  -- Explicit custom PH OT remains its own evidence/code and exactly reconciles.
  read:=payroll_ph_statutory_project(run,emp,'2026-09-16');
  input:=jsonb_build_object('run_id',run,'employee_id',emp,'date','2026-09-16','decision','keep_approved','treatment','custom','company_overlap','not_applicable','amount',50,'ot_amount',17,'acknowledge_warning',true,'reason','QA separately confirmed normal and PH OT allowances','request_id',gen_random_uuid(),'context_fingerprint',read->>'context_fingerprint');
  perform pg_temp.confirm_ph(input);
  read:=payroll_ph_statutory_project(run,emp,'2026-09-16');
  if (read#>>'{lines,0,amount}')::numeric<>50 or (read#>>'{lines,1,amount}')::numeric<>17 or read#>>'{lines,1,code}'<>'public_holiday_ot' then raise exception 'Custom OT was merged or guessed';end if;
  result:=payroll_calculation_project(run,emp);
  if (select sum((x->>'amount')::numeric) from jsonb_array_elements(payroll_earning_groups(result)) x)<>(result->>'gross_earnings')::numeric then raise exception 'Custom Gross mismatch';end if;
  insert into ph_treatment_documents values(jsonb_build_object('draft',payroll_payslip_document('{"employer":"QA ONLY","employee_name":"QA PH 陈"}','2026-09-01','2026-09-30',null,result,jsonb_build_object('net_pay',(result->>'gross_earnings')::numeric,'lines','[]'::jsonb),true),'final',payroll_payslip_document('{"employer":"QA ONLY","employee_name":"QA PH 陈"}','2026-09-01','2026-09-30','2026-10-04T00:00:00Z',result,jsonb_build_object('net_pay',(result->>'gross_earnings')::numeric,'lines','[]'::jsonb),false)));
  -- Correction retains original time; missing statutory comparison remains warning.
  if (select md5(to_jsonb(v)::text) from payroll_payable_time_versions v where id=approved)<>before_hash then raise exception 'Override edited approved time';end if;
  begin update payroll_ph_profile_versions set reason='overwrite' where id=(saved->>'id')::uuid;raise exception 'Profile mutable';exception when sqlstate '55000' then null;end;
  begin perform pg_temp.confirm_ph(input||jsonb_build_object('request_id',gen_random_uuid(),'evidence',evidence));raise exception 'Day legal override accepted';exception when others then if sqlerrm not like 'Submit an occurrence decision%' then raise;end if;end;
  -- Explicit zero is not statutory compliance; warnings and prior decisions remain.
  read:=payroll_ph_statutory_project(run,emp,'2026-09-17');
  perform pg_temp.confirm_ph(input||jsonb_build_object('request_id',gen_random_uuid(),'date','2026-09-17','context_fingerprint',read->>'context_fingerprint','decision','paid_not_worked','treatment','none','acknowledge_warning',true,'reason','QA explicit zero with statutory compliance warning'));
  read:=payroll_ph_statutory_project(run,emp,'2026-09-17');
  if jsonb_array_length(read->'issues')<>0 or jsonb_array_length(read->'lines')<>0 or not (read->'warnings' ? 'ph_no_additional_pay_entitlement_may_be_due') then raise exception 'Zero lost compliance warning';end if;
  -- Genuine future employment changes invalidate the later profile only.
  if i=3 then
   perform employee_employment_assignment_save(emp,'2026-10-01',jsonb_build_object('employment_type','full_time','employment_status','active','position','Service Crew','workplace',workplace,'legal_entity_id',ent),'QA genuine employment change',(employee_employment_assignment_at(emp,'2026-10-01')).id,'QA verified future contract change');
   if payroll_ph_profile_read(emp,'2026-10-01')->>'profile_status'<>'review_required' or payroll_ph_profile_read(emp,'2026-09-16')->>'profile_status'<>'verified' then raise exception 'Employment change overwrote historical profile';end if;
  end if;
  -- Real canonical preceding Payroll/time derives wages after source changes;
  -- the manually confirmed source-bound history must no longer apply.
  if i=2 then
   insert into duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at) values(augpub,outlet,emp,'2026-08-20','09:00','14:00',0,'working',workplace,now());
   prior_run:=payroll_run_create(ent,'2026-08-01','2026-08-31','QA ONLY canonical preceding wages');
   perform payroll_time_reconcile(ent,'2026-08-20','2026-08-20');
   select * into t from payroll_payable_time_versions where employee_id=emp and work_date='2026-08-20' order by revision desc limit 1;
   perform payroll_time_decision_save(jsonb_build_object('run_id',prior_run,'time_version_id',t.id,'correction',false,'request_id',gen_random_uuid(),'action','adjust','approved_minutes',300,'extra_minutes',0,'classification','regular','reason','QA actual verified preceding work'));
   read:=payroll_ph_wage_resolve(emp,ent,'2026-08-01');
   if read->>'origin'<>'payroll' or (read->>'qualifying_wages')::numeric<>40 or (read->>'worked_days')::integer<>1 then raise exception 'Canonical wages not derived: %',read;end if;
  end if;
 end loop;
 if snapshot_hash<>(select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) from payroll_run_calculation_snapshots s) then raise exception 'Finalized evidence changed'; end if;
 if has_function_privilege('anon','public.payroll_ph_profile_read(uuid,date)','execute') or has_function_privilege('authenticated','public.payroll_ph_profile_resolve(uuid,date)','execute') or has_table_privilege('authenticated','public.payroll_ph_profile_versions','select') then raise exception 'Private authority exposed';end if;
end $$;
select jsonb_build_object('manifests',jsonb_agg(manifest)) from ph_treatment_documents;
rollback;
