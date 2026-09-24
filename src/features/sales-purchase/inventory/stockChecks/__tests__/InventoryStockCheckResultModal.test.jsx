import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryStockCheckResultModal from "../InventoryStockCheckResultModal.jsx";

afterEach(cleanup);

const itemById = new Map([
  ["one", { id: "one", name: "Flour", sku: "F-1", categoryId: "dry", unit: "kg" }],
  ["two", { id: "two", name: "Oil", sku: "O-2", categoryId: "wet", unit: "L" }],
]);
const categoryById = new Map([["dry", { name: "Dry Goods" }], ["wet", { name: "Wet Goods" }]]);

function mount() {
  return render(<InventoryStockCheckResultModal
    stockCheck={{ date: "2026-09-24", submittedAt: "2026-09-24T09:00:00Z", auditType: "Spot Check", rows: [
      { id: "row-1", itemId: "one", expectedQty: 10, actualCount: 7, variance: 3, unit: "kg", unitCostSnapshot: 5 },
      { id: "row-2", itemId: "two", expectedQty: 4, actualCount: 6, variance: -2, unit: "L", unitCostSnapshot: 2.5 },
    ] }}
    isAuditResult outletName="QA Outlet" submittedByName="QA Crew" itemById={itemById} categoryById={categoryById}
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
    expect(filterSlots.map((field) => field.textContent)).toEqual(["Category All", "Status All", "Search Item"]);
    fireEvent.change(screen.getByPlaceholderText("Search item or category"), { target: { value: "flour" } });
    expect(screen.getByText("Flour")).toBeTruthy();
    expect(screen.queryByText("Oil")).toBeNull();
    expect(within(valuation).getByText("RM50.00")).toBeTruthy();
    expect(within(valuation).getByText("-RM10.00")).toBeTruthy();
  });
});
