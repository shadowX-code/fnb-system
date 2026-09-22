import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260917211500_crew_asset_inspection_result_updates.sql"), "utf8");

describe("Crew inspection result updates", () => {
  it("returns committed quantity and condition values from the authoritative inspection transaction", () => {
    expect(sql).toContain("returning * into v_asset");
    expect(sql).toContain("v_asset_updates:=v_asset_updates || jsonb_build_array");
    expect(sql).toContain("'asset_updates',v_asset_updates");
  });
});
