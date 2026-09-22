export function formatLeaveDate(value) {
  if (!value) return "—";
  const text = String(value);
  const date = new Date(text.includes("T") ? text : `${text.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(text.includes("T") ? { timeZone: "Asia/Kuala_Lumpur" } : {}),
  }).format(date);
}

export function formatLeaveDateRange(start, end) {
  const first = formatLeaveDate(start);
  const last = formatLeaveDate(end);
  return start && end && String(start).slice(0, 10) !== String(end).slice(0, 10)
    ? `${first} – ${last}`
    : first;
}
