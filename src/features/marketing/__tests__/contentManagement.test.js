import { beforeEach, describe, expect, it } from "vitest";
import {
  contentBounds,
  contentMetric,
  preferredContentView,
  saveContentView,
  shiftContentPeriod,
} from "../contentManagement.js";
beforeEach(() => localStorage.clear());
describe("shared Content Management contracts", () => {
  it("defaults to List and persists a user-specific preference", () => {
    expect(preferredContentView("a")).toBe("list");
    saveContentView("a", "calendar");
    expect(preferredContentView("a")).toBe("calendar");
    expect(preferredContentView("b")).toBe("list");
  });
  it("uses inclusive KL date filters and exclusive UTC bounds consistently", () => {
    expect(
      contentBounds({ view: "list", from: "2026-05-21", to: "2026-05-22" }),
    ).toEqual({
      from: "2026-05-20T16:00:00.000Z",
      to: "2026-05-22T16:00:00.000Z",
    });
    expect(
      contentBounds({
        view: "calendar",
        anchor: "2026-05-22",
        mode: "month",
        from: "2026-05-21",
        to: "2026-05-22",
      }),
    ).toEqual({
      from: "2026-05-20T16:00:00.000Z",
      to: "2026-05-22T16:00:00.000Z",
      empty: false,
    });
    expect(
      contentBounds({
        view: "calendar",
        anchor: "2026-06-01",
        mode: "month",
        from: "2026-05-21",
        to: "2026-05-22",
      }).empty,
    ).toBe(true);
    expect(() =>
      contentBounds({ view: "list", from: "2026-05-22", to: "2026-05-21" })
    ).toThrow("End date");
  });
  it("advances month boundaries without date overflow, and weeks by seven days", () => {
    expect(shiftContentPeriod("2026-01-31", "month", 1)).toBe("2026-02-01");
    expect(shiftContentPeriod("2026-01-01", "month", -1)).toBe("2025-12-01");
    expect(shiftContentPeriod("2026-12-29", "week", 1)).toBe("2027-01-05");
  });
  it("distinguishes zero, missing and incomplete channel metrics without summing reach", () => {
    expect(
      contentMetric({
        channel: "instagram",
        metrics: { likes: 0, comments: 0, reach: 0 },
      }, "engagement"),
    ).toBe(0);
    expect(
      contentMetric(
        { channel: "facebook", metrics: { likes: 3, shares: 1 } },
        "engagement",
      ),
    ).toBeNull();
    expect(contentMetric({ metrics: {} }, "reach")).toBeNull();
    expect(contentMetric({ metrics: { reach: 0 } }, "reach")).toBe(0);
  });
});
