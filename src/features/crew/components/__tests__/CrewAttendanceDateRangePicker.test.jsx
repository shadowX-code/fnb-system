import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CrewAttendanceDateRangePicker, { rangeLabel } from "../CrewAttendanceDateRangePicker.jsx";

afterEach(cleanup);

const today = "2026-08-15";

describe("Crew Attendance Date Range Picker", () => {
  it.each([
    ["Today", "2026-08-15", "2026-08-15"],
    ["Yesterday", "2026-08-14", "2026-08-14"],
    ["This week", "2026-08-10", "2026-08-15"],
    ["Last week", "2026-08-03", "2026-08-09"],
    ["Last 7 days", "2026-08-09", "2026-08-15"],
    ["This month", "2026-08-01", "2026-08-15"],
    ["Last month", "2026-07-01", "2026-07-31"],
  ])("applies the %s preset only after Apply", (preset, from, to) => {
    const onApply = vi.fn();
    render(<CrewAttendanceDateRangePicker from={today} to={today} today={today} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Date Range" }));
    fireEvent.click(screen.getByRole("button", { name: preset }));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({ from, to });
  });

  it("supports custom single-day and multi-day ranges", () => {
    const onApply = vi.fn();
    const { rerender } = render(<CrewAttendanceDateRangePicker from={today} to={today} today={today} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Date Range" }));
    fireEvent.click(screen.getByRole("button", { name: "10 Aug 2026" }));
    fireEvent.click(screen.getByRole("button", { name: "14 Aug 2026" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenLastCalledWith({ from: "2026-08-10", to: "2026-08-14" });

    rerender(<CrewAttendanceDateRangePicker from="2026-08-10" to="2026-08-14" today={today} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Date Range" }));
    fireEvent.click(screen.getByRole("button", { name: "12 Aug 2026" }));
    fireEvent.click(screen.getByRole("button", { name: "12 Aug 2026" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenLastCalledWith({ from: "2026-08-12", to: "2026-08-12" });
  });

  it("discards draft changes on Cancel", () => {
    const onApply = vi.fn();
    render(<CrewAttendanceDateRangePicker from={today} to={today} today={today} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Date Range" }));
    fireEvent.click(screen.getByRole("button", { name: "Last month" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Date Range" }).textContent).toContain("Today");
  });

  it("formats current single-day and multi-day summaries", () => {
    expect(rangeLabel(today, today, today)).toBe("Today");
    expect(rangeLabel("2026-08-14", "2026-08-14", today)).toBe("14 Aug 2026");
    expect(rangeLabel("2026-07-16", "2026-08-15", today)).toBe("16 Jul – 15 Aug 2026");
  });
});
