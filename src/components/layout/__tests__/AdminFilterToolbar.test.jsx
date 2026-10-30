import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminFilterToolbar, { AdminOutletField } from "../AdminFilterToolbar.jsx";
import FactoryFilterBar from "../../../features/factory/components/FactoryFilterBar.jsx";
import FeedXDateRangePicker from "../../ui/FeedXDateRangePicker.jsx";
import SelectField from "../../forms/SelectField.jsx";
import AdminSearchField from "../../forms/AdminSearchField.jsx";
import { FieldLabel } from "../../forms/Selectors.jsx";
import { CREW_ADMIN_OUTLET_STORAGE_KEY, CrewAdminOutletProvider, useCrewAdminOutlet } from "../../../features/crew/context/CrewAdminOutletContext.jsx";

function Field({ label }) {
  return <label>{label}<input aria-label={label} /></label>;
}

const outlets = [{ id: "outlet-1", name: "Friends Corner", is_active: true }, { id: "outlet-2", name: "Hola Hola", is_active: true }];

function OutletHarness() {
  const { outletId, setOutletId } = useCrewAdminOutlet();
  return <><AdminFilterToolbar outlet={<AdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />} /><output>{outletId}</output></>;
}

afterEach(cleanup);

describe("AdminFilterToolbar", () => {
  it("supports inline header placement without duplicating the surface or changing field controls", () => {
    const view=render(<AdminFilterToolbar presentation="inline" outlet={<Field label="Company"/>}/>);
    const toolbar=screen.getByRole('region',{name:'Filters'});
    expect(toolbar.dataset.adminFilterPresentation).toBe('inline');
    expect(toolbar.className).not.toContain('border-border');
    expect(screen.getByLabelText('Company').closest('[data-admin-filter-slot]').className).toContain('sm:w-[230px]');
    view.rerender(<AdminFilterToolbar outlet={<Field label="Company"/>}/>);
    expect(toolbar.className).toContain('border-border');
  });
  it("keeps compact and standard toolbars full width while selects stay bounded", () => {
    const view = render(<AdminFilterToolbar compact><AdminSearchField label="Search" value="" onChange={vi.fn()} /><Field label="Status" /></AdminFilterToolbar>);
    expect(screen.getByRole("region", { name: "Filters" }).className).toContain("w-full min-w-0");
    expect(screen.getByLabelText("Status").closest('[data-admin-filter-slot]').className).toContain("sm:w-[180px]");
    view.rerender(<AdminFilterToolbar><Field label="Status" /></AdminFilterToolbar>);
    expect(screen.getByRole("region", { name: "Filters" }).className).toContain("w-full min-w-0");
  });
  it("gives a shared child Search the same responsive space as the Search slot", () => {
    render(<AdminFilterToolbar><AdminSearchField label="Search" value="" onChange={vi.fn()} /></AdminFilterToolbar>);
    expect(screen.getByRole("searchbox", { name: "Search" }).closest('[data-admin-filter-role="search"]').className).toContain("sm:flex-[1_1_280px]");
  });
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

  it("preserves canonical period width beside flexible search in dense mode", () => {
    render(<AdminFilterToolbar denseFields period={<Field label="Created month" />} search={<AdminSearchField value="" onChange={vi.fn()} />} />);
    expect(screen.getByLabelText("Created month").closest('[data-admin-filter-slot]').className).toContain("sm:w-[180px]");
    expect(screen.getByLabelText("Search").closest('[data-admin-filter-slot]').className).toContain("sm:flex-[1_1_240px]");
  });

  it("accepts an existing outlet scope without owning its context", () => {
    localStorage.clear();
    const view = render(<CrewAdminOutletProvider outlets={outlets}><OutletHarness /></CrewAdminOutletProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Outlet" }));
    fireEvent.click(screen.getByRole("option", { name: "Hola Hola" }));
    expect(localStorage.getItem(CREW_ADMIN_OUTLET_STORAGE_KEY)).toBe("outlet-2");
    view.rerender(<CrewAdminOutletProvider outlets={[outlets[0]]}><OutletHarness /></CrewAdminOutletProvider>);
    expect(screen.getByText("outlet-1")).not.toBeNull();
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

  it("uses the date-range width role when a range picker occupies the period slot", () => {
    render(<AdminFilterToolbar period={<Field label="Date Range" />} />);
    const range = screen.getByLabelText("Date Range").closest('[data-admin-filter-slot]');
    expect(range.dataset.adminFilterRole).toBe("date-range");
    expect(range.className).toContain("sm:w-[220px]");
    expect(range.className).toContain("shrink-0");
  });

  it("can place a shared date range after its primary filters without changing the default order", () => {
    const { container } = render(<AdminFilterToolbar outlet={<Field label="Outlet" />} search={<Field label="Search" />} filters={<><Field label="Supplier" /><Field label="Status" /></>} period={<Field label="Date Range" />} periodAfterFilters />);
    expect(Array.from(container.querySelectorAll("[data-admin-filter-fields] [data-admin-filter-slot]")).map((field) => field.textContent)).toEqual(["Outlet", "Search", "Supplier", "Status", "Date Range"]);
  });

  it("can place shared search after filters for result-table filtering", () => {
    const { container } = render(<AdminFilterToolbar filters={<><Field label="Category" /><Field label="Status" /></>} search={<Field label="Search Item" />} searchAfterFilters />);
    expect(Array.from(container.querySelectorAll("[data-admin-filter-fields] [data-admin-filter-slot]")).map((field) => field.textContent)).toEqual(["Category", "Status", "Search Item"]);
  });

  it("uses a shared component-declared role when the period has no label prop", () => {
    render(<AdminFilterToolbar period={<FeedXDateRangePicker from="2026-09-16" to="2026-09-16" today="2026-09-16" onApply={vi.fn()} />} />);
    const range = screen.getByLabelText("Date Range").closest('[data-admin-filter-slot]');
    expect(range.dataset.adminFilterRole).toBe("date-range");
    expect(range.className).toContain("sm:w-[220px]");
  });

  it("reserves a stable slot for date-range navigation controls", () => {
    render(<AdminFilterToolbar period={<FieldLabel label="Date Range" adminFilterRole="date-range-navigation"><div>Week navigation</div></FieldLabel>} />);
    const range = screen.getByText("Date Range").closest('[data-admin-filter-slot]');
    expect(range.dataset.adminFilterRole).toBe("date-range-navigation");
    expect(range.className).toContain("sm:w-[320px]");
    expect(range.className).toContain("shrink-0");
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
    expect(range.className).toContain("sm:w-[220px]");
    expect(filter.dataset.adminFilterRole).toBe("filter");
    expect(filter.className).toContain("sm:w-[180px]");
  });

  it("keeps the canonical search icon separate from placeholder text", () => {
    const { container } = render(<AdminFilterToolbar search={<AdminSearchField label="Search Crew" value="" onChange={vi.fn()} placeholder="Name or employee code" />} />);
    const field = screen.getByLabelText("Search Crew");
    expect(field.className).toContain("admin-search-field-input");
    expect(field.closest(".admin-search-field-control")?.querySelector("svg")).not.toBeNull();
    expect(container.querySelector('[data-admin-filter-role="search"]')).not.toBeNull();
  });
});

it("keeps a partial date bound visible after removing an active range filter",()=>{
 render(<AdminFilterToolbar period={<FeedXDateRangePicker from="" to="2026-05-31" today="2026-10-12" onApply={vi.fn()}/>} />);
 expect(screen.getByRole('button',{name:'Date Range'}).textContent).toContain('Until 31 May 2026');
 cleanup();render(<AdminFilterToolbar period={<FeedXDateRangePicker from="2026-05-01" to="" today="2026-10-12" onApply={vi.fn()}/>} />);
 expect(screen.getByRole('button',{name:'Date Range'}).textContent).toContain('From 1 May 2026');
});

it("applies auto-search to primary and disclosed shared dropdowns without changing option values", () => {
  const options = [{value:'',label:'All'},...Array.from({length:8},(_,i)=>({value:`value-${i}`,label:`Status ${i}`}))], change=vi.fn();
  render(<AdminFilterToolbar filters={<SelectField label="Status" value="" options={options} onChange={change}/>} moreFilters={<SelectField label="Tag" value="" options={options} onChange={change}/>}/>);
  fireEvent.click(screen.getByRole('button',{name:'Status',exact:true}));
  expect(screen.getByRole('option',{name:'All'}).getAttribute('aria-selected')).toBe('true');
  fireEvent.change(screen.getByRole('textbox',{name:'Search Status'}),{target:{value:'Status 7'}});
  fireEvent.click(screen.getByRole('option',{name:'Status 7'}));
  expect(change).toHaveBeenCalledWith('value-7');
  fireEvent.click(screen.getByRole('button',{name:'More filters'}));
  fireEvent.click(screen.getByRole('button',{name:'Tag',exact:true}));
  expect(screen.getByRole('textbox',{name:'Search Tag'})).toBeTruthy();
});
it('supports compact icon-only disclosure without losing its accessible filter label',()=>{
 render(<AdminFilterToolbar moreFiltersIconOnly moreFilters={<Field label="Assignee"/>}/>);
 const toggle=screen.getByRole('button',{name:'More filters'});
 expect(toggle.textContent).not.toContain('Filters');
 fireEvent.click(toggle);expect(screen.getByLabelText('Assignee')).toBeTruthy();
});
it('supports a visually hidden shared search label while preserving its accessible name',()=>{
 render(<AdminSearchField hideLabel label="Search" ariaLabel="Search conversations" value="" onChange={vi.fn()}/>);
 expect(screen.getByRole('searchbox',{name:'Search conversations'})).toBeTruthy();
 expect(screen.getByText('Search').className).toBe('sr-only');
});
