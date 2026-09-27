import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryManualMovementModal from "../InventoryManualMovementModal.jsx";
import { canonical } from "../../inventoryItemModel.js";
const props = () => ({ outlets: [{ id: "outlet", name: "KL" }], items: [{ id: "item", name: "Chilli", unit: "kg", status: "active" }], canonical: (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_"), isActiveInventoryItem: () => true, todayInput: () => "2026-08-10", makeId: () => "move-1", parseNonNegativeNumber: (value) => value === "" ? "" : Number(value), onClose: vi.fn(), onSave: vi.fn() });
function setQuantity(value) { const label = screen.getByText("Quantity (kg)"); fireEvent.change(label.parentElement.querySelector("input"), { target: { value } }); }
afterEach(cleanup);
describe("InventoryManualMovementModal", () => {
  it("preserves outgoing/incoming identities using canonical normalization when either transfer leg is edited", async () => {
    const out = { id: 'out', outletId: 'source', itemId: 'item', movementType: 'Transfer Out', quantity: -3, reference: 'TRF-1' };
    const incoming = { id: 'in', outletId: 'destination', itemId: 'item', movementType: 'Transfer In', quantity: 3, reference: 'TRF-1' };
    const value = { ...props(), canonical, outlets: [{ id: 'source', name: 'Source' }, { id: 'destination', name: 'Destination' }], movement: incoming, movements: [out, incoming] };
    render(<InventoryManualMovementModal {...value} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update Movement' }));
    await waitFor(() => expect(value.onSave).toHaveBeenCalledWith(expect.objectContaining({ transfer: true, id: 'out', pairMovementId: 'in', fromOutletId: 'source', toOutletId: 'destination', quantity: 3 })));
  });
  it("prepares the existing positive adjustment payload through its page callback", async () => { const value = props(); value.onSave.mockResolvedValue(undefined); render(<InventoryManualMovementModal {...value} />); setQuantity("3"); fireEvent.click(screen.getByRole("button", { name: "Save Movement" })); await waitFor(() => expect(value.onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "move-1", itemId: "item", outletId: "outlet", movementType: "adjustment", quantity: 3, unit: "kg", referenceType: "manual" }))); });
  it("prevents repeat submit while saving and recovers for retry", async () => { let resolve; const value = props(); value.onSave.mockImplementation(() => new Promise((done) => { resolve = done; })); render(<InventoryManualMovementModal {...value} />); setQuantity("2"); const save = screen.getByRole("button", { name: "Save Movement" }); fireEvent.click(save); fireEvent.click(save); expect(value.onSave).toHaveBeenCalledTimes(1); resolve(); await waitFor(() => expect(screen.getByRole("button", { name: "Save Movement" }).disabled).toBe(false)); });
});
