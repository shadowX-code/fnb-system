import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryStockCheckResultModal from "../InventoryStockCheckResultModal.jsx";

afterEach(cleanup);

const itemById = new Map([
  ["one", { id: "one", name: "Flour", sku: "F-1", categoryId: "dry", unit: "kg" }],
  ["two", { id: "two", name: "Oil", sku: "O-2", categoryId: "wet", unit: "L" }],
]);
const categoryById = new Map([["dry", { name: "Dry Goods" }], ["wet", { name: "Wet Goods" }]]);

function mount(costs = [5, 2.5]) {
  return render(<InventoryStockCheckResultModal
    stockCheck={{ date: "2026-09-24", submittedAt: "2026-09-24T09:00:00Z", auditType: "Spot Check", rows: [
      { id: "row-1", itemId: "one", expectedQty: 10, actualCount: 7, variance: 3, unit: "kg", unitCostSnapshot: costs[0] },
      { id: "row-2", itemId: "two", expectedQty: 4, actualCount: 6, variance: -2, unit: "L", unitCostSnapshot: costs[1] },
    ] }}
    isAuditResult outletName="QA Outlet" createdByName="QA Creator" submittedByName="QA Crew" itemById={itemById} categoryById={categoryById}
    formatDate={(value) => value} formatDateTimeCompact={(value) => value}
    formatCurrency={(value) => `RM${value.toFixed(2)}`} ItemThumbnail={() => <span aria-hidden="true">image</span>}
    onPhotoPreview={vi.fn()} onClose={vi.fn()}
  />);
}

describe("InventoryStockCheckResultModal", () => {
  it("shows canonical filters and full-Audit totals that do not change with displayed rows", () => {
    mount();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Item", "Par", "Actual", "Variance", "UOM", "Status", "Stock Value", "Variance Value", "Notes", "Skip Reason",
    ]);
    const flourRow = screen.getByText("Flour").closest("tr");
    expect(within(flourRow).getByText("Shortage")).toBeTruthy();
    expect(within(flourRow).getByText("-3")).toBeTruthy();
    const oilRow = screen.getByText("Oil").closest("tr");
    expect(within(oilRow).getByText("Excess")).toBeTruthy();
    expect(within(oilRow).getByText("2")).toBeTruthy();
    const valuation = screen.getByRole("region", { name: "Full Audit valuation" });
    expect(within(valuation).getByText("RM50.00")).toBeTruthy();
    expect(within(valuation).getByText("RM15.00")).toBeTruthy();
    expect(within(valuation).getByText("RM5.00")).toBeTruthy();
    expect(within(valuation).getByText("-RM10.00")).toBeTruthy();
    const filterSlots = [...screen.getByRole("region", { name: "Audit result filters" }).querySelectorAll("[data-admin-filter-slot]")];
    expect(filterSlots.map((field) => field.textContent)).toEqual(["Category All", "Status All", "Valuation All", "Sort Saved order", "Search Item"]);
    fireEvent.change(screen.getByPlaceholderText("Search item or category"), { target: { value: "flour" } });
    expect(screen.getByText("Flour")).toBeTruthy();
    expect(screen.queryByText("Oil")).toBeNull();
    expect(within(valuation).getByText("RM50.00")).toBeTruthy();
    expect(within(valuation).getByText("-RM10.00")).toBeTruthy();
  });

  it("shows partial pinned-cost coverage and keeps a valid zero distinct from an unvalued line", () => {
    mount([0, null]);
    const values = screen.getByRole("region", { name: "Partial audit valuation" });
    expect(within(values).getByText("Known Stock Value (Partial)")).toBeTruthy();
    expect(within(values).getAllByText("RM0.00")).toHaveLength(4);
    expect(screen.getByText(/1 of 2 items valued · 1 missing valid pinned cost/)).toBeTruthy();
    expect(screen.getByText("QA Creator").closest("details").open).toBe(false);
    expect(screen.getByText(/Variance coverage 1 of 2 items/)).toBeTruthy();
    expect(within(values).getByText("Shortage Value (Partial)")).toBeTruthy();
    expect(within(values).getByText("Excess Value (Partial)")).toBeTruthy();
    expect(within(values).getByText("Net Variance (Partial)")).toBeTruthy();
    expect(screen.getByText("QA Crew")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Valuation" }));
    fireEvent.click(screen.getByRole("option", { name: "Unvalued" }));
    expect(screen.queryByText("Flour")).toBeNull();
    const unvalued = screen.getByText("Oil").closest("tr");
    expect(within(unvalued).getAllByRole("cell")[6].textContent).toBe("—");
    expect(within(values).getAllByText("RM0.00")).toHaveLength(4);
    expect(screen.getByText(/1 of 2 items valued/)).toBeTruthy();
  });

  it("sorts valued entries before unvalued entries without changing the snapshot subtotal", () => {
    mount([null, 0]);
    const dataRows = () => screen.getAllByRole("row").slice(1);
    expect(dataRows()[0].textContent).toContain("Flour");
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("option", { name: "Highest stock value" }));
    expect(dataRows()[0].textContent).toContain("Oil");
    expect(dataRows()[1].textContent).toContain("Flour");
    const values = screen.getByRole("region", { name: "Partial audit valuation" });
    expect(within(values).getAllByText("RM0.00")).toHaveLength(4);
    expect(screen.getByText(/1 of 2 items valued/)).toBeTruthy();
  });
});
