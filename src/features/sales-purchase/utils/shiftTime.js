export const SHIFT_TIME_INPUT_ERROR = "Enter time like 2pm, 2:30pm, 14:00, or select from the list.";

function parseDbTime(value) {
  if (!value) return null;
  const [hourText, minuteText = "0"] = String(value).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function formatShiftTime(value) {
  const parsed = parseDbTime(value);
  if (!parsed) return "";
  const period = parsed.hour >= 12 ? "pm" : "am";
  const hour12 = parsed.hour % 12 || 12;
  return `${hour12}${parsed.minute ? `:${String(parsed.minute).padStart(2, "0")}` : ""}${period}`;
}

export function formatShiftTimeRange(startTime, endTime) {
  const start = formatShiftTime(startTime);
  const end = formatShiftTime(endTime);
  if (!start || !end) return "";
  return `${start} - ${end}`;
}

export function formatShiftTimeInput(value) {
  const parsed = parseDbTime(value);
  if (!parsed) return "";
  const period = parsed.hour >= 12 ? "pm" : "am";
  const hour12 = parsed.hour % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}${period}`;
}

function timeValue(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseNumericTimeParts(text) {
  const colonMatch = text.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    return { hour: Number(colonMatch[1]), minute: Number(colonMatch[2]), hasColon: true };
  }
  if (!/^\d{1,4}$/.test(text)) return null;
  if (text.length <= 2) return { hour: Number(text), minute: 0, hasColon: false };
  const hourText = text.length === 3 ? text.slice(0, 1) : text.slice(0, 2);
  return { hour: Number(hourText), minute: Number(text.slice(-2)), hasColon: false };
}

export function parseShiftTimeInput(rawValue) {
  const text = String(rawValue || "").trim().toLowerCase();
  const compact = text.replace(/\s+/g, "");
  if (!compact) return { valid: false, value: "", display: "", error: SHIFT_TIME_INPUT_ERROR };

  const periodMatch = compact.match(/^(.*?)(am|pm)$/);
  if (periodMatch) {
    const parts = parseNumericTimeParts(periodMatch[1]);
    if (!parts || !Number.isInteger(parts.hour) || !Number.isInteger(parts.minute) || parts.hour < 1 || parts.hour > 12 || parts.minute < 0 || parts.minute > 59) {
      return { valid: false, value: "", display: "", error: SHIFT_TIME_INPUT_ERROR };
    }
    let hour = parts.hour % 12;
    if (periodMatch[2] === "pm") hour += 12;
    const value = timeValue(hour, parts.minute);
    return { valid: true, value, display: formatShiftTimeInput(value), error: "" };
  }

  const parts = parseNumericTimeParts(compact);
  if (!parts || !Number.isInteger(parts.hour) || !Number.isInteger(parts.minute) || parts.hour < 0 || parts.hour > 23 || parts.minute < 0 || parts.minute > 59) {
    return { valid: false, value: "", display: "", error: SHIFT_TIME_INPUT_ERROR };
  }
  const value = timeValue(parts.hour, parts.minute);
  return { valid: true, value, display: formatShiftTimeInput(value), error: "" };
}

export function normalizeShiftTimeInput(rawValue) {
  return parseShiftTimeInput(rawValue);
}

export function buildShiftTimeOptions(startHour = 8, count = 32) {
  return Array.from({ length: count }, (_, index) => {
    const totalMinutes = startHour * 60 + index * 30;
    const hour = Math.floor(totalMinutes / 60) % 24;
    const minute = totalMinutes % 60;
    const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return { value, label: formatShiftTimeInput(value), displayLabel: formatShiftTime(value) };
  });
}
