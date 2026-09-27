import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe,it,expect } from 'vitest';
const read = path => readFileSync(resolve(process.cwd(),path),'utf8');
const sql=read('supabase/migrations/20260927075050_payroll_payslips_settlement_v1.sql');
const edge=read('supabase/functions/payroll-payslips/index.ts');
describe('Payroll Phase 5 authority boundaries',()=>{
 it('pins identity at Finalize and never backfills live historical identities',()=>{
  expect(sql).toContain('after insert on public.payroll_run_profile_snapshots');
  expect(sql).toContain('Frozen payslip identity or financial evidence unavailable');
  const manifest=sql.slice(sql.indexOf('create function public.payroll_payslip_manifest'),sql.indexOf('create function public.payroll_payslip_prepare_core'));
  expect(manifest).not.toContain('public.employees');expect(manifest).not.toContain('public.legal_entities');
 });
 it('keeps Crew employee and revision selection server derived',()=>{
  expect(sql).toContain('employee uuid:=public.crew_session_employee(p_token)');
  expect(sql).toContain('s.run_id=p.current_finalized_run_id and s.employee_id=employee');
  expect(sql).toContain('crew_payroll_payslip_prepare(p_token text,p_period_id uuid)');
  expect(edge).toContain('verified.job_id!==context.job_id');
 });
 it('locks settlement to period, appends evidence and never changes entitlement',()=>{
  expect(sql).toContain('for update of period');
  expect(sql).toContain('Settlement retry payload changed');
  expect(sql).toContain('greatest(paid-due,0)');
  expect(sql).not.toMatch(/update public.payroll_runs|update public.payroll_run_statutory/);
  expect(sql).toContain("kind in ('payment','recovery','reversal')");
 });
 it('has private immutable storage and short-lived authorized access',()=>{
  expect(sql).toContain("'payroll-payslips',false");expect(sql).toContain('enable row level security');
  expect(edge).toContain('upsert:false');expect(edge).toContain('createSignedUrl(context.object_path,60)');
  expect(edge).not.toContain('getPublicUrl');expect(edge).toContain('caller.auth.getUser()');
  expect(sql).toContain('payroll_payslip_finalize_service(uuid,text,text,integer) to service_role');
 });
});
