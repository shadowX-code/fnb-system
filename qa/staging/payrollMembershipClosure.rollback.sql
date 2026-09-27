-- Isolated rollback fixtures only. Existing employees and finalized evidence stay untouched.
begin;
select set_config('request.jwt.claim.sub',(select auth_user_id::text from public.employees e
 join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login
 and e.access_state='active' limit 1),true);
do $$
declare actor uuid:=public.payroll_admin_actor(); entity uuid; outlet uuid; employee uuid; former uuid; future uuid;
 profile uuid; run uuid; r jsonb; a jsonb:='{"epf":false,"socso":false,"eis":false,"pcb":false}';
 member_count integer; snapshots_before text; source_before text; missing_join uuid; missing_employer uuid;
begin
 insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA ONLY membership rollback','QA-'||gen_random_uuid(),'Rollback only',actor,actor) returning id into entity;
 insert into public.outlets(name,code,state_code) values('QA ONLY membership rollback','QA-'||substr(gen_random_uuid()::text,1,8),'MY-08') returning id into outlet;
 insert into public.payroll_outlet_state_versions(outlet_id,effective_from,state_code) values(outlet,'2026-01-01','MY-08');
 insert into public.employees(full_name,employee_code,legal_entity_id,workplace,joined_date,birthday,nationality)
 values('QA ONLY eligible','QA-'||substr(gen_random_uuid()::text,1,8),entity,'QA ONLY membership rollback','2026-01-01','1990-01-01','Malaysia') returning id into employee;
 r:=public.payroll_initial_setup_read(employee,'2026-01-01',a,'2026-01-01');
 r:=public.payroll_initial_setup_confirm(employee,'2026-01-01','monthly',2000,'MYR',a,r->>'fingerprint','2026-01-01');
 insert into public.employees(full_name,employee_code,legal_entity_id,workplace,joined_date,birthday,nationality)
 values('QA ONLY former','QA-'||substr(gen_random_uuid()::text,1,8),entity,'QA ONLY membership rollback','2026-01-01','1990-01-01','Malaysia') returning id into former;
 r:=public.payroll_initial_setup_read(former,'2026-01-01',a,'2026-01-01');
 r:=public.payroll_initial_setup_confirm(former,'2026-01-01','monthly',2000,'MYR',a,r->>'fingerprint','2026-01-01');
 update public.employees set resigned_date='2026-05-31' where id=former;
 insert into public.employees(full_name,employee_code,legal_entity_id,workplace,joined_date)
 values('QA ONLY future','QA-'||substr(gen_random_uuid()::text,1,8),entity,'QA ONLY membership rollback','2026-07-01') returning id into future;
 run:=public.payroll_run_create(entity,'2026-06-01','2026-06-30','QA ONLY membership closure');
 select count(*) into member_count from public.payroll_run_employee_ids(run);
 if member_count<>1 then raise exception 'Eligible membership mismatch: %',member_count; end if;
 perform public.payroll_run_calculate(run); perform public.payroll_run_statutory_calculate(run);
 r:=public.payroll_calculation_project(run,employee);
 if r->>'status'<>'ready' then raise exception 'Fixture earning evidence incomplete: %',r->'issues'; end if;
 perform public.payroll_run_transition(run,'review_required','QA ONLY member test');
 perform public.payroll_run_transition(run,'ready','QA ONLY member test');
 perform public.payroll_run_transition(run,'finalized','QA ONLY member test');
 if (select count(*) from public.payroll_run_profile_snapshots where run_id=run)<>1
   or (select count(*) from public.payroll_run_calculation_snapshots where run_id=run)<>1
   or (select count(*) from public.payroll_run_statutory_snapshots where run_id=run)<>1
 then raise exception 'Finalize snapshots diverge from canonical membership'; end if;
 select md5(string_agg(to_jsonb(s)::text,'' order by employee_id)) into snapshots_before from public.payroll_run_profile_snapshots s where run_id=run;
 update public.employees set joined_date='2026-07-01',legal_entity_id=null where id=employee;
 if not exists(select 1 from public.payroll_run_employee_ids(run) where employee_id=employee)
 then raise exception 'Historical membership followed mutable employee data'; end if;
 if snapshots_before is distinct from (select md5(string_agg(to_jsonb(s)::text,'' order by employee_id)) from public.payroll_run_profile_snapshots s where run_id=run)
 then raise exception 'Historical snapshot changed'; end if;
 -- Unknown dates remain blockers rather than fabricated dates.
 insert into public.employees(full_name,employee_code,legal_entity_id,workplace)
 values('QA ONLY missing join','QA-'||substr(gen_random_uuid()::text,1,8),entity,'QA ONLY membership rollback') returning id into missing_join;
 r:=public.payroll_calculation_project(run,missing_join);
 if r->>'status'='ready' then raise exception 'Missing Joined Date became Ready'; end if;
 insert into public.employees(full_name,employee_code,joined_date)
 values('QA ONLY missing employer','QA-'||substr(gen_random_uuid()::text,1,8),'2026-01-01') returning id into missing_employer;
 begin
   r:=public.payroll_initial_setup_read(missing_employer,'2026-01-01',a,'2026-01-01');
   perform public.payroll_initial_setup_confirm(missing_employer,'2026-01-01','monthly',2000,'MYR',a,r->>'fingerprint','2026-01-01');
   raise exception 'Missing Legal Employer accepted Payroll setup';
 exception when insufficient_privilege or invalid_parameter_value then null;
 end;
 raise notice 'PASS: eligibility, equal Finalize snapshots, frozen membership, missing setup fail-closed';
end $$;
rollback;
