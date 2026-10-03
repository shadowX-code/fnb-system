-- Presentation-only fixtures: these are already-priced canonical-style lines.
-- They do NOT configure/verify a statutory PH formula or employee entitlement.
begin;
do $$
declare calc jsonb; groups jsonb; draft jsonb; final jsonb;
begin
 calc:='{"pay_basis":"hourly","gross_earnings":212.69,"non_statutory_deductions":0,"lines":[
 {"kind":"earning","code":"regular","minutes":300,"rate_per_minute":0.13333333,"multiplier":1,"amount":40,"source":{"compensation_version_id":"a","rule_version_id":"r","work_date":"2026-09-22"}},
 {"kind":"earning","code":"regular","minutes":300,"rate_per_minute":0.13333333,"multiplier":1,"amount":40,"source":{"compensation_version_id":"a","rule_version_id":"r","work_date":"2026-09-23"}},
 {"kind":"earning","code":"regular","minutes":300,"rate_per_minute":0.15,"multiplier":1,"amount":45,"source":{"compensation_version_id":"b","rule_version_id":"r","work_date":"2026-09-24"}},
 {"kind":"earning","code":"overtime","label":"Overtime","minutes":60,"rate_per_minute":0.13333333,"multiplier":1.5,"amount":12,"source":{"compensation_version_id":"a","rule_version_id":"ot"}},
 {"kind":"earning","code":"public_holiday","minutes":300,"rate_per_minute":0.13333333,"multiplier":1,"amount":40,"source":{"compensation_version_id":"a","rule_version_id":"test-priced-evidence-only"}},
 {"kind":"earning","code":"public_holiday","minutes":240,"rate_per_minute":0.13333333,"multiplier":1,"amount":32,"source":{"compensation_version_id":"a","rule_version_id":"test-priced-evidence-only"}},
 {"kind":"earning","code":"regular","minutes":1,"rate_per_minute":0.845,"multiplier":1,"amount":0.85,"source":{"compensation_version_id":"c","rule_version_id":"r"}},
 {"kind":"earning","code":"regular","minutes":1,"rate_per_minute":0.845,"multiplier":1,"amount":0.84,"source":{"compensation_version_id":"c","rule_version_id":"r"}},
 {"kind":"earning","code":"regular","minutes":1,"rate_per_minute":0.845,"multiplier":2,"amount":2,"source":{"compensation_version_id":"c","rule_version_id":"different-rule"}}
 ]}';
 groups:=payroll_earning_groups(calc);
 if jsonb_array_length(groups)<>6 then raise exception 'Incompatible pricing bases merged: %',groups; end if;
 if (select sum((x->>'amount')::numeric) from jsonb_array_elements(groups) x)<>212.69 then raise exception 'Aggregate gross changed'; end if;
 if (select sum(jsonb_array_length(x->'calculation_details')) from jsonb_array_elements(groups) x)<>9 then raise exception 'Daily evidence lost'; end if;
 if not exists(select 1 from jsonb_array_elements(groups) x where x->>'label'='Public Holiday Allowance' and (x->>'amount')::numeric=72 and (x->>'minutes')::numeric=540) then raise exception 'PH presentation incorrect'; end if;
 if not exists(select 1 from jsonb_array_elements(groups) x where (x->>'amount')::numeric=1.69 and (x->>'minutes')::numeric=2) then raise exception 'Rounded daily evidence repriced'; end if;
 draft:=payroll_payslip_document('{"employee_name":"QA ONLY Earnings 陈"}', '2026-09-01','2026-09-30',null,calc,'{"net_pay":212.69,"lines":[]}',true);
 final:=payroll_payslip_document('{"employee_name":"QA ONLY Earnings 陈"}', '2026-09-01','2026-09-30',now(),calc,'{"net_pay":212.69,"lines":[]}',false);
 if jsonb_array_length(draft->'earnings')<>6 or draft->'earnings' is distinct from final->'earnings' or (select sum((x->>'amount')::numeric) from jsonb_array_elements(final->'earnings') x)<>212.69 then raise exception 'Draft/Final server projection diverged'; end if;
 if exists(select 1 from jsonb_array_elements(final->'earnings') x where x ? 'source' or x ? 'calculation_details') then raise exception 'Raw audit text leaked into renderer/font input'; end if;
 if has_function_privilege('anon','public.payroll_time_decision_save(jsonb)','execute') or has_function_privilege('authenticated','public.payroll_earning_groups(jsonb)','execute') then raise exception 'Private authority exposed'; end if;
end $$;
select 'PASS: priced-line exact gross, rate/rule/multiplier splits, daily rounding/evidence, Public Holiday Allowance, Draft/Final parity, private grants' as contract;
rollback;
