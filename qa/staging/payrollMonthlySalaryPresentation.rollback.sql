-- Presentation-only contracts over pinned canonical evidence; no business writes.
begin;
do $$
declare calc jsonb; groups jsonb; draft jsonb; final jsonb; basis jsonb; raw jsonb; i int;
begin
 for i in 1..5 loop
  basis:=jsonb_build_object('formula_code','ea18a_calendar_days_v1','monthly_salary',1800,
   'employment_reduction',case when i=3 then 60 else 0 end,
   'unpaid_leave_reduction',case when i in (2,3) then 60 else 0 end,
   'unpaid_absence_reduction',case when i in (1,3) then 60 else 0 end,
   'payable_basic_salary',case when i=3 then 1620 when i in (1,2) then 1740 else 1800 end);
  raw:=jsonb_build_object('kind','earning','code','monthly_basic','label','Basic Salary',
   'amount',basis->'payable_basic_salary','source',jsonb_build_object('monthly_entitlement',basis));
  if i=5 then raw:=raw-'source'; end if;
  calc:=jsonb_build_object('pay_basis','monthly','gross_earnings',raw->'amount',
    'non_statutory_deductions',0,'lines',jsonb_build_array(raw));
  groups:=payroll_earning_groups(calc);
  assert (select sum((x->>'amount')::numeric) from jsonb_array_elements(groups) x)=(raw->>'amount')::numeric,'Presentation net differs';
  assert calc#>'{lines,0}'=raw,'Canonical salary was repriced';
  if i<>5 then
   assert groups#>>'{0,label}'='Basic Salary' and (groups#>>'{0,amount}')::numeric=1800,'Contractual salary replaced by net';
   assert groups#>'{0,calculation_details,0}'=raw,'Pinned raw earning/evidence lost';
  else
   assert jsonb_array_length(groups)=1,'Incomplete legacy salary inferred';
  end if;
  if i=1 then
   assert groups#>>'{1,label}'='Unpaid Absence' and (groups#>>'{1,amount}')::numeric=-60,'Absence reduction incorrect';
   assert not exists(select 1 from jsonb_array_elements(groups) x where x->>'label'='Unpaid Leave'),'Absence impersonates Leave';
  elsif i=2 then
   assert groups#>>'{1,label}'='Unpaid Leave' and (groups#>>'{1,amount}')::numeric=-60,'Leave reduction incorrect';
   assert not exists(select 1 from jsonb_array_elements(groups) x where x->>'label'='Unpaid Absence'),'Leave impersonates absence';
  elsif i=3 then
   assert jsonb_array_length(groups)=4,'Independent reductions merged';
  elsif i=4 then
   assert jsonb_array_length(groups)=1,'Clean salary has redundant adjustments';
  end if;
  draft:=payroll_payslip_document('{"employee_name":"QA ONLY Monthly 陈"}','2026-09-01','2026-09-30',null,calc,'{"net_pay":1740,"lines":[]}',true);
  final:=payroll_payslip_document('{"employee_name":"QA ONLY Monthly 陈"}','2026-09-01','2026-09-30',now(),calc,'{"net_pay":1740,"lines":[]}',false);
  assert draft->'earnings'=final->'earnings','Draft/Final earnings differ';
  assert (select sum((x->>'amount')::numeric) from jsonb_array_elements(final->'earnings') x)=(final->>'gross_earnings')::numeric,'Payslip net effect counted twice';
  assert final->'deductions'='[]'::jsonb,'Unpaid earning reduction became a deduction';
 end loop;
 -- Final rounded entitlement and independent reductions must reconcile exactly.
 basis:=basis||'{"monthly_salary":1800,"employment_reduction":0,"unpaid_leave_reduction":58.06,"unpaid_absence_reduction":58.07,"payable_basic_salary":1683.87}';
 raw:=raw||jsonb_build_object('amount',1683.87,'source',jsonb_build_object('monthly_entitlement',basis));
 groups:=payroll_earning_groups(jsonb_build_object('lines',jsonb_build_array(raw)));
 assert (select sum((x->>'amount')::numeric) from jsonb_array_elements(groups) x)=1683.87,'Rounded pinned reductions repriced';
 -- An inconsistent legacy basis must not invent contractual/net reconciliation.
 raw:=jsonb_set(raw,'{amount}','1600');
 groups:=payroll_earning_groups(jsonb_build_object('lines',jsonb_build_array(raw)));
 assert jsonb_array_length(groups)=1 and (groups#>>'{0,amount}')::numeric=1600,'Nonreconciling legacy amount changed';
 assert not has_function_privilege('authenticated','public.payroll_earning_groups(jsonb)','execute'),'Private presentation authority exposed';
end $$;
select 'PASS: contractual salary, distinct Leave/absence, exact net/Gross, no second deduction, Draft/Final parity, legacy and rounding' as contract;
rollback;
