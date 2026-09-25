import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925134633_payroll_statutory_official_packs.sql"), "utf8");
const hourlyGuard = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925135058_payroll_epf_hourly_bonus_guard.sql"), "utf8");
const socsoClosure = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925140129_payroll_socso_act4_independent_of_lindung24jam.sql"), "utf8");

function schedule(category) {
  const start = migration.indexOf(`values ('${category === "standard" ? "eis" : category.startsWith("malaysian") ? "epf" : "socso"}','${category}'`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("as b(wage_above,wage_through,employee_amount,employer_amount,source_row);", start);
  const rows = [...migration.slice(start, end).matchAll(/\((\d+\.\d{2}),(\d+\.\d{2}|null),(\d+\.\d{2}),(\d+\.\d{2}),'(?:Part [AE] line \d+|Act (?:4|800) row \d+)'\)/g)]
    .map(([, above, through, employee, employer]) => ({ above: Number(above), through: through === "null" ? Infinity : Number(through), employee: Number(employee), employer: Number(employer) }));
  return rows;
}

function contribution(category, wage) {
  const row = schedule(category).find((band) => wage > band.above && wage <= band.through);
  return row && [row.employee, row.employer];
}

describe("issuer-published statutory tables and safe category boundary", () => {
  it("contains complete continuous official KWSP Part A/E bands through RM20,000", () => {
    for (const category of ["malaysian_under_60", "malaysian_60_to_74"]) {
      const rows = schedule(category);
      expect(rows).toHaveLength(401);
      expect(rows[0].above).toBe(0);
      expect(rows.at(-1).through).toBe(20000);
      rows.slice(1).forEach((row, i) => expect(row.above).toBe(rows[i].through));
    }
    // KWSP's published RM3,250 example, age-60 category, and rate-band boundary.
    expect(contribution("malaysian_under_60", 3250)).toEqual([359, 424]);
    expect(contribution("malaysian_under_60", 5000)).toEqual([550, 650]);
    expect(contribution("malaysian_under_60", 5000.01)).toEqual([561, 612]);
    expect(contribution("malaysian_60_to_74", 5000)).toEqual([0, 200]);
  });

  it("keeps separate complete PERKESO Act 4 and Act 800 tables and RM6,000 ceiling", () => {
    for (const category of ["first_category_base", "second_category_base", "standard"]) {
      const rows = schedule(category);
      expect(rows).toHaveLength(65);
      expect(rows[0].above).toBe(0);
      expect(rows.at(-1).above).toBe(6000);
      expect(rows.at(-1).through).toBe(Infinity);
      rows.slice(1).forEach((row, i) => expect(row.above).toBe(rows[i].through));
    }
    expect(contribution("first_category_base", 30)).toEqual([0.1, 0.4]);
    expect(contribution("first_category_base", 6000.01)).toEqual([29.75, 104.15]);
    expect(contribution("second_category_base", 6000.01)).toEqual([0, 74.4]);
    expect(contribution("standard", 30)).toEqual([0.05, 0.05]);
    expect(contribution("standard", 6000.01)).toEqual([11.9, 11.9]);
  });

  it("blocks unsupported category assumptions and preserves the unvalidated PCB gate", () => {
    expect(socsoClosure).not.toContain("socso_2026_lindung24jam_election_unmodeled");
    expect(socsoClosure).toContain("socso_prior_contribution_history_unverified");
    expect(socsoClosure).toContain("socso_category_mismatch");
    expect(migration).toContain("eis_prior_contribution_history_unverified");
    expect(migration).toContain("epf_category_mismatch");
    expect(migration).toContain("epf_above_20000_split_unreconciled");
    expect(migration).toContain("pcb_2026_official_spec_unvalidated");
    expect(hourlyGuard).toContain("where l->>'code' in ('monthly_basic','regular')");
    expect(migration).not.toContain("insert into public.payroll_run_statutory_versions");
  });
});
