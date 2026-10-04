-- Staging or isolated local only. Synthetic correction is rolled back.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from employees e join roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
do $contract$
declare
  definition text; code text; basis text; rule_id uuid; comp_id uuid;
  employee uuid; run uuid; time_id uuid; result jsonb; projected jsonb;
  calculation_count integer; source_hash text; audit_count integer;
begin
  if exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='payroll_pay_rule_versions' and column_name='revision') then
    raise exception 'A fake pay-rule revision column must not be introduced';
  end if;
  -- Check every canonical rule code/basis, including unsupported/unconfigured
  -- pairs: absence stays null, rather than fabricating a rate.
  foreach code in array array['monthly_basic','monthly_proration','regular','overtime',
    'rest_day','public_holiday','public_holiday_ot','unpaid_time','non_payable'] loop
    foreach basis in array array['monthly','hourly'] loop
      select id into rule_id from payroll_pay_rule_versions where rule_code=code
        and pay_basis=basis and effective_from<='2026-09-30'
        order by effective_from desc limit 1;
      if rule_id is distinct from (select id from payroll_pay_rule_versions where rule_code=code
        and pay_basis=basis and effective_from=(select max(effective_from)
          from payroll_pay_rule_versions where rule_code=code and pay_basis=basis and effective_from<='2026-09-30')) then
        raise exception 'Canonical rule ordering mismatch: % / %',code,basis;
      end if;
      select id into comp_id from payroll_compensation_versions where pay_basis=basis limit 1;
      if comp_id is null then raise exception 'Representative compensation required: %',basis;end if;
      perform payroll_price_time(comp_id,null,code,300,'2026-09-30');
    end loop;
  end loop;
  -- Scan each individual SQL statement that refers to the rule table. This
  -- covers pricing, monthly entitlement, PH context, publication and read paths.
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral regexp_split_to_table(p.prosrc,';') statement
    where n.nspname='public' and p.prokind='f' and statement ilike '%payroll_pay_rule_versions%'
      and statement ~* 'order\s+by[^;]*\mrevision\M') then
    raise exception 'Invalid pay-rule revision ordering remains';
  end if;
  definition:=pg_get_functiondef('public.payroll_calculation_project(uuid,uuid)'::regprocedure);
  if (length(definition)-length(replace(definition,'order by effective_from desc,revision desc limit 1','')))
      /length('order by effective_from desc,revision desc limit 1')<>3
    or definition like '%public.payroll_compensation_effective_versions()%' then
    raise exception 'Indexed compensation effective-date/revision selection changed';
  end if;
  definition:=pg_get_functiondef('public.payroll_time_decision_save(jsonb)'::regprocedure);
  if definition like '%public.payroll_employee_recalculate(%'
    or definition not like '%calculation_stale%' then
    raise exception 'Fast decision transaction boundary changed';
  end if;
  select e.id,r.id into employee,run from employees e join payroll_periods p on p.legal_entity_id=e.legal_entity_id
    join payroll_runs r on r.period_id=p.id where e.employee_code='QA-TIME-LATENCY-1004' and p.period_start='2026-09-01';
  if employee is null then raise exception 'Labelled fast-decision fixture required';end if;
  select count(*) into calculation_count from payroll_run_calculation_versions where run_id=run;
  select md5(jsonb_agg(to_jsonb(t) order by revision,work_date)::text) into source_hash
    from payroll_payable_time_versions t where employee_id=employee;
  select count(*) into audit_count from payroll_events;
  select id into time_id from payroll_payable_time_versions where employee_id=employee
    and work_date='2026-09-23' order by revision desc limit 1;
  result:=payroll_time_decision_save(jsonb_build_object('request_id',gen_random_uuid(),
    'run_id',run,'time_version_id',time_id,'correction',true,'action','reject',
    'approved_minutes',0,'extra_minutes',0,'classification','non_payable',
    'reason','QA ONLY pay-rule ordering regression correction; transaction rolls back'));
  if result#>>'{row,status}'<>'non_payable' then raise exception 'Synthetic rejection not effective';end if;
  if (select count(*) from payroll_run_calculation_versions where run_id=run)<>calculation_count
    or (select count(*) from payroll_events)<>audit_count+1 then
    raise exception 'Save must append exactly one audit without month calculation';end if;
  projected:=payroll_calculation_project(run,employee);
  if (projected->>'gross_earnings')::numeric<>800 then
    raise exception 'Hourly non-payable branch / Regular gross incorrect: %',projected->>'gross_earnings';end if;
  if md5((select jsonb_agg(to_jsonb(t) order by revision,work_date)::text from payroll_payable_time_versions t
    where employee_id=employee and id<>(result->>'id')::uuid))<>source_hash then
    raise exception 'Earlier time evidence changed';end if;
  -- Previously failing monthly_basic projection (existing synthetic fixture).
  projected:=payroll_calculation_project('305a804a-404f-4b33-858f-8417fab6c473','b81d36fd-d24a-4b75-b6d9-f84b70854336');
  if projected->>'pay_basis'<>'monthly' then raise exception 'Monthly projection missing';end if;
  perform payroll_run_calculation_read(run);
end $contract$;
select 'PASS' pay_rule_ordering_and_fast_decision_contract;
rollback;
