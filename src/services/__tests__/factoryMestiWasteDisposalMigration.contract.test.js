import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260904090000_factory_mesti_waste_disposal_record.sql"), "utf8");

describe("Factory MeSTI Waste Disposal contract", () => {
  it("uses versioned Location requirements and a single daily session", () => {
    expect(sql).toContain("factory_mesti_waste_disposal_requirements");
    expect(sql).toContain("logical_requirement_id uuid not null");
    expect(sql).toContain("required_count integer not null check (required_count > 0)");
    expect(sql).toContain("disposal_date date not null unique");
    expect(sql).toContain("version_created");
  });
  it("allows multiple immutable events while protecting submitted evidence", () => {
    expect(sql).toContain("factory_mesti_waste_disposal_events");
    expect(sql).toContain("location_snapshot jsonb not null");
    expect(sql).toContain("disposed_at timestamptz not null");
    expect(sql).toContain("Submitted waste disposal sessions are immutable.");
    expect(sql).not.toContain("unique (session_id, location_id)");
  });
  it("enforces canonical permissions and whole-day verification", () => {
    for (const permission of ["manage", "record", "submit", "verify"]) expect(sql).toContain(`factory_mesti_waste_disposal.${permission}`);
    expect(sql).toContain("Self-verification is not allowed.");
    expect(sql).toContain("completed_count<required_count");
    expect(sql).toContain("public.factory_mesti_waste_disposal_monthly(date)");
    expect(sql).toContain("to authenticated;");
  });
});
