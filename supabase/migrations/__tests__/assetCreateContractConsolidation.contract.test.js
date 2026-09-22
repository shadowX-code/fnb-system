import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260919094057_consolidate_asset_create_contract.sql"), "utf8");

describe("consolidated Asset create authority", () => {
  it("checks an idempotent retry before revalidating mutable options", () => {
    expect(sql.indexOf("operation = 'asset_creation'")).toBeLessThan(sql.indexOf("Choose an active asset category."));
  });

  it("sets create-only defaults and accepts only the shared unit vocabulary", () => {
    expect(sql).toContain("v_unit not in ('unit', 'piece', 'set', 'box', 'bottle', 'pair')");
    expect(sql).toMatch(/v_unit, v_quantity, 0, 'active', 'healthy'/);
    expect(sql).not.toContain("p_asset->>'minimum_quantity'");
  });

  it("preserves active-category and Crew attribution authority", () => {
    expect(sql).toContain("id = v_category_id and is_active");
    expect(sql).toContain("created_by_employee_id");
    expect(sql).toContain("v_employee_id");
  });
});
