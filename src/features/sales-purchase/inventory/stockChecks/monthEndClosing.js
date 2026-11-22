export const MONTH_END_CLOSING = "Month-End Closing";

export function isValidClosingQuantity(value) {
  const quantity = Number(value);
  return value != null && value !== "" && quantity >= 0 && quantity <= 99999999999.999
    && quantity === Number(quantity.toFixed(3));
}

export function formatClosingError(message, invalidMonth = "Select a valid Closing Month.") {
  if (message?.includes("A valid Accounting Month is required.")) return invalidMonth;
  if (message?.includes("Approval opens after the accounting month ends.")) return "Approval opens after the Closing Month ends.";
  return message;
}

const countDateFormat = new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("en-MY", { month: "short", year: "numeric", timeZone: "UTC" });

export function formatPhysicalCountDate(value) {
  return value ? countDateFormat.format(new Date(value + "T00:00:00Z")) : "";
}

export function formatClosingMonthLabel(value) {
  return /^\d{4}-(0[1-9]|1[0-2])-01$/.test(value)
    ? monthFormat.format(new Date(value + "T00:00:00Z"))
    : "";
}

export function generateAuditName(type, date, month) {
  const countDate = countDateFormat.format(new Date(`${date}T00:00:00Z`));
  if (type !== MONTH_END_CLOSING) return `${type} · ${countDate}`;
  return `${type} · ${monthFormat.format(new Date(`${month}-01T00:00:00Z`))} · ${countDate}`;
}

export function updateClosingAuditName(name, previousDate, previousMonth, date, month) {
  // Existing custom names remain intact when a closing draft is edited.
  return previousMonth && previousMonth !== month && name?.replaceAll("Sept ", "Sep ")
    === generateAuditName(MONTH_END_CLOSING, previousDate, previousMonth).replaceAll("Sept ", "Sep ")
    ? generateAuditName(MONTH_END_CLOSING, date, month) : name;
}

export function toClosingLocalTime(value) {
  if (!value) return "";
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "";
  return new Date(instant.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19);
}
