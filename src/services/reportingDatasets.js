import { monthlyFinancialDataset, emptyFinancials, numberOrNull } from '../../supabase/functions/_shared/finance/monthlyReporting.js';
export { monthlyFinancialDataset };

export function buildMonthlyReportingDataset({ financialContract, productContract }) {
  const financial = monthlyFinancialDataset(financialContract);
  return {
    reportType: "monthly",
    outlet: financial.outlet,
    period: financial.period,
    financials: financial.financials,
    financialCompleteness: financial.financialCompleteness,
    topProducts: productContract?.top_products ?? [],
    lowestProducts: productContract?.lowest_products ?? [],
    categoryContributions: productContract?.category_contributions ?? [],
    productDataStatus: productContract?.product_data_status ?? "unavailable",
    totalProductSalesRevenue: numberOrNull(productContract?.total_product_sales_revenue),
  };
}

function totalsFor(months, field) {
  const present = months.map((month) => month.financials[field]).filter((value) => value.presence === "present");
  return {
    amount: present.length ? present.reduce((sum, value) => sum + value.amount, 0) : null,
    presence: present.length ? "present" : "missing",
    presentMonths: present.length,
  };
}

export function buildYearlyFinancialDataset({ outlet, year, monthlyContracts = [], currentYear, currentMonth }) {
  const byMonth = new Map(monthlyContracts.map((contract) => [Number(contract?.period?.month), contract]));
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const future = year > currentYear || (year === currentYear && month > currentMonth);
    if (future) {
      return { month, ...monthlyFinancialDataset(null, { year, month, outlet }), isFuture: true };
    }
    const dataset = monthlyFinancialDataset(byMonth.get(month), { year, month, outlet });
    return { month, ...dataset, isFuture: false };
  });
  const allComplete = months.every((month) => !month.isFuture && month.financialCompleteness === "complete");
  const periodMode = year < currentYear && allComplete ? "yearly" : "ytd";
  return {
    reportType: "yearly",
    outlet: outlet ?? monthlyContracts.find(Boolean)?.outlet ?? null,
    year,
    periodMode,
    months,
    totals: {
      revenue: totalsFor(months, "revenue"),
      purchaseBasedCogs: totalsFor(months, "purchaseBasedCogs"),
      opex: totalsFor(months, "opex"),
      netProfit: totalsFor(months, "netProfit"),
    },
    completeness: allComplete ? "complete" : "incomplete",
  };
}

export { emptyFinancials };
