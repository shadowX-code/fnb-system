import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924191411_crew_purchase_order_mobile_consolidation.sql"), "utf8");

describe("Crew PO mobile source and presentation contract", () => {
  it("limits both token-bound source reads and both Crew creation paths to recent completed scheduled checks", () => {
    expect(sql).toContain("c.stock_check_type='scheduled' and c.status='submitted'");
    expect(sql).toContain("c.submitted_at >= now()-interval '7 days'");
    expect(sql).toContain("inventory_authority.crew_recent_source_check(c.id,v_outlet)");
    expect(sql.match(/inventory_authority\.crew_recent_source_check\(/g)).toHaveLength(5);
    expect(sql).toContain("inventory_authority.crew_scope(p_token,p_outlet_id,'can_manage_purchase_orders')");
    expect(sql).toContain("inventory_authority.save_purchase_order(p_request_id,p_order,p_items,v_outlet");
    expect(sql).toContain("inventory_authority.create_stock_check_purchase_orders(p_request_id,p_check_id,p_orders");
  });

  it("preserves request retry authority while denying a new old-source command", () => {
    expect(sql).toContain("r.request_id=p_request_id and r.operation='purchase_order' and r.outlet_id=v_outlet");
    expect(sql).toContain("r.request_id=p_request_id and r.operation='stock_check_purchase_orders' and r.outlet_id=v_outlet");
    expect(sql).toContain("revoke all on function inventory_authority.crew_recent_source_check(uuid,uuid)");
  });

  it("projects canonical item imagery and lifecycle context without new mutation authority", () => {
    expect(sql).toContain("'photo_url',i.photo_url");
    expect(sql).toContain("'sku_code',i.sku_code");
    expect(sql).toContain("'category_names'");
    expect(sql).toContain("'submitted_at',p.submitted_at,'confirmed_at',p.confirmed_at,'completed_at',p.completed_at");
    expect(sql).not.toContain("insert into public.inventory_purchase_receipts");
  });
});
