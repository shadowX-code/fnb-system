import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
const sql=readFileSync('supabase/migrations/20260927085319_payroll_payslip_draft_v1.sql','utf8');
const edge=readFileSync('supabase/functions/payroll-payslips/index.ts','utf8');
it('keeps draft Admin-authorized, entity-scoped and read-only',()=>{
 const draft=sql.slice(sql.indexOf('create function public.payroll_draft_payslip_read'));
 expect(draft).toContain('payroll_admin_actor()');
 expect(draft).toContain("payroll_can_manage_entity(p.legal_entity_id,'payroll.view')");
 expect(draft).toContain('payroll_run_calculation_read');
 expect(draft).toContain('is_stale');
 expect(draft).not.toMatch(/insert into|update public|delete from/);
 expect(draft).toContain('to authenticated');
 const branch=edge.slice(edge.indexOf('if(draft)'),edge.indexOf('const rpc='));
 expect(branch).toContain('Cache-Control');
 expect(branch).not.toContain('.storage');
});
it('retains snapshots and historic artifacts, defers settlement',()=>{
 expect(sql).toContain('payroll_run_calculation_snapshots');
 expect(sql).toContain('payroll_run_statutory_snapshots');
 expect(sql).not.toMatch(/delete from|drop table|update public.payroll_payslip/);
 expect(sql).toContain('revoke all on function public.payroll_payment_read');
});
