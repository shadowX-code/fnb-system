import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CrewStockCheckMobile from "../CrewStockCheckMobile.jsx";
import CrewPurchaseOrdersMobile from "../CrewPurchaseOrdersMobile.jsx";
import { CrewInventoryHomeAttention, hasCrewInventoryAccess, orderHomeRows, stockHomeRows } from "../CrewInventoryOperationsMobile.jsx";
import "../../../../i18n/index.js";

const api = vi.hoisted(() => ({ inventoryAttention: vi.fn(), inventoryStockChecks: vi.fn(), inventoryStockCheckHistory: vi.fn(), inventoryPurchaseOrders: vi.fn(), inventoryPurchaseOrderHistory: vi.fn(), inventoryPurchaseOrdersForCheck: vi.fn(), inventoryMobileCatalog: vi.fn(), saveInventoryStockCheck: vi.fn(), skipInventoryStockCheck: vi.fn(), deleteInventoryAuditDraft: vi.fn(), saveInventoryPurchaseOrder: vi.fn(), createInventoryStockCheckOrders: vi.fn(), transitionInventoryPurchaseOrder: vi.fn(), receiveInventoryPurchaseOrder: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: api }));

const catalog = { outlet_id: "outlet-1", outlet_name: "Test Outlet", business_date: "2026-09-24", categories: [{ id: "cat-1", name: "Dry Goods" }], items: [{ id: "item-1", name: "Rice", sku: "RICE", category_id: "cat-1", unit: "kg", par_level: 10, supplier_ids: ["supplier-1"] }], suppliers: [{ id: "supplier-1", name: "Supplier A" }] };
const stock = { business_date: "2026-09-24", can_perform_stock_check: true, can_create_audit_stock_check: false, due: [{ group_id: "group-1", name: "Opening", shift: "Morning", status: "due", items: [{ item_id: "item-1", item_name: "Rice", category_id: "cat-1", par_level_quantity: 10, unit: "kg" }] }], checks: [] };
const poDetail = { id: "po-1", po_no: "PO-1", business_po_no: "FC-260924-01", supplier_id: "supplier-1", supplier_name: "Supplier A", status: "supplier_confirmed", created_at: "2026-09-24T00:00:00Z", lines: [{ id: "line-1", item_id: "item-1", item_name: "Rice", requested_qty: 10, received_qty: 3, remaining_qty: 7, unit: "kg" }], receipts: [] };

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.inventoryMobileCatalog.mockResolvedValue(catalog);
  api.inventoryAttention.mockResolvedValue({ stock_checks_due_today: 1, purchase_orders_awaiting_confirmation: 0, purchase_orders_awaiting_receiving: 1 });
  api.inventoryStockChecks.mockResolvedValue(stock);
  api.inventoryStockCheckHistory.mockResolvedValue({ rows: [], has_more: false });
  api.inventoryPurchaseOrderHistory.mockResolvedValue({ rows: [], has_more: false });
  api.inventoryPurchaseOrdersForCheck.mockResolvedValue([]);
  api.inventoryPurchaseOrders.mockImplementation(async (_token, _outlet, id) => id ? { ...orders, detail: poDetail } : orders);
});
afterEach(cleanup);
const orders = { can_manage_purchase_orders: true, can_receive_purchase_orders: true, orders: [{ id: "po-1", po_no: "PO-1", business_po_no: "FC-260924-01", supplier_name: "Supplier A", line_count: 1, status: "supplier_confirmed" }], suggestions: [] };

