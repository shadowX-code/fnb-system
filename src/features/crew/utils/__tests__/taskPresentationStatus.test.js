import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../../i18n/index.js";
import { taskPresentationStatus, taskMatchesStatus, historyTasks, activeTaskResponsibilities } from "../taskSchedule.js";
const base = { id: "run", source: "instance", business_date: "2026-10-02", schedule_type: "recurring", status: "not_started", completed_count: 0, block_count: 12, available_from: "2026-10-02T20:30:00+08:00", due_at: "2026-10-02T22:30:00+08:00" };
const now = (time) => new Date(`2026-10-02T${time}+08:00`);
afterEach(async () => { vi.useRealTimers(); await i18n.changeLanguage("en"); });
describe("Crew Task operational presentation", () => {
  for (const [time, count, expected] of [
    ["20:29:59.999", 0, "upcoming"], ["20:30:00", 0, "start_now"],
    ["21:00:00", 0, "start_now"], ["21:00:00", 3, "in_progress"],
    ["22:30:00", 0, "start_now"], ["22:30:00", 3, "in_progress"],
    ["22:30:00.001", 0, "overdue"], ["22:30:00.001", 3, "overdue"],
  ]) it(`${time}, ${count}/12 → ${expected}`, () => {
    const task = { ...base, completed_count: count };
    expect(taskPresentationStatus(task, now(time))).toBe(expected);
    expect(taskMatchesStatus(task, expected, now(time))).toBe(true);
    expect(taskMatchesStatus(task, expected === "overdue" ? "in_progress" : "overdue", now(time))).toBe(false);
    expect(task.status).toBe("not_started");
    expect(task.completed_count).toBe(count);
  });
  for (const status of ["completed", "completed_with_exceptions", "review_required", "exception", "needs_attention", "cancelled"])
    it(`preserves ${status} before start and after due`, () => {
      for (const time of ["20:00:00", "23:00:00"]) expect(taskPresentationStatus({ ...base, status }, now(time))).toBe(status);
    });
  it("uses Detail's available_until and retains incomplete progress without inventing completion", () => {
    expect(taskPresentationStatus({ ...base, due_at: null, available_until: base.due_at, completed_count: 12 }, now("23:00:00"))).toBe("overdue");
    expect(taskPresentationStatus({ ...base, completed_count: 12 }, now("21:00:00"))).toBe("in_progress");
    expect(taskPresentationStatus({ status: "in_progress" }, now("21:00:00"))).toBe("in_progress");
    expect(taskPresentationStatus({ status: "in_progress", completed_count: 0 }, now("21:00:00"))).toBe("start_now");
  });
  it("keeps an overnight window in absolute Malaysia time", () => {
    const task = { ...base, available_from: "2026-10-02T23:00:00+08:00", due_at: "2026-10-03T01:00:00+08:00" };
    expect(taskPresentationStatus(task, new Date("2026-10-03T00:30:00+08:00"))).toBe("start_now");
    expect(taskPresentationStatus(task, new Date("2026-10-03T01:00:00.001+08:00"))).toBe("overdue");
  });
  it("shares overdue status in Active grouping and History filters while preserving evidence counts", () => {
    vi.useFakeTimers(); vi.setSystemTime(now("23:00:00"));
    const task = { ...base, status: "in_progress", completed_count: 3 };
    const t = key => i18n.t(key);
    expect(activeTaskResponsibilities([task], t)[0][0]).toBe(t("tasks.groups.needsAttention"));
    expect(historyTasks([task], "overdue")).toEqual([task]);
    expect(historyTasks([task], "in_progress")).toEqual([]);
    expect(historyTasks([{ ...task, completed_count: 0 }], "overdue")).toHaveLength(1);
  });
  it("does not turn untouched future executions into history; preserves review/completed filters", () => {
    expect(historyTasks([base], "all", now("20:00:00"))).toEqual([]);
    expect(taskMatchesStatus({ ...base, status: "completed_with_exceptions" }, "completed", now("23:00:00"))).toBe(true);
    expect(taskMatchesStatus({ ...base, status: "exception" }, "completed", now("23:00:00"))).toBe(false);
  });
  for (const [language, upcoming, start] of [["en", "Upcoming", "Start Now"], ["zh-CN", "即将开始", "现在开始"], ["ms", "Akan Datang", "Mula Sekarang"]])
    it(`localizes new presentation states in ${language}`, async () => {
      await i18n.changeLanguage(language);
      expect(i18n.t("status.upcoming")).toBe(upcoming);
      expect(i18n.t("status.start_now")).toBe(start);
    });
});
