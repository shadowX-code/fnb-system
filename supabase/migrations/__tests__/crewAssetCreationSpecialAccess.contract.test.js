import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260917124812_crew_asset_creation_special_access.sql"), "utf8");

describe("Crew Asset creation authority", () => {
  it("keeps add, adjust and inspect as independent capabilities while granting read access to any of them", () => {
    expect(sql).toContain("can_add_assets boolean not null default false");
    expect(sql).toMatch(/not \(v_access\.can_add_assets or v_access\.can_adjust_assets or v_access\.can_perform_asset_inspections\)/);
    expect(sql).toMatch(/crew_update_asset_access[\s\S]*p_can_add_assets boolean default false/);
  });

  it("creates only a safe, outlet-derived active asset with Crew attribution and idempotent audit evidence", () => {
    expect(sql).toMatch(/crew_asset_create\(p_token text, p_request_id uuid, p_asset jsonb\)/);
    expect(sql).toContain("Add Assets Special Access is required.");
    expect(sql).toContain("Choose an active asset category.");
    expect(sql).toContain("created_by_employee_id");
    expect(sql).toContain("operation='asset_creation'");
    expect(sql).not.toMatch(/crew_asset_create[\s\S]*purchase_date/);
  });

  it("preserves physical condition during direct quantity adjustments", () => {
    const adjustment = sql.match(/create or replace function public\.crew_asset_adjust[\s\S]*?\n\$\$;/)?.[0] || "";
    expect(adjustment).toContain("p_condition text");
    expect(adjustment).not.toContain("condition=v_condition");
    expect(adjustment).toContain("'condition',v_asset.condition");
  });

  it("keeps initial Crew photos token-bound to the caller's newly created asset", () => {
    expect(sql).toContain("crew_asset_initial_photo_context");
    expect(sql).toContain("created_by_employee_id=v_employee_id");
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).toContain("crew_asset_set_initial_photo");
  });

  it("extends the read-only activity projection with inspection count evidence", () => {
    expect(sql).toContain("'expected_quantity'");
    expect(sql).toContain("'counted_quantity'");
    expect(sql).toContain("'difference'");
  });
});
