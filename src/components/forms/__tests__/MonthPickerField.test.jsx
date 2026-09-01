import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MonthPickerField from "../MonthPickerField.jsx";

afterEach(cleanup);

describe("MonthPickerField", () => {
  it("selects a canonical YYYY-MM value from the year-aware month grid", () => {
    const onChange = vi.fn();
    render(<MonthPickerField label="Period" value="2026-08" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Period" }));
    expect(screen.getByRole("grid", { name: "Months in 2026" })).not.toBeNull();
    fireEvent.click(screen.getByRole("gridcell", { name: "Sept" }));
    expect(onChange).toHaveBeenCalledWith("2026-09");
  });

  it("supports year navigation and unavailable campaign months", () => {
    render(<MonthPickerField label="Reward Month" value="2026-08" onChange={vi.fn()} unavailable={["2026-09"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Reward Month" }));
    expect(screen.getByRole("gridcell", { name: "Sept" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next year" }));
    expect(screen.getByRole("grid", { name: "Months in 2027" })).not.toBeNull();
  });
});
