-- Explicit labelled synthetic Staging evidence only. Reuse published QA 2027 calendar; no real calendar change.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from employees e join roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
do $$
declare actor uuid:=payroll_admin_actor(); ent uuid; outlet uuid; emp uuid; profile uuid; run uuid; calendar uuid; selected uuid[]; basis text;
begin
 if exists(select 1 from legal_entities where company_registration_no='QA-PHP-20261004') then raise exception 'Fixture exists: inspect, never recreate'; end if;
 insert into legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA ONLY PH Profile','QA-PHP-20261004','STAGING ONLY - no payment',actor,actor) returning id into ent;
 insert into outlets(name,code,state_code) values('QA ONLY PH Profile Workplace','QA-PHP-1004','MY-08') returning id into outlet;
 perform set_config('feedx.payroll_command','yes',true);
 insert into payroll_outlet_state_versions(outlet_id,effective_from,state_code) values(outlet,'2026-08-01','MY-08');
 select id into calendar from payroll_holiday_calendar_versions where year=2027 and status='published' order by revision desc limit 1;
 if calendar is null then raise exception 'Published calendar required; do not manufacture publication'; end if;
 select array_agg((x->>'holiday_id')::uuid) into selected from payroll_holiday_calendar_versions c cross join lateral jsonb_array_elements(c.entries) x where c.id=calendar and x->>'kind'='required';
 perform payroll_paid_holiday_policy_save('QA ONLY Malaysia PH policy',calendar,selected,array[ent],'{}',null,true,null,gen_random_uuid());
 -- Reuse the existing synthetic 2027 calendar; no real calendar is changed.
 foreach basis in array array['monthly','hourly'] loop
  insert into employees(full_name,employee_code,legal_entity_id,workplace,position,employment_type,employment_status,joined_date,birthday,nationality,enable_system_login,access_state)
  values('QA ONLY PH Profile '||initcap(basis),'QA-PHP-'||basis||'-1004',ent,'QA ONLY PH Profile Workplace','Service Crew',case when basis='hourly' then 'part_time' else 'full_time' end,'active','2026-08-01','1990-01-01','Malaysia',false,'no_access') returning id into emp;
  perform employee_employment_assignment_save(emp,'2026-08-01',jsonb_build_object('employment_type',case when basis='hourly' then 'part_time' else 'full_time' end,'employment_status','active','position','Service Crew','workplace','QA ONLY PH Profile Workplace','legal_entity_id',ent),'QA explicit August assignment',null,'QA synthetic legal evidence');
  profile:=payroll_profile_create(emp,'2026-08-01',basis,case when basis='monthly' then 2600 else 9 end,'MYR','QA ONLY verified compensation',null,outlet,false,false,false,false);
 end loop;
 run:=payroll_run_create(ent,'2027-02-01','2027-02-28','QA ONLY Malaysia PH - no finalization/payment');
 for emp in select id from employees where legal_entity_id=ent loop perform payroll_employee_recalculate(run,emp); end loop;
end $$;
select e.id employee_id,e.full_name,r.id run_id,l.id legal_entity_id,o.id outlet_id from employees e join legal_entities l on l.id=e.legal_entity_id join payroll_periods period on period.legal_entity_id=l.id join payroll_runs r on r.period_id=period.id join outlets o on o.name=e.workplace where l.company_registration_no='QA-PHP-20261004';
commit;
