import { describe, expect, it } from "vitest";
import { formatLeaveDate, formatLeaveDateRange } from "../leaveFormatters.js";

describe("Leave date formatting", () => {
  it("uses DD/MM/YYYY for single dates and ranges", () => {
    expect(formatLeaveDate("2026-09-01")).toBe("01/09/2026");
    expect(formatLeaveDateRange("2026-09-01", "2026-09-02")).toBe("01/09/2026 – 02/09/2026");
    expect(formatLeaveDateRange("2026-11-10", "2026-11-10")).toBe("10/11/2026");
  });

  it("formats audit timestamps in the Malaysia business timezone", () => {
    expect(formatLeaveDate("2026-08-14T17:30:00Z")).toBe("15/08/2026");
  });
});

