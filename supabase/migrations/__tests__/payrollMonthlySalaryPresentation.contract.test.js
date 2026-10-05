import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
const sql=readFileSync('supabase/migrations/20261005121845_payroll_monthly_salary_presentation.sql','utf8');
it('only evolves the shared earning presentation, preserving calculation and evidence authorities',()=>{
 expect(sql.match(/create or replace function/gi)).toHaveLength(1);
 expect(sql).toContain('public.payroll_earning_groups(p_calculation jsonb)');
 expect(sql).not.toMatch(/(?:insert into|update|delete from|create table|alter table)/i);
 expect(sql).toContain("'canonical_amount',line->'amount'");
 expect(sql).toContain("'Unpaid Leave'");expect(sql).toContain("'Unpaid Absence'");
 expect(sql).toContain("else jsonb_build_array(line)");
 expect(sql).toContain('from public,anon,authenticated');
});
