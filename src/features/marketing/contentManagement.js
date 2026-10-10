import {
  calendarRange,
  localInput,
  scheduleInstant,
} from "./marketingCalendar.js";
export const CONTENT_TIMEZONE = "Asia/Kuala_Lumpur";
export const contentStatusLabel = (status) =>
  status === "review"
    ? "Pending approval"
    : String(status || "").replace(/\b\w/g, (c) => c.toUpperCase());
export function preferredContentView(userId) {
  try {
    return localStorage.getItem(
        `admin.presentation.marketing.content.${userId}`,
      ) === "calendar"
      ? "calendar"
      : "list";
  } catch {
    return "list";
  }
}
export function saveContentView(userId, value) {
  try {
    localStorage.setItem(
      `admin.presentation.marketing.content.${userId}`,
      value,
    );
  } catch { /* Optional display preference. */ }
}
export function shiftContentPeriod(anchor, mode, direction) {
  const [year, month, day] = anchor.split("-").map(Number);
  const date = mode === "month"
    ? new Date(Date.UTC(year, month - 1 + direction, 1))
    : new Date(Date.UTC(year, month - 1, day + direction * 7));
  return date.toISOString().slice(0, 10);
}
export function contentBounds({ view, anchor, mode, from, to }) {
  const lower = from
    ? scheduleInstant(`${from}T00:00`, CONTENT_TIMEZONE)
    : null;
  const upper = to
    ? scheduleInstant(`${shiftDay(to, 1)}T00:00`, CONTENT_TIMEZONE)
    : null;
  if (lower && upper && lower >= upper) {
    throw new Error("End date must be on or after the start date.");
  }
  if (view === "list") return { from: lower, to: upper };
  const period = calendarRange(anchor, mode, CONTENT_TIMEZONE);
  const bounds = {
    from: lower && lower > period.from ? lower : period.from,
    to: upper && upper < period.to ? upper : period.to,
  };
  return { ...bounds, empty: bounds.from >= bounds.to };
}
export function shiftDay(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function contentMetric(channel, name) {
  const metrics = channel?.metrics || {};
  if (name === "engagement") {
    // Per-channel interactions only. Incomplete counts cannot be presented as a total.
    const keys = channel.channel === "facebook"
      ? ["likes", "comments", "shares"]
      : ["likes", "comments"];
    return keys.every((key) =>
        Number.isFinite(metrics[key]) && metrics[key] >= 0
      )
      ? keys.reduce((sum, key) => sum + metrics[key], 0)
      : null;
  }
  return Number.isFinite(metrics[name]) && metrics[name] >= 0
    ? metrics[name]
    : null;
}
export function contentDay(value) {
  return localInput(new Date(value), CONTENT_TIMEZONE).slice(0, 10);
}
