import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminFilterToolbar from "../AdminFilterToolbar.jsx";
import FactoryFilterBar from "../../../features/factory/components/FactoryFilterBar.jsx";

function Field({ label }) {
  return <label>{label}<input aria-label={label} /></label>;
}

afterEach(cleanup);

describe("AdminFilterToolbar", () => {
  it("keeps outlet, period, search, filters and actions in one responsive toolbar", () => {
    render(<AdminFilterToolbar outlet={<Field label="Outlet" />} period={<Field label="Period" />} search={<Field label="Search" />} filters={<Field label="Status" />} secondaryActions={<button type="button">Export</button>} primaryActions={<button type="button">Create</button>} />);
    expect(screen.getByRole("region", { name: "Filters" })).toBeTruthy();
    expect(document.querySelector(".admin-filter-toolbar-row")).toBeTruthy();
    expect(document.querySelector("[data-admin-filter-fields]").className).not.toContain("gap-");
    expect(screen.getByLabelText("Outlet").closest("div").className).toContain("sm:w-[230px]");
    expect(screen.getByLabelText("Period").closest("div").className).toContain("sm:w-[180px]");
    expect(screen.getByLabelText("Outlet").closest("[data-admin-filter-slot]").dataset.adminFilterRole).toBe("outlet");
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

  it("flattens fragment filters into the main control flow", () => {
    const { container } = render(<AdminFilterToolbar outlet={<Field label="Outlet" />} filters={<><Field label="Employee" /><Field label="Position" /><Field label="Status" /></>} />);
    const slots = container.querySelectorAll('[data-admin-filter-slot="filter"]');
    expect(slots).toHaveLength(3);
    expect(screen.getByLabelText("Employee").closest('[data-admin-filter-slot]')).not.toBe(screen.getByLabelText("Position").closest('[data-admin-filter-slot]'));
  });

  it("keeps actions in the same surfaced toolbar group", () => {
    render(<AdminFilterToolbar outlet={<Field label="Outlet" />} primaryActions={<button type="button">Create</button>} />);
    expect(screen.getByRole("button", { name: "Create" }).closest('[data-admin-filter-actions]')).not.toBeNull();
    expect(screen.getByRole("region", { name: "Filters" }).className).toContain("bg-surface/80");
  });

  it("keeps Factory's compatibility wrapper in the same flattened flow", () => {
    const { container } = render(<FactoryFilterBar><><Field label="Supplier" /><Field label="Status" /></></FactoryFilterBar>);
    expect(container.querySelectorAll('[data-admin-filter-slot="filter"]')).toHaveLength(2);
  });

  it("uses shared field roles instead of consumer-specific widths", () => {
    const { container } = render(<AdminFilterToolbar filters={<><Field label="Date Range" /><Field label="Status" /></>} />);
    const [range, filter] = container.querySelectorAll('[data-admin-filter-slot="filter"]');
    expect(range.dataset.adminFilterRole).toBe("date-range");
    expect(range.className).toContain("sm:w-[260px]");
    expect(filter.dataset.adminFilterRole).toBe("filter");
    expect(filter.className).toContain("sm:w-[180px]");
  });
});
