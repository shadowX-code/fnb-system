-- STAGING ONLY synthetic fixture, no real employee or payment authority changes.
-- Master and published shift inserts establish labelled test evidence; Payroll
-- decisions and recalculation remain canonical authenticated commands.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
do $$
declare actor uuid:=public.payroll_admin_actor(); ent uuid; outlet uuid; emp uuid; pub uuid; r jsonb; run uuid; day date;
 a jsonb:='{"epf":false,"socso":false,"eis":false,"pcb":false}';
begin
 if exists(select 1 from public.legal_entities where company_registration_no='QA-SEQ-20261003') then raise exception 'Fixture already exists: inspect, do not repeat'; end if;
 insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA ONLY Sequential Time Review','QA-SEQ-20261003','STAGING ONLY - no payment',actor,actor) returning id into ent;
 insert into public.outlets(name,code,state_code) values('QA ONLY Sequential Review Workplace','QA-SEQ-1003','MY-08') returning id into outlet;
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_outlet_state_versions(outlet_id,effective_from,state_code) values(outlet,'2026-09-01','MY-08');
 insert into public.employees(full_name,employee_code,legal_entity_id,workplace,position,employment_type,employment_status,joined_date,birthday,nationality,enable_system_login,access_state)
 values('QA ONLY Sequential Review Employee','QA-SEQ-1003',ent,'QA ONLY Sequential Review Workplace','Service Crew','part_time','active','2026-09-01','1990-01-01','Malaysia',false,'no_access') returning id into emp;
 perform public.employee_employment_assignment_save(emp,'2026-09-01',jsonb_build_object('employment_type','part_time','employment_status','active','position','Service Crew','workplace','QA ONLY Sequential Review Workplace','legal_entity_id',ent),'QA explicit known assignment',null,'QA synthetic sequential exception test');
 r:=public.payroll_initial_setup_read(emp,'2026-09-01',a,'2026-09-01');
 r:=public.payroll_initial_setup_confirm(emp,'2026-09-01','hourly',15,'MYR',a,r->>'fingerprint','2026-09-01');
 insert into public.duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by) values(outlet,'2026-09-21','2026-09-27',1,auth.uid()) returning id into pub;
 foreach day in array array['2026-09-22'::date,'2026-09-23'::date,'2026-09-24'::date] loop
  insert into public.duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at)
  values(pub,outlet,emp,day,'09:00','18:00',60,'working','QA ONLY Sequential Review Workplace',now());
 end loop;
 perform public.payroll_time_reconcile(ent,'2026-09-01','2026-09-30');
 run:=public.payroll_run_create(ent,'2026-09-01','2026-09-30','QA ONLY sequential exception review - no finalization/payment');
 perform public.payroll_employee_recalculate(run,emp);
 if (select count(*) from public.payroll_payable_time_versions where employee_id=emp and status='review_required')<>3 then raise exception 'Expected exactly three unresolved exceptions'; end if;
end $$;
commit;
