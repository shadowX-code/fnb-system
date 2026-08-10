import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryMovementsPage from "../InventoryMovementsPage.jsx";

const rows = [
  { id: "purchase", outletId: "outlet-1", itemId: "item-1", movementType: "Purchase", quantity: 10, unit: "kg", date: "2026-08-01", reference: "PO-1" },
  { id: "waste", outletId: "outlet-1", itemId: "item-1", movementType: "Waste", quantity: -2, unit: "kg", date: "2026-08-02", reference: "WST-1" },
  { id: "transfer", outletId: "outlet-1", itemId: "item-1", movementType: "Transfer Out", quantity: -3, unit: "kg", date: "2026-08-03", reference: "TRF-1" },
  { id: "adjustment", outletId: "outlet-1", itemId: "item-1", movementType: "Adjustment", quantity: 1, unit: "kg", date: "2026-08-04" },
];
function mount({ canRecordMovement = true } = {}) { const onEditMovement = vi.fn(); const onOpenReference = vi.fn(); render(<InventoryMovementsPage movements={rows} itemById={new Map([["item-1", { name: "Dried Chilli", unit: "kg" }]])} outletById={new Map([["outlet-1", { name: "KL Central" }]])} outletOptions={[{ value: "all", label: "All outlets" }, { value: "outlet-1", label: "KL Central" }]} actorNameByAnyId={() => "Operator"} formatDateTimeCompact={(value) => value} canonical={(value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")} toTitle={(value) => value} canEditMovement={(row) => row.id === "adjustment"} canRecordMovement={canRecordMovement} onEditMovement={onEditMovement} onOpenReference={onOpenReference} />); return { onEditMovement, onOpenReference }; }
describe("InventoryMovementsPage", () => {
  it("renders representative purchase, waste, transfer, and manual adjustment history with signed quantities", () => { mount(); expect(screen.getByText("+10 kg")).toBeTruthy(); expect(screen.getByText("-2 kg")).toBeTruthy(); expect(screen.getByText("-3 kg")).toBeTruthy(); expect(screen.getByText("+1 kg")).toBeTruthy(); expect(screen.getByText("Purchase")).toBeTruthy(); expect(screen.getAllByText("Waste").length).toBeGreaterThan(0); expect(screen.getByText("Transfer Out")).toBeTruthy(); expect(screen.getByText("Adjustment")).toBeTruthy(); });
  it("keeps reference and manual edit actions on narrow callbacks", () => { const { onEditMovement, onOpenReference } = mount(); fireEvent.click(screen.getByRole("button", { name: "PO-1" })); fireEvent.click(screen.getByRole("button", { name: "Edit" })); expect(onOpenReference).toHaveBeenCalledWith(expect.objectContaining({ id: "purchase" })); expect(onEditMovement).toHaveBeenCalledWith(expect.objectContaining({ id: "adjustment" })); });
  it("does not expose edit when the current movement permission is absent", () => { mount({ canRecordMovement: false }); expect(screen.queryByRole("button", { name: "Edit" })).toBeNull(); });
});

afterEach(cleanup);
