import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewPurchaseOrdersMobile from "../CrewPurchaseOrdersMobile.jsx";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/crewService.js", () => ({ crewService: {
  inventoryPurchaseOrders: vi.fn(), inventoryMobileCatalog: vi.fn(), receiveInventoryPurchaseOrder: vi.fn(), createInventoryStockCheckOrders: vi.fn(),
} }));

const order = { id: "order-1", business_po_no: "FC-260925-01", supplier_name: "Test Supplier", status: "supplier_confirmed",
  category_names: ["Vegetables"], line_count: 2, requested_qty: 8, received_qty: 0, created_at: "2026-09-25T01:00:00Z" };
const detail = { ...order, lines: [
  { id: "line-1", item_id: "item-1", item_name: "Carrots", sku_code: "CAR", photo_url: "https://example.test/carrot.jpg", requested_qty: 5, received_qty: 2, remaining_qty: 3, unit: "kg" },
  { id: "line-2", item_id: "item-2", item_name: "Lettuce", sku_code: "LET", photo_url: null, requested_qty: 3, received_qty: 3, remaining_qty: 0, unit: "kg" },
] };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Crew PO operational presentation", () => {
  it("keeps supplier primary and Receive All Remaining as editable local prefill only", async () => {
    crewService.inventoryPurchaseOrders.mockImplementation(async (_token, _outlet, id) => id ? { detail, can_receive_purchase_orders: true } : {
      orders: [order], suggestions: [], can_manage_purchase_orders: false, can_receive_purchase_orders: true,
    });
    crewService.inventoryMobileCatalog.mockResolvedValue({ items: [], categories: [], suppliers: [] });
    render(<CrewPurchaseOrdersMobile token="qa-token" outletId="outlet-1" grants={{ can_receive_purchase_orders: true }} onBack={() => {}} />);
    const supplier = await screen.findByText("Test Supplier");
    expect(supplier.closest("button").textContent).toContain("FC-260925-01");
    expect(supplier.closest("button").textContent).toContain("Vegetables");
    expect(supplier.closest("button").textContent).toMatch(/Sep 25, 2026/);
    fireEvent.click(supplier.closest("button"));
    await screen.findByText("Carrots");
    expect(screen.getByRole("button", { name: "View Carrots image" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Receive PO" }));
    await screen.findByRole("button", { name: "Receive All Remaining" });
    expect(screen.getByRole("button", { name: "Record Receipt" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Receive All Remaining" }));
    expect(screen.getByRole("spinbutton", { name: "Received now" }).value).toBe("3");
    expect(screen.getByRole("button", { name: "Record Receipt" }).disabled).toBe(false);
    expect(crewService.receiveInventoryPurchaseOrder).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Received now" }), { target: { value: "1" } });
    expect(screen.getByRole("spinbutton", { name: "Received now" }).value).toBe("1");
    expect(screen.getByText("Fully received")).toBeTruthy();
    await waitFor(() => expect(crewService.receiveInventoryPurchaseOrder).not.toHaveBeenCalled());
  });

  it("groups Restock Items by canonical supplier and keeps order quantities editable before draft creation", async () => {
    crewService.inventoryPurchaseOrders.mockResolvedValue({ orders: [], can_manage_purchase_orders: true, suggestions: [{
      stock_check_id: "check-1", check_name: "QA Scheduled Count", check_date: "2026-09-25", shortages: [
        { stock_check_item_id: "check-item-1", item_id: "item-1", item_name: "Carrots", sku_code: "CAR", current_qty: 1, par_qty: 5, shortage_qty: 4, unit: "kg", suppliers: [{ id: "supplier-1", name: "Produce Supplier" }] },
        { stock_check_item_id: "check-item-2", item_id: "item-2", item_name: "Milk", sku_code: "MLK", current_qty: 1, par_qty: 3, shortage_qty: 2, unit: "pack", suppliers: [{ id: "supplier-2", name: "Dairy Supplier" }] },
      ],
    }] });
    crewService.inventoryMobileCatalog.mockResolvedValue({ items: [], categories: [], suppliers: [] });
    render(<CrewPurchaseOrdersMobile token="qa-token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create PO" }));
    fireEvent.click(screen.getByRole("button", { name: /From Stock Check/ }));
    fireEvent.click(screen.getByRole("button", { name: /QA Scheduled Count/ }));
    expect(screen.getByRole("heading", { name: "Restock Items" })).toBeTruthy();
    expect(screen.getByText("Produce Supplier")).toBeTruthy();
    expect(screen.getByText("Dairy Supplier")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create 2 Draft POs" }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: /Milk/ }));
    expect(screen.getByRole("button", { name: "Create 1 Draft PO" }).disabled).toBe(false);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Order Qty" }), { target: { value: "6" } });
    expect(screen.getByRole("spinbutton", { name: "Order Qty" }).value).toBe("6");
    expect(crewService.createInventoryStockCheckOrders).not.toHaveBeenCalled();
  });
});
