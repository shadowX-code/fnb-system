import { describe, expect, it } from "vitest";
import { buildMonthlyReportingDataset, buildYearlyFinancialDataset } from "../reportingDatasets.js";

function financialContract(overrides = {}) {
  return {
    outlet: { id: "outlet-a", name: "A" }, period: { year: 2026, month: 8 }, financial_completeness: "complete",
    financials: {
      revenue: { amount: 1000, presence: "present" }, purchase_based_cogs: { amount: 300, presence: "present" },
      opex: { amount: 200, presence: "present" }, net_profit: { amount: 500, presence: "present" },
    }, ...overrides,
  };
}

describe("Reporting datasets", () => {
  it("keeps the server financial contract authoritative and preserves Outlet P&L arithmetic", () => {
    const report = buildMonthlyReportingDataset({ financialContract: financialContract(), productContract: { product_data_status: "unavailable" } });
    expect(report.financials.netProfit.amount).toBe(1000 - 300 - 200);
    expect(report.financialCompleteness).toBe("complete");
    expect(report.productDataStatus).toBe("unavailable");
  });

  it.each(["revenue", "purchase_based_cogs", "opex"])("marks a missing %s as incomplete instead of RM0", (field) => {
    const source = financialContract();
    source.financial_completeness = "incomplete";
    source.financials[field] = { amount: null, presence: "missing" };
    source.financials.net_profit = { amount: null, presence: "missing" };
    const report = buildMonthlyReportingDataset({ financialContract: source, productContract: {} });
    expect(report.financialCompleteness).toBe("incomplete");
    expect(report.financials.netProfit).toEqual({ amount: null, presence: "missing" });
  });

  it("distinguishes an explicit RM0 source record from a missing source", () => {
    const source = financialContract();
    source.financials.opex = { amount: 0, presence: "present" };
    source.financials.net_profit = { amount: 700, presence: "present" };
    const report = buildMonthlyReportingDataset({ financialContract: source, productContract: {} });
    expect(report.financials.opex).toEqual({ amount: 0, presence: "present" });
    expect(report.financialCompleteness).toBe("complete");
  });

  it("returns a fixed twelve-row YTD dataset with null future and missing months", () => {
    const august = financialContract();
    const yearly = buildYearlyFinancialDataset({ outlet: august.outlet, year: 2026, monthlyContracts: [august], currentYear: 2026, currentMonth: 8 });
    expect(yearly.months).toHaveLength(12);
    expect(yearly.months[0].financials.revenue.amount).toBeNull();
    expect(yearly.months[8].financials.revenue.amount).toBeNull();
    expect(yearly.months[8].isFuture).toBe(true);
    expect(yearly.periodMode).toBe("ytd");
    expect(yearly.completeness).toBe("incomplete");
    expect(yearly.totals.revenue).toEqual({ amount: 1000, presence: "present", presentMonths: 1 });
  });

  it("uses yearly only for a complete past twelve months and totals only present values", () => {
    const contracts = Array.from({ length: 12 }, (_, index) => financialContract({ period: { year: 2025, month: index + 1 } }));
    const yearly = buildYearlyFinancialDataset({ outlet: contracts[0].outlet, year: 2025, monthlyContracts: contracts, currentYear: 2026, currentMonth: 8 });
    expect(yearly.periodMode).toBe("yearly");
    expect(yearly.completeness).toBe("complete");
    expect(yearly.totals.netProfit.amount).toBe(6000);
  });
});
