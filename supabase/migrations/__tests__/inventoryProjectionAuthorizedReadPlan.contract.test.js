import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260928134153_inventory_projection_authorized_read_plan.sql"), "utf8");

describe("Inventory projection authorized child read", () => {
  it("keeps the public projections as invokers and direct table RLS untouched", () => {
    expect(sql.match(/security invoker/g)).toHaveLength(2);
    expect(sql).not.toMatch(/alter table|create policy|drop policy|disable row level security/i);
    expect(sql).toContain("inventory_projection.authorized_stock_check_rows(");
  });

  it("gates the private definer on caller, parent permission, every check and outlet", () => {
    expect(sql).toContain("create schema if not exists inventory_projection");
    expect(sql).toContain("security definer\nset search_path = ''");
    expect(sql).toContain("auth.uid() is null");
    expect(sql).toContain("v_authorized_count <> v_requested_count");
    expect(sql).toContain("public.current_user_can_access_outlet(check_header.outlet_id)");
    expect(sql).toContain("revoke all on function inventory_projection.authorized_stock_check_rows(uuid[])");
    expect(sql).toContain("grant execute on function inventory_projection.authorized_stock_check_rows(uuid[])\n  to authenticated");
    expect(sql).not.toMatch(/grant .* to anon/i);
  });

  it("reads only the child fields used by Dashboard and historical summaries", () => {
    expect(sql).toContain("where row.stock_check_id = any(p_check_ids)");
    expect(sql).toContain("array(select check_header.id from scoped_headers check_header)");
    expect(sql).toContain("left join scoped_rows row on row.stock_check_id = check_header.id");
    expect(sql).toContain("and check_header.status in ('submitted', 'reviewed', 'locked')");
  });
});
