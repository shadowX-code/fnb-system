import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const sql=readFileSync('supabase/migrations/20261005114210_payroll_monthly_absence_and_ph_preview.sql','utf8');
describe('Payroll unpaid-absence and independent PH financial projections',()=>{
 it('uses only the latest current full-day decision inside effective employment and company scope',()=>{
  for(const guard of ['distinct on (work_date)','order by work_date,revision desc','v_time.approved_minutes is distinct from 0','v_active_dates ? v_time.work_date::text','v_time.source_fingerprint is distinct from v_source','v_period.legal_entity_id::text',"v_source->>'pay_basis' is distinct from 'monthly'"])
   expect(sql).toContain(guard);
  expect(sql).toContain("'confirmed_unpaid_absences',v_absences");
  expect(sql).toContain("'time_version_id',v_time.id");
 });
 it('retains Leave and PH ownership and prices Monthly absence once through existing calendar entitlement',()=>{
  expect(sql).toContain("v_source#>>'{paid_holiday_policy,status}'='paid_holiday'");
  expect(sql).toContain('Approved Leave owns its date');
  expect(sql).toContain('jsonb_array_elements_text(v_leave_dates||v_absence_dates)');
  expect(sql).toContain('v_comp.basic_salary*(v_employed-v_unpaid)/v_days');
  expect(sql).toContain("'unpaid_absence_reduction',v_leave_pay-v_pay");
  const nonPayable=sql.slice(sql.indexOf("if v_time.classification='non_payable'"),sql.indexOf('-- Regular Monthly time'));
  expect(nonPayable).not.toContain('payroll_price_time');
  expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.(crew_approved_leaves|crew_leave_requests|payroll_payable_time_versions|payroll_run_calculation_snapshots)/i);
 });
 it('shows only canonical allowance lines when OT alone is unresolved without claiming a complete total',()=>{
  expect(sql).toContain("where issue<>'ph_ot_statutory_evidence_required'");
  expect(sql).toContain("'allowance_basis',case when allowance_determinate then allowance_line end");
  expect(sql).toContain("'public_holiday_allowance',case when allowance_determinate then normal end");
  expect(sql).toContain("'payroll_change',case when determinate then total-previous end");
  expect(sql).toContain('payroll_ph_treatment_quote(');
  expect(sql).not.toContain('create or replace function public.payroll_ph_company_allowance');
 });
 it('keeps private calculation helpers private and authenticated preview scoped',()=>{
  expect(sql).toContain('payroll_can_access_run_employee');
  expect(sql).toContain('perform payroll_admin_actor()');
  expect(sql).toContain('public.payroll_calculation_project(uuid,uuid) from public,anon,authenticated');
  expect(sql).toContain('public.payroll_ph_treatment_preview(jsonb) to authenticated');
 });
});
