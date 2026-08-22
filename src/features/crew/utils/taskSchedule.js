import { crewLocale, formatCrewDate, formatCrewTime, MALAYSIA_TIME_ZONE } from "./crewI18n.js";

const WEEKDAY_BY_ISO = [null, "mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function localBusinessDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MALAYSIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(value);
}

function dateValue(value) {
  return value ? new Date(`${value}T00:00:00+08:00`) : null;
}

function localDateLabel(value, t) {
  if (!value) return null;
  if (value === localBusinessDate()) return t("tasks.schedule.today");
  return formatCrewDate(dateValue(value), { weekday: "short", day: "numeric", month: "short" });
}

function localizedWeekdays(days, t) {
  const values = (days || []).map((day) => WEEKDAY_BY_ISO[Number(day)]).filter(Boolean);
  return values.length ? values.map((day) => t(`tasks.schedule.weekdays.${day}`)).join(", ") : t("tasks.schedule.selectedWeekdays");
}

function taskTime(task) {
  if (isDefaultAllDayWindow(task)) return null;
  if (task.start_time) return task.start_time;
  if (task.available_from) return task.available_from;
  return null;
}

function timeParts(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MALAYSIA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

// Instance generation represents an untimed recurring task as 00:00–23:59.
// That is an availability window, not a Crew-facing appointment, so never surface it as a fake time.
function isDefaultAllDayWindow(task) {
  if (task.start_time || task.due_time || !task.available_from || !(task.due_at || task.available_until)) return false;
  const start = timeParts(task.available_from);
  const end = timeParts(task.due_at || task.available_until);
  return start?.hour === 0 && start?.minute === 0 && end?.hour === 23 && end?.minute === 59;
}

function formattedTime(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{1,2}:\d{2}/.test(value)) {
    const [hours, minutes] = value.split(":").map(Number);
    return new Intl.DateTimeFormat(crewLocale(), { hour: "numeric", minute: "2-digit", hour12: true, timeZone: MALAYSIA_TIME_ZONE })
      .format(new Date(Date.UTC(2026, 0, 1, hours, minutes)));
  }
  return formatCrewTime(value, { hour12: true });
}

function scheduleRule(task, t) {
  const config = task.schedule_config || task.template_snapshot?.schedule_config || {};
  if (task.schedule_type === "shift_based") {
    return t(`tasks.schedule.${config.shift_phase || "during_shift"}`);
  }
  if (task.schedule_type === "one_time") return t("tasks.schedule.oneTime");

  switch (config.frequency || "every_day") {
    case "specific_weekdays": return localizedWeekdays(config.weekdays, t);
    case "weekly": return `${t("tasks.schedule.weekly")} · ${localizedWeekdays([config.weekday || 1], t)}`;
    case "monthly": return t("tasks.schedule.monthlyDay", { day: config.day || 1 });
    case "custom_interval": return t("tasks.schedule.everyDays", { count: config.interval_days || 1 });
    default: return t("tasks.schedule.daily");
  }
}

/**
 * The canonical Crew-facing schedule line. It only uses a frozen Task instance
 * (or a Task definition preview), never infers eligibility from attendance.
 */
export function formatTaskSchedule(task, t) {
  const rule = scheduleRule(task, t);
  const date = localDateLabel(task.business_date || task.task_date || task.effective_date, t);
  const start = formattedTime(taskTime(task));
  const due = isDefaultAllDayWindow(task) ? null : formattedTime(task.due_at || task.available_until || task.due_time);
  const timing = start && due && start !== due ? `${start}–${due}` : start || due || null;

  if (task.schedule_type === "one_time") return [rule, date, timing].filter(Boolean).join(" · ");
  if (task.schedule_type === "shift_based") return [date, rule].filter(Boolean).join(" · ");
  return [date, rule, timing].filter(Boolean).join(" · ") || t("tasks.schedule.noFixedTime");
}

export function taskGroup(task, t) {
  const date = task.business_date || task.task_date || task.effective_date;
  const today = localBusinessDate();
  if (date === today) return t("tasks.groups.today");
  if (date && date > today) return t("tasks.groups.upcoming");
  return t("tasks.groups.ongoing");
}

export function taskMatchesStatus(task, filter) {
  if (filter === "all") return true;
  const status = task.status === "pending" ? "not_started" : task.status;
  return status === filter;
}
