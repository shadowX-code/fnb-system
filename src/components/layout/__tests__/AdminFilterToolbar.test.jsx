import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminFilterToolbar from "../AdminFilterToolbar.jsx";

function Field({ label }) {
  return <label>{label}<input aria-label={label} /></label>;
}

describe("AdminFilterToolbar", () => {
  it("keeps outlet, period, search, filters and actions in one responsive toolbar", () => {
    render(<AdminFilterToolbar outlet={<Field label="Outlet" />} period={<Field label="Period" />} search={<Field label="Search" />} filters={<Field label="Status" />} secondaryActions={<button type="button">Export</button>} primaryActions={<button type="button">Create</button>} />);
    expect(screen.getByRole("region", { name: "Filters" })).toBeTruthy();
    expect(screen.getByLabelText("Outlet").closest("div").className).toContain("sm:w-[230px]");
    expect(screen.getByLabelText("Period").closest("div").className).toContain("sm:w-[180px]");
    expect(screen.getByText("Export")).toBeTruthy();
    expect(screen.getByText("Create")).toBeTruthy();
  });

  it("renders removable active filters and reset", () => {
    const remove = vi.fn(); const clear = vi.fn();
    render(<AdminFilterToolbar activeFilters={[{ key: "status", label: "Status", value: "Draft", onRemove: remove }]} onClear={clear}><Field label="Status" /></AdminFilterToolbar>);
    fireEvent.click(screen.getByRole("button", { name: "Remove Status filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("lets a canonical date-range control request the width it needs", () => {
    render(<AdminFilterToolbar periodWidth="w-full sm:w-[360px]" period={<Field label="Date range" />} />);
    expect(screen.getByLabelText("Date range").closest("div").className).toContain("sm:w-[360px]");
  });
});
