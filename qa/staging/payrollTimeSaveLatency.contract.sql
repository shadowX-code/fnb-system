-- STAGING/isolated local ONLY. Synthetic decisions roll back after assertions.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from employees e join roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
create temporary table latency_results(day date, milliseconds numeric) on commit drop;
do $$
declare emp uuid; run uuid; t payroll_payable_time_versions%rowtype; input jsonb; result jsonb; started timestamptz; n integer:=0; count_before integer; source_hash text; final_hash text; q jsonb; ph_count integer:=0; expected numeric;
begin
 select id into emp from employees where employee_code='QA-TIME-LATENCY-1004';
 select r.id into run from payroll_runs r join payroll_periods p on p.id=r.period_id join employees e on e.legal_entity_id=p.legal_entity_id where e.id=emp;
 if emp is null or run is null then raise exception 'Labelled 22-exception fixture required';end if;
 select count(*) into count_before from payroll_run_calculation_versions where run_id=run;
 select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) into final_hash from payroll_run_calculation_snapshots s;
 select md5(jsonb_agg(evidence order by work_date)::text) into source_hash from payroll_payable_time_versions where employee_id=emp and revision=1;
 for t in select * from payroll_payable_time_versions where employee_id=emp and status='review_required' order by work_date loop
  if t.evidence#>>'{paid_holiday_policy,status}'='paid_holiday' then ph_count:=ph_count+1;end if;
  input:=jsonb_build_object('request_id',gen_random_uuid(),'run_id',run,'time_version_id',t.id,'correction',false,'action','adjust','approved_minutes',300,'extra_minutes',0,'classification',case when t.evidence#>>'{paid_holiday_policy,status}'='paid_holiday' then 'public_holiday' else 'regular' end,'reason','QA ONLY explicit published roster evidence reviewed');
  if n=0 then
   -- Emulate a SQL cancellation after append: PostgreSQL rolls back the entire
   -- command, including decision + event; replay is allowed exactly once.
   begin
    perform payroll_time_decision_save(input);
    raise exception using errcode='57014',message='QA simulated statement timeout';
   exception when query_canceled then null; end;
   if payroll_time_decision_status(input) is not null then raise exception 'Timed-out append escaped rollback';end if;
  end if;
  started:=clock_timestamp(); result:=payroll_time_decision_save(input);
  insert into latency_results values(t.work_date,extract(epoch from clock_timestamp()-started)*1000);
  if result#>>'{row,status}'<>'approved_manual' or (result#>>'{row,approved_minutes}')::integer<>300 or result->>'calculation_stale'<>'true' then raise exception 'Canonical committed row unavailable';end if;
  if payroll_time_decision_status(input)->>'id'<>result->>'id' then raise exception 'Lost-response recovery mismatch';end if;
  if payroll_time_decision_save(input)->>'id'<>result->>'id' then raise exception 'Idempotent retry mismatch';end if;
  if (select count(*) from payroll_events where details->>'request_id'=input->>'request_id')<>1 then raise exception 'Duplicate retry history';end if;
  begin perform payroll_time_decision_save(input||jsonb_build_object('reason','QA altered retry'));raise exception 'Changed request accepted';exception when others then if sqlerrm='Changed request accepted' then raise;end if;end;
  n:=n+1;
 end loop;
 if n<>22 then raise exception 'Expected 22 saves, got %',n;end if;
 if (select count(*) from payroll_run_calculation_versions where run_id=run)<>count_before then raise exception 'Decision recalculated inside critical transaction';end if;
 if (select count(*) from payroll_payable_time_versions where employee_id=emp and revision=2)<>22 then raise exception 'Effective decisions duplicated';end if;
 if md5((select jsonb_agg(evidence order by work_date)::text from payroll_payable_time_versions where employee_id=emp and revision=1))<>source_hash then raise exception 'Original evidence changed';end if;
 perform payroll_employee_recalculate(run,emp);
 q:=payroll_calculation_project(run,emp);
 expected:=880-ph_count*40;
 if (q->>'gross_earnings')::numeric<>expected then raise exception 'Final approved Regular Gross incorrect: % / %',q->>'gross_earnings',q->'issues';end if;
 if (select sum((x->>'amount')::numeric) from jsonb_array_elements(payroll_earning_groups(q)) x)<>expected then raise exception 'Payslip group reconciliation failed';end if;
 if exists(select 1 from payroll_run_calculation_versions c where c.run_id=run and c.id=(select id from payroll_run_calculation_versions where run_id=run order by revision desc limit 1) and c.input_fingerprint<>q->>'input_fingerprint') then raise exception 'Calculation fingerprint stale after sequence';end if;
 if md5(coalesce((select jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text from payroll_run_calculation_snapshots s),''))<>final_hash then raise exception 'Finalized snapshots changed';end if;
end $$;
select count(*) saves,round(min(milliseconds),2) min_ms,round(avg(milliseconds),2) mean_ms,round(max(milliseconds),2) max_ms from latency_results;
rollback;
