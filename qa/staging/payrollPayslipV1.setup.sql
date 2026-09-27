-- Approved isolated Staging-only Phase 5 fixture. Master/source inserts are
-- fixture setup; financial decisions use canonical Payroll commands.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
do $$
declare actor uuid:=public.payroll_admin_actor(); ent uuid; outlet uuid; emp uuid; monthly uuid; hourly uuid; run uuid; pub uuid; roster uuid; result jsonb; i integer;
begin
 if exists(select 1 from public.legal_entities where company_registration_no='QA-P5V1-20260927') then raise exception 'Fixture exists; inspect, do not repeat'; end if;
 insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id) values('QA ONLY Phase 5 V1 Payslips','QA-P5V1-20260927','STAGING ONLY - no bank transfer',actor,actor) returning id into ent;
 insert into public.outlets(name,code,state_code) values('QA ONLY Phase 5 V1 Workplace','QA-P5V1-0927','MY-08') returning id into outlet;
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_outlet_state_versions(outlet_id,effective_from,state_code) values(outlet,'2026-01-01','MY-08');
 for i in 1..2 loop
  insert into public.employees(full_name,employee_code,legal_entity_id,workplace,joined_date,birthday,nationality,enable_system_login,access_state)
  values(case i when 1 then 'QA ONLY Phase 5 V1 Monthly' else 'QA ONLY Phase 5 V1 Hourly' end,'QA-P5V1-'||i,ent,'QA ONLY Phase 5 V1 Workplace','2026-01-01','1990-01-01','Malaysia',false,'no_access') returning id into emp;
  if i=1 then monthly:=emp; else hourly:=emp; end if;
  result:=public.payroll_initial_setup_read(emp,'2026-01-01',jsonb_build_object('epf',true,'socso',true,'eis',true,'pcb',i=1));
  result:=public.payroll_initial_setup_confirm(emp,'2026-01-01',case i when 1 then 'monthly' else 'hourly' end,case i when 1 then 3250 else 15 end,'MYR',jsonb_build_object('epf',true,'socso',true,'eis',true,'pcb',i=1),result->>'fingerprint');
 end loop;
 insert into public.duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by) values(outlet,'2026-06-01','2026-06-07',1,auth.uid()) returning id into pub;
 insert into public.duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at) values(pub,outlet,hourly,'2026-06-02','09:00','15:00',60,'working','QA ONLY Phase 5 V1 Workplace',now()) returning id into roster;
 insert into public.crew_attendance_records(employee_id,outlet_id,clock_in_at,clock_out_at,clock_in_source,clock_out_source,status,scheduled_roster_entry_id,scheduled_roster_publication_id,scheduled_start_at,scheduled_end_at,scheduled_published_at,scheduled_entry_type) values(hourly,outlet,'2026-06-02 09:00+08','2026-06-02 15:00+08','admin','admin','completed',roster,pub,'2026-06-02 09:00+08','2026-06-02 15:00+08',now(),'working');
 perform public.payroll_time_reconcile(ent,'2026-06-01','2026-06-30');
 run:=public.payroll_run_create(ent,'2026-06-01','2026-06-30','QA ONLY Phase 5 - Draft/Final Payslip only, no payment');
 perform public.payroll_run_calculate(run);
 perform public.payroll_run_pcb_confirm(gen_random_uuid(),run,monthly,50,null,'Synthetic approved Phase 5 QA PCB','QA ONLY');
 perform public.payroll_run_statutory_calculate(run);
 result:=public.payroll_statutory_project(run,monthly);
 if result->>'status'<>'ready' or (result->>'net_pay')::numeric<>2818.25 then raise exception 'Monthly mismatch: %',result; end if;
 result:=public.payroll_statutory_project(run,hourly);
 if result->>'status'<>'ready' then raise exception 'Hourly unresolved: %',result; end if;
 -- Leave Draft for authenticated UI preview and finalization.
end $$;
commit;
