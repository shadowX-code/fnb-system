import { describe, expect, it } from "vitest";
import { formatOperationalDateTime } from "../dateTime.js";

describe("formatOperationalDateTime", () => {
  it("uses the FeedX operational Malaysia datetime format", () => {
    expect(formatOperationalDateTime("2026-09-21T02:05:00Z")).toBe("21/09/2026 10:05 am");
  });

  it("uses a safe placeholder for absent or invalid timestamps", () => {
    expect(formatOperationalDateTime(null)).toBe("—");
    expect(formatOperationalDateTime("not-a-date")).toBe("—");
  });
});
