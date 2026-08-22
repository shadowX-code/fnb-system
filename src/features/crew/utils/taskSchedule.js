import { crewLocale, formatCrewDate, formatCrewTime, MALAYSIA_TIME_ZONE } from "./crewI18n.js";

const WEEKDAY_BY_ISO = [null, "mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function crewBusinessDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MALAYSIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(value);
}

function dateValue(value) {
  return value ? new Date(`${value}T00:00:00+08:00`) : null;
}

function localDateLabel(value, t) {
  if (!value) return null;
  if (value === crewBusinessDate()) return t("tasks.schedule.today");
  return formatCrewDate(dateValue(value), { weekday: "short", day: "numeric", month: "short" });
}

function localizedWeekdays(days, t) {
  const values = (days || []).map((day) => WEEKDAY_BY_ISO[Number(day)]).filter(Boolean);
  return values.length ? values.map((day) => t(`tasks.schedule.weekdays.${day}`)).join(", ") : t("tasks.schedule.selectedWeekdays");
}

function taskTime(task) {
  if (task.start_time) return task.start_time;
  if (task.schedule_type === "one_time" && task.available_from) return task.available_from;
  return null;
}

function formattedTime(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{1,2}:\d{2}/.test(value)) {
    const [hours, minutes] = value.split(":").map(Number);
    // PostgreSQL `time` values are already wall-clock values. Formatting them in
    // Malaysia again would shift the displayed time by eight hours.
    return new Intl.DateTimeFormat(crewLocale(), { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" })
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
  const due = formattedTime(task.due_time || (task.schedule_type === "one_time" ? (task.due_at || task.available_until) : null));
  const timing = start && due && start !== due ? `${start}–${due}` : start || due || null;

  if (task.schedule_type === "one_time") return [rule, date, timing].filter(Boolean).join(" · ");
  if (task.schedule_type === "shift_based") return [date, rule].filter(Boolean).join(" · ");
  return [date, rule, timing].filter(Boolean).join(" · ") || t("tasks.schedule.noFixedTime");
}

export function taskGroup(task, t) {
  const date = task.business_date || task.task_date || task.effective_date;
  const today = crewBusinessDate();
  if (date === today) return t("tasks.groups.today");
  if (date && date > today) return t("tasks.groups.upcoming");
  return t("tasks.groups.ongoing");
}

export function taskMatchesStatus(task, filter) {
  if (filter === "all") return true;
  const status = task.status === "pending" ? "not_started" : task.status;
  return status === filter;
}

function taskDate(task) {
  return task.business_date || task.task_date || task.effective_date || "";
}

function activePriority(task, today) {
  const status = task.status === "pending" ? "not_started" : task.status;
  const date = taskDate(task);
  if (status === "overdue") return 0;
  if (status === "in_progress") return 1;
  if (date === today && status === "not_started") return 2;
  if (date > today && status === "not_started") return 3;
  if (date === today) return 4;
  return 5;
}

/**
 * Condense the instance stream into the Crew-facing active responsibility list.
 * Recurring and shift-based definitions deliberately appear once while every
 * immutable instance remains available in the execution history read model.
 */
export function activeTaskResponsibilities(tasks = [], t) {
  const today = crewBusinessDate();
  const current = tasks.filter((task) => taskDate(task) >= today);
  const unique = new Map();
  for (const task of current) {
    const recurring = task.source === "instance" && ["recurring", "shift_based"].includes(task.schedule_type);
    const key = recurring ? `definition:${task.template_id || task.name}:${task.schedule_type}` : `${task.source || "task"}:${task.id}`;
    const existing = unique.get(key);
    if (!existing || activePriority(task, today) < activePriority(existing, today)) unique.set(key, task);
  }
  const groups = {
    [t("tasks.groups.needsAttention")]: [],
    [t("tasks.groups.recurringScheduled")]: [],
    [t("tasks.groups.upcoming")]: [],
  };
  for (const task of unique.values()) {
    const status = task.status === "pending" ? "not_started" : task.status;
    if (["overdue", "in_progress"].includes(status)) groups[t("tasks.groups.needsAttention")].push(task);
    else if (["recurring", "shift_based"].includes(task.schedule_type)) groups[t("tasks.groups.recurringScheduled")].push(task);
    else groups[t("tasks.groups.upcoming")].push(task);
  }
  return Object.entries(groups).filter(([, group]) => group.length);
}

export function historyTasks(tasks = [], filter = "all", now = new Date()) {
  const today = crewBusinessDate(now);
  const earliest = new Date(`${today}T00:00:00+08:00`);
  earliest.setDate(earliest.getDate() - 29);
  const from = new Intl.DateTimeFormat("en-CA", { timeZone: MALAYSIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(earliest);
  return tasks
    .filter((task) => {
      const date = taskDate(task);
      const status = task.status === "pending" ? "not_started" : task.status;
      if (!date || date < from || date > today) return false;
      if (filter === "all") return ["completed", "completed_with_exceptions", "review_required", "overdue", "exception"].includes(status);
      if (filter === "completed") return ["completed", "completed_with_exceptions", "review_required"].includes(status);
      return status === filter;
    })
    .sort((a, b) => String(taskDate(b)).localeCompare(String(taskDate(a))) || String(b.completed_at || "").localeCompare(String(a.completed_at || "")));
}
