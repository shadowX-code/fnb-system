import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve("supabase/migrations/202608300001_reporting_read_contract.sql"), "utf8").toLowerCase();

describe("Reporting read contract migration", () => {
  it("uses financial sales, purchase records and OpEx without Product Analytics as revenue", () => {
    expect(sql).toContain("reporting_monthly_outlet_financials");
    expect(sql).toContain("public.sales_records");
    expect(sql).toContain("public.purchase_records");
    expect(sql).toContain("public.operating_expenses");
    expect(sql).toContain("v_revenue - v_purchase_based_cogs - v_opex");
    expect(sql).toContain("'purchase_based_cogs'");
    const financialFunction = sql.slice(sql.indexOf("reporting_monthly_outlet_financials"), sql.indexOf("reporting_monthly_outlet_product_sales"));
    expect(financialFunction).not.toContain("product_sales_items");
  });

  it("preserves presence, restricts access, and exposes read-only authenticated RPCs", () => {
    expect(sql).toContain("'presence'");
    expect(sql).toContain("'financial_completeness'");
    expect(sql).toContain("current_user_has_permission('reports.view')");
    expect(sql).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("revoke all on function");
    expect(sql).toContain("grant execute on function");
  });

  it("uses completed Product Analytics items, category-safe aggregation, and required rankings", () => {
    expect(sql).toContain("v_report.status <> 'completed'");
    expect(sql).toContain("group by i.category_name, i.product_name, coalesce(i.variant_name, '')");
    expect(sql).toContain("order by sales_revenue desc");
    expect(sql).toContain("where sales_revenue > 0");
    expect(sql).toContain("order by sales_revenue asc");
    expect(sql).toContain("limit 10");
    expect(sql).toContain("'product_data_status', 'unavailable'");
  });
});
