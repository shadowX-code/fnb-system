import { describe, expect, it } from "vitest";
import { monthlyPerformanceModel } from "../productionMonthlyPerformance.js";

const snapshot = { month: "2026-09", today: "2026-09-18", unattributed_runs: 2, days: [
  { day: "2026-09-16", completed_runs: 2, output_kg: 100, jo_hours: 5, productivity_output_kg: 80, productivity_runs: 1, invalid_duration_runs: 1, moving_average_kg: 70, average_days: 7 },
  { day: "2026-09-17", completed_runs: 1, output_kg: 40, jo_hours: 1, productivity_output_kg: 40, productivity_runs: 1 },
] };
describe("Monthly completed Production presentation", () => {
  it("uses weighted summed JO-hours, not an average of daily productivity", () => {
    const result = monthlyPerformanceModel(snapshot);
    expect(result).toMatchObject({ totalOutput: 140, completedRuns: 3, productivity: 20, hours: 6, invalidDurationRuns: 1, unattributedRuns: 2 });
    expect(result.days[15]).toMatchObject({ output_kg: 100, productivity: 16, moving_average_kg: 70 });
  });
  it("distinguishes past zero, future and missing output without inventing duration", () => {
    const result = monthlyPerformanceModel({ ...snapshot, days: [{ day: "2026-09-16", completed_runs: 1, output_kg: null, missing_output_runs: 1, jo_hours: null }] });
    expect(result.days[0]).toMatchObject({ state: "recorded", output_kg: 0, productivity: null });
    expect(result.days[15]).toMatchObject({ state: "missing", output_kg: null, productivity: null });
    expect(result.days[18]).toMatchObject({ state: "future", output_kg: null, productivity: null });
    expect(result.productivity).toBeNull();
  });
  it.each([["2028-02", 29], ["2026-02", 28], ["2026-12", 31]])("renders every date in %s", (month, length) => {
    const result = monthlyPerformanceModel({ ...snapshot, month, days: [] });
    expect(result.days).toHaveLength(length);
    expect(result.days[0].day).toBe(`${month}-01`);
  });
});
