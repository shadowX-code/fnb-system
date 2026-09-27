import { describe, expect, it } from "vitest";
import { buildYearlyFinancialDataset } from "../reportingDatasets.js";
import { projectOutletPnl } from "../outletPnlProjection.js";

const present = (amount) => ({ amount, presence: "present" });
function dataset(financials, completeness = "complete") {
  return buildYearlyFinancialDataset({ year: 2026, currentYear: 2026, currentMonth: 1,
    monthlyContracts: [{ period: { year: 2026, month: 1 }, financials, financial_completeness: completeness }] });
}
describe("Outlet P&L canonical projection", () => {
  it("uses the server EBITDA amount, rather than recalculating it", () => {
    const report = projectOutletPnl(dataset({ revenue: present(100), purchase_based_cogs: present(30), opex: present(10), net_profit: present(59.5) }));
    expect(report.total.netProfit).toBe(59.5);
    expect(report.monthly[0].netProfit).toBe(59.5);
    expect(report.monthly[1].future).toBe(true);
    expect(report.completeness).toBe("complete");
  });
  it("preserves legitimate explicit zero", () => {
    const report = projectOutletPnl(dataset({ revenue: present(0), purchase_based_cogs: present(0), opex: present(0), net_profit: present(0) }));
    expect(report.total.netProfit).toBe(0);
    expect(report.total.opex).toBe(0);
    expect(report.total.margin).toBeNull();
  });
  it("never totals missing evidence as zero or partial EBITDA", () => {
    const report = projectOutletPnl(dataset({ revenue: present(100), purchase_based_cogs: present(30) }, "incomplete"));
    expect(report.total.opex).toBeNull();
    expect(report.total.netProfit).toBeNull();
    expect(report.total.margin).toBeNull();
    expect(report.completeness).toBe("incomplete");
  });
});
