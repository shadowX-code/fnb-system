const monthFormatter = new Intl.DateTimeFormat("en-MY", { month: "short" });
const longMonthFormatter = new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric" });
const currencyFormatter = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const reportMonths = Array.from({ length: 12 }, (_, index) => ({ value: index + 1, label: monthFormatter.format(new Date(2026, index, 1)) }));

export function money(metric) {
  return metric?.presence === "present" && metric.amount !== null && metric.amount !== undefined
    ? currencyFormatter.format(Number(metric.amount))
    : "—";
}

export function signedMoney(metric) {
  return money(metric);
}

export function periodLabel(period) {
  if (!period?.year || !period?.month) return "Reporting period";
  return longMonthFormatter.format(new Date(Number(period.year), Number(period.month) - 1, 1));
}

export function compactMonth(month) {
  return reportMonths[Number(month) - 1]?.label ?? "—";
}

export function statusLabel(completeness, periodMode) {
  if (periodMode === "ytd") return "YTD / Incomplete";
  return completeness === "complete" ? "Complete" : "Incomplete";
}
