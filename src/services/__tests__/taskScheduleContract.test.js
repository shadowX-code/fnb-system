import { describe, expect, it } from "vitest";
import { taskDraftFromTemplate, taskTimeError } from "../taskScheduleContract.js";

describe("Task time contract", () => {
  it.each([["09:00:00", null], [null, "17:00:00"], ["09:00:00", "17:00:00"]])("restores optional SQL times %s / %s", (start, due) => {
    expect(taskDraftFromTemplate({ available_from: start, available_until: due, priority: "critical" })).toMatchObject({ start_time: start || "", due_time: due || "", priority: "critical" });
  });
  it("does not replace an intentionally cleared builder value", () => {
    expect(taskDraftFromTemplate({ start_time: "", available_from: "09:00:00" }).start_time).toBe("");
  });
  it.each([{ start_time: "09:00" }, { due_time: "17:00" }, { start_time: "09:00", due_time: "17:00" }])("accepts optional valid times", (task) => expect(taskTimeError(task)).toBe(""));
  it.each(["08:00", "09:00"])("rejects due before or equal to start", (due) => expect(taskTimeError({ start_time: "09:00:00", due_time: due })).toBeTruthy());
});
