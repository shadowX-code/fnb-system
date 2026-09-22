import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260922121308_reporting_all_outlets_scope.sql"), "utf8");

describe("Reporting All Outlets scope contract", () => {
  it("derives the outlet set from reports.view and the existing server outlet-scope predicate", () => {
    expect(sql).toContain("current_user_has_permission('reports.view')");
    expect(sql).toContain("current_user_can_access_outlet(o.id)");
    expect(sql).toContain("You do not have access to any reportable outlets.");
  });

  it("preserves missing financial data instead of presenting a partial outlet aggregate as complete", () => {
    expect(sql).toContain("v_has_sales := v_sales_outlet_count = v_scope_count");
    expect(sql).toContain("v_has_purchases := v_purchase_outlet_count = v_scope_count");
    expect(sql).toContain("v_has_opex := v_opex_outlet_count = v_scope_count");
    expect(sql).toContain("case when v_complete then v_revenue - v_purchase_based_cogs - v_opex else null end");
  });

  it("aggregates product and category contribution across the authorized scope server-side", () => {
    expect(sql).toContain("group by i.category_name, i.product_name, coalesce(i.variant_name, '')");
    expect(sql).toContain("group by i.category_name");
    expect(sql).toContain("v_completed_outlet_count = v_scope_count");
    expect(sql).toContain("reporting_yearly_scope_financials");
  });

  it("keeps scope reads authenticated-only and never grants the internal scope resolver", () => {
    expect(sql).toContain("revoke all on function public.reporting_scope_outlets(uuid) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.reporting_monthly_scope_financials(uuid, integer, integer) to authenticated");
    expect(sql).toContain("grant execute on function public.reporting_monthly_scope_product_sales(uuid, integer, integer) to authenticated");
    expect(sql).toContain("grant execute on function public.reporting_yearly_scope_financials(uuid, integer) to authenticated");
  });
});
