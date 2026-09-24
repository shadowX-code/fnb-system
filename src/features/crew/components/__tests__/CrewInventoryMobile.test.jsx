import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewStockCheckMobile from "../CrewStockCheckMobile.jsx";
import CrewPurchaseOrdersMobile from "../CrewPurchaseOrdersMobile.jsx";
import { hasCrewInventoryAccess } from "../CrewInventoryOperationsMobile.jsx";
import "../../../../i18n/index.js";

const api = vi.hoisted(() => ({ inventoryStockChecks: vi.fn(), inventoryPurchaseOrders: vi.fn(), inventoryMobileCatalog: vi.fn(), saveInventoryStockCheck: vi.fn(), saveInventoryPurchaseOrder: vi.fn(), createInventoryStockCheckOrders: vi.fn(), transitionInventoryPurchaseOrder: vi.fn(), receiveInventoryPurchaseOrder: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: api }));

const catalog = { outlet_id: "outlet-1", outlet_name: "Test Outlet", business_date: "2026-09-24", categories: [{ id: "cat-1", name: "Dry Goods" }], items: [{ id: "item-1", name: "Rice", sku: "RICE", category_id: "cat-1", unit: "kg", par_level: 10 }], suppliers: [{ id: "supplier-1", name: "Supplier A" }] };
const stock = { business_date: "2026-09-24", can_perform_stock_check: true, can_create_audit_stock_check: false, due: [{ group_id: "group-1", name: "Opening", shift: "Morning", status: "due", items: [{ item_id: "item-1", item_name: "Rice", category_id: "cat-1", par_level_quantity: 10, unit: "kg" }] }], checks: [] };
const poDetail = { id: "po-1", po_no: "PO-1", supplier_id: "supplier-1", supplier_name: "Supplier A", status: "supplier_confirmed", created_at: "2026-09-24T00:00:00Z", lines: [{ id: "line-1", item_id: "item-1", item_name: "Rice", requested_qty: 10, received_qty: 3, remaining_qty: 7, unit: "kg" }], receipts: [] };

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.inventoryMobileCatalog.mockResolvedValue(catalog);
  api.inventoryStockChecks.mockResolvedValue(stock);
  api.inventoryPurchaseOrders.mockImplementation(async (_token, _outlet, id) => id ? { ...orders, detail: poDetail } : orders);
});
afterEach(cleanup);
const orders = { can_manage_purchase_orders: true, can_receive_purchase_orders: true, orders: [{ id: "po-1", po_no: "PO-1", supplier_name: "Supplier A", line_count: 1, status: "supplier_confirmed" }], suggestions: [] };

