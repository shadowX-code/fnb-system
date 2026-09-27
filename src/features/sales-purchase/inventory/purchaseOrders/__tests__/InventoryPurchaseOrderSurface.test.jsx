import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), receive: vi.fn() }));
vi.mock("../inventoryPurchaseOrderService.js", () => ({
  loadPurchaseOrderDetail: mocks.load, persistRemotePurchaseOrderReceive: mocks.receive,
}));
vi.mock("../../../../../lib/supabase.ts", () => ({ supabase: {} }));
import InventoryPurchaseOrderSurface from "../InventoryPurchaseOrderSurface.jsx";
import { subscribeInventoryRevalidation } from "../../../../../services/inventoryRevalidation.js";
const outletId = "00000000-0000-4000-8000-000000000001";
const orderId = "00000000-0000-4000-8000-000000000002";
const data = {
  order: { id: orderId, poNo: "PO-TEST", supplierId: "supplier", outletId, status: "supplier_confirmed",
    lines: [{ id: "line", itemId: "item", requestedQty: 10, receivedQty: 2, unit: "kg" }], receipts: [] },
  items: [{ id: "item", name: "Rice", unit: "kg" }], people: [], checks: [],
};
const props = { orderId, auth: { hasPermission: () => true, isProtectedRole: true },
  ui: { notify: vi.fn() }, outlets: [{ id: outletId, name: "Outlet" }], suppliers: [{ id: "supplier", name: "Supplier" }], onClose: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue(data); mocks.receive.mockResolvedValue({ status: "partial_received" }); });
afterEach(cleanup);
it("loads by identity, refreshes, and owns Receiving + receipt read-back with one revalidation signal", async () => {
  const invalidate = vi.fn(), unsubscribe = subscribeInventoryRevalidation(invalidate);
  render(<InventoryPurchaseOrderSurface {...props} />);
  await screen.findByRole("button", { name: "Receive" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  await screen.findByRole("button", { name: "Receive" });
  fireEvent.click(screen.getByRole("button", { name: "Receive" }));
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
  let finish;
  mocks.receive.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm Receive" }));
  expect(screen.getByRole("button", { name: "Receiving…" }).disabled).toBe(true);
  mocks.load.mockResolvedValue({ ...data, order: { ...data.order, status: "partial_received",
    lines: [{ ...data.order.lines[0], receivedQty: 5 }],
    receipts: [{ id: "receipt", receivedAt: "2026-09-28", remark: "Persisted delivery", items: [] }] } });
  finish({ status: "partial_received" });
  await screen.findByText(/Persisted delivery/);
  expect(mocks.receive).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({ orderId, outletId, reason: "purchase-order-received" });
  expect(mocks.load).toHaveBeenCalledTimes(3);
  unsubscribe();
});
it("preserves a rejected receipt for retry but never offers a committed receipt after failed read-back", async () => {
  render(<InventoryPurchaseOrderSurface {...props} initialAction="receive" />);
  await screen.findByRole("spinbutton");
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
  mocks.receive.mockRejectedValueOnce(new Error("Receipt rejected"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm Receive" }));
  await waitFor(() => expect(props.ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to receive inventory" })));
  expect(screen.getByRole("heading", { name: "Receive Inventory" })).toBeTruthy();
  mocks.load.mockRejectedValueOnce(new Error("Read unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm Receive" }));
  await screen.findByText("Read unavailable");
  expect(screen.queryByRole("button", { name: "Confirm Receive" })).toBeNull();
  expect(mocks.receive).toHaveBeenCalledTimes(2);
  expect(mocks.receive.mock.calls[0][4]).toBe(mocks.receive.mock.calls[1][4]);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "Receive" });
  expect(mocks.receive).toHaveBeenCalledTimes(2);
});
it("blocks inaccessible outlets and read errors instead of showing partial detail", async () => {
  mocks.load.mockResolvedValue({ ...data, order: { ...data.order, outletId: "other" } });
  render(<InventoryPurchaseOrderSurface {...props} />);
  await screen.findByText("Purchase order is outside your accessible outlets.");
  expect(screen.queryByRole("button", { name: "Receive" })).toBeNull();
});
it("ignores an older PO read after switching identities", async () => {
  let old;
  mocks.load.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }));
  const view = render(<InventoryPurchaseOrderSurface {...props} />);
  mocks.load.mockResolvedValue({ ...data, order: { ...data.order, id: "next", poNo: "PO-NEXT" } });
  view.rerender(<InventoryPurchaseOrderSurface {...props} orderId="next" />);
  await screen.findByText("PO-NEXT", { selector: ".font-mono.text-lg" });
  old(data);
  await waitFor(() => expect(screen.queryByText("PO-TEST", { selector: ".font-mono.text-lg" })).toBeNull());
});
it("uses canonical Copy PO Text and keeps the manual clipboard fallback in the PO surface", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("Unavailable")) } });
  render(<InventoryPurchaseOrderSurface {...props} />);
  await screen.findByRole("button", { name: "Copy PO Text" });
  fireEvent.click(screen.getByRole("button", { name: "Copy PO Text" }));
  const text = await screen.findByRole("textbox");
  expect(text.value).toContain("Rice — 10 kg");
  expect(text.value).toContain("PO No.: PO-TEST");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
  await screen.findByRole("button", { name: "Receive" });
});
