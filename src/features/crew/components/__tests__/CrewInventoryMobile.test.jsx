import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewStockCheckMobile from "../CrewStockCheckMobile.jsx";
import CrewPurchaseOrdersMobile from "../CrewPurchaseOrdersMobile.jsx";
import { CrewInventoryHomeAttention, hasCrewInventoryAccess } from "../CrewInventoryOperationsMobile.jsx";
import "../../../../i18n/index.js";

const api = vi.hoisted(() => ({ inventoryAttention: vi.fn(), inventoryStockChecks: vi.fn(), inventoryPurchaseOrders: vi.fn(), inventoryMobileCatalog: vi.fn(), saveInventoryStockCheck: vi.fn(), saveInventoryPurchaseOrder: vi.fn(), createInventoryStockCheckOrders: vi.fn(), transitionInventoryPurchaseOrder: vi.fn(), receiveInventoryPurchaseOrder: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: api }));

const catalog = { outlet_id: "outlet-1", outlet_name: "Test Outlet", business_date: "2026-09-24", categories: [{ id: "cat-1", name: "Dry Goods" }], items: [{ id: "item-1", name: "Rice", sku: "RICE", category_id: "cat-1", unit: "kg", par_level: 10 }], suppliers: [{ id: "supplier-1", name: "Supplier A" }] };
const stock = { business_date: "2026-09-24", can_perform_stock_check: true, can_create_audit_stock_check: false, due: [{ group_id: "group-1", name: "Opening", shift: "Morning", status: "due", items: [{ item_id: "item-1", item_name: "Rice", category_id: "cat-1", par_level_quantity: 10, unit: "kg" }] }], checks: [] };
const poDetail = { id: "po-1", po_no: "PO-1", supplier_id: "supplier-1", supplier_name: "Supplier A", status: "supplier_confirmed", created_at: "2026-09-24T00:00:00Z", lines: [{ id: "line-1", item_id: "item-1", item_name: "Rice", requested_qty: 10, received_qty: 3, remaining_qty: 7, unit: "kg" }], receipts: [] };

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.inventoryMobileCatalog.mockResolvedValue(catalog);
  api.inventoryAttention.mockResolvedValue({ stock_checks_due_today: 1, purchase_orders_awaiting_confirmation: 0, purchase_orders_awaiting_receiving: 1 });
  api.inventoryStockChecks.mockResolvedValue(stock);
  api.inventoryPurchaseOrders.mockImplementation(async (_token, _outlet, id) => id ? { ...orders, detail: poDetail } : orders);
});
afterEach(cleanup);
const orders = { can_manage_purchase_orders: true, can_receive_purchase_orders: true, orders: [{ id: "po-1", po_no: "PO-1", supplier_name: "Supplier A", line_count: 1, status: "supplier_confirmed" }], suggestions: [] };

