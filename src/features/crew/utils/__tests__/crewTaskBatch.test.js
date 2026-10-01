import { afterEach, describe, expect, it } from "vitest";
import i18n from "../../../../i18n/index.js";
import { formatHomeDate, formatHomeClock, formatRosterTime } from "../crewMobile.js";
import { formatCrewTime } from "../crewI18n.js";
import { completedTasksLast } from "../taskSchedule.js";

afterEach(() => i18n.changeLanguage("en"));
describe("Crew operational presentation", () => {
  it("moves only final tasks behind the unchanged operational order", () => {
    const rows = [{id:1,status:"completed",priority:"critical"},{id:2,status:"overdue"},{id:3,status:"in_progress"},{id:4,status:"completed_with_exceptions"},{id:5,status:"review_required"},{id:6,status:"not_started"}];
    expect(completedTasksLast(rows).map(x => x.id)).toEqual([2,3,5,6,1,4]);
    expect(rows.map(x => x.id)).toEqual([1,2,3,4,5,6]);
  });
  it("separates Chinese date/weekday and uses shared am/pm shift times", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(formatHomeDate("2026-10-01T00:00:00+08:00")).toBe("10月1日 · 周四");
    expect(formatRosterTime("08:00:00")).toBe("8:00 am");
    expect(formatRosterTime("17:00:00")).toBe("5:00 pm");
    expect(formatCrewTime("2026-10-01T17:00:00+08:00")).toBe("5:00 pm");
    expect(formatHomeClock("2026-10-01T17:00:00+08:00")).toEqual({time:"5:00",period:"PM"});
    expect(i18n.t("tasks.openTask", {title:"Closing Duties"})).toBe("打开任务：Closing Duties");
    expect(i18n.t("tasks.completionNote")).toBe("完成备注");
  });
});
