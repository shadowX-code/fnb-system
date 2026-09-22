import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260919143000_crew_asset_manage_details.sql"), "utf8");

describe("Crew Asset detail access contract", () => {
  it("keeps presentation editing separate from Add Assets and records it", () => {
    expect(sql).toContain("can_manage_asset_details boolean not null default false");
    expect(sql).toContain("Manage Asset Details Special Access is required.");
    expect(sql).toContain("'asset_details_update'");
    expect(sql).toMatch(/set name=v_name,description=.*location=/s);
    expect(sql).not.toMatch(/set[^;]+current_quantity=/s);
    expect(sql).not.toMatch(/set[^;]+category_id=/s);
  });
});
