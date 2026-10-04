-- Forward repair only: pay-rule versions are unique by rule_code, pay_basis,
-- effective_from. Compensation has separate revision semantics and is untouched.
do $repair$
declare
  definition text:=pg_get_functiondef('public.payroll_calculation_project(uuid,uuid)'::regprocedure);
  monthly_lookup text:=$monthly$from public.payroll_pay_rule_versions
          where rule_code='monthly_basic' and pay_basis='monthly'
            and effective_from<=v_period.period_start order by effective_from desc,revision desc limit 1;$monthly$;
  non_payable_lookup text:=$non_payable$from public.payroll_pay_rule_versions
          where rule_code='non_payable' and pay_basis=v_basis and effective_from<=v_day
          order by effective_from desc,revision desc limit 1;$non_payable$;
begin
  if (length(definition)-length(replace(definition,monthly_lookup,'')))/length(monthly_lookup)<>1
    or (length(definition)-length(replace(definition,non_payable_lookup,'')))/length(non_payable_lookup)<>1 then
    raise exception 'Pay-rule repair anchors differ from verified fast-decision authority';
  end if;
  definition:=replace(definition,monthly_lookup,
    replace(monthly_lookup,'effective_from desc,revision desc','effective_from desc'));
  definition:=replace(definition,non_payable_lookup,
    replace(non_payable_lookup,'effective_from desc,revision desc','effective_from desc'));
  execute definition;
end $repair$;
