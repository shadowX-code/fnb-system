import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const sql=readFileSync('supabase/migrations/20260926035233_payroll_unified_statutory_setup.sql','utf8');
describe('Unified statutory setup authority',()=>{
  it('resolves applicability before category and never creates PCB category',()=>{
    expect(sql.indexOf('elsif applicable=false')).toBeLessThan(sql.indexOf("category:=to_jsonb(i)"));
    expect(sql).toContain("elsif s='pcb' then null");
    expect(sql).toContain("'not_applicable'");
    expect(sql).toContain("'statutory_setup',public.payroll_statutory_setup_resolve");
  });
  it('atomically delegates append-only commands with shared date, scope and evidence',()=>{
    expect(sql).toContain('for update');
    expect(sql).toContain("payroll_can_access_employee(p.employee_id,'payroll.manage')");
    expect(sql).toContain('payroll_statutory_adjust(p_profile_id,p_effective_from');
    expect(sql).toContain('payroll_statutory_input_adjust(p_profile_id,p_effective_from');
    expect(sql).toContain("r->>'fingerprint' is distinct from p_fingerprint");
    expect(sql).toContain('Complete Setup or an override requires evidence and reason');
    expect(sql).not.toMatch(/update public\.payroll_statutory_(input|profile)_versions/);
    expect(sql).toContain('from public,anon,authenticated');
  });
});
