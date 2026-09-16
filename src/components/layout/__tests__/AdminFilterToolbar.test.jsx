import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminFilterToolbar from "../AdminFilterToolbar.jsx";
import FactoryFilterBar from "../../../features/factory/components/FactoryFilterBar.jsx";
import FeedXDateRangePicker from "../../ui/FeedXDateRangePicker.jsx";

function Field({ label }) { return <label>{label}<input aria-label={label} /></label>; }
afterEach(cleanup);

describe("AdminFilterToolbar", () => {
  it("keeps outlet, period, search, filters and actions in one responsive toolbar", () => {
    render(<AdminFilterToolbar outlet={<Field label="Outlet" />} period={<Field label="Period" />} search={<Field label="Search" />} filters={<Field label="Status" />} secondaryActions={<button type="button">Export</button>} primaryActions={<button type="button">Create</button>} />);
    expect(screen.getByRole("region", { name: "Filters" })).toBeTruthy();
    expect(document.querySelector(".admin-filter-toolbar-row")).toBeTruthy();
    expect(screen.getByLabelText("Outlet").closest("div").className).toContain("sm:w-[230px]");
    expect(screen.getByLabelText("Period").closest("div").className).toContain("sm:w-[180px]");
  });
  it("renders removable active filters and reset", () => {
    const remove = vi.fn(); const clear = vi.fn();
    render(<AdminFilterToolbar activeFilters={[{ key: "status", label: "Status", value: "Draft", onRemove: remove }]} onClear={clear}><Field label="Status" /></AdminFilterToolbar>);
    fireEvent.click(screen.getByRole("button", { name: "Remove Status filter" })); fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(remove).toHaveBeenCalledTimes(1); expect(clear).toHaveBeenCalledTimes(1);
  });
  it("uses the date-range width role when a range picker occupies the period slot", () => {
    render(<AdminFilterToolbar period={<Field label="Date Range" />} />);
    const range = screen.getByLabelText("Date Range").closest('[data-admin-filter-slot]');
    expect(range.dataset.adminFilterRole).toBe("date-range"); expect(range.className).toContain("sm:w-[220px]");
  });
  it("uses a shared component-declared date range role", () => {
    render(<AdminFilterToolbar period={<FeedXDateRangePicker from="2026-09-16" to="2026-09-16" today="2026-09-16" onApply={vi.fn()} />} />);
    expect(screen.getByLabelText("Date Range").closest('[data-admin-filter-slot]').className).toContain("sm:w-[220px]");
  });
  it("keeps Factory's compatibility wrapper in the shared field flow", () => {
    const { container } = render(<FactoryFilterBar><><Field label="Supplier" /><Field label="Status" /></></FactoryFilterBar>);
    expect(container.querySelectorAll('[data-admin-filter-slot="filter"]')).toHaveLength(2);
  });
});
