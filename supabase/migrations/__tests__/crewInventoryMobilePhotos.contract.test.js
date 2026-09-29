import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924043131_crew_inventory_mobile_item_photos.sql"), "utf8");

describe("Crew Inventory read-only presentation fields", () => {
  it("projects canonical Master Inventory photos only through the existing token-bound outlet read", () => {
    expect(sql).toContain("inventory_authority.crew_scope(p_token,p_outlet_id,'attention')");
    expect(sql).toContain("'photo_url',i.photo_url");
    expect(sql).toContain("io.outlet_id=v_outlet and io.is_active and i.status='active'");
  });

  it("adds draft metadata without changing Stock Check lifecycle ownership", () => {
    expect(sql).toContain("inventory_authority.crew_scope(p_token,p_outlet_id,'stock_read')");
    expect(sql).toContain("'updated_at',c.updated_at");
    expect(sql).toContain("'cover_item_id',(select ci.item_id from public.inventory_stock_check_items ci");
    expect(sql).toContain("where ci.stock_check_id=c.id order by ci.id limit 1");
    expect(sql).not.toMatch(/\b(?:insert|update|delete)\s+(?:into|from|public\.)/i);
  });
});
