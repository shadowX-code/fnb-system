-- Run in an isolated database with the fixture source adapters and compensation schema.
begin;
do $cases$
declare
 staff uuid:=gen_random_uuid();
 profile uuid:=gen_random_uuid();
 entity uuid:=gen_random_uuid();
 run uuid:=gen_random_uuid();
 period uuid:=gen_random_uuid();
 machine uuid;
 old_id uuid:=gen_random_uuid();
 reapproved_id uuid:=gen_random_uuid();
 equivalent_id uuid:=gen_random_uuid();
 different_id uuid:=gen_random_uuid();
 old_comp jsonb;
 new_comp jsonb;
 period_day date;
 payload jsonb;
 prior jsonb;
 live jsonb;
 approval jsonb;
 ph_saved jsonb;
 ph_live jsonb;
 change_path text[];
 changed jsonb;
 approval_before text;
 ph_before text;
 totals integer;
begin
 insert into payroll_compensation_versions(id,profile_id,legal_entity_id,effective_from,revision,pay_basis,currency,basic_salary)
 values (old_id,profile,entity,'2026-02-01',1,'monthly','MYR',2000),
        (equivalent_id,profile,entity,'2026-09-01',3,'monthly','MYR',2000),
        (different_id,profile,entity,'2026-09-01',1,'monthly','MYR',2100),
        (reapproved_id,profile,entity,'2026-09-01',2,'monthly','MYR',2000);
 insert into employees(id,joined_date,employment_status) values(staff,'2026-02-01','active');
 insert into employee_employment_assignment_revisions(id,employee_id,effective_from,position,employment_type,employment_status,legal_entity_id,workplace,employment_jurisdiction)
 values(gen_random_uuid(),staff,'2026-02-01','Service Crew','full_time','active',entity,'QA Only','peninsular_labuan');
 insert into payroll_pay_rule_versions(id,rule_code,pay_basis,effective_from)
 values(gen_random_uuid(),'monthly_basic','monthly','2026-02-01');
 insert into payroll_profiles(id,employee_id) values(profile,staff);
 insert into payroll_periods(id,legal_entity_id,period_start,period_end) values(period,entity,'2026-09-01','2026-09-30');
 insert into payroll_runs(id,period_id,status,foundation_only) values(run,period,'draft',false);
 select to_jsonb(c) into old_comp from payroll_compensation_versions c where id=old_id;
 select to_jsonb(c) into new_comp from payroll_compensation_versions c where id=equivalent_id;

 for period_day in select d::date from generate_series(date '2026-09-01',date '2026-09-30',interval '1 day') d
    where extract(day from d) in (1,3,4,5,6,7,8,9,12,13,15,16,17,18,19,20,22,23,24,25,26,27,29,30) loop
  payload:=jsonb_build_object('profile_id',profile,'employee_id',staff,'work_date',period_day,
   'legal_entity_id',entity,'pay_basis','monthly','classification',case when period_day='2026-09-16' then 'public_holiday' else 'regular' end,
   'roster_publication_id',gen_random_uuid(),'attendance_id',null,'leave_id',null,'issue_codes','["missing_punch"]'::jsonb);
  prior:=payload||jsonb_build_object('compensation_version_id',case when period_day='2026-09-16' then old_id else reapproved_id end);
  live:=payload||jsonb_build_object('compensation_version_id',equivalent_id);
  prior:=prior||jsonb_build_object('source_fingerprint',md5(prior::text));
  live:=live||jsonb_build_object('source_fingerprint',md5(live::text));
  insert into qa_time_source values (staff,period_day,live);
  insert into payroll_payable_time_versions(id,profile_id,employee_id,work_date,revision,source_fingerprint,evidence,status,classification,approved_minutes,approved_extra_minutes,scheduled_minutes)
  values(gen_random_uuid(),profile,staff,period_day,3,prior->>'source_fingerprint',prior,'approved_manual',prior->>'classification',480,0,480)
  returning to_jsonb(payroll_payable_time_versions) into approval;
  assert prior->>'source_fingerprint'<>live->>'source_fingerprint', 'live calculation fingerprint input must remain distinct';
  assert public.payroll_time_evidence_matches(approval,live), 'equivalent decision must remain valid';
  assert public.payroll_time_source_state((approval->>'id')::uuid)->>'updated'='false', 'Review must retain approved state';
  if period_day<>'2026-09-16' then
    assert public.payroll_time_requirement(live,approval)->>'state'='ready', 'readiness must retain approved hours';
  else
    ph_saved:=jsonb_build_object('date',period_day,'period_start','2026-09-01','period_end','2026-09-30',
     'time',approval,'source',prior,'compensation',old_comp,
     'employment',jsonb_build_object('employment_jurisdiction','peninsular_labuan','legal_entity_id',entity),
     'paid_holiday',jsonb_build_object('status','paid_holiday','holiday','Hari Malaysia'),
     'company_policy',null,'company_benefit',null,'rules','[]'::jsonb);
    ph_live:=ph_saved||jsonb_build_object('source',live,'compensation',new_comp);
    insert into qa_ph_context values(run,staff,period_day,ph_live);
    insert into payroll_ph_eligibility_reviews(id,run_id,employee_id,work_date,revision,evidence,context,context_fingerprint)
    values(gen_random_uuid(),run,staff,period_day,2,
      '{"workflow":"pay_treatment_v1","intent":{"decision":"keep_approved","treatment":"none","treatment_model":"unified_v1"}}',
      ph_saved,md5(ph_saved::text));
  end if;

  if period_day='2026-09-01' then
   foreach change_path slice 1 in array array[
    array['roster_publication_id'],array['attendance_id'],array['leave_id'],array['holiday_id'],array['legal_entity_id'],array['compensation_version_id']
   ] loop
    changed:=live-'source_fingerprint';
    changed:=changed||jsonb_build_object(change_path[1],case when change_path[1]='compensation_version_id' then different_id else gen_random_uuid() end);
    changed:=changed||jsonb_build_object('source_fingerprint',md5(changed::text));
    assert not public.payroll_time_evidence_matches(approval,changed),'material change accepted: '||change_path[1];
    assert public.payroll_time_requirement(changed,approval)->>'state'='source_updated','readiness missed material change';
   end loop;
   assert not public.payroll_source_evidence_matches(prior,'invalid',live),'invalid saved hash accepted';
   assert not public.payroll_time_evidence_matches(approval,live||'{"source_fingerprint":"invalid"}'),'invalid live hash accepted';
  end if;
 end loop;

 select sum(approved_minutes) into totals from payroll_payable_time_versions where employee_id=staff and classification='regular';
 assert totals=184*60,'23 approval records must retain 184 regular hours';
 assert (select approved_minutes from payroll_payable_time_versions where employee_id=staff and work_date='2026-09-16')=480;
 select md5(jsonb_agg(to_jsonb(t) order by work_date)::text) into approval_before from payroll_payable_time_versions t where employee_id=staff;
 select md5(jsonb_agg(to_jsonb(r) order by revision)::text) into ph_before from payroll_ph_eligibility_reviews r where employee_id=staff;
 changed:=feedx_integrations.hr_payroll_run_time_readiness(null,run);
 assert changed->>'ready'='true' and changed->>'required_days'='23' and changed->>'stale'='0', 'run readiness must agree with Review';
 foreach machine in array array[null::uuid,gen_random_uuid(),null::uuid] loop
  changed:=feedx_integrations.hr_payroll_time_reconcile(machine,entity,'2026-09-01','2026-09-30',run);
  assert changed->>'created'='0' and changed->>'unchanged'='24' and changed->>'unresolved'='0', 'repeated Human and Agent sync must skip equivalent approvals';
 end loop;
 changed:=public.payroll_ph_statutory_project(run,staff,'2026-09-16');
 assert changed->'issues'='[]'::jsonb and changed#>>'{review,evidence,intent,treatment}'='none', 'existing PH treatment must project without reopening time or PH review';

 changed:=public.payroll_calculation_project(run,staff);
 assert changed->>'status'='ready' and changed->>'gross_earnings'='2000.00', 'canonical Monthly projection must price the existing decisions';
 assert changed#>>'{inputs,compensation_start,id}'=equivalent_id::text, 'calculation must record current compensation independently of approval validity';

 for i in 1..7 loop
  prior:=jsonb_set(ph_saved,'{employment}',(ph_saved->'employment')-'employment_jurisdiction',false);
  prior:=prior#-'{time,actor_machine_id}';
  live:=jsonb_set(prior,'{employment,recorded_by_machine_id}','null');
  live:=jsonb_set(live,'{time,actor_machine_id}','null');
  if i<=5 then live:=jsonb_set(live,'{employment,employment_jurisdiction}','null'); end if;
  assert public.payroll_ph_review_context_matches(prior,md5(prior::text),live),'historical absent/null PH review failed';
  foreach change_path slice 1 in array array[
   array['employment','recorded_by_machine_id'],array['time','actor_machine_id'],array['employment','legal_entity_id'],
   array['employment','employment_jurisdiction'],array['paid_holiday','holiday'],array['compensation','basic_salary'],
   array['time','approved_minutes']
  ] loop
   changed:=jsonb_set(live,change_path,to_jsonb('material change'::text));
   assert not public.payroll_ph_review_context_matches(prior,md5(prior::text),changed),'accepted material PH change: '||array_to_string(change_path,'.');
  end loop;
 end loop;
 assert (select md5(jsonb_agg(to_jsonb(t) order by work_date)::text) from payroll_payable_time_versions t where employee_id=staff)=approval_before;
 assert (select md5(jsonb_agg(to_jsonb(r) order by revision)::text) from payroll_ph_eligibility_reviews r where employee_id=staff)=ph_before;
end;
$cases$;
rollback;
