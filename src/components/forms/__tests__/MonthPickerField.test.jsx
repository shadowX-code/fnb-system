import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MonthPickerField from "../MonthPickerField.jsx";

afterEach(cleanup);

describe("MonthPickerField", () => {
  it("can show an explicit all-months state without pretending a month is selected", () => {
    const onChange = vi.fn();
    render(<MonthPickerField label="Created month" value="" emptyLabel="All months" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Created month" }).textContent).toContain("All months");
    fireEvent.click(screen.getByRole("button", { name: "Created month" }));
    fireEvent.click(screen.getByRole("gridcell", { name: "Oct" }));
    expect(onChange).toHaveBeenCalledWith(`${new Date().getFullYear()}-10`);
  });
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
