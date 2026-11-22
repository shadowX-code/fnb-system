const MISSING = Object.freeze({ amount: null, presence: "missing" });

export function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function metric(value = MISSING) {
  return { amount: numberOrNull(value.amount), presence: value.presence === "present" ? "present" : "missing" };
}

export function emptyFinancials() {
  return {
    revenue: { ...MISSING },
    purchaseBasedCogs: { ...MISSING },
    opex: { ...MISSING },
    netProfit: { ...MISSING },
  };
}

export function monthlyFinancialDataset(contract, { year, month, outlet } = {}) {
  const source = contract?.financials ?? {};
  const closing = contract?.closing_stock_evidence;
  return {
    outlet: contract?.outlet ?? outlet ?? null,
    period: contract?.period ?? { year, month },
    financials: {
      revenue: metric(source.revenue),
      purchaseBasedCogs: metric(source.purchase_based_cogs),
      opex: metric(source.opex),
      netProfit: metric(source.net_profit),
    },
    closingStock: numberOrNull(closing?.amount ?? contract?.closing_stock),
    closingStockEvidence: closing ? {
      valuationStatus: closing.valuation_status,
      valuedItemCount: numberOrNull(closing.valued_item_count),
      totalItemCount: numberOrNull(closing.total_item_count),
      actualCountDate: closing.actual_count_date ?? null,
    } : null,
    financialCompleteness: contract?.financial_completeness === "complete" ? "complete" : "incomplete",
  };
}
