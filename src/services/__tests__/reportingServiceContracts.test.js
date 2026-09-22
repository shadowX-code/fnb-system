import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ supabase: { rpc } }));
import { reportingService } from "../reportingService.js";

beforeEach(() => rpc.mockReset());

describe("Reporting service contracts", () => {
  it("uses only the approved monthly Reporting RPCs for the monthly dataset", async () => {
    rpc
      .mockResolvedValueOnce({ data: { outlet: { id: "outlet-a" }, period: { year: 2026, month: 8 }, financials: {}, financial_completeness: "incomplete" }, error: null })
      .mockResolvedValueOnce({ data: { product_data_status: "unavailable", top_products: [], lowest_products: [] }, error: null });
    await reportingService.getMonthlyOutletReport({ outletId: "outlet-a", year: 2026, month: 8 });
    expect(rpc).toHaveBeenCalledWith("reporting_monthly_outlet_financials", { p_outlet_id: "outlet-a", p_year: 2026, p_month: 8 });
    expect(rpc).toHaveBeenCalledWith("reporting_monthly_outlet_product_sales", { p_outlet_id: "outlet-a", p_year: 2026, p_month: 8 });
  });

  it("uses the server-owned All Outlets scope contract without browser aggregation", async () => {
    rpc
      .mockResolvedValueOnce({ data: { outlet: { id: null, name: "All Outlets", scope: "all" }, period: { year: 2026, month: 8 }, financials: {}, financial_completeness: "incomplete" }, error: null })
      .mockResolvedValueOnce({ data: { product_data_status: "incomplete", top_products: [], lowest_products: [] }, error: null });
    await reportingService.getMonthlyAllOutletsReport({ year: 2026, month: 8 });
    expect(rpc).toHaveBeenCalledWith("reporting_monthly_scope_financials", { p_outlet_id: null, p_year: 2026, p_month: 8 });
    expect(rpc).toHaveBeenCalledWith("reporting_monthly_scope_product_sales", { p_outlet_id: null, p_year: 2026, p_month: 8 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("uses one server-owned yearly scope read for All Outlets", async () => {
    rpc.mockResolvedValueOnce({ data: { outlet: { id: null, name: "All Outlets", scope: "all" }, year: 2026, months: [] }, error: null });
    await reportingService.getYearlyAllOutletsFinancialReport({ year: 2026, now: new Date("2026-09-22T00:00:00Z") });
    expect(rpc).toHaveBeenCalledWith("reporting_yearly_scope_financials", { p_outlet_id: null, p_year: 2026 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
