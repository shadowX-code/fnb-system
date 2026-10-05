import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
const sql=readFileSync('supabase/migrations/20261005165925_payroll_blocked_calculation_persistence.sql','utf8');
it('keeps incomplete financial evidence out of append-only money versions without weakening table constraints',()=>{
 expect(sql).not.toMatch(/alter table|delete from|update public\.payroll_run_/i);
 expect(sql).toContain('if not public.payroll_calculation_has_totals(v_projection) then');
 expect(sql).toContain('v_blocked:=v_blocked+1; continue;');
 expect(sql).toContain('public.payroll_calculation_has_totals(public.payroll_calculation_project(p_run_id,v_employee_id))');
 expect(sql).toContain("from public,anon,authenticated");
 expect(sql).toContain("v_run.status not in ('draft','review_required')");
});
it('presents current blocked evidence consistently without reusing old money or pretending it is stale',()=>{
 expect(sql).toContain("'previous_calculation_version_id',c.id,'persistence_state','blocked'");
 expect(sql).toContain("'status','review_required','is_stale',false");
 expect(sql).toContain("'net_pay',null,'employer_statutory_cost',null,'total_employer_cost',null");
 expect(sql).toContain("return public.payroll_run_evidence_read(p_run_id)->'calculation'");
 expect(sql).toContain("return public.payroll_run_evidence_read(p_run_id)->'statutory'");
 expect(sql).toContain('payroll_run_calculation_snapshots');
});
