import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const sql=readFileSync('supabase/migrations/20260926031421_payroll_employee_setup_guidance.sql','utf8');
describe('Payroll recommendation authority',()=>{
  it('reuses existing guard and append-only category command',()=>{
    expect(sql).toContain('public.payroll_statutory_category_issue');
    expect(sql).toContain('public.payroll_statutory_input_adjust');
    expect(sql).toContain("payroll_can_access_employee(e.id,'payroll.view')");
    expect(sql).toContain('for update');
    expect(sql).toContain('is distinct from p_fingerprint');
    expect(sql).not.toMatch(/update public.payroll_statutory_input_versions/i);
  });
  it('pins canonical employee/applicability evidence and exposes no anonymous command',()=>{
    expect(sql).toContain("'applicability_version_id',a.id");
    expect(sql).toContain("'birthday',e.birthday");
    expect(sql).toContain('from public,anon');
    expect(sql).toContain('set search_path=public');
  });
});
