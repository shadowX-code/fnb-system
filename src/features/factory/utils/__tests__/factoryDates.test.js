import { describe, expect, it } from "vitest";
import { formatFactoryListDate, formatFactoryListDateTime } from "../factoryDates.js";

describe("Factory list date formatting", () => {
  it("formats date-only values for compact Factory lists", () => {
    expect(formatFactoryListDate("2026-09-05")).toBe("05/09/2026");
  });

  it("separates the Factory list date and local time hierarchy", () => {
    expect(formatFactoryListDateTime("2026-09-05T10:42:00+08:00")).toEqual({ date: "05/09/2026", time: "10:42 AM" });
  });
});
