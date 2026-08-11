import { quantity } from "./factoryFormatters.js";

export const analyticsQuantityList = (rows) => {
  const values = Array.isArray(rows) ? rows : [];
  if (!values.length) return "—";
  return values.map((row) => quantity(row.quantity, row.uom)).join(" · ");
};

export const truncateDashboardChartLabel = (value, limit = 34) => String(value || "—").length > limit ? `${String(value).slice(0, limit - 1)}…` : String(value || "—");
export const dashboardTrendLabel = (month) => new Intl.DateTimeFormat("en-MY", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${month}T00:00:00Z`));
export const dashboardRequiredCheckLabel = (count) => `required ${count === 1 ? "check" : "checks"}`;
export const dashboardActionTone = (severity) => severity === "Critical" ? "danger" : severity === "Warning" ? "warning" : "info";