describe("Crew Inventory mobile authority boundary", () => {
  it("shows direct Home modules with canonical attention and opens the priority check", async () => {
    const onOpenCheck = vi.fn();
    render(<CrewInventoryHomeAttention token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true, can_receive_purchase_orders: true }} onOpenStock={vi.fn()} onOpenOrders={vi.fn()} onOpenCheck={onOpenCheck} onOpenOrder={vi.fn()} />);
    expect(await screen.findByText("1 check due today")).not.toBeNull();
    expect(screen.getByText("1 awaiting receiving")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onOpenCheck).toHaveBeenCalledWith(stock.due[0]);
  });

  it("uses action-oriented all-clear copy rather than zero KPI pills", async () => {
    api.inventoryAttention.mockResolvedValue({ stock_checks_due_today: 0, purchase_orders_awaiting_confirmation: 0, purchase_orders_awaiting_receiving: 0 });
    api.inventoryStockChecks.mockResolvedValue({ ...stock, due: [], checks: [] });
    api.inventoryPurchaseOrders.mockResolvedValue({ ...orders, orders: [] });
    render(<CrewInventoryHomeAttention token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true, can_receive_purchase_orders: true }} onOpenStock={vi.fn()} onOpenOrders={vi.fn()} onOpenCheck={vi.fn()} onOpenOrder={vi.fn()} />);
    expect(await screen.findByText("All clear today · No checks due")).not.toBeNull();
    expect(screen.getByText("No orders need attention")).not.toBeNull();
  });

  it("prioritizes a resumable check and shows one item plus a full-list link", async () => {
    api.inventoryStockChecks.mockResolvedValue({ ...stock,
      checks: [{ id: "draft-1", type: "scheduled", status: "draft", name: "Yesterday Opening", check_date: "2026-09-23", item_count: 1, updated_at: "2026-09-24T08:00:00Z" }],
      due: [...stock.due, { ...stock.due[0], group_id: "group-2", name: "Closing" }] });
    const onOpenCheck = vi.fn(); const onOpenStock = vi.fn();
    render(<CrewInventoryHomeAttention token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true }} onOpenStock={onOpenStock} onOpenOrders={vi.fn()} onOpenCheck={onOpenCheck} onOpenOrder={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
    expect(onOpenCheck).toHaveBeenCalledWith(expect.objectContaining({ id: "draft-1" }));
    fireEvent.click(screen.getByRole("button", { name: "+2 more checks" }));
    expect(onOpenStock).toHaveBeenCalled();
  });

  it("never renders a previous outlet's attention after switching", async () => {
    let resolveFirst;
    api.inventoryStockChecks.mockImplementation((_token, outlet) => outlet === "outlet-1" ? new Promise((resolve) => { resolveFirst = resolve; }) : Promise.resolve({ ...stock, due: [], checks: [] }));
    api.inventoryPurchaseOrders.mockResolvedValue({ ...orders, orders: [] });
    const grants = { can_perform_stock_check: true, can_receive_purchase_orders: true };
    const props = { token: "token", grants, onOpenStock: vi.fn(), onOpenOrders: vi.fn(), onOpenCheck: vi.fn(), onOpenOrder: vi.fn() };
    const view = render(<CrewInventoryHomeAttention {...props} outletId="outlet-1" />);
    await waitFor(() => expect(resolveFirst).toBeTypeOf("function"));
    view.rerender(<CrewInventoryHomeAttention {...props} outletId="outlet-2" />);
    resolveFirst(stock);
    expect(await screen.findByText("All clear today · No checks due")).not.toBeNull();
    expect(screen.queryByText("Opening")).toBeNull();
  });

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
    expect(await screen.findByText("Draft saved")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Opening/ })).not.toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /Rice.*Actual count/ })).toBeNull();
  });

  it("offers Save & Leave, Keep Counting and Discard Changes for an unsaved count", async () => {
    api.saveInventoryStockCheck.mockResolvedValue({ check: { id: "check-1" } });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Opening/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Rice.*Actual count/ }), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Save your progress?" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep Counting" }));
    expect(screen.getByRole("spinbutton", { name: /Rice.*Actual count/ }).value).toBe("8");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & Leave" }));
    await waitFor(() => expect(api.saveInventoryStockCheck).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Draft saved")).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: "Save your progress?" })).toBeNull();
  });

  it("keeps unsaved counts and the request identity on a failed Save & Leave retry", async () => {
    api.saveInventoryStockCheck.mockRejectedValueOnce(new Error("Temporary failure")).mockResolvedValueOnce({ check: { id: "check-1" } });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Opening/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Rice.*Actual count/ }), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & Leave" }));
    expect(await screen.findAllByText("Temporary failure")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save & Leave" }));
    await waitFor(() => expect(api.saveInventoryStockCheck).toHaveBeenCalledTimes(2));
    expect(api.saveInventoryStockCheck.mock.calls[0][2]).toBe(api.saveInventoryStockCheck.mock.calls[1][2]);
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

  it("opens Home's Receive shortcut only when the fresh gateway read still permits receiving", async () => {
    const target = orders.orders[0];
    const view = render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_receive_purchase_orders: true }} initialTarget={target} onBack={() => {}} />);
    expect(await screen.findByRole("button", { name: "Record Receipt" })).not.toBeNull();
    view.unmount();
    api.inventoryPurchaseOrders.mockImplementation(async (_token, _outlet, id) => id ? { ...orders, can_receive_purchase_orders: false, detail: poDetail } : orders);
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_receive_purchase_orders: true }} initialTarget={target} onBack={() => {}} />);
    expect(await screen.findByRole("button", { name: "Copy Text" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Record Receipt" })).toBeNull();
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
    api.inventoryPurchaseOrders.mockResolvedValue({ ...orders, suggestions: [{ stock_check_id: "check-1", check_name: "Opening", check_date: "2026-09-24", shortages: [{ stock_check_item_id: "count-1", item_id: "item-1", item_name: "Rice", current_qty: 7, par_qty: 10, shortage_qty: 3, unit: "kg", suppliers: [{ id: "supplier-1", name: "Supplier A" }] }] }] });
    api.createInventoryStockCheckOrders.mockResolvedValue([{ order: { id: "created-po" } }]);
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create PO" }));
    fireEvent.click(screen.getByRole("button", { name: /From Stock Check/ }));
    fireEvent.click(screen.getByRole("button", { name: /Opening/ }));
    expect(screen.getByText(/Current/)).not.toBeNull();
    expect(screen.getByText(/Par/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create 1 Draft PO" }));
    await waitFor(() => expect(api.createInventoryStockCheckOrders).toHaveBeenCalledTimes(1));
    expect(api.createInventoryStockCheckOrders.mock.calls[0]).toEqual(["token", "outlet-1", expect.any(String), "check-1", [expect.objectContaining({ source_type: "stock_check", source_stock_check_id: "check-1", supplier_id: "supplier-1", lines: [expect.objectContaining({ item_id: "item-1", source_stock_check_item_id: "count-1", requested_qty: 3 })] })]]);
    expect(api.createInventoryStockCheckOrders.mock.calls[0][4][0].po_no).toMatch(/^PO-[A-F0-9]{12}$/);
  });

  it("keeps the completed scheduled check visible and opens its exact gateway suggestion", async () => {
    api.saveInventoryStockCheck.mockResolvedValue({ check: { id: "check-1" } });
    api.inventoryPurchaseOrders.mockResolvedValue({ ...orders, suggestions: [{ stock_check_id: "check-1", shortages: [{ stock_check_item_id: "count-1", shortage_qty: 3, unit: "kg", suppliers: [{ id: "supplier-1", name: "Supplier A" }] }] }] });
    const onReviewSuggestions = vi.fn();
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true, can_manage_purchase_orders: true }} onBack={() => {}} onReviewSuggestions={onReviewSuggestions} />);
    fireEvent.click(await screen.findByRole("button", { name: /Opening/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Rice.*Actual count/ }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    fireEvent.click(screen.getByRole("button", { name: "Complete Check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review Purchase Suggestions" }));
    expect(onReviewSuggestions).toHaveBeenCalledWith("check-1");
    expect(api.inventoryPurchaseOrders).toHaveBeenCalledWith("token", "outlet-1");
  });

  it("shows a successful completed check without forcing PO creation when the gateway returns no suggestions", async () => {
    api.inventoryStockChecks.mockImplementation(async (_token, _outlet, id) => id ? { ...stock, detail: { id, type: "scheduled", status: "submitted", check_name: "Opening", items: [{ item_id: "item-1", item_name: "Rice", actual_count_quantity: 10, par_level_quantity: 10, unit: "kg" }] } } : stock);
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true, can_manage_purchase_orders: true }} initialTarget={{ id: "check-1" }} onBack={() => {}} />);
    expect(await screen.findByText("No purchase suggestions for this check.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Review Purchase Suggestions" })).toBeNull();
  });

  it("does not offer purchasing after an ineligible Audit, even with a shortage", async () => {
    api.inventoryStockChecks.mockImplementation(async (_token, _outlet, id) => id ? { ...stock, detail: { id, type: "audit", status: "submitted", audit_name: "QA Audit", items: [{ item_id: "item-1", item_name: "Rice", actual_count_quantity: 7, par_level_quantity: 10, unit: "kg" }] } } : stock);
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_create_audit_stock_check: true, can_manage_purchase_orders: true }} initialTarget={{ id: "audit-1" }} onBack={() => {}} />);
    expect(await screen.findByText("Completed counts cannot be edited.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Review Purchase Suggestions" })).toBeNull();
    expect(api.inventoryPurchaseOrders).not.toHaveBeenCalled();
  });

  it("shows canonical imagery, count evidence and related PO state in a completed result", async () => {
    api.inventoryMobileCatalog.mockResolvedValue({ ...catalog, items: [{ ...catalog.items[0], photo_url: "https://example.test/rice.jpg" }] });
    api.inventoryStockChecks.mockImplementation(async (_token, _outlet, id) => id ? { ...stock, detail: { id, type: "scheduled", status: "submitted", check_name: "Opening", submitted_at: "2026-09-24T08:30:00Z", items: [{ item_id: "item-1", item_name: "Rice", sku_code: "RICE", actual_count_quantity: 7, par_level_quantity: 10, unit: "kg" }] } } : stock);
    api.inventoryPurchaseOrders.mockResolvedValue({ ...orders, orders: [{ id: "po-1", po_no: "PO-1", source_stock_check_id: "check-1", status: "submitted" }] });
    const onOpenPurchaseOrder = vi.fn();
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true, can_manage_purchase_orders: true }} initialTarget={{ id: "check-1" }} onBack={() => {}} onOpenPurchaseOrder={onOpenPurchaseOrder} />);
    expect(await screen.findByText(/Items 1 · Counted 1 · Variances 1 · Skipped 0/)).not.toBeNull();
    expect(screen.getByText("Variance -3")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View Rice image" }));
    expect(screen.getByRole("dialog", { name: "Rice" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: /PO-1.*Submitted/ }));
    expect(onOpenPurchaseOrder).toHaveBeenCalledWith("po-1");
    expect(screen.queryByRole("button", { name: "Complete Check" })).toBeNull();
  });

  it("opens an existing source PO instead of creating another when deep-linked after conversion", async () => {
    api.inventoryPurchaseOrders.mockImplementation(async (_token, _outlet, id) => id ? { ...orders, detail: poDetail } : { ...orders, suggestions: [], orders: [{ ...orders.orders[0], id: "po-1", source_stock_check_id: "check-1", supplier_id: "supplier-1" }] });
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} initialTarget={{ stock_check_id: "check-1" }} onBack={() => {}} />);
    expect(await screen.findByRole("button", { name: "Copy Text" })).not.toBeNull();
    expect(api.createInventoryStockCheckOrders).not.toHaveBeenCalled();
  });

  it("creates one draft per selected supplier with exact source lines and adjusted quantities", async () => {
    const suggestions = [{ stock_check_id: "check-1", check_name: "Opening", shortages: [
      { stock_check_item_id: "count-1", item_id: "item-1", item_name: "Rice", current_qty: 7, par_qty: 10, shortage_qty: 3, unit: "kg", suppliers: [{ id: "supplier-1", name: "Supplier A" }] },
      { stock_check_item_id: "count-2", item_id: "item-2", item_name: "Flour", current_qty: 2, par_qty: 5, shortage_qty: 3, unit: "kg", suppliers: [{ id: "supplier-2", name: "Supplier B" }] },
    ] }];
    api.inventoryPurchaseOrders.mockResolvedValue({ ...orders, suggestions });
    api.createInventoryStockCheckOrders.mockResolvedValue([{ order: { id: "po-a" } }, { order: { id: "po-b" } }]);
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} initialTarget={{ stock_check_id: "check-1" }} onBack={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Supplier A" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Supplier B" })).not.toBeNull();
    fireEvent.change(screen.getAllByRole("spinbutton", { name: "Order Qty" })[0], { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Create 2 Draft POs" }));
    await waitFor(() => expect(api.createInventoryStockCheckOrders).toHaveBeenCalledTimes(1));
    const created = api.createInventoryStockCheckOrders.mock.calls[0][4];
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ supplier_id: "supplier-1", status: "draft", lines: [{ source_stock_check_item_id: "count-1", requested_qty: 4 }] });
    expect(created[1]).toMatchObject({ supplier_id: "supplier-2", status: "draft", lines: [{ source_stock_check_item_id: "count-2", requested_qty: 3 }] });
  });

  it("excludes unchecked shortages and keeps retry identity stable after a failed source command", async () => {
    api.inventoryPurchaseOrders.mockResolvedValue({ ...orders, suggestions: [{ stock_check_id: "check-1", check_name: "Opening", shortages: [
      { stock_check_item_id: "count-1", item_id: "item-1", item_name: "Rice", current_qty: 7, par_qty: 10, shortage_qty: 3, unit: "kg", suppliers: [{ id: "supplier-1", name: "Supplier A" }] },
      { stock_check_item_id: "count-2", item_id: "item-2", item_name: "Flour", current_qty: 2, par_qty: 5, shortage_qty: 3, unit: "kg", suppliers: [{ id: "supplier-1", name: "Supplier A" }] },
    ] }] });
    api.createInventoryStockCheckOrders.mockRejectedValueOnce(new Error("Temporary network failure")).mockResolvedValueOnce([{ order: { id: "po-a" } }]);
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} initialTarget={{ stock_check_id: "check-1" }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Flour" }));
    fireEvent.click(screen.getByRole("button", { name: "Create 1 Draft PO" }));
    expect(await screen.findByText("Temporary network failure")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create 1 Draft PO" }));
    await waitFor(() => expect(api.createInventoryStockCheckOrders).toHaveBeenCalledTimes(2));
    expect(api.createInventoryStockCheckOrders.mock.calls[0][2]).toBe(api.createInventoryStockCheckOrders.mock.calls[1][2]);
    expect(api.createInventoryStockCheckOrders.mock.calls[0][4]).toEqual(api.createInventoryStockCheckOrders.mock.calls[1][4]);
    expect(api.createInventoryStockCheckOrders.mock.calls[0][4][0].lines).toHaveLength(1);
  });

  it("keeps a new PO reference and request identity stable across a failed-save retry", async () => {
    api.saveInventoryPurchaseOrder.mockRejectedValueOnce(new Error("Temporary network failure")).mockResolvedValueOnce({ order: { id: "created-po" } });
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create PO" }));
    fireEvent.click(screen.getByRole("button", { name: /Manual PO/ }));
    fireEvent.click(screen.getByRole("button", { name: "Supplier" }));
    fireEvent.click(screen.getByRole("option", { name: "Supplier A" }));
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.click(screen.getByRole("button", { name: /Rice/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(await screen.findByText("Temporary network failure")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.saveInventoryPurchaseOrder).toHaveBeenCalledTimes(2));
    expect(api.saveInventoryPurchaseOrder.mock.calls[0][2]).toBe(api.saveInventoryPurchaseOrder.mock.calls[1][2]);
    expect(api.saveInventoryPurchaseOrder.mock.calls[0][3].po_no).toMatch(/^PO-[A-F0-9]{12}$/);
    expect(api.saveInventoryPurchaseOrder.mock.calls[0][3].po_no).toBe(api.saveInventoryPurchaseOrder.mock.calls[1][3].po_no);
  });

  it("shows a stable reference for legacy null-number orders and uses it in Copy Text", async () => {
    const id = "f8a11540-3337-4b95-9426-b3d70a607555";
    api.inventoryPurchaseOrders.mockImplementation(async (_token, _outlet, selectedId) => selectedId ? { ...orders, detail: { ...poDetail, id, po_no: null } } : { ...orders, orders: [{ id, po_no: null, supplier_name: "Supplier A", line_count: 1, status: "supplier_confirmed" }] });
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /PO-F8A115403337.*Supplier A/s }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy Text" }));
    expect((await screen.findByRole("textbox")).value).toContain("PO No.: PO-F8A115403337");
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

  it("reopens only an unconfirmed Submitted PO through the trusted transition, then edits the same identity", async () => {
    const submitted = { ...poDetail, status: "submitted", received_at: null, receipts: [], lines: [{ ...poDetail.lines[0], received_qty: 0, remaining_qty: 10 }] };
    api.inventoryPurchaseOrders.mockImplementation(async (_token, _outlet, id) => id ? { ...orders, detail: api.transitionInventoryPurchaseOrder.mock.calls.length ? { ...submitted, status: "draft" } : submitted } : orders);
    api.transitionInventoryPurchaseOrder.mockResolvedValue({ order: { ...submitted, status: "draft" } });
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /PO-1.*Supplier A/s }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit Order" }));
    expect(screen.getByText(/Send the updated order to the supplier again/)).not.toBeNull();
    fireEvent.click(screen.getByRole("dialog", { name: "Edit this purchase order?" }).querySelector(".crew-mobile-primary"));
    await waitFor(() => expect(api.transitionInventoryPurchaseOrder).toHaveBeenCalledWith("token", "outlet-1", "po-1", expect.any(String), "reopen_draft"));
    expect(await screen.findByRole("button", { name: "Save Draft" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Edit Draft" })).not.toBeNull();
  });

  it("saves and resubmits the same corrected PO, then Copy Text reflects the new quantity", async () => {
    let status = "submitted"; let quantity = 10;
    api.inventoryPurchaseOrders.mockImplementation(async (_token, _outlet, id) => id ? { ...orders, detail: { ...poDetail, status, lines: [{ ...poDetail.lines[0], requested_qty: quantity, received_qty: 0, remaining_qty: quantity }] } } : { ...orders, orders: [{ ...orders.orders[0], status }] });
    api.transitionInventoryPurchaseOrder.mockImplementation(async (_token, _outlet, _id, _requestId, action) => { status = action === "reopen_draft" ? "draft" : "submitted"; return { order: { id: "po-1", status } }; });
    api.saveInventoryPurchaseOrder.mockImplementation(async (_token, _outlet, _requestId, order, items) => { quantity = items[0].requested_qty; return { order: { id: order.id } }; });
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /PO-1.*Supplier A/s }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit Order" }));
    fireEvent.click(screen.getByRole("dialog", { name: "Edit this purchase order?" }).querySelector(".crew-mobile-primary"));
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Requested quantity" }), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.saveInventoryPurchaseOrder).toHaveBeenCalledWith("token", "outlet-1", expect.any(String), expect.objectContaining({ id: "po-1" }), [expect.objectContaining({ requested_qty: 12 })]));
    fireEvent.click(await screen.findByRole("button", { name: "Submit PO" }));
    await waitFor(() => expect(api.transitionInventoryPurchaseOrder.mock.calls.map((call) => call[4])).toEqual(["reopen_draft", "submit"]));
    fireEvent.click(await screen.findByRole("button", { name: "Copy Text" }));
    expect((await screen.findByRole("textbox")).value).toContain("12 kg");
  });
});
