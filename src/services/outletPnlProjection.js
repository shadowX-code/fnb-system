// Presentation adapter only. Amounts come from the canonical Reporting contract.
export function projectOutletPnl(dataset) {
  const fields = { revenue: "revenue", cogs: "purchaseBasedCogs", opex: "opex", netProfit: "netProfit" };
  const monthly = dataset.months.map((month) => {
    const row = { month: month.month, label: new Date(2020, month.month - 1, 1).toLocaleString("en", { month: "short" }), future: month.isFuture, completeness: month.financialCompleteness };
    for (const [name, source] of Object.entries(fields)) {
      const metric = month.financials[source];
      row[name] = metric.presence === "present" ? metric.amount : null;
    }
    row.grossProfit = row.revenue !== null && row.cogs !== null ? row.revenue - row.cogs : null;
    row.margin = row.netProfit !== null && row.revenue > 0 ? row.netProfit / row.revenue * 100 : null;
    return row;
  });
  const eligible = monthly.filter((month) => !month.future);
  const total = {};
  for (const name of Object.keys(fields)) {
    total[name] = eligible.length && eligible.every((row) => row[name] !== null)
      ? eligible.reduce((sum, row) => sum + row[name], 0) : null;
  }
  total.grossProfit = total.revenue !== null && total.cogs !== null ? total.revenue - total.cogs : null;
  total.margin = total.netProfit !== null && total.revenue > 0 ? total.netProfit / total.revenue * 100 : null;
  return { monthly, total, completeness: eligible.length && eligible.every((month) => month.completeness === "complete") ? "complete" : "incomplete" };
}
