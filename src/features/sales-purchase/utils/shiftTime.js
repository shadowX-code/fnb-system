export const SHIFT_TIME_INPUT_ERROR = "Use format HH:MMam or HH:MMpm";

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

function autoColonTime(value) {
  const match = String(value || "").trim().toLowerCase().replace(/\s+/g, "").match(/^(\d{3,4})(am|pm)$/);
  if (!match) return "";
  const digits = match[1];
  const hour = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
  const minute = digits.slice(-2);
  return `${hour.padStart(2, "0")}:${minute}${match[2]}`;
}

export function normalizeShiftTimeInput(rawValue) {
  const text = String(rawValue || "").trim().toLowerCase();
  const compact = text.replace(/\s+/g, "");
  const candidate = autoColonTime(text) || compact;
  const match = candidate.match(/^(\d{2}):([0-5]\d)(am|pm)$/);
  if (!match) return { valid: false, value: "", display: "", error: SHIFT_TIME_INPUT_ERROR };

  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3];
  if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12 || !Number.isInteger(minute) || minute > 59) {
    return { valid: false, value: "", display: "", error: SHIFT_TIME_INPUT_ERROR };
  }

  let hour = hour12 % 12;
  if (period === "pm") hour += 12;
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return {
    valid: true,
    value,
    display: formatShiftTimeInput(value),
    error: "",
  };
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
