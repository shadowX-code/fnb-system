const fields = { revenue: "revenue", cogs: "purchaseBasedCogs", opex: "opex", netProfit: "netProfit" };
const metricNames = [...Object.keys(fields), "grossProfit"];
const sum = (rows, name) => rows.length ? rows.reduce((total, row) => total + row[name], 0) : null;

export function comparableOutletPnlTotals(current, previous) {
  const totals = {};
  for (const name of [...metricNames, "margin"]) {
    const months = current.coverage[name] ?? [];
    const rows = previous.monthly.filter((row) => !row.future && months.includes(row.month));
    const requiredMetric = name === "margin" ? "netProfit" : name;
    const matches = rows.length === months.length && rows.every((row) => row[requiredMetric] !== null);
    totals[name] = matches ? sum(rows, requiredMetric) : null;
    if (name === "margin" && matches) totals.margin = ebitdaMix(rows).margin;
  }
  return totals;
}

function ebitdaMix(rows) {
  const mix = Object.fromEntries(Object.keys(fields).map((name) => [name, sum(rows, name)]));
  mix.margin = mix.revenue > 0 ? mix.netProfit / mix.revenue * 100 : null;
  return mix;
}

// Presentation adapter only. Amounts come from the canonical Reporting contract.
export function projectOutletPnl(dataset) {
  const monthly = dataset.months.map((month) => {
    const row = { month: month.month, label: new Date(2020, month.month - 1, 1).toLocaleString("en", { month: "short" }), future: month.isFuture, completeness: month.financialCompleteness };
    for (const [name, source] of Object.entries(fields)) {
      const metric = month.financials[source];
      row[name] = metric.presence === "present" && Number.isFinite(metric.amount) ? metric.amount : null;
    }
    row.closingStock = month.closingStock ?? null;
    row.closingStockEvidence = month.closingStockEvidence ?? null;
    row.grossProfit = row.revenue !== null && row.cogs !== null ? row.revenue - row.cogs : null;
    if (row.grossProfit === null || row.opex === null) row.netProfit = null;
    row.margin = row.netProfit !== null && row.revenue > 0 ? row.netProfit / row.revenue * 100 : null;
    return row;
  });
  const eligible = monthly.filter((month) => !month.future);
  const total = {};
  const coverage = {};
  for (const name of metricNames) {
    const rows = eligible.filter((row) => row[name] !== null);
    total[name] = sum(rows, name);
    coverage[name] = rows.map((row) => row.month);
  }
  const mix = ebitdaMix(eligible.filter((row) => row.netProfit !== null));
  total.margin = mix.margin;
  coverage.margin = coverage.netProfit;
  const grossProfitRows = eligible.filter((row) => row.grossProfit !== null);
  const cogsRevenue = sum(grossProfitRows, "revenue");
  return {
    monthly, total, coverage, mix, elapsedMonths: eligible.length,
    cogsRatio: cogsRevenue > 0 ? sum(grossProfitRows, "cogs") / cogsRevenue * 100 : null,
    completeness: eligible.length && coverage.netProfit.length === eligible.length ? "complete" : "incomplete",
  };
}
