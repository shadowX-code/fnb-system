import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../../i18n/index.js";
import { activeTaskResponsibilities, crewBusinessDate, formatTaskSchedule, historyTasks, taskMatchesStatus } from "../taskSchedule.js";

const t = (key, values = {}) => i18n.t(key, values);

afterEach(async () => { vi.useRealTimers(); await i18n.changeLanguage("en"); });

describe("Crew Task schedule formatter", () => {
  it("formats canonical recurring, one-time and shift schedules without backend enum copy", () => {
    expect(formatTaskSchedule({ schedule_type: "recurring", schedule_config: { frequency: "every_day" }, business_date: "2026-08-22", available_from: "2026-08-22T01:00:00Z" }, t)).toContain("Daily");
    expect(formatTaskSchedule({ schedule_type: "recurring", schedule_config: { frequency: "specific_weekdays", weekdays: [1, 3, 5] }, business_date: "2026-08-24" }, t)).toContain("Mon, Wed, Fri");
    expect(formatTaskSchedule({ schedule_type: "one_time", business_date: "2026-08-24", due_at: "2026-08-24T06:00:00Z" }, t)).toContain("One-time");
    expect(formatTaskSchedule({ schedule_type: "shift_based", schedule_config: { shift_phase: "end_of_shift" }, business_date: "2026-08-24" }, t)).toContain("End of shift");
  });

  it("uses localized schedule labels and keeps semantic status filtering separate", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(formatTaskSchedule({ schedule_type: "recurring", schedule_config: { frequency: "every_day" }, business_date: "2026-08-24" }, t)).toContain("每天");
    expect(taskMatchesStatus({ status: "pending" }, "not_started")).toBe(true);
    expect(taskMatchesStatus({ status: "completed" }, "not_started")).toBe(false);
  });

  it("does not expose an untimed task's all-day availability window as a fake appointment", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00+08:00"));
    const label = formatTaskSchedule({
      schedule_type: "recurring",
      schedule_config: { frequency: "every_day" },
      business_date: "2026-08-22",
      available_from: "2026-08-22T04:00:00Z",
      due_at: "2026-08-22T15:59:00Z",
    }, t);
    expect(label).toBe("Today · Daily");
  });

  it("keeps configured database time values in their local wall-clock time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00+08:00"));
    expect(formatTaskSchedule({
      schedule_type: "recurring",
      schedule_config: { frequency: "every_day" },
      business_date: "2026-08-22",
      start_time: "15:00:00",
      due_time: "16:00:00",
    }, t)).toBe("Today · Daily · 3:00 pm–4:00 pm");
  });

  it("shows a recurring responsibility once while retaining immutable instances for history", () => {
    const today = crewBusinessDate();
    const tomorrow = new Date(`${today}T00:00:00+08:00`);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrow);
    const tasks = [
      { id: "today", template_id: "opening", source: "instance", name: "Opening Checklist", schedule_type: "recurring", business_date: today, status: "in_progress" },
      { id: "tomorrow", template_id: "opening", source: "instance", name: "Opening Checklist", schedule_type: "recurring", business_date: tomorrowDate, status: "not_started" },
      { id: "one-time", source: "instance", name: "Team briefing", schedule_type: "one_time", business_date: tomorrowDate, status: "not_started" },
    ];
    const flattened = activeTaskResponsibilities(tasks, t).flatMap(([, values]) => values);
    expect(flattened.map((task) => task.id)).toEqual(["today", "one-time"]);
  });

  it("limits Crew history to the latest thirty calendar days and filters execution status", () => {
    const today = crewBusinessDate();
    const old = new Date(`${today}T00:00:00+08:00`); old.setDate(old.getDate() - 30);
    const recent = new Date(`${today}T00:00:00+08:00`); recent.setDate(recent.getDate() - 1);
    const format = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
    const tasks = [
      { id: "old", business_date: format(old), status: "completed" },
      { id: "recent", business_date: format(recent), status: "completed" },
      { id: "exception", business_date: today, status: "exception" },
    ];
    expect(historyTasks(tasks).map((task) => task.id)).toEqual(["exception", "recent"]);
    expect(historyTasks(tasks, "exception").map((task) => task.id)).toEqual(["exception"]);
  });
});
