-- Regular Monthly payable minutes record attendance and do not authorize a salary deduction.
do $migration$
declare
  definition text:=pg_get_functiondef('public.payroll_calculation_project(uuid,uuid)'::regprocedure);
  old_branch text:=$branch$        v_billable_minutes:=greatest(0,coalesce(v_time.scheduled_minutes,0)-coalesce(v_time.approved_minutes,0));
        if v_billable_minutes>0 then
          v_line:=public.payroll_price_time(v_day_comp.id,v_time.id,'unpaid_time',v_billable_minutes,v_day);
          if v_line is null then v_issues:=array_append(v_issues,'missing_unpaid_time_rule:'||v_day);
          else v_lines:=v_lines||jsonb_build_array(v_line);
            v_deductions:=v_deductions+(v_line->>'amount')::numeric;
            v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||jsonb_build_array(v_line->'source'->>'rule_version_id'));
          end if;
        end if;
$branch$;
begin
  if position(old_branch in definition)=0 then
    raise exception 'Unexpected Monthly Regular time calculation';
  end if;
  definition:=replace(definition,old_branch,
    '        -- Basic Salary already covers Regular Monthly time.
        null;
');
  definition:=replace(definition,'v_billable_minutes integer; ','');
  definition:=replace(definition,
    '-- Regular Monthly time is already covered by Basic Salary, but an
      -- approved deficit needs a sourced unpaid-time rule and approved extra
      -- minutes need a sourced premium rule.',
    '-- Regular Monthly time is covered by Basic Salary. Approved extra time
      -- still requires a sourced premium rule.');
  execute definition;
end $migration$;
