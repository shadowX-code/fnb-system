import { describe, expect, it } from "vitest";
import { dashboardActionTone, dashboardRequiredCheckLabel, dashboardTrendLabel, truncateDashboardChartLabel } from "../factoryDashboardFormatters.js";
import { factoryMonthLabel, malaysiaBusinessMonthInput, shiftFactoryMonth } from "../factoryDates.js";

describe("Factory Dashboard presentation contracts", () => {
  it("uses Malaysia business month and safe month navigation", () => {
    expect(malaysiaBusinessMonthInput(new Date("2026-01-31T18:00:00Z"))).toBe("2026-02");
    expect(shiftFactoryMonth("2026-01", -1)).toBe("2025-12"); expect(shiftFactoryMonth("2026-12", 1)).toBe("2027-01"); expect(factoryMonthLabel("2026-08")).toBe("August 2026");
  });
  it("preserves chart, QC, trend, and action labels", () => {
    expect(dashboardTrendLabel("2026-08-01")).toBe("Aug 26"); expect(dashboardRequiredCheckLabel(1)).toBe("required check"); expect(dashboardRequiredCheckLabel(2)).toBe("required checks"); expect(dashboardActionTone("Critical")).toBe("danger"); expect(dashboardActionTone("Warning")).toBe("warning"); expect(truncateDashboardChartLabel("A very long product name", 10)).toBe("A very lo…");
  });
});
