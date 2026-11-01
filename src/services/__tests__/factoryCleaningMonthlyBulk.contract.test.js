import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261101014601_factory_area_cleaning_monthly_bulk_actions.sql'), 'utf8');
it('scopes the guarded batch to one requirement/date with explicit server permissions', () => {
  expect(sql).toContain("auth.uid() is null");
  for (const permission of ['view','manage','complete','review']) expect(sql).toContain(`factory_mesti_cleaning.${permission}`);
  expect(sql).toContain('where requirement_id=p_requirement_id and due_date=p_due_date order by id for update');
  expect(sql).toContain('Future cleaning dates cannot use bulk actions');
  expect(sql).toContain('from public,anon');
});
it('delegates transitions and audits per record without another occurrence writer', () => {
  expect(sql).toContain('public.factory_mesti_complete_cleaning_occurrence(v_row.id,null)');
  expect(sql).toContain("public.factory_mesti_verify_cleaning_occurrence(v_row.id,'verified',null)");
  expect(sql).toContain('insert into public.audit_logs');
  expect(sql).not.toMatch(/update\s+public\.factory_mesti_cleaning_occurrences/i);
});
it('revalidates confirmed versions and independently eligible states, with explicit partial outcomes', () => {
  expect(sql).toContain('Changed since confirmation');
  expect(sql).toContain('Not in confirmed selection');
  expect(sql).toContain("v_row.status not in ('pending','missed')");
  expect(sql).toContain('v_row.completed_by=v_actor.id');
  expect(sql).toContain('exception when others then');
  for(const field of ['affected_count','skipped_count','failed_count']) expect(sql).toContain(`'${field}'`);
});
