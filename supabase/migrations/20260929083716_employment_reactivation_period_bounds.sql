-- Correct only dated employment boundaries. The People timeline, not today's
-- Employee projection, decides whether a Payroll/Roster/Performance date is active.
-- Existing finalized/published/retained evidence is not updated.
do $migration$
declare v_definition text; v_changed text;
begin
  v_definition:=pg_get_functiondef('public.payroll_monthly_entitlement(uuid,uuid,uuid)'::regprocedure);
  v_changed:=replace(v_definition,
    'v_state_version uuid; v_employed_pay numeric; v_pay numeric; v_basis jsonb;',
    'v_state_version uuid; v_employed_pay numeric; v_pay numeric; v_basis jsonb;'||E'\n  '||
    'v_day date; v_assignment public.employee_employment_assignment_revisions%rowtype;'||E'\n  '||
    'v_first_active date; v_last_active date; v_unresolved date; v_active_dates jsonb:=''[]''::jsonb;');
  if v_changed=v_definition then raise exception 'Payroll monthly declaration anchor changed'; end if;
  v_definition:=v_changed;
  v_changed:=replace(v_definition,
    $old$  v_end:=least(v_period.period_end,coalesce(v_employee.resigned_date,v_period.period_end));
  v_employed:=greatest(0,v_end-v_start+1);$old$,
    $new$  v_end:=v_period.period_end;
  v_employed:=0;
  for v_day in select generate_series(v_start,v_end,interval '1 day')::date loop
    v_assignment:=public.employee_employment_assignment_at(p_employee_id,v_day);
    if v_assignment.id is null then
      v_unresolved:=coalesce(v_unresolved,v_day);
    elsif v_assignment.employment_status='active'
      and (v_assignment.employment_end_date is null or v_day<=v_assignment.employment_end_date) then
      v_employed:=v_employed+1;
      v_first_active:=coalesce(v_first_active,v_day);
      v_last_active:=v_day;
      v_active_dates:=v_active_dates||to_jsonb(v_day::text);
    end if;
  end loop;
  if v_unresolved is not null then
    v_issues:=array_append(v_issues,'employment_history_unresolved');
  elsif v_employed=0 and v_employee.joined_date<=v_period.period_end then
    v_issues:=array_append(v_issues,'employment_assignment_requires_review');
  end if;$new$);
  if v_changed=v_definition then raise exception 'Payroll monthly employment-day anchor changed'; end if;
  v_definition:=v_changed;
  v_changed:=replace(v_definition,
    $old$from (select generate_series(v_start,v_end,interval '1 day')::date work_date) d$old$,
    $new$from (select value::date work_date from jsonb_array_elements_text(v_active_dates)) d$new$);
  if v_changed=v_definition then raise exception 'Payroll monthly unpaid-day anchor changed'; end if;
  v_definition:=v_changed;
  v_changed:=replace(v_definition,
    $old$'employment_start',v_start,'employment_end',v_end,'joined_date',v_employee.joined_date,$old$,
    $new$'employment_start',v_first_active,'employment_end',v_last_active,'joined_date',v_employee.joined_date,$new$);
  if v_changed=v_definition then raise exception 'Payroll monthly evidence-span anchor changed'; end if;
  v_definition:=v_changed;
  v_changed:=replace(v_definition,
    $old$'last_employment_date',v_employee.resigned_date,'period_days',v_days,'employed_days',v_employed,$old$,
    $new$'last_employment_date',v_assignment.employment_end_date,'period_days',v_days,'employed_days',v_employed,$new$||E'\n    '||
    $new$'active_employment_dates',v_active_dates,$new$);
  if v_changed=v_definition then raise exception 'Payroll monthly end-evidence anchor changed'; end if;
  execute v_changed;

  -- The dated resolver already supplies the final eligibility issue. A current
  -- resignation must not add a contradictory issue for a later active period.
  v_definition:=pg_get_functiondef('public.payroll_calculation_project(uuid,uuid)'::regprocedure);
  v_changed:=replace(v_definition,
    $old$  if v_employee.resigned_date is not null and v_employee.resigned_date<v_period.period_start then
    v_issues:=array_append(v_issues,'employment_ended_before_period');
  end if;$old$,
    $new$  -- Period employment eligibility is resolved from People below.$new$);
  if v_changed=v_definition then raise exception 'Payroll calculation current-resignation anchor changed'; end if;
  execute v_changed;

  v_definition:=pg_get_functiondef('public.roster_employment_on_date(uuid,uuid,date)'::regprocedure);
  v_changed:=replace(v_definition,
    $old$    or (v_employee.resigned_date is not null and p_on > v_employee.resigned_date)
    or (v_assignment.employment_end_date is not null and p_on > v_assignment.employment_end_date)$old$,
    $new$    or (v_assignment.employment_end_date is not null and p_on > v_assignment.employment_end_date)$new$);
  if v_changed=v_definition then raise exception 'Roster dated-boundary anchor changed'; end if;
  execute v_changed;

  v_definition:=pg_get_functiondef('public.crew_performance_period_employment(uuid,date)'::regprocedure);
  v_changed:=replace(v_definition,
    '  v_end:=least(v_end,coalesce(v_employee.resigned_date,v_end));',
    '  -- Evaluate every applicable day through its People assignment, including scheduled reactivation.');
  if v_changed=v_definition then raise exception 'Performance dated-boundary anchor changed'; end if;
  execute v_changed;
end $migration$;

-- Replacing a function preserves its existing grants; keep all three private.
revoke all on function public.payroll_monthly_entitlement(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.payroll_calculation_project(uuid,uuid) from public,anon,authenticated;
revoke all on function public.roster_employment_on_date(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.crew_performance_period_employment(uuid,date) from public,anon,authenticated;
