-- STAGING ONLY. Every synthetic record and canonical command rolls back.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from employees e join roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
do $$
declare actor uuid:=payroll_admin_actor(); ent uuid; outlet uuid; emp uuid; profile uuid; pub uuid; pub_regular uuid; run uuid; day date; t payroll_payable_time_versions%rowtype; result jsonb; original jsonb; assignment jsonb; groups jsonb; current_result jsonb; input jsonb; request uuid; final_hash text; roster_hash text; holiday uuid; calendar uuid; prev uuid; basis text; i integer; approved uuid;
begin
 select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) into final_hash from payroll_run_calculation_snapshots s;
 insert into legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA ONLY Time Earnings','QA-TIME-EARN-'||substr(gen_random_uuid()::text,1,8),'STAGING ONLY',actor,actor) returning id into ent;
 insert into outlets(name,code,state_code) values('QA ONLY Time Earnings Workplace','QA-TE-'||substr(gen_random_uuid()::text,1,8),'MY-08') returning id into outlet;
 perform set_config('feedx.payroll_command','yes',true);
 insert into payroll_outlet_state_versions(outlet_id,effective_from,state_code) values(outlet,'2026-09-01','MY-08');
 holiday:=payroll_holiday_save('2026-09-16','QA ONLY PH authority','national','QA ONLY synthetic evidence, not regulatory configuration');
 select id into prev from payroll_holiday_calendar_versions where year=2026 order by revision desc limit 1;
 calendar:=payroll_holiday_calendar_save(2026,coalesce((select entries from payroll_holiday_calendar_versions where id=prev),'[]')||jsonb_build_array(jsonb_build_object('holiday_id',holiday,'kind','required','source_reference','QA ONLY')),'QA ONLY',true,true,prev,gen_random_uuid());
 perform payroll_paid_holiday_policy_save('QA ONLY',calendar,(select array_agg((x->>'holiday_id')::uuid) from payroll_holiday_calendar_versions c cross join lateral jsonb_array_elements(c.entries) x where c.id=calendar and (x->>'kind'='required' or x->>'holiday_id'=holiday::text)),array[ent],'{}',null,true,null,gen_random_uuid());
 perform payroll_ph_policy_save(ent,'2026-09-01','additional_pay','QA ONLY company benefit must not bypass statutory rules');
 insert into duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by) values(outlet,'2026-09-14','2026-09-20',1,auth.uid()) returning id into pub;
 insert into duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by) values(outlet,'2026-09-21','2026-09-27',1,auth.uid()) returning id into pub_regular;
 for i in 1..3 loop
  basis:=case when i=2 then 'monthly' else 'hourly' end;
  insert into employees(full_name,employee_code,legal_entity_id,workplace,position,employment_type,employment_status,joined_date,birthday,nationality,enable_system_login,access_state)
  values('QA ONLY Time Earnings '||i,'QA-TE-'||substr(gen_random_uuid()::text,1,8),ent,'QA ONLY Time Earnings Workplace','Service Crew','part_time','active','2026-09-01','1990-01-01','Malaysia',false,'no_access') returning id into emp;
  assignment:=jsonb_build_object('employment_type','part_time','employment_status','active','position','Service Crew','workplace','QA ONLY Time Earnings Workplace','legal_entity_id',ent);
  perform employee_employment_assignment_save(emp,'2026-09-01',assignment,'QA explicit assignment',null,'QA synthetic evidence');
  profile:=payroll_profile_create(emp,'2026-09-01',basis,case when basis='monthly' then 2600 else 8 end,'MYR','QA reviewed pay',null,outlet,false,false,false,false);
  if i=1 then perform payroll_compensation_adjust(profile,'2026-09-24','hourly',9,'MYR','QA rate change',null,outlet); end if;
  if i=1 then
   foreach day in array array['2026-09-22'::date,'2026-09-23'::date,'2026-09-24'::date] loop
    insert into duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at)
    values(pub_regular,outlet,emp,day,'09:00','15:00',60,'working','QA ONLY Time Earnings Workplace',now());
   end loop;
  end if;
  if i=1 then run:=payroll_run_create(ent,'2026-09-01','2026-09-30','QA ONLY time earnings'); end if;
  perform payroll_time_reconcile(ent,'2026-09-01','2026-09-30');
  if i=1 then
   perform payroll_employee_recalculate(run,emp);
   for t in select * from payroll_payable_time_versions where employee_id=emp order by work_date loop
    original:=to_jsonb(t); request:=gen_random_uuid();
    input:=jsonb_build_object('request_id',request,'run_id',run,'time_version_id',t.id,'correction',false,'action','adjust','approved_minutes',300,'extra_minutes',0,'classification','regular','reason','QA explicit roster verified after attendance review');
    result:=payroll_time_decision_save(input);
    perform payroll_time_decision_save(input); -- safe retry, no duplicate history
    if original is distinct from (select to_jsonb(v) from payroll_payable_time_versions v where id=t.id) then raise exception 'Original time rewritten'; end if;
   end loop;
   current_result:=payroll_run_calculation_read(run)->'results'->0;
   if (current_result->>'is_stale')::boolean or exists(select 1 from jsonb_array_elements_text(current_result->'issues') issue where issue like 'unresolved_time%') then raise exception 'Final exception did not recalculate'; end if;
   groups:=current_result->'earning_groups';
   if jsonb_array_length(groups)<>2 or (current_result->>'gross_earnings')::numeric<>125 then raise exception 'Rate-separated gross failed: %',current_result; end if;
   if (select sum((x->>'amount')::numeric) from jsonb_array_elements(groups) x)<>(current_result->>'gross_earnings')::numeric then raise exception 'Gross does not reconcile'; end if;
   select * into t from payroll_payable_time_versions where employee_id=emp and work_date='2026-09-22' order by revision desc limit 1;
   approved:=t.id; original:=to_jsonb(t);
   input:=jsonb_build_object('request_id',gen_random_uuid(),'run_id',run,'time_version_id',t.id,'correction',true,'action','adjust','approved_minutes',240,'extra_minutes',0,'classification','regular','reason','QA correction: actual verified attendance reduced');
   begin perform payroll_time_decision_save(input||jsonb_build_object('reason','')); raise exception 'Missing correction reason accepted'; exception when others then if sqlerrm<>'A decision or correction reason is required.' then raise; end if; end;
   begin perform payroll_time_decision_save(input||jsonb_build_object('run_id',gen_random_uuid())); raise exception 'Wrong Run accepted'; exception when insufficient_privilege then null; end;
   begin perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true); perform payroll_time_decision_save(input); raise exception 'Unauthorized actor accepted'; exception when insufficient_privilege then null; end;
   begin update payroll_runs set status='finalized' where id=run; raise exception 'Finalization evidence gate bypassed'; exception when sqlstate '55000' then null; end;
   begin perform payroll_time_decide(t.id,'adjust',240,0,'regular','Legacy correction attempt'); raise exception 'Unscoped correction accepted'; exception when sqlstate '55000' then null; end;
   result:=payroll_time_decision_save(input);
   if original is distinct from (select to_jsonb(v) from payroll_payable_time_versions v where id=approved) then raise exception 'Reviewed decision overwritten'; end if;
   if not exists(select 1 from payroll_events where event_type='time_corrected' and details->>'run_id'=run::text and details->>'previous_version_id'=approved::text) then raise exception 'Correction audit absent'; end if;
   current_result:=payroll_calculation_project(run,emp);
   if (current_result->>'gross_earnings')::numeric<>117 then raise exception 'Corrected earnings failed'; end if;
   begin perform payroll_time_decision_save(input||jsonb_build_object('request_id',gen_random_uuid())); raise exception 'Stale correction accepted'; exception when sqlstate '55000' then null; end;
  end if;
  -- Published PH without work: monthly basic remains separate; hourly paid day
  -- is explicitly unresolved without a verified ordinary-day/eligibility rule.
  result:=payroll_calculation_project(run,emp);
  if basis='hourly' and not (result->'issues' ? 'ph_paid_day_entitlement_unverified:hourly:2026-09-16') then raise exception 'Hourly no-work holiday pay inferred'; end if;
  if exists(select 1 from jsonb_array_elements(result->'lines') x where x->>'code' in ('company_ph_benefit','public_holiday','public_holiday_ot')) then raise exception 'No-work PH premium invented'; end if;
  insert into duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at)
  values(pub,outlet,emp,'2026-09-16','09:00','15:00',60,'working','QA ONLY Time Earnings Workplace',now());
  perform payroll_time_reconcile(ent,'2026-09-16','2026-09-16');
  select * into t from payroll_payable_time_versions where employee_id=emp and work_date='2026-09-16' order by revision desc limit 1;
  input:=jsonb_build_object('request_id',gen_random_uuid(),'run_id',run,'time_version_id',t.id,'correction',false,'action','adjust','approved_minutes',300,'extra_minutes',0,'classification','public_holiday','reason','QA explicit PH work');
  perform payroll_time_decision_save(input);
  result:=payroll_calculation_project(run,emp);
  if not (result->'issues' ? ('ph_statutory_rule_unverified:'||basis||':2026-09-16')) then raise exception 'PH work accepted without statutory authority'; end if;
  if exists(select 1 from jsonb_array_elements(result->'lines') x where x->>'code' in ('company_ph_benefit','public_holiday','public_holiday_ot')) then raise exception 'Company benefit duplicated/bypassed statutory PH'; end if;
  select * into t from payroll_payable_time_versions where employee_id=emp and work_date='2026-09-16' order by revision desc limit 1;
  perform payroll_time_decision_save(input||jsonb_build_object('request_id',gen_random_uuid(),'time_version_id',t.id,'correction',true,'extra_minutes',60,'reason','QA explicit beyond-normal PH work'));
  result:=payroll_calculation_project(run,emp);
  if not (result->'issues' ? ('ph_ot_statutory_rule_unverified:'||basis||':2026-09-16')) then raise exception 'PH OT missing-authority blocker absent'; end if;
 end loop;
 if final_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) from payroll_run_calculation_snapshots s) then raise exception 'Finalized snapshot changed'; end if;
 raise notice 'PASS: final exception atomic calculation, correction/audit/retry/stale guard, rate split/gross, Monthly/Hourly PH no work/work/OT fail closed and no company duplicate';
end $$;
select 'PASS: atomic time correction/recalculation, actor/Run scope, reason/retry/stale/legacy guards, rate split/gross and Monthly/Hourly PH boundaries' as contract;
rollback;
