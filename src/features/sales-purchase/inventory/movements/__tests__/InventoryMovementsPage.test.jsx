import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InventoryMovementsPage from "../InventoryMovementsPage.jsx";

const rows = [
  { id: "purchase", outletId: "outlet-1", itemId: "item-1", movementType: "Purchase", quantity: 10, unit: "kg", date: "2026-08-01", reference: "PO-1" },
  { id: "waste", outletId: "outlet-1", itemId: "item-1", movementType: "Waste", quantity: -2, unit: "kg", date: "2026-08-02", reference: "WST-1" },
  { id: "transfer", outletId: "outlet-1", itemId: "item-1", movementType: "Transfer Out", quantity: -3, unit: "kg", date: "2026-08-03", reference: "TRF-1" },
  { id: "adjustment", outletId: "outlet-1", itemId: "item-1", movementType: "Adjustment", quantity: 1, unit: "kg", date: "2026-08-04" },
];
function mount({ canRecordMovement = true } = {}) { const onEditMovement = vi.fn(); const onOpenReference = vi.fn(); render(<InventoryMovementsPage movements={rows} itemById={new Map([["item-1", { name: "Dried Chilli", unit: "kg" }]])} outletById={new Map([["outlet-1", { name: "KL Central" }]])} outletOptions={[{ value: "all", label: "All outlets" }, { value: "outlet-1", label: "KL Central" }]} actorNameByAnyId={() => "Operator"} formatDateTimeCompact={(value) => value} canonical={(value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")} toTitle={(value) => value} canEditMovement={(row) => row.id === "adjustment"} canRecordMovement={canRecordMovement} onEditMovement={onEditMovement} onOpenReference={onOpenReference} />); return { onEditMovement, onOpenReference }; }
function paginationRows() { return Array.from({ length: 21 }, (_, index) => ({ id: `movement-${index + 1}`, outletId: "outlet-1", itemId: "item-1", movementType: "Purchase", quantity: index + 1, unit: "kg", date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`, reference: `PO-${index + 1}` })); }
function mountPagination() { const onEditMovement = vi.fn(); const onOpenReference = vi.fn(); render(<InventoryMovementsPage movements={paginationRows()} itemById={new Map([["item-1", { name: "Dried Chilli", unit: "kg" }]])} outletById={new Map([["outlet-1", { name: "KL Central" }]])} outletOptions={[{ value: "all", label: "All outlets" }, { value: "outlet-1", label: "KL Central" }]} actorNameByAnyId={() => "Operator"} formatDateTimeCompact={(value) => value} canonical={(value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")} toTitle={(value) => value} canEditMovement={() => false} canRecordMovement={false} onEditMovement={onEditMovement} onOpenReference={onOpenReference} />); return { onEditMovement, onOpenReference }; }
beforeEach(() => window.localStorage.clear());
describe("InventoryMovementsPage", () => {
  it("renders representative purchase, waste, transfer, and manual adjustment history with signed quantities", () => { mount(); expect(screen.getByText("+10 kg")).toBeTruthy(); expect(screen.getByText("-2 kg")).toBeTruthy(); expect(screen.getByText("-3 kg")).toBeTruthy(); expect(screen.getByText("+1 kg")).toBeTruthy(); expect(screen.getByText("Purchase")).toBeTruthy(); expect(screen.getAllByText("Waste").length).toBeGreaterThan(0); expect(screen.getByText("Transfer Out")).toBeTruthy(); expect(screen.getByText("Adjustment")).toBeTruthy(); });
  it("keeps reference and manual edit actions on narrow callbacks", () => { const { onEditMovement, onOpenReference } = mount(); fireEvent.click(screen.getByRole("button", { name: "PO-1" })); fireEvent.click(screen.getByRole("button", { name: "Edit" })); expect(onOpenReference).toHaveBeenCalledWith(expect.objectContaining({ id: "purchase" })); expect(onEditMovement).toHaveBeenCalledWith(expect.objectContaining({ id: "adjustment" })); });
  it("does not expose edit when the current movement permission is absent", () => { mount({ canRecordMovement: false }); expect(screen.queryByRole("button", { name: "Edit" })).toBeNull(); });
  it("paginates the filtered movement history with the Factory footer and resets to page one after filtering", () => {
    mountPagination();
    expect(screen.getByText("Showing 1–20 of 21 records")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Previous" }).every((button) => button.disabled)).toBe(true);
    expect(screen.getAllByRole("button", { name: "Next" }).every((button) => !button.disabled)).toBe(true);
    expect(screen.getByText("PO-1")).toBeTruthy();
    expect(screen.queryByText("PO-21")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Next" })[0]);
    expect(screen.getByText("Showing 21–21 of 21 records")).toBeTruthy();
    expect(screen.getByText("PO-21")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search item, PO no, notes"), { target: { value: "PO-21" } });
    expect(screen.getByText("Showing 1–1 of 1 records")).toBeTruthy();
    expect(screen.getByText("PO-21")).toBeTruthy();
    expect(screen.queryByText("PO-1")).toBeNull();
  });
});

afterEach(cleanup);
