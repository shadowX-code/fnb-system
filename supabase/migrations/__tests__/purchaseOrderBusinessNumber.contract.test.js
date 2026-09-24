import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924092947_purchase_order_business_number.sql"), "utf8").toLowerCase();
const guard = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924093140_purchase_order_business_number_overflow_guard.sql"), "utf8").toLowerCase();

describe("purchase order business identity contract", () => {
  it("freezes legacy display numbers and assigns future numbers in the database", () => {
    expect(sql).toContain("row_number() over (partition by (p.created_at at time zone 'utc')::date");
    expect(sql).toContain("lpad(n.daily_number::text, greatest(3, length(n.daily_number::text)), '0')");
    expect(sql).toContain("create unique index inventory_purchase_orders_business_po_no_key");
    expect(sql).toContain("before insert on public.inventory_purchase_orders");
    expect(sql).toContain("new.business_po_no := v_prefix || '-' || v_date_code || '-' || lpad(v_number::text, greatest(2, length(v_number::text)), '0')");
    expect(guard).toContain("lpad(v_number::text, greatest(2, length(v_number::text)), '0')");
    expect(sql).toContain("on conflict (prefix, business_date) do update");
    expect(sql).toContain("purchase order business number is immutable");
  });

  it("exposes the same persisted number for Crew list and detail without changing scope", () => {
    expect(sql.match(/'business_po_no',p.business_po_no/g)).toHaveLength(2);
    expect(sql).toContain("inventory_authority.crew_scope(p_token,p_outlet_id,'order_read')");
    expect(sql).toContain("where id=p_order_id and outlet_id=v_outlet");
    expect(sql).toContain("p.outlet_id=v_outlet");
  });
});
