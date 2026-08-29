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
});
