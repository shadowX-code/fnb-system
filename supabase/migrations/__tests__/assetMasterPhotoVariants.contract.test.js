import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260918150000_asset_master_photo_variants.sql"), "utf8");

describe("Asset master photo variant contract", () => {
  it("keeps an original reference while retaining canonical display and thumbnail fields", () => {
    expect(sql).toContain("add column if not exists original_image_url text");
    expect(sql).toContain("set original_image_url = image_url");
    expect(sql).toMatch(/set original_image_url=btrim\(p_original_image_url\),[\s\S]*image_url=btrim\(p_image_url\),[\s\S]*thumbnail_url=btrim\(p_thumbnail_url\)/);
  });

  it("attaches Crew photo bundles through the existing token-bound, request-idempotent authority", () => {
    expect(sql).toContain("crew_asset_initial_photo_context(p_token,p_asset_id)");
    expect(sql).toContain("operation='asset_initial_photo'");
    expect(sql).toContain("p_original_image_url text");
    expect(sql).toContain("p_thumbnail_url text");
  });

  it("keeps inspection evidence outside the master-photo migration", () => {
    expect(sql).not.toContain("asset_inspection_evidence");
    expect(sql).not.toContain("inspection_evidence/");
  });
});
