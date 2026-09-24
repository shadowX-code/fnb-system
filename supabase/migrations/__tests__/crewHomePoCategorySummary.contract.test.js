import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924185540_crew_home_po_category_summary.sql"), "utf8").toLowerCase();

describe("Crew Home PO category projection", () => {
  it("derives display categories from canonical PO items without changing token scope", () => {
    expect(sql).toContain("inventory_authority.crew_scope(p_token,p_outlet_id,'order_read')");
    expect(sql).toContain("where p.outlet_id=v_outlet");
    expect(sql).toContain("where l.purchase_order_id=p.id");
    expect(sql).toContain("join public.inventory_items i on i.id=l.item_id");
    expect(sql).toContain("join public.inventory_categories c on c.id=i.category_id");
    expect(sql).toContain("'category_names'");
    expect(sql).not.toMatch(/\b(insert|update|delete)\s+(into|public\.)/);
  });
});
