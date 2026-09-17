import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260917120105_crew_asset_activity_projection.sql"), "utf8");

describe("Crew Asset activity projection", () => {
  it("extends the token-bound Asset read with canonical movements and completed inspections only", () => {
    expect(sql).toContain("v_context jsonb := public.crew_asset_context(p_token)");
    expect(sql).toContain("'movement_history'");
    expect(sql).toContain("from public.asset_movement_logs where outlet_id=v_outlet_id");
    expect(sql).toContain("'inspection_history'");
    expect(sql).toContain("status in ('completed','partial','submitted')");
    expect(sql).toContain("'asset_ids'");
  });

  it("preserves the security-definer hardening and does not create a Crew event store", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).not.toMatch(/create table.*crew.*activity/i);
  });
});
