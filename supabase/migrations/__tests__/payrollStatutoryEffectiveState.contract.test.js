import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const sql=readFileSync('supabase/migrations/20260926043815_payroll_statutory_effective_state.sql','utf8');
describe('Statutory effective setup projection',()=>{
  it('distinguishes recommendation from confirmation without making it complete',()=>{
    expect(sql).toContain("issue is not null and recommendation is not null then 'confirmation_required'");
    expect(sql).toContain('complete:=complete and issue is null');
  });
  it('keeps current evidence separate from resolved future display and applies date boundaries',()=>{
    expect(sql).toContain('effective_from<=p_date');
    expect(sql).toContain('effective_from>p_date order by effective_from');
    expect(sql).toContain("in ('confirmed','not_applicable')");
    expect(sql).toContain("'display_schemes',display_schemes");
    expect(sql).toContain("'current',current_result->'schemes'->s");
    expect(sql).toContain("'Scheduled Change'");
    expect(sql).toContain("'statutory_setup',public.payroll_statutory_setup_summary");
    expect(sql).not.toMatch(/create or replace function public\.payroll_(statutory_project|run_finalize|statutory_setup_confirm)/);
    expect(sql).not.toMatch(/\b(update|delete from|insert into) public\.payroll_/i);
    expect(sql).toContain('from public,anon,authenticated');
  });
});
