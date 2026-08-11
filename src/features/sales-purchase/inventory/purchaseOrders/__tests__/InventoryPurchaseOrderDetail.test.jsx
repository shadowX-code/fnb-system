import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryPurchaseOrderDetail from "../InventoryPurchaseOrderDetail.jsx";

const baseOrder = {
  id: "po-1",
  poNo: "INT-PO-001",
  supplierId: "supplier-1",
  outletId: "outlet-1",
  sourceType: "stock_check",
  sourceStockCheckId: "check-1",
  createdAt: "2026-08-09T08:00:00.000Z",
  submittedAt: "2026-08-09T09:00:00.000Z",
  lines: [
    { id: "line-1", itemId: "item-1", requestedQty: 10, receivedQty: 4, unit: "kg", remark: "Use sealed bags" },
    { id: "line-2", itemId: "item-2", requestedQty: 5, receivedQty: 1, unit: "pcs" },
  ],
  receipts: [{
    id: "receipt-1",
    receivedAt: "2026-08-10T08:00:00.000Z",
    receivedBy: "employee-1",
    remark: "First delivery",
    items: [{ id: "receipt-line-1", itemId: "item-1", receivedQty: 4, unit: "kg", remark: "Invoice A" }, { id: "receipt-line-2", itemId: "item-2", receivedQty: 1, unit: "pcs" }],
  }],
};

function mount({ order = { ...baseOrder, status: "partial_received" } } = {}) {
  const callbacks = { onClose: vi.fn(), onRequestReceive: vi.fn(), onCopyPurchaseOrder: vi.fn(), onNotify: vi.fn(), onPrint: vi.fn() };
  render(<InventoryPurchaseOrderDetail
    order={order}
    getBusinessPoNo={() => "PO-2026-001"}
    suppliers={[{ id: "supplier-1", name: "Chilli Supplier", phone: "+60 12 345 6789", email: "orders@chilli.test" }]}
    outletById={new Map([["outlet-1", { name: "KL Central" }]])}
    itemById={new Map([["item-1", { name: "Dried Chilli", unit: "kg" }], ["item-2", { name: "Takeaway Cups", unit: "pcs" }]])}
    checks={[{ id: "check-1", auditName: "Daily Count", date: "2026-08-09" }]}
    actorNameByAnyId={(id) => id === "employee-1" ? "Operator" : "Unknown"}
    formatDate={(value) => ({ "2026-08-09": "09 Aug 2026", "2026-08-09T08:00:00.000Z": "09 Aug 2026", "2026-08-09T09:00:00.000Z": "09 Aug 2026", "2026-08-10T08:00:00.000Z": "10 Aug 2026" }[value] || "Pending date")}
    statusTone={(status) => status === "completed" ? "success" : "warning"}
    {...callbacks}
  />);
  return callbacks;
}

describe("InventoryPurchaseOrderDetail", () => {
  it("faithfully presents current partial-receipt detail, receiving history, and read-only action bridges", () => {
    const callbacks = mount();
    const modal = screen.getByRole("heading", { name: "Purchase Order Detail" }).closest(".fixed");
    expect(within(modal).getByText("PO-2026-001")).toBeTruthy();
    expect(within(modal).getByText("INT-PO-001")).toBeTruthy();
    expect(within(modal).getByText("Partial Received")).toBeTruthy();
    expect(within(modal).getByText("Stock Check")).toBeTruthy();
    expect(within(modal).getByText("Daily Count · 09 Aug 2026")).toBeTruthy();
    expect(within(modal).getByText("Chilli Supplier")).toBeTruthy();
    expect(within(modal).getByText("+60 12 345 6789")).toBeTruthy();
    expect(within(modal).getByText("PO-2026-001 · Chilli Supplier · KL Central")).toBeTruthy();
    expect(within(modal).getByText("5 / 15 received")).toBeTruthy();
    expect(within(modal).getByText("33% fulfilled")).toBeTruthy();
    expect(within(modal).getByText("Dried Chilli")).toBeTruthy();
    expect(within(modal).getByText("Use sealed bags")).toBeTruthy();
    expect(within(modal).getByText("Receiving History")).toBeTruthy();
    expect(within(modal).getByText("Received By: Operator")).toBeTruthy();
    expect(within(modal).getByText("Remark: First delivery")).toBeTruthy();

    fireEvent.click(within(modal).getByRole("button", { name: "Receive" }));
    fireEvent.click(within(modal).getByRole("button", { name: "Copy PO Text" }));
    fireEvent.click(within(modal).getByRole("button", { name: "Export PDF" }));
    fireEvent.click(within(modal).getByRole("button", { name: "Print" }));
    fireEvent.click(within(modal).getByRole("button", { name: "Close" }));
    expect(callbacks.onRequestReceive).toHaveBeenCalledWith(expect.objectContaining({ id: "po-1" }));
    expect(callbacks.onCopyPurchaseOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "po-1" }));
    expect(callbacks.onNotify).toHaveBeenCalledWith("Export PDF", "Use the print dialog to save this PO as PDF.");
    expect(callbacks.onPrint).toHaveBeenCalledTimes(2);
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Receive eligibility limited to submitted, confirmed, and partial orders with a balance", () => {
    mount({ order: { ...baseOrder, status: "draft", receipts: [] } });
    expect(screen.queryByRole("button", { name: "Receive" })).toBeNull();
    cleanup();
    mount({ order: { ...baseOrder, status: "fully_received", lines: [{ id: "line", itemId: "item-1", requestedQty: 10, receivedQty: 10, unit: "kg" }] } });
    expect(screen.queryByRole("button", { name: "Receive" })).toBeNull();
    cleanup();
    mount({ order: { ...baseOrder, status: "completed", completedAt: "2026-08-10T08:00:00.000Z", lines: [{ id: "line", itemId: "item-1", requestedQty: 10, receivedQty: 10, unit: "kg" }] } });
    expect(screen.queryByRole("button", { name: "Receive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Complete PO" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy PO Text" })).toBeTruthy();
  });
});

afterEach(cleanup);