describe("Crew purchase order business identity", () => {
  it("uses the server-owned PO number in lists and hides creation on History", async () => {
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} onBack={() => {}} />);
    expect(await screen.findByText(/FC-260924-01/)).not.toBeNull();
    expect(screen.queryByText("PO-1")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.queryByRole("button", { name: "Create PO" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Drafts" }));
    expect(screen.getByRole("button", { name: "Create PO" })).not.toBeNull();
  });
});

describe("Crew Inventory mobile authority boundary", () => {
  it("shows direct Home modules with canonical attention and opens the priority check", async () => {
    const onOpenCheck = vi.fn();
    render(<CrewInventoryHomeAttention token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true, can_receive_purchase_orders: true }} onOpenStock={vi.fn()} onOpenOrders={vi.fn()} onOpenCheck={onOpenCheck} onOpenOrder={vi.fn()} />);
    expect(await screen.findByText("1 check due today")).not.toBeNull();
    expect(screen.getByText("1 order needs attention")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start: Opening" }));
    expect(onOpenCheck).toHaveBeenCalledWith(expect.objectContaining(stock.due[0]));
  });

  it("uses action-oriented all-clear copy rather than zero KPI pills", async () => {
    api.inventoryAttention.mockResolvedValue({ stock_checks_due_today: 0, purchase_orders_awaiting_confirmation: 0, purchase_orders_awaiting_receiving: 0 });
    api.inventoryStockChecks.mockResolvedValue({ ...stock, due: [], checks: [] });
    api.inventoryPurchaseOrders.mockResolvedValue({ ...orders, orders: [] });
    render(<CrewInventoryHomeAttention token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true, can_receive_purchase_orders: true }} onOpenStock={vi.fn()} onOpenOrders={vi.fn()} onOpenCheck={vi.fn()} onOpenOrder={vi.fn()} />);
    expect(await screen.findByText("All clear today · No checks due")).not.toBeNull();
    expect(screen.getByText("No orders need attention")).not.toBeNull();
  });

  it("shows only current scheduled runs and Audit drafts on Home", async () => {
    api.inventoryStockChecks.mockResolvedValue({ ...stock, can_create_audit_stock_check: true,
      checks: [{ id: "draft-1", type: "scheduled", status: "missed", name: "Yesterday Opening", check_date: "2026-09-23", item_count: 1 }, { id: "audit-1", type: "audit", status: "draft", name: "Audit Draft", item_count: 1 }],
      due: [...stock.due, { ...stock.due[0], group_id: "group-2", name: "Closing" }] });
    const onOpenCheck = vi.fn(); const onOpenStock = vi.fn();
    render(<CrewInventoryHomeAttention token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true, can_create_audit_stock_check: true }} onOpenStock={onOpenStock} onOpenOrders={vi.fn()} onOpenCheck={onOpenCheck} onOpenOrder={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume: Audit Draft" }));
    expect(onOpenCheck).toHaveBeenCalledWith(expect.objectContaining({ id: "audit-1" }));
    expect(screen.queryByText("Yesterday Opening")).toBeNull();
    expect(screen.getByText("Opening")).not.toBeNull();
    expect(screen.getByText("Closing")).not.toBeNull();
    expect(screen.queryByText(/more checks/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stock Check" }));
    expect(onOpenStock).toHaveBeenCalled();
  });

  it("shows a current scheduled draft as In Progress with one Resume action on Home", async () => {
    api.inventoryStockChecks.mockResolvedValue({ ...stock, due: [{ ...stock.due[0], status: "in_progress", check_id: "check-1" }],
      checks: [{ id: "check-1", type: "scheduled", status: "in_progress", name: "Opening", check_date: "2026-09-24" }] });
    const onOpenCheck = vi.fn();
    render(<CrewInventoryHomeAttention token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true }} onOpenStock={vi.fn()} onOpenOrders={vi.fn()} onOpenCheck={onOpenCheck} onOpenOrder={vi.fn()} />);
    expect(await screen.findByText("1 check in progress")).not.toBeNull();
    expect(screen.getByText("In Progress").classList.contains("crew-ui-status")).toBe(true);
    expect(screen.getByText("Morning · 1 item")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume: Opening" }));
    expect(onOpenCheck).toHaveBeenCalledWith(expect.objectContaining({ check_id: "check-1", status: "in_progress" }));
    expect(screen.getAllByRole("button", { name: "Resume: Opening" })).toHaveLength(1);
  });

  it("orders Due, In Progress and Audit drafts without Missed or terminal checks", () => {
    const rows = stockHomeRows({ business_date: "2026-09-24", can_perform_stock_check: true, can_create_audit_stock_check: true,
      checks: [
        { id: "recent-draft", type: "audit", status: "draft", check_date: "2026-09-22" },
        { id: "old-draft", type: "scheduled", status: "missed", check_date: "2026-09-22" },
        { id: "completed", type: "scheduled", status: "completed", check_date: "2026-09-24" },
      ],
      due: [{ group_id: "due", status: "due" }, { group_id: "progress", status: "in_progress" }, { group_id: "done", status: "completed" }, { group_id: "skip", status: "skipped" }],
    });
    expect(rows.map((row) => row.id || row.group_id)).toEqual(["due", "progress", "recent-draft"]);
  });

  it("shows every actionable PO but never a PO number, completed order, or unauthorized action", async () => {
    api.inventoryPurchaseOrders.mockResolvedValue({ ...orders, orders: [
      { id: "draft", business_po_no: "FC-260924-02", supplier_name: "First Supplier", category_names: ["Vegetables", "Dry Goods", "Beverages"], line_count: 2, status: "draft" },
      { id: "submitted", business_po_no: "FC-260924-03", supplier_name: "Second Supplier", line_count: 1, status: "submitted" },
      { id: "receiving", business_po_no: "FC-260924-04", supplier_name: "Third Supplier", line_count: 3, status: "partial_received" },
      { id: "done", business_po_no: "FC-260924-05", supplier_name: "Hidden Supplier", status: "completed" },
    ] });
    const onOpenOrder = vi.fn();
    render(<CrewInventoryHomeAttention token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true, can_receive_purchase_orders: true }} onOpenStock={vi.fn()} onOpenOrders={vi.fn()} onOpenCheck={vi.fn()} onOpenOrder={onOpenOrder} />);
    expect(await screen.findByText("3 orders need attention")).not.toBeNull();
    expect(screen.getByText("First Supplier")).not.toBeNull();
    expect(screen.getByText("Vegetables +2")).not.toBeNull();
    expect(screen.getByText("Draft").classList.contains("crew-ui-status")).toBe(true);
    expect(screen.getByText("Awaiting Confirm")).not.toBeNull();
    expect(screen.getByText("Partially Received")).not.toBeNull();
    expect(screen.getByText("Second Supplier")).not.toBeNull();
    expect(screen.getByText("Third Supplier")).not.toBeNull();
    expect(screen.queryByText("Hidden Supplier")).toBeNull();
    expect(screen.queryByText(/FC-260924/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Receive: Third Supplier" }));
    expect(onOpenOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "receiving" }));
    expect(orderHomeRows({ ...orders, can_manage_purchase_orders: false, orders: [{ id: "draft", status: "draft" }, { id: "receiving", status: "supplier_confirmed" }] }).map((row) => row.id)).toEqual(["receiving"]);
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
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Rice.*Actual count/ }), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.saveInventoryStockCheck).toHaveBeenCalledTimes(1));
    const [token, outletId, requestId, check, lines] = api.saveInventoryStockCheck.mock.calls[0];
    expect([token, outletId, check.outlet_id, check.group_id, check.status]).toEqual(["token", "outlet-1", "outlet-1", "group-1", "draft"]);
    expect(requestId).toBeTruthy();
    expect(lines[0]).toMatchObject({ item_id: "item-1", actual_count_quantity: 8, variance: -2 });
    expect(await screen.findByText("Draft saved")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Start" })).not.toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /Rice.*Actual count/ })).toBeNull();
  });

  it("offers Save & Leave, Keep Counting and Discard Changes for an unsaved count", async () => {
    api.saveInventoryStockCheck.mockResolvedValue({ check: { id: "check-1" } });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Rice.*Actual count/ }), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & Leave" }));
    expect(await screen.findAllByText("Temporary failure")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save & Leave" }));
    await waitFor(() => expect(api.saveInventoryStockCheck).toHaveBeenCalledTimes(2));
    expect(api.saveInventoryStockCheck.mock.calls[0][2]).toBe(api.saveInventoryStockCheck.mock.calls[1][2]);
  });

  it("shows an expired scheduled draft only as read-only Missed history", async () => {
    api.inventoryStockChecks.mockImplementation(async (_token, _outlet, id) => id ? { ...stock, detail: { id, type: "scheduled", status: "missed", check_name: "Yesterday Opening", check_date: "2026-09-23", items: [] } } : {
      ...stock, due: [], checks: [{ id: "old-draft", type: "scheduled", status: "missed", name: "Yesterday Opening", check_date: "2026-09-23", item_count: 1 }]
    });
    api.inventoryStockCheckHistory.mockResolvedValue({ rows: [{ id: "old-draft", type: "scheduled", status: "missed", name: "Yesterday Opening", check_date: "2026-09-23", item_count: 1 }], has_more: false });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true }} onBack={() => {}} />);
    expect(await screen.findByText("No checks due today")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /Yesterday Opening/ }));
    await waitFor(() => expect(api.inventoryStockChecks).toHaveBeenCalledWith("token", "outlet-1", "old-draft"));
    expect(await screen.findByText(/Counting is closed/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Save Draft" })).toBeNull();
  });

  it("skips only a Due occurrence with confirmation and shows its evidence in History", async () => {
    api.skipInventoryStockCheck.mockResolvedValue({ id: "skipped-1", status: "skipped" });
    api.inventoryStockChecks.mockResolvedValueOnce(stock).mockResolvedValueOnce({ ...stock, due: [], checks: [{ id: "skipped-1", type: "scheduled", status: "skipped", name: "Opening", check_date: "2026-09-24" }] });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(screen.getByRole("dialog", { name: "Skip this stock check?" })).not.toBeNull();
    expect(screen.getByText(/reviewed today’s requirement/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reason (optional)" }));
    fireEvent.click(screen.getByRole("option", { name: "Stock level sufficient" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip Check" }));
    await waitFor(() => expect(api.skipInventoryStockCheck).toHaveBeenCalledWith("token", "outlet-1", expect.any(String), "group-1", "stock_sufficient"));
    expect(await screen.findByText("Stock Check skipped")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
    expect(api.inventoryStockCheckHistory).toHaveBeenCalled();
  });

  it("reuses Skip request identity after an uncertain failure", async () => {
    api.skipInventoryStockCheck.mockRejectedValueOnce(new Error("Temporary failure")).mockResolvedValueOnce({ id: "skipped-1", status: "skipped" });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip Check" }));
    expect(await screen.findAllByText("Temporary failure")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Skip Check" }));
    await waitFor(() => expect(api.skipInventoryStockCheck).toHaveBeenCalledTimes(2));
    expect(api.skipInventoryStockCheck.mock.calls[0][2]).toBe(api.skipInventoryStockCheck.mock.calls[1][2]);
  });

  it("includes completed Audits in History without purchase suggestions", async () => {
    api.inventoryStockChecks.mockImplementation(async (_token, _outlet, id) => id ? { ...stock, detail: { id, type: "audit", status: "completed", audit_name: "Month-End Audit", audit_type: "Month-End Closing", check_date: "2026-05-30", items: [{ item_id: "item-1", item_name: "Rice", actual_count_quantity: 7, par_level_quantity: 10, unit: "kg" }] } } : {
      ...stock, due: [], checks: [{ id: "audit-1", type: "audit", status: "completed", name: "Month-End Audit", audit_type: "Month-End Closing", check_date: "2026-05-30", item_count: 1 }]
    });
    api.inventoryStockCheckHistory.mockResolvedValue({ rows: [{ id: "audit-1", type: "audit", status: "completed", name: "Month-End Audit", audit_type: "Month-End Closing", check_date: "2026-05-30", item_count: 1 }], has_more: false });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_create_audit_stock_check: true, can_manage_purchase_orders: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: "View: Month-End Closing · 30 May 2026" }));
    expect(await screen.findByText("Completed counts cannot be edited.")).not.toBeNull();
    expect(api.inventoryPurchaseOrders).not.toHaveBeenCalled();
  });

  it("starts an Audit on the server, retries the same start, and resumes its original timestamp", async () => {
    const started = "2026-09-24T00:00:00Z";
    api.inventoryStockChecks.mockImplementation(async (_token, _outlet, id) => id ? { ...stock, detail: {
      id, type: "audit", status: "draft", audit_name: "Weekly Audit", audit_type: "Spot Check", check_date: "2026-09-24", created_at: started,
      items: [{ item_id: "item-1", item_name: "Rice", category_id: "cat-1", par_level_quantity: 10, actual_count_quantity: 7, unit: "kg" }],
    } } : { ...stock, can_create_audit_stock_check: true, checks: [{ id: "audit-1", type: "audit", status: "draft", name: "Weekly Audit", audit_type: "Spot Check", check_date: "2026-09-24", item_count: 1 }] });
    api.saveInventoryStockCheck.mockRejectedValueOnce(new Error("Lost response")).mockResolvedValue({ check: {
      id: "audit-1", stock_check_type: "audit", audit_type: "Spot Check", status: "draft",
      audit_name: "Spot Check · 24 Sep 2026", check_date: "2026-09-24", created_at: started,
    } });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_create_audit_stock_check: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Audit" }));
    fireEvent.click(screen.getByRole("button", { name: "Audit" }));
    expect(screen.queryByRole("textbox", { name: /audit name/i })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Dry Goods" }));
    expect(screen.queryByRole("button", { name: "Check date" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Lost response");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("24 Sept 2026 · 8:00 AM")).toBeTruthy();
    expect(api.saveInventoryStockCheck.mock.calls[0][2]).toBe(api.saveInventoryStockCheck.mock.calls[1][2]);
    const startPayload = api.saveInventoryStockCheck.mock.calls[0][3];
    expect(startPayload).toMatchObject({ stock_check_type: "audit", status: "draft", outlet_id: "outlet-1" });
    expect(startPayload).not.toHaveProperty("check_date");
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.saveInventoryStockCheck).toHaveBeenCalledTimes(3));
    expect(api.saveInventoryStockCheck.mock.calls[2][3]).not.toHaveProperty("created_at");
    fireEvent.click(await screen.findByRole("button", { name: "Continue: Spot Check · 24 Sept 2026" }));
    expect(await screen.findByText("24 Sept 2026 · 8:00 AM")).toBeTruthy();
    expect((await screen.findByRole("spinbutton", { name: /Rice.*Actual count/ })).value).toBe("7");
    expect(api.inventoryPurchaseOrders).not.toHaveBeenCalled();
  });

  it("confirms a Month-End Closing with explicit zero only after the server reports submission", async () => {
    api.inventoryStockChecks.mockResolvedValue({ ...stock, can_create_audit_stock_check: true });
    const year = new Date().getFullYear();
    const draft = { id: "closing-audit", stock_check_type: "audit", audit_type: "Month-End Closing", status: "draft",
      accounting_month: `${year}-08-01`, audit_name: `Month-End Closing · Aug ${year} · 20 Nov ${year}`,
      check_date: `${year}-11-20`, created_at: `${year}-11-20T01:00:00Z` };
    const items = [{ item_id: "item-1", unit: "kg", actual_count_quantity: 0 }];
    api.inventoryMobileCatalog.mockResolvedValue({ ...catalog, items: [{ ...catalog.items[0], photo_url: "https://example.test/rice.jpg" }] });
    api.saveInventoryStockCheck.mockResolvedValueOnce({ check: draft })
      .mockRejectedValueOnce(new Error("Closing counts must include every active outlet item exactly once. Start a new audit if the outlet roster changed."))
      .mockResolvedValueOnce({ check: draft, items })
      .mockResolvedValueOnce({ check: { ...draft, status: "submitted", submitted_at: `${year}-11-20T02:00:00Z` }, items });
    const { container } = render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_create_audit_stock_check: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Audit" }));
    fireEvent.click(screen.getByRole("button", { name: "Audit" }));
    fireEvent.click(screen.getByRole("button", { name: /Audit type/i }));
    fireEvent.click(await screen.findByText("Month-End Closing"));
    const setup = within(screen.getByRole("dialog", { name: "Audit" }));
    expect(setup.queryByText("Stock Count Date & Time")).toBeNull();
    expect(setup.getByRole("button", { name: "Continue" }).disabled).toBe(true);
    expect(setup.getByRole("button", { name: "Closing Month" }).className).toBe(setup.getByRole("button", { name: "Audit type" }).className);
    fireEvent.click(setup.getByRole("button", { name: "Closing Month" }));
    const monthPicker = within(screen.getByRole("dialog", { name: "Closing Month" }));
    fireEvent.keyDown(monthPicker.getByRole("button", { name: "Aug" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Closing Month" })).toBeNull();
    fireEvent.click(setup.getByRole("button", { name: "Closing Month" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Closing Month" })).getByRole("button", { name: "Aug" }));
    fireEvent.click(setup.getByRole("button", { name: "Continue" }));
    const input = await screen.findByRole("spinbutton", { name: /Rice.*Actual count/ });
    expect(screen.getByRole("button", { name: "Closing Month" })).toBeTruthy();
    expect(screen.getByText("Count Started At (MYT)")).toBeTruthy();
    expect(input.value).toBe("");
    expect(screen.getByRole("button", { name: "Skip Item" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review (0/1)" }).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Review (1/1)" }));
    expect(screen.getByText("Closing Month")).toBeTruthy();
    expect(screen.getByText(`August ${year}`)).toBeTruthy();
    expect(container.querySelector(".crew-inventory-review img")?.getAttribute("src")).toBe("https://example.test/rice.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/Start a new audit if the outlet roster changed/)).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/Submission could not be confirmed/)).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.saveInventoryStockCheck).toHaveBeenLastCalledWith("token", "outlet-1", expect.any(String),
      expect.objectContaining({ status: "submitted", accounting_month: `${year}-08-01`,
        audit_name: expect.stringContaining(`Month-End Closing · Aug ${year} · `) }),
      [expect.objectContaining({ item_id: "item-1", actual_count_quantity: 0 })]));
    const payload = api.saveInventoryStockCheck.mock.lastCall[3];
    expect(payload).not.toHaveProperty("physical_count_cutoff");
    expect(payload).not.toHaveProperty("publish_closing");
    expect(await screen.findByText("Closing count submitted. An authorized Admin can now publish Closing Stock.")).toBeTruthy();
    expect(screen.getByText(`20 Nov ${year} · 10:00 AM`)).toBeTruthy();
  });

  it("saves closing skips with a reason and requires explicit counts after undo, even when filtered", async () => {
    const beans = { id: "item-2", name: "Beans", category_id: "cat-2", unit: "kg" };
    const closing = {
      id: "closing-audit", type: "audit", status: "draft", audit_type: "Month-End Closing",
      audit_name: "Closing QA", accounting_month: "2026-09-01", check_date: "2026-09-24",
    };
    let items = [stock.due[0].items[0], { item_id: beans.id, category_id: beans.category_id, unit: beans.unit, actual_count_quantity: 7 }];
    api.inventoryMobileCatalog.mockResolvedValue({
      ...catalog, categories: [...catalog.categories, { id: "cat-2", name: "Produce" }], items: [...catalog.items, beans],
    });
    api.inventoryStockChecks.mockImplementation(async (_token, _outlet, id) => ({
      ...stock, can_create_audit_stock_check: true, checks: [{ ...closing, name: closing.audit_name }],
      detail: id ? { ...closing, items } : null,
    }));
    api.saveInventoryStockCheck.mockImplementation(async (_token, _outlet, _request, payload, rows) => {
      items = rows;
      return { check: { ...closing, stock_check_type: "audit", status: payload.status }, items };
    });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_create_audit_stock_check: true }}
      initialTarget={{ id: closing.id }} onBack={() => {}} />);
    const rice = await screen.findByRole("spinbutton", { name: /Rice.*Actual count/ });
    fireEvent.click(within(rice.closest("article")).getByRole("button", { name: "Skip Item" }));
    const sheet = within(screen.getByRole("dialog", { name: "Skip Item" }));
    const confirm = sheet.getByRole("button", { name: "Skip Item" });
    expect(confirm.disabled).toBe(true);
    expect(sheet.queryByRole("textbox")).toBeNull();
    expect(sheet.getAllByRole("option").map(option => option.textContent)).toEqual([
      "Stock In Use", "Cannot Access", "Pending Verification", "Item Not Found", "Other",
    ]);
    fireEvent.click(sheet.getByRole("option", { name: "Stock In Use" }));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(sheet.getByRole("option", { name: "Other" }));
    expect(sheet.getAllByRole("option", { selected: true }).map(option => option.textContent)).toEqual(["Other"]);
    const reason = sheet.getByRole("textbox", { name: "Explanation (required)" });
    fireEvent.change(reason, { target: { value: "  " } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(reason, { target: { value: "  Storage locked  " } });
    fireEvent.click(confirm);
    expect(screen.getByText("1 Counted · 1 Skipped · 0 Remaining")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review (1/2)" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Skipped" }));
    fireEvent.click(screen.getByRole("button", { name: "Produce" }));
    expect(screen.queryByText("Other: Storage locked")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dry Goods" }));
    expect(screen.getByText("Other: Storage locked")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search items" }), { target: { value: "Beans" } });
    expect(screen.queryByText("Other: Storage locked")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.saveInventoryStockCheck).toHaveBeenCalledWith("token", "outlet-1", expect.any(String),
      expect.objectContaining({ status: "draft" }), [
        expect.objectContaining({ item_id: "item-1", skipped: true, skip_reason: "Other: Storage locked", actual_count_quantity: null }),
        expect.objectContaining({ item_id: "item-2", skipped: false, actual_count_quantity: 7 }),
      ]));
    fireEvent.click(await screen.findByRole("tab", { name: "Audit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue: September 2026 Closing" }));
    expect(await screen.findByText("Other: Storage locked")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo Skip" }));
    const resumed = screen.getByRole("spinbutton", { name: /Rice.*Actual count/ });
    expect(resumed.value).toBe("");
    expect(screen.getByText("1 Counted · 0 Skipped · 1 Remaining")).toBeTruthy();
    fireEvent.change(resumed, { target: { value: "0.0001" } });
    expect(screen.getByRole("button", { name: "Review (1/2)" }).disabled).toBe(true);
    fireEvent.change(resumed, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Dry Goods" }));
    fireEvent.click(screen.getByRole("button", { name: "Review (2/2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.saveInventoryStockCheck).toHaveBeenLastCalledWith("token", "outlet-1", expect.any(String),
      expect.objectContaining({ status: "submitted" }), [
        expect.objectContaining({ item_id: "item-1", skipped: false, skip_reason: null, actual_count_quantity: 0 }),
        expect.objectContaining({ item_id: "item-2", actual_count_quantity: 7 }),
      ]));
  });

  it("still lets scheduled checks submit a reasoned skip without counting it", async () => {
    api.saveInventoryStockCheck.mockResolvedValue({ check: { id: "scheduled-qa" } });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip Item" }));
    const sheet = within(screen.getByRole("dialog", { name: "Skip Item" }));
    fireEvent.click(sheet.getByRole("option", { name: "Stock In Use" }));
    expect(sheet.queryByRole("textbox")).toBeNull();
    fireEvent.click(sheet.getByRole("button", { name: "Skip Item" }));
    expect(screen.getByText("0 Counted · 1 Skipped · 0 Remaining")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review (0/1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete Check" }));
    await waitFor(() => expect(api.saveInventoryStockCheck).toHaveBeenCalledWith("token", "outlet-1", expect.any(String),
      expect.objectContaining({ status: "submitted" }), [expect.objectContaining({
        skipped: true, skip_reason: "Stock In Use", actual_count_quantity: null,
      })]));
    expect(api.skipInventoryStockCheck).not.toHaveBeenCalled();
  });

  it("keeps an existing closing draft's custom name and leaves its historical cutoff to the server", async () => {
    api.inventoryStockChecks.mockImplementation(async (_token, _outlet, id) => id ? { ...stock, detail: {
      id, type: "audit", status: "draft", audit_type: "Month-End Closing", audit_name: "Legacy closing name",
      check_name: "Legacy closing check", check_date: "2026-08-31", accounting_month: "2026-08-01",
      physical_count_cutoff: "2026-08-31T15:59:42Z", created_at: "2026-08-31T14:00:00Z",
      items: [{ item_id: "item-1", item_name: "Rice", actual_count_quantity: 0, unit: "kg" }],
    } } : { ...stock, can_create_audit_stock_check: true });
    api.saveInventoryStockCheck.mockResolvedValue({ check: { id: "closing-audit" } });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_create_audit_stock_check: true }}
      initialTarget={{ id: "closing-audit" }} onBack={() => {}} />);
    expect(await screen.findByText("31 Aug 2026 · 10:00 PM")).toBeTruthy();
    expect(screen.queryByText("23:59:42")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.saveInventoryStockCheck).toHaveBeenCalledWith("token", "outlet-1", expect.any(String),
      expect.objectContaining({ id: "closing-audit", audit_name: "Legacy closing name", check_name: "Legacy closing check",
        check_date: "2026-08-31" }), expect.any(Array)));
    expect(api.saveInventoryStockCheck.mock.calls[0][3]).not.toHaveProperty("physical_count_cutoff");
  });

  it("uses the recorded month or a concise type and date for both Audit and History cards", async () => {
    const draft = { id: "closing-draft", type: "audit", status: "draft", audit_type: "Month-End Closing",
      name: "Long stored draft name", check_date: "2026-11-02", item_count: 47 };
    const completed = { ...draft, id: "closing-result", status: "completed", name: "Long stored result name" };
    api.inventoryStockChecks.mockImplementation(async (_token, _outlet, id) => id
      ? { detail: { id, accounting_month: id === "closing-draft" ? "2026-11-01" : "2026-10-01" } }
      : { ...stock, can_create_audit_stock_check: true, checks: [draft] });
    api.inventoryStockCheckHistory.mockResolvedValue({ rows: [
      completed,
      { ...completed, id: "legacy-result", accounting_month: null, name: "Legacy imported name" },
      { ...completed, id: "control-result", audit_type: "Control Audit", name: "Stored control name" },
    ], has_more: false });
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_create_audit_stock_check: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Audit" }));
    const continueButton = await screen.findByRole("button", { name: "Continue: November 2026 Closing" });
    expect(within(continueButton).getByText("47 items")).toBeTruthy();
    expect(within(continueButton).getByText("Draft")).toBeTruthy();
    expect(screen.queryByText("Long stored draft name")).toBeNull();
    expect(api.inventoryStockChecks).toHaveBeenCalledWith("token", "outlet-1", "closing-draft");

    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const view = await screen.findByRole("button", { name: "View: October 2026 Closing" });
    expect(within(view).getByText("Completed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "View: Month-End Closing · 2 Nov 2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View: Control Audit · 2 Nov 2026" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /More actions:/ })).toBeNull();
    expect(api.inventoryStockChecks).not.toHaveBeenCalledWith("token", "outlet-1", "legacy-result");
    expect(api.saveInventoryStockCheck).not.toHaveBeenCalled();
  });

  it("deletes only an Audit draft through the trusted command", async () => {
    api.inventoryStockChecks.mockResolvedValue({ ...stock, can_create_audit_stock_check: true,
      checks: [{ id: "audit-1", type: "audit", status: "draft", name: "Weekly Audit", audit_type: "Spot Check", check_date: "2026-09-24", item_count: 1 }] });
    api.deleteInventoryAuditDraft.mockResolvedValue({});
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_create_audit_stock_check: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Audit" }));
    expect(screen.queryByRole("button", { name: "Delete Draft" })).toBeNull();
    const more = screen.getByRole("button", { name: /More actions: Spot Check/ });
    fireEvent.click(more);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Draft" }));
    const confirm = within(screen.getByRole("dialog", { name: "Delete Draft" }));
    expect(api.deleteInventoryAuditDraft).not.toHaveBeenCalled();
    fireEvent.click(confirm.getByRole("button", { name: "Cancel" }));
    expect(api.deleteInventoryAuditDraft).not.toHaveBeenCalled();
    fireEvent.click(more);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Draft" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete Draft" })).getByRole("button", { name: "Delete Draft" }));
    await waitFor(() => expect(api.deleteInventoryAuditDraft).toHaveBeenCalledWith("token", "outlet-1", "audit-1", expect.any(String)));
  });

  it("receives only requested remaining quantities with canonical line and item IDs", async () => {
    api.receiveInventoryPurchaseOrder.mockResolvedValue({ receipt_id: "receipt-1", status: "partial_received" });
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true, can_receive_purchase_orders: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Supplier A.*FC-260924-01/s }));
    fireEvent.click(await screen.findByRole("button", { name: "Receive PO" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Received now" }), { target: { value: "4" } });
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
    fireEvent.click(await screen.findByRole("button", { name: /Supplier A.*FC-260924-01/s }));
    fireEvent.click(await screen.findByRole("button", { name: "Receive PO" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Received now" }), { target: { value: "8" } });
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
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Rice.*Actual count/ }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    fireEvent.click(screen.getByRole("button", { name: "Complete Check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restock Items" }));
    expect(onReviewSuggestions).toHaveBeenCalledWith("check-1");
    expect(api.inventoryPurchaseOrders).toHaveBeenCalledWith("token", "outlet-1");
  });

  it("shows a successful completed check without forcing PO creation when the gateway returns no suggestions", async () => {
    api.inventoryStockChecks.mockImplementation(async (_token, _outlet, id) => id ? { ...stock, detail: { id, type: "scheduled", status: "completed", check_name: "Opening", items: [{ item_id: "item-1", item_name: "Rice", actual_count_quantity: 10, par_level_quantity: 10, unit: "kg" }] } } : stock);
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true, can_manage_purchase_orders: true }} initialTarget={{ id: "check-1" }} onBack={() => {}} />);
    expect(await screen.findByText("No purchase suggestions for this check.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Review Purchase Suggestions" })).toBeNull();
  });

  it("does not offer purchasing after an ineligible Audit, even with a shortage", async () => {
    api.inventoryStockChecks.mockImplementation(async (_token, _outlet, id) => id ? { ...stock, detail: { id, type: "audit", status: "completed", audit_name: "QA Audit", items: [{ item_id: "item-1", item_name: "Rice", actual_count_quantity: 7, par_level_quantity: 10, unit: "kg" }] } } : stock);
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_create_audit_stock_check: true, can_manage_purchase_orders: true }} initialTarget={{ id: "audit-1" }} onBack={() => {}} />);
    expect(await screen.findByText("Completed counts cannot be edited.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Review Purchase Suggestions" })).toBeNull();
    expect(api.inventoryPurchaseOrders).not.toHaveBeenCalled();
  });

  it("shows canonical imagery, count evidence and related PO state in a completed result", async () => {
    api.inventoryMobileCatalog.mockResolvedValue({ ...catalog, items: [{ ...catalog.items[0], photo_url: "https://example.test/rice.jpg" }] });
    api.inventoryStockChecks.mockImplementation(async (_token, _outlet, id) => id ? { ...stock, detail: { id, type: "scheduled", status: "completed", check_name: "Opening", submitted_at: "2026-09-24T08:30:00Z", items: [{ item_id: "item-1", item_name: "Rice", sku_code: "RICE", actual_count_quantity: 7, par_level_quantity: 10, unit: "kg" }] } } : stock);
    api.inventoryPurchaseOrders.mockResolvedValue({ ...orders, orders: [{ id: "po-1", po_no: "PO-1", business_po_no: "FC-260924-01", source_stock_check_id: "check-1", status: "submitted" }] });
    api.inventoryPurchaseOrdersForCheck.mockResolvedValue([{ id: "po-1", business_po_no: "FC-260924-01", status: "submitted" }]);
    const onOpenPurchaseOrder = vi.fn();
    render(<CrewStockCheckMobile token="token" outletId="outlet-1" grants={{ can_perform_stock_check: true, can_manage_purchase_orders: true }} initialTarget={{ id: "check-1" }} onBack={() => {}} onOpenPurchaseOrder={onOpenPurchaseOrder} />);
    expect(await screen.findByText(/Items 1 · Counted 1 · Variances 1 · Skipped 0/)).not.toBeNull();
    expect(screen.getByText("Variance -3")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View Rice image" }));
    expect(screen.getByRole("dialog", { name: "Rice" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: /FC-260924-01.*Submitted/ }));
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

  it("uses the persisted business PO number for a legacy null technical number and Copy Text", async () => {
    const id = "f8a11540-3337-4b95-9426-b3d70a607555";
    api.inventoryPurchaseOrders.mockImplementation(async (_token, _outlet, selectedId) => selectedId ? { ...orders, detail: { ...poDetail, id, po_no: null, business_po_no: "FC-260924-004" } } : { ...orders, orders: [{ id, po_no: null, business_po_no: "FC-260924-004", supplier_name: "Supplier A", line_count: 1, status: "supplier_confirmed" }] });
    render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Supplier A.*FC-260924-004/s }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy Text" }));
    expect((await screen.findByRole("textbox")).value).toContain("PO No.: FC-260924-004");
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
    fireEvent.click(await screen.findByRole("button", { name: /Supplier A.*FC-260924-01/s }));
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
    fireEvent.click(await screen.findByRole("button", { name: /Supplier A.*FC-260924-01/s }));
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

it("scopes Add Item and search to the supplier and confirms removal on switch", async () => {
  api.inventoryMobileCatalog.mockResolvedValue({
    ...catalog,
    items: [...catalog.items,
      { id: "oil", name: "Oil", sku: "SHARED", unit: "L", supplier_ids: ["supplier-1", "supplier-2"] },
      { id: "salt", name: "Salt", sku: "SALT", unit: "kg", supplier_ids: ["supplier-2"] }],
    suppliers: [...catalog.suppliers, { id: "supplier-2", name: "Supplier B" }, { id: "supplier-3", name: "Empty Supplier" }],
  });
  render(<CrewPurchaseOrdersMobile token="token" outletId="outlet-1" grants={{ can_manage_purchase_orders: true }} onBack={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Create PO" }));
  fireEvent.click(screen.getByRole("button", { name: /Manual PO/ }));
  const add = () => screen.getByRole("button", { name: "Add item", exact: true });
  const choose = (name) => {
    fireEvent.click(screen.getByRole("button", { name: "Supplier" }));
    fireEvent.click(screen.getByRole("option", { name }));
  };
  expect(add().disabled).toBe(true);
  choose("Supplier A");
  fireEvent.click(add());
  const search = screen.getByPlaceholderText("Search items");
  fireEvent.change(search, { target: { value: "SALT" } });
  expect(screen.queryByRole("button", { name: /Salt/ })).toBeNull();
  expect(screen.getAllByText("No items found").length).toBeGreaterThan(0);
  fireEvent.change(search, { target: { value: "RICE" } });
  fireEvent.click(screen.getByRole("button", { name: /Rice/ }));
  fireEvent.click(add());
  fireEvent.change(screen.getByPlaceholderText("Search items"), { target: { value: "SHARED" } });
  fireEvent.click(screen.getByRole("button", { name: /Oil/ }));
  choose("Supplier B");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Rice")).not.toBeNull();
  choose("Supplier B");
  fireEvent.click(screen.getByRole("button", { name: "Change supplier" }));
  expect(screen.queryByText("Rice")).toBeNull();
  expect(screen.getByText("Oil")).not.toBeNull();
  choose("Empty Supplier");
  fireEvent.click(screen.getByRole("button", { name: "Change supplier" }));
  fireEvent.click(add());
  expect(screen.getAllByText("No active items are linked to this supplier.").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /Salt|Oil|Rice/ })).toBeNull();
});
