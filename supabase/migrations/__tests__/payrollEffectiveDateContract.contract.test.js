import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const sql=readFileSync('supabase/migrations/20260927061128_payroll_effective_date_contract.sql','utf8');
describe('Payroll effective-date contract',()=>{
 it('retains legacy evidence and appends explicit monthly revisions',()=>{
  expect(sql).toContain("default 'exact_date'");
  expect(sql).toContain("'payroll_month',revision");
  expect(sql).not.toMatch(/update public\.payroll_statutory_(profile|input)_versions/i);
  expect(sql).toContain('payroll_statutory_applicability_effective');
  expect(sql).toContain('payroll_statutory_category_effective');
  expect(sql).toContain('payroll_run_pcb_read_pre_employee_scope');
 });
 it('preserves scope, concurrency, immutable snapshots and private helper ACLs',()=>{
  expect(sql).toContain("payroll_can_access_employee(employee,'payroll.manage')");
  expect(sql).toContain("r->>'fingerprint' is distinct from p_fingerprint");
  expect(sql).toContain('for update of run');
  expect(sql).toContain('Use a controlled correction for a finalized period.');
  expect(sql).toContain('from public,anon,authenticated');
  expect(sql).not.toMatch(/update public\.payroll_run_.*snapshots/i);
 });
 it('makes component policy explicit and prices only through the canonical projection',()=>{
  expect(sql).toContain("mid_period_policy text\n check");
  for(const policy of ['calendar_days','full_when_active','next_full_period']) expect(sql).toContain(policy);
  expect(sql).toContain('round(total/period_days,2)');
  expect(sql).toContain('component_proration_policy_required:');
  expect(sql).toContain('payroll_recurring_period_project(v_profile.id');
  expect(sql).toContain("'definition',to_jsonb(c)");
  expect(sql).toContain('Create a successor for a changed policy.');
 });
});
