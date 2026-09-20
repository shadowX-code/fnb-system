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
