import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261028170644_factory_cleaning_exact_effective_date.sql", "utf8");
it("saves exact dates or raises actionable validation without rewriting occurrence history", () => {
  expect(sql.match(/create or replace function/g)).toHaveLength(1);
  expect(sql).toContain("factory_save_mesti_cleaning_requirement(p_requirement jsonb)");
  expect(sql).not.toMatch(/greatest\(v_requested_effective_from/);
  expect(sql).not.toMatch(/(delete from|update) public.factory_mesti_cleaning_occurrences/i);
  expect(sql).toContain("lock table public.factory_mesti_cleaning_occurrences in share mode");
  expect(sql).toContain("Effective From must be on or after %s");
  expect(sql).toContain("v_current.id is distinct from v_id");
  expect(sql).toContain("v_previous.effective_from + 1");
  expect(sql).toContain("v_latest_evidence_date + 1");
  expect(sql).toContain("security definer set search_path = public, pg_temp");
  expect(sql).toContain("from public, anon");
});