describe("Crew Inventory mobile authority boundary", () => {
  it("shows no direct-route data or actions without an outlet grant", async () => {
    expect(hasCrewInventoryAccess({})).toBe(false);
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{}} onBack={() => {}} />);
    expect(await screen.findByText("No operations access")).not.toBeNull();
    expect(api.inventoryStockChecks).not.toHaveBeenCalled();
    expect(api.inventoryMobileCatalog).not.toHaveBeenCalled();
  });

  it("saves a scheduled count through the gateway with canonical outlet and item IDs", async () => {
    api.saveInventoryStockCheck.mockResolvedValue({ check: { id: "check-1" } });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Opening/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Rice.*Actual count/ }), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.saveInventoryStockCheck).toHaveBeenCalledTimes(1));
    const [token, outletId, requestId, check, lines] = api.saveInventoryStockCheck.mock.calls[0];
    expect([token, outletId, check.outlet_id, check.group_id, check.status]).toEqual(["token", "outlet-1", "outlet-1", "group-1", "draft"]);
    expect(requestId).toBeTruthy();
    expect(lines[0]).toMatchObject({ item_id: "item-1", actual_count_quantity: 8, variance: -2 });
  });

  it("keeps older scheduled drafts reachable even when no check is due today", async () => {
    api.inventoryStockChecks.mockImplementation(async (_token, _outlet, id) => id ? { ...stock, detail: { id, type: "scheduled", status: "draft", check_name: "Yesterday Opening", check_date: "2026-09-23", items: [] } } : {
      ...stock, due: [], checks: [{ id: "old-draft", type: "scheduled", status: "draft", name: "Yesterday Opening", check_date: "2026-09-23", item_count: 1 }]
    });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true }} onBack={() => {}} />);
    expect(await screen.findByText("Drafts to continue")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Yesterday Opening/ }));
    await waitFor(() => expect(api.inventoryStockChecks).toHaveBeenCalledWith("token", "outlet-1", "old-draft"));
  });

  it("receives only requested remaining quantities with canonical line and item IDs", async () => {
    api.receiveInventoryPurchaseOrder.mockResolvedValue({ receipt_id: "receipt-1", status: "partial_received" });
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true, can_receive_purchase_orders: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /PO-1.*Supplier A/s }));
    fireEvent.click(await screen.findByRole("button", { name: "Receive PO" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Received quantity" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Receipt" }));
    await waitFor(() => expect(api.receiveInventoryPurchaseOrder).toHaveBeenCalledTimes(1));
    expect(api.receiveInventoryPurchaseOrder.mock.calls[0]).toEqual(["token", "outlet-1", "po-1", expect.any(String), "", [{ purchase_order_item_id: "line-1", item_id: "item-1", received_qty: 4, unit: "kg" }]]);
  });

  it("blocks over-receiving before the canonical receiving command", async () => {
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_receive_purchase_orders: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /PO-1.*Supplier A/s }));
    fireEvent.click(await screen.findByRole("button", { name: "Receive PO" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Received quantity" }), { target: { value: "8" } });
    expect(screen.getByText("Received quantity cannot exceed the remaining balance.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Record Receipt" }).disabled).toBe(true);
    expect(api.receiveInventoryPurchaseOrder).not.toHaveBeenCalled();
  });

  it("creates a Stock Check-sourced draft with server-owned shortage identities", async () => {
    api.inventoryPurchaseOrders.mockResolvedValue({ ...orders, suggestions: [{ stock_check_id: "check-1", check_name: "Opening", check_date: "2026-09-24", shortages: [{ stock_check_item_id: "count-1", item_id: "item-1", shortage_qty: 3, unit: "kg", suppliers: [{ id: "supplier-1", name: "Supplier A" }] }] }] });
    api.createInventoryStockCheckOrders.mockResolvedValue([{ order: { id: "created-po" } }]);
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create PO" }));
    fireEvent.click(screen.getByRole("button", { name: /From Stock Check/ }));
    fireEvent.click(screen.getByRole("button", { name: /Opening/ }));
    fireEvent.click(screen.getByRole("button", { name: "Supplier" }));
    fireEvent.click(screen.getByRole("option", { name: "Supplier A" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.createInventoryStockCheckOrders).toHaveBeenCalledTimes(1));
    expect(api.createInventoryStockCheckOrders.mock.calls[0]).toEqual(["token", "outlet-1", expect.any(String), "check-1", [expect.objectContaining({ source_type: "stock_check", source_stock_check_id: "check-1", supplier_id: "supplier-1", lines: [expect.objectContaining({ item_id: "item-1", source_stock_check_item_id: "count-1", requested_qty: 3 })] })]]);
  });

  it("can discard an incomplete manual PO that cannot yet be saved", async () => {
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create PO" }));
    fireEvent.click(screen.getByRole("button", { name: /Manual PO/ }));
    fireEvent.click(screen.getByRole("button", { name: "Supplier" }));
    fireEvent.click(screen.getByRole("option", { name: "Supplier A" }));
    expect(screen.getByRole("button", { name: "Save Draft" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Unsaved purchase order changes will be lost. Your saved drafts are not affected.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("button", { name: "Create PO" })).not.toBeNull();
    expect(api.saveInventoryPurchaseOrder).not.toHaveBeenCalled();
  });
});
