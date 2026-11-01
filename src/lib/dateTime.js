export function formatDateTime(value) {
  if (!value || value === "Not saved") return "—";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(/\b(am|pm)\b/gi, (match) => match.toUpperCase());
}

const OPERATIONAL_TIME_ZONE = "Asia/Kuala_Lumpur";

/** Sortable date-only key for operational filters; never use the browser's local date. */
export function operationalDateKey(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: OPERATIONAL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type).value).join("-");
}

function operationalDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: OPERATIONAL_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

function operationalTime(value) {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: OPERATIONAL_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(value).toLowerCase();
}

export function formatOperationalDateTime(value) {
  if (!value || value === "Not saved") return "—";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return `${operationalDate(date)} ${operationalTime(date)}`;
}

/** Compact operational timestamp for lifecycle/workspace history. */
export function formatOperationalMoment(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = new Intl.DateTimeFormat("en-GB", {timeZone: OPERATIONAL_TIME_ZONE,day:"numeric",month:"short",year:"numeric"}).format(date);
  return `${day} · ${operationalTime(date).toUpperCase()}`;
}
