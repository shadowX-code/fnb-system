import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260927073102_payroll_v1_epf_supported_envelope.sql'), 'utf8');
describe('locked Payroll V1 statutory support envelope', () => {
  it('restores the fractional allocation blocker without a second calculator or history mutation', () => {
    expect(migration).toContain("'if v_issue not like ''pcb_%'' then'");
    expect(migration).toContain('official_reconciliation_required_v1');
    expect(migration).toContain('EPF gate replacement did not match');
    expect(migration).not.toContain('insert into');
    expect(migration).not.toContain('update public.payroll_run');
    expect(migration).toContain('from public,anon,authenticated');
  });
});
