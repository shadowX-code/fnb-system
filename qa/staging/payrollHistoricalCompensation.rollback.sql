-- STAGING ONLY. Authenticated canonical commands; all synthetic evidence rolls back.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from employees e join roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
do $$
declare actor uuid:=payroll_admin_actor(); ent uuid; emp uuid; profile uuid; september uuid; october uuid; later uuid; historical uuid; correction uuid; assignment jsonb; before_employee jsonb; before_later jsonb; projection jsonb; final_hash text; final_profile uuid; final_date date;
begin
 select md5(coalesce(string_agg(to_jsonb(s)::text,'|' order by run_id,employee_id),'')) into final_hash from payroll_run_statutory_snapshots s;
 insert into legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA ONLY Historical Pay','QA-HIST-PAY-'||substr(gen_random_uuid()::text,1,8),'STAGING ONLY',actor,actor) returning id into ent;
 insert into employees(full_name,employee_code,legal_entity_id,workplace,position,employment_type,employment_status,joined_date,resigned_date,birthday,nationality,enable_system_login,access_state)
 values('QA ONLY Historical Pay Employee','QA-HIST-PAY-'||substr(gen_random_uuid()::text,1,8),null,'QA ONLY Sequential Review Workplace','Service Crew','full_time','resigned','2026-09-01','2026-10-01','1990-01-01','Malaysia',false,'no_access') returning id into emp;
 assignment:=jsonb_build_object('employment_type','full_time','employment_status','active','position','Service Crew','workplace','QA ONLY Sequential Review Workplace','legal_entity_id',ent);
 perform employee_employment_assignment_save(emp,'2026-09-01',assignment,'QA explicit September employment',null,'QA historical pay contract');
 profile:=payroll_profile_create(emp,'2026-10-01','monthly',3400,'MYR','QA later pay must remain unchanged');
 select id,to_jsonb(c) into later,before_later from payroll_compensation_versions c where profile_id=profile;
 perform employee_employment_assignment_save(emp,'2026-10-01',assignment||jsonb_build_object('employment_status','resigned','employment_end_date','2026-09-30'),'QA October resignation',(employee_employment_assignment_at(emp,'2026-10-01')).id,'QA historical pay contract');
 september:=payroll_run_create(ent,'2026-09-01','2026-09-30','QA historical pay September');
 october:=payroll_run_create(ent,'2026-10-01','2026-10-31','QA historical pay October');
 if not exists(select 1 from payroll_run_employee_ids(september) where employee_id=emp) or exists(select 1 from payroll_run_employee_ids(october) where employee_id=emp) then raise exception 'Period membership failed'; end if;
 projection:=payroll_calculation_project(september,emp);
 if projection->'inputs'->'compensation_start'->>'id' is not null then raise exception 'Later pay proved September'; end if;
 perform payroll_employee_recalculate(september,emp);
 select to_jsonb(e) into before_employee from employees e where id=emp;
 historical:=payroll_compensation_adjust(profile,'2026-09-01','monthly',3000,'MYR','QA explicit historical September salary');
 if not coalesce((select is_stale from jsonb_to_recordset(payroll_run_calculation_read(september)->'results') as x(employee_id uuid,is_stale boolean) where employee_id=emp),false) then raise exception 'Historical input did not mark calculation stale'; end if;
 projection:=payroll_calculation_project(september,emp);
 if projection->'inputs'->'compensation_start'->>'id' is distinct from historical::text or (projection->>'gross_earnings')::numeric is distinct from 3000::numeric then raise exception 'September compensation calculation failed: %',projection; end if;
 perform payroll_employee_recalculate(september,emp);
 correction:=payroll_compensation_adjust(profile,'2026-09-01','monthly',3100,'MYR','QA audited correction at the same effective date');
 projection:=payroll_calculation_project(september,emp);
 if projection->'inputs'->'compensation_start'->>'id' is distinct from correction::text or (projection->>'gross_earnings')::numeric is distinct from 3100::numeric then raise exception 'Same-date correction resolution failed'; end if;
 if not exists(select 1 from payroll_compensation_versions where id=historical and basic_salary=3000) then raise exception 'Original pay evidence lost'; end if;
 if before_later is distinct from (select to_jsonb(c) from payroll_compensation_versions c where id=later) then raise exception 'Later compensation rewritten'; end if;
 if before_employee is distinct from (select to_jsonb(e) from employees e where id=emp) then raise exception 'Employment reactivated or altered'; end if;
 if exists(select 1 from payroll_run_employee_ids(october) where employee_id=emp) then raise exception 'October membership broadened'; end if;
 if not exists(select 1 from payroll_events where profile_id=profile and details->>'supersedes_same_date_version_id'=historical::text and actor_employee_id=actor) then raise exception 'Correction audit missing'; end if;
 if not exists(select 1 from jsonb_array_elements(payroll_foundation_read()->'employees') e where e->>'id'=emp::text and e->>'employment_status'='resigned' and e->>'employment_end_date'='2026-10-01') then raise exception 'Former employee not available in Profiles'; end if;
 select s.profile_id,p.period_start into final_profile,final_date from payroll_run_profile_snapshots s join payroll_runs r on r.id=s.run_id join payroll_periods p on p.id=r.period_id where r.status in ('finalized','paid') limit 1;
 if final_profile is not null then
  begin perform payroll_compensation_adjust(final_profile,final_date,'monthly',3100,'MYR','QA finalized protection'); raise exception 'Finalized pay accepted'; exception when sqlstate '55000' then null; end;
 end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
 begin perform payroll_compensation_adjust(profile,'2026-08-01','monthly',3000,'MYR','QA unauthorized'); raise exception 'Unauthorized write accepted'; exception when insufficient_privilege then null; end;
 if final_hash is distinct from (select md5(coalesce(string_agg(to_jsonb(s)::text,'|' order by run_id,employee_id),'')) from payroll_run_statutory_snapshots s) then raise exception 'Finalized statutory evidence changed'; end if;
 raise notice 'PASS: historical pay, same-date correction, September stale/recalculation, October exclusion, later history, employment, audit, authorization and finalized preservation';
end $$;
rollback;
