import { strictDateTimeValue, strictDateValue } from "../../../services/factoryService.js";

export function todayInput() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function malaysiaBusinessDateInput(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function malaysiaBusinessMonthInput(value = new Date()) {
  return malaysiaBusinessDateInput(value).slice(0, 7);
}

export function shiftFactoryMonth(value, delta) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  if (!match) return malaysiaBusinessMonthInput();
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function factoryMonthLabel(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  if (!match) return "Selected month";
  return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

export function formatDateDisplay(value, placeholder = "Select date") {
  if (!value) return placeholder;
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return placeholder;
  return `${year}-${month}-${day}`;
}

export function formatFactoryDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  if (year && month && day) return `${year}-${month}-${day}`;
  return String(value).slice(0, 10) || "—";
}

export function formatFactoryListDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  if (year && month && day) return `${day}/${month}/${year}`;
  return String(value).slice(0, 10) || "—";
}

export function formatFactoryListDateTime(value) {
  if (!value) return { date: "—", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: formatFactoryListDate(value), time: "" };
  const formatter = new Intl.DateTimeFormat("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour: "numeric", minute: "2-digit", hour12: true });
  return { date: formatFactoryListDate(value), time: formatter.format(date).toUpperCase() };
}

export function formatFactoryReadableDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatFactoryDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace("T", " ");
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatFactoryAuditDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function monthStart(value) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function timeInput() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function addDaysToFactoryDate(value, days) {
  const timestamp = strictDateValue(value);
  const dayCount = Number(days);
  if (timestamp === null || !Number.isInteger(dayCount) || dayCount < 0) return "";
  return new Date(timestamp + (dayCount * 86400000)).toISOString().slice(0, 10);
}

export function productionDurationLabel(startDate, startTime, endDate, endTime) {
  const start = strictDateTimeValue(startDate, startTime);
  const end = strictDateTimeValue(endDate, endTime);
  if (start === null || end === null || end < start) return "—";
  const totalMinutes = Math.floor((end - start) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} min${minutes === 1 ? "" : "s"}`;
  return `${hours} hr${hours === 1 ? "" : "s"}${minutes ? ` ${minutes} min${minutes === 1 ? "" : "s"}` : ""}`;
}
