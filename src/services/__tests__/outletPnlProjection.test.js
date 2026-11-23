import { describe, expect, it } from "vitest";
import { buildYearlyFinancialDataset } from "../reportingDatasets.js";
import { comparableOutletPnlTotals, projectOutletPnl } from "../outletPnlProjection.js";

const present = (amount) => ({ amount, presence: "present" });
function dataset(financials, completeness = "complete", closing = {}) {
  return buildYearlyFinancialDataset({ year: 2026, currentYear: 2026, currentMonth: 1,
    monthlyContracts: [{ period: { year: 2026, month: 1 }, financials, financial_completeness: completeness, ...closing }] });
}

function yearProjection(year, elapsed, evidence) {
  return projectOutletPnl(buildYearlyFinancialDataset({
    year, currentYear: year, currentMonth: elapsed,
    monthlyContracts: evidence.flatMap((financials, index) => financials ? [{ period: { year, month: index + 1 }, financials }] : []),
  }));
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
  it("preserves published partial coverage and genuine zero without changing financial totals", () => {
    const financials = { revenue: present(100), purchase_based_cogs: present(30), opex: present(10), net_profit: present(60) };
    for (const amount of [47829.93, 0, null]) {
      const report = projectOutletPnl(dataset(financials, "complete", { closing_stock: null, closing_stock_evidence: {
        amount, valuation_status: "partial", valued_item_count: amount === null ? 0 : 193,
        total_item_count: 242, actual_count_date: "2026-02-02",
      } }));
      expect(report.monthly[0].closingStock).toBe(amount);
      expect(report.monthly[0].closingStockEvidence).toEqual({
        valuationStatus: "partial", valuedItemCount: amount === null ? 0 : 193,
        totalItemCount: 242, actualCountDate: "2026-02-02",
      });
      expect(report.total).toEqual(projectOutletPnl(dataset(financials)).total);
    }
    expect(projectOutletPnl(dataset(financials)).monthly[0].closingStockEvidence).toBeNull();
  });
  it("never totals missing evidence as zero or partial EBITDA", () => {
    const report = projectOutletPnl(dataset({ revenue: present(100), purchase_based_cogs: present(30) }, "incomplete"));
    expect(report.total.opex).toBeNull();
    expect(report.total.netProfit).toBeNull();
    expect(report.total.margin).toBeNull();
    expect(report.completeness).toBe("incomplete");
  });
  it("aggregates each metric over its own recorded months and leaves gaps", () => {
    const complete = { revenue: present(100), purchase_based_cogs: present(25), opex: present(15), net_profit: present(60) };
    const report = yearProjection(2026, 6, [
      complete, null, { revenue: present(90), purchase_based_cogs: present(20) },
      { revenue: present(70) }, { purchase_based_cogs: present(200), opex: present(2), net_profit: present(0) },
      { revenue: present(0), purchase_based_cogs: present(0), opex: present(0), net_profit: present(0) },
      complete,
    ]);
    expect(report.completeness).toBe("incomplete");
    expect(report.elapsedMonths).toBe(6);
    expect(report.total).toMatchObject({ revenue: 260, grossProfit: 145, netProfit: 60, margin: 60 });
    expect(report.mix).toEqual({ revenue: 100, cogs: 25, opex: 15, netProfit: 60, margin: 60 });
    expect(report.coverage).toMatchObject({ revenue: [1, 3, 4, 6], grossProfit: [1, 3, 6], netProfit: [1, 6], margin: [1, 6] });
    expect(report.cogsRatio).toBeCloseTo(45 / 190 * 100);
    expect(report.monthly.slice(0, 7).map((month) => month.netProfit)).toEqual([60, null, null, null, null, 0, null]);
  });
  it("compares only identical metric months in the prior year", () => {
    const complete = { revenue: present(100), purchase_based_cogs: present(30), opex: present(10), net_profit: present(60) };
    const current = yearProjection(2026, 3, [complete, null, { revenue: present(0) }]);
    const prior = yearProjection(2025, 12, [complete, complete, { revenue: present(30) }, complete]);
    expect(comparableOutletPnlTotals(current, prior)).toMatchObject({ revenue: 130, grossProfit: 70, netProfit: 60, margin: 60 });
    expect(comparableOutletPnlTotals(current, yearProjection(2025, 12, [complete, complete])).revenue).toBeNull();
  });
});
