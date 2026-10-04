-- STAGING ONLY synthetic fixture, no real employee or payment authority changes.
-- Master and published shift inserts establish labelled test evidence; Payroll
-- decisions and recalculation remain canonical authenticated commands.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
do $$
declare actor uuid:=public.payroll_admin_actor(); ent uuid; outlet uuid; emp uuid; pub uuid; profile uuid; calendar uuid; selected uuid[]; r jsonb; run uuid; day date;
 a jsonb:='{"epf":false,"socso":false,"eis":false,"pcb":false}';
begin
 if exists(select 1 from public.legal_entities where company_registration_no='QA-TIME-LATENCY-20261004') then raise exception 'Fixture already exists: inspect, do not repeat'; end if;
 insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA ONLY Save Latency','QA-TIME-LATENCY-20261004','STAGING ONLY - no payment',actor,actor) returning id into ent;
 insert into public.outlets(name,code,state_code) values('QA ONLY Save Latency Workplace','QA-TIME-LATENCY-1004','MY-08') returning id into outlet;
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_outlet_state_versions(outlet_id,effective_from,state_code) values(outlet,'2026-09-01','MY-08');
 insert into public.employees(full_name,employee_code,legal_entity_id,workplace,position,employment_type,employment_status,joined_date,birthday,nationality,enable_system_login,access_state)
 values('QA ONLY Save Latency Employee','QA-TIME-LATENCY-1004',ent,'QA ONLY Save Latency Workplace','Service Crew','part_time','active','2026-09-01','1990-01-01','Malaysia',false,'no_access') returning id into emp;
 perform public.employee_employment_assignment_save(emp,'2026-09-01',jsonb_build_object('employment_type','part_time','employment_status','active','position','Service Crew','workplace','QA ONLY Save Latency Workplace','legal_entity_id',ent),'QA explicit known assignment',null,'QA synthetic sequential exception test');
 r:=public.payroll_initial_setup_read(emp,'2026-09-01',a,'2026-09-01');
 r:=public.payroll_initial_setup_confirm(emp,'2026-09-01','hourly',8,'MYR',a,r->>'fingerprint','2026-09-01');
 profile:=(r->>'profile_id')::uuid;
 select id into profile from payroll_profiles where employee_id=emp;
 perform payroll_compensation_adjust(profile,'2026-09-24','hourly',9,'MYR','QA ONLY rate split',null,outlet);
 select id into calendar from payroll_holiday_calendar_versions where year=2026 and status='published' order by revision desc limit 1;
 if calendar is null then raise exception 'Existing published Staging fixture calendar required';end if;
 select array_agg((x->>'holiday_id')::uuid) into selected from payroll_holiday_calendar_versions c cross join lateral jsonb_array_elements(c.entries) x where c.id=calendar and x->>'kind'='required';
 perform payroll_paid_holiday_policy_save('QA ONLY Save Latency policy',calendar,coalesce(selected,'{}'::uuid[]),array[ent],'{}',null,true,null,gen_random_uuid());
 perform payroll_ph_policy_save(ent,'2026-09-01','additional_pay','QA ONLY company benefit boundary');
 insert into public.duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by) values(outlet,'2026-09-21','2026-09-27',1,auth.uid()) returning id into pub;
 for day in select d::date from generate_series('2026-09-01'::date,'2026-09-23'::date,interval '1 day') d where d::date<>'2026-09-16' loop
  insert into public.duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at)
  values(pub,outlet,emp,day,'09:00','15:00',60,'working','QA ONLY Save Latency Workplace',now());
 end loop;
 perform public.payroll_time_reconcile(ent,'2026-09-01','2026-09-30');
 run:=public.payroll_run_create(ent,'2026-09-01','2026-09-30','QA ONLY corrections/earnings - no finalization/payment');
 perform public.payroll_employee_recalculate(run,emp);
 if (select count(*) from public.payroll_payable_time_versions where employee_id=emp and status='review_required')<>22 then raise exception 'Expected exactly 22 unresolved exceptions'; end if;
end $$;
select e.id employee_id,e.full_name,p.id profile_id,r.id run_id,l.id legal_entity_id,o.id outlet_id from employees e join legal_entities l on l.id=e.legal_entity_id join payroll_profiles p on p.employee_id=e.id join payroll_periods period on period.legal_entity_id=l.id join payroll_runs r on r.period_id=period.id join outlets o on o.name=e.workplace where l.company_registration_no='QA-TIME-LATENCY-20261004';
commit;
