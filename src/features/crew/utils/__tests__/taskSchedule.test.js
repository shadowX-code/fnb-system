import { afterEach, describe, expect, it } from "vitest";
import i18n from "../../../../i18n/index.js";
import { formatTaskSchedule, taskMatchesStatus } from "../taskSchedule.js";

const t = (key, values = {}) => i18n.t(key, values);

afterEach(async () => { await i18n.changeLanguage("en"); });

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
    const label = formatTaskSchedule({
      schedule_type: "recurring",
      schedule_config: { frequency: "every_day" },
      business_date: "2026-08-22",
      available_from: "2026-08-22T04:00:00Z",
      due_at: "2026-08-22T15:59:00Z",
    }, t);
    expect(label).toBe("Today · Daily");
  });
});
