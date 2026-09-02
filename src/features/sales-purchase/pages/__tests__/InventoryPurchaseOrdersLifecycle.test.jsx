import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ tables: {}, operations: [], notifications: [], rpcResponses: {}, singleResponses: {}, tableErrors: {}, deferredTables: {}, from: vi.fn(), rpc: vi.fn() }));

vi.mock("../../../../lib/supabase.ts", () => {
  const rowsFor = (table, filters = []) => (mocks.tables[table] || []).filter((row) => filters.every(({ kind, key, value }) => {
    if (kind === "eq") return String(row[key]) === String(value);
    if (kind === "neq") return String(row[key]) !== String(value);
    if (kind === "in") return value.map(String).includes(String(row[key]));
    return true;
  }));
  const from = (table) => {
    const filters = [];
    const builder = {};
    const mutate = (kind) => vi.fn((payload) => { mocks.operations.push({ table, kind, payload }); return builder; });
    builder.select = vi.fn(() => builder);
    builder.insert = mutate("insert");
    builder.update = mutate("update");
    builder.delete = mutate("delete");
    builder.eq = vi.fn((key, value) => { filters.push({ kind: "eq", key, value }); return builder; });
    builder.neq = vi.fn((key, value) => { filters.push({ kind: "neq", key, value }); return builder; });
    builder.in = vi.fn((key, value) => { filters.push({ kind: "in", key, value }); return builder; });
    builder.order = vi.fn(() => builder);
    builder.range = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.ilike = vi.fn(() => builder);
    builder.single = vi.fn(async () => mocks.singleResponses[table]?.shift() || ({ data: rowsFor(table, filters)[0] || null, error: null }));
    builder.then = (resolve, reject) => {
      const deferred = mocks.deferredTables[table];
      if (deferred) return deferred.then(resolve, reject);
      return Promise.resolve({ data: rowsFor(table, filters), error: mocks.tableErrors[table] || null }).then(resolve, reject);
    };
    return builder;
  };
  mocks.from.mockImplementation(from);
  mocks.rpc.mockImplementation(async (name, payload) => {
    mocks.operations.push({ kind: "rpc", name, payload });
    const queued = mocks.rpcResponses[name]?.shift();
    if (queued) return queued;
    if (name === "inventory_save_purchase_order") return { data: { order: mocks.tables.inventory_purchase_orders[0], items: mocks.tables.inventory_purchase_order_items.filter((line) => line.purchase_order_id === mocks.tables.inventory_purchase_orders[0].id) }, error: null };
    if (name === "inventory_receive_purchase_order") return { data: { receipt_id: ids.receipt, purchase_order_id: payload.p_purchase_order_id, status: "partial_received" }, error: null };
    return { data: {}, error: null };
  });
  return { supabase: { from: mocks.from, rpc: mocks.rpc } };
});

vi.mock("../../../../services/productAnalyticsService.js", () => ({ productAnalyticsService: { listReports: vi.fn().mockResolvedValue([]), listItemsByReportIds: vi.fn().mockResolvedValue([]) } }));
vi.mock("../../../../services/auditLogService.js", () => ({ auditLogService: { createAuditLog: vi.fn().mockResolvedValue(undefined) } }));

import InventoryControlPage from "../InventoryControlPage.jsx";

const ids = {
  outlet: "00000000-0000-4000-8000-000000000001", category: "00000000-0000-4000-8000-000000000002", item: "00000000-0000-4000-8000-000000000003",
  supplierA: "00000000-0000-4000-8000-000000000004", supplierB: "00000000-0000-4000-8000-000000000005", draft: "00000000-0000-4000-8000-000000000006",
  submitted: "00000000-0000-4000-8000-000000000007", confirmed: "00000000-0000-4000-8000-000000000008", partial: "00000000-0000-4000-8000-000000000009",
  full: "00000000-0000-4000-8000-000000000010", completed: "00000000-0000-4000-8000-000000000011", cancelled: "00000000-0000-4000-8000-000000000012",
  receipt: "00000000-0000-4000-8000-000000000013", group: "00000000-0000-4000-8000-000000000014", check: "00000000-0000-4000-8000-000000000015", checkItem: "00000000-0000-4000-8000-000000000016",
};

const now = "2026-08-10T08:00:00.000Z";
const order = (id, po_no, status, requested_qty, received_qty = 0, source_type = "manual") => ({ id, po_no, outlet_id: ids.outlet, supplier_id: ids.supplierA, status, source_type, created_at: now, submitted_at: status === "draft" ? null : now, updated_at: now });

function seed({ includeCheck = false } = {}) {
  const orders = [
    order(ids.draft, "PO-DRAFT", "draft", 10), order(ids.submitted, "PO-SUBMITTED", "submitted", 10), order(ids.confirmed, "PO-CONFIRMED", "supplier_confirmed", 10),
    order(ids.partial, "PO-PARTIAL", "partial_received", 10, 4), order(ids.full, "PO-FULL", "fully_received", 10, 10), order(ids.completed, "PO-COMPLETED", "completed", 10, 4), order(ids.cancelled, "PO-CANCELLED", "cancelled", 10),
  ];
  mocks.tables = {
    inventory_items: [{ id: ids.item, item_name: "Dried Chilli", sku_code: "RM-CHILLI", category_id: ids.category, unit: "kg", status: "active" }],
    inventory_categories: [{ id: ids.category, name: "Raw Materials", status: "active", sort_order: 1 }], inventory_uoms: [],
    inventory_item_outlets: [{ id: "item-link", inventory_item_id: ids.item, outlet_id: ids.outlet, is_active: true, outlets: { id: ids.outlet, name: "KL Central", code: "KLC" } }],
    inventory_item_outlet_suppliers: [{ inventory_item_outlet_id: "item-link", supplier_id: ids.supplierA }],
    inventory_stock_check_groups: includeCheck ? [{ id: ids.group, outlet_id: ids.outlet, name: "Daily Count", frequency_type: "custom", frequency_days: ["Monday"], status: "active", shift: "Opening" }] : [],
    inventory_stock_check_group_categories: includeCheck ? [{ group_id: ids.group, category_id: ids.category }] : [],
    inventory_stock_checks: includeCheck ? [{ id: ids.check, outlet_id: ids.outlet, group_id: ids.group, stock_check_type: "scheduled", check_name: "Daily Count", check_date: "2026-08-10", shift: "Opening", status: "submitted", created_at: now, submitted_at: now }] : [],
    inventory_stock_check_items: includeCheck ? [{ id: ids.checkItem, stock_check_id: ids.check, item_id: ids.item, category_id: ids.category, par_level_quantity: 10, actual_count_quantity: 4, variance: -6, unit: "kg", status: "shortage", created_at: now }] : [],
    inventory_purchase_orders: orders, inventory_purchase_order_items: orders.map((entry, index) => ({ id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`, purchase_order_id: entry.id, item_id: ids.item, requested_qty: 10, received_qty: entry.id === ids.partial || entry.id === ids.completed ? 4 : entry.id === ids.full ? 10 : 0, unit: "kg", remark: "Current line", created_at: now })),
    inventory_purchase_receipts: [{ id: ids.receipt, purchase_order_id: ids.partial, outlet_id: ids.outlet, received_at: now, received_by: "operator", remark: "First delivery" }],
    inventory_purchase_receipt_items: [{ id: "receipt-line", receipt_id: ids.receipt, item_id: ids.item, received_qty: 4, unit: "kg", remark: "Invoice A", created_at: now }],
    inventory_movements: [], inventory_waste_records: [], inventory_menu_categories: [], inventory_recipes: [], inventory_recipe_items: [], employees: [{ id: "employee", auth_user_id: "user", full_name: "Operator" }], product_recipe_mappings: [],
  };
}

function permissions(extra = []) { return new Set(["inventory_orders.view", "inventory_orders.create", "inventory_orders.edit", "inventory_orders.submit", "inventory_orders.receive", "inventory_orders.complete", "inventory_orders.cancel", "inventory_orders.export", "inventory_stock_check.view", "inventory_stock_check.review", ...extra]); }
function mount({ granted = permissions(), tab = "orders", includeCheck = false } = {}) {
  seed({ includeCheck });
  render(<InventoryControlPage initialTab={tab} store={{ outlets: [{ id: ids.outlet, name: "KL Central", code: "KLC" }], suppliers: [{ id: ids.supplierA, name: "Chilli Supplier", status: "active", outletIds: [ids.outlet] }, { id: ids.supplierB, name: "Backup Supplier", status: "active", outletIds: [ids.outlet] }] }} auth={{ user: { id: "user" }, profile: { id: "employee", role_outlet_access_type: "all" }, hasPermission: (key) => granted.has(key) }} ui={{ notify: (entry) => mocks.notifications.push(entry) }} />);
}
function rpcCalls(name) { return mocks.operations.filter((entry) => entry.kind === "rpc" && entry.name === name); }
function mutations(table) { return mocks.operations.filter((entry) => entry.table === table && entry.kind === "update"); }
async function ready() { await screen.findAllByText(/PO-DRAFT/); }
async function modal(title) {
  const heading = await screen.findByRole("heading", { name: title });
  return heading.closest(".fixed");
}
function orderCard(poNo) {
  const marker = screen.getAllByText(new RegExp(`Internal ID: ${poNo}`)).find((node) => node.closest(".rounded-2xl"));
  const card = marker?.closest(".rounded-2xl");
  if (!card) throw new Error(`Unable to find responsive purchase-order card for ${poNo}`);
  return card;
}
function orderTableRow(poNo) {
  const marker = screen.getAllByTitle(`Internal system ID: ${poNo}`).find((node) => node.closest("tr"));
  const row = marker?.closest("tr");
  if (!row) throw new Error(`Unable to find purchase-order table row for ${poNo}`);
  return row;
}

beforeEach(() => { mocks.operations.length = 0; mocks.notifications.length = 0; mocks.rpcResponses = {}; mocks.singleResponses = {}; mocks.tableErrors = {}; mocks.deferredTables = {}; mocks.from.mockClear(); mocks.rpc.mockClear(); });
afterEach(() => {
  window.history.replaceState(null, "", "/");
  cleanup();
});

describe("InventoryControlPage Purchase Orders lifecycle", () => {
  it("keeps the PO page loading until its own read model resolves", async () => {
    let resolveOrders;
    mocks.deferredTables.inventory_purchase_orders = new Promise((resolve) => { resolveOrders = resolve; });
    mount();
    expect(await screen.findByRole("status")).toBeTruthy();
    resolveOrders({ data: mocks.tables.inventory_purchase_orders, error: null, count: mocks.tables.inventory_purchase_orders.length });
    await ready();
  });

  it("does not request unrelated supplier-link metadata before rendering purchase orders", async () => {
    mocks.tableErrors.inventory_item_outlet_suppliers = new Error("supplier links unavailable");
    mount(); await ready();
    expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain("inventory_item_outlet_suppliers");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a Purchase Order read failure explicit and retryable", async () => {
    mocks.tableErrors.inventory_purchase_orders = new Error("purchase order read timed out");
    mount();
    expect((await screen.findByRole("alert")).textContent).toContain("purchase order read timed out");
    mocks.tableErrors = {};
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await ready();
  });

  it("renders current non-empty PO states, fulfillment, and search/status filters", async () => {
    mount(); await ready();
    expect(screen.getAllByText(/PO-PARTIAL/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chilli Supplier").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4 / 10").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Partial Received").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText("Search business PO no, internal ID, supplier or item"), { target: { value: "PO-FULL" } });
    await waitFor(() => expect(screen.getAllByText(/PO-FULL/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/PO-DRAFT/)).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search business PO no, internal ID, supplier or item"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "All Status" }));
    fireEvent.click(await screen.findByRole("button", { name: "Supplier Confirmed" }));
    await waitFor(() => expect(screen.getAllByText(/PO-CONFIRMED/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/PO-FULL/)).toBeNull();
  });

  it("edits the mounted Draft PO through one trusted save, refresh, notification, and close", async () => {
    mount(); await ready(); const readsBefore = mocks.from.mock.calls.length;
    fireEvent.click(within(orderCard("PO-DRAFT")).getByRole("button", { name: "Edit" }));
    const dialog = await modal("Edit Draft PO");
    const quantity = within(dialog).getByDisplayValue("10");
    fireEvent.change(quantity, { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Draft PO" }));
    await waitFor(() => expect(rpcCalls("inventory_save_purchase_order")).toHaveLength(1));
    expect(rpcCalls("inventory_save_purchase_order")[0].payload).toEqual(expect.objectContaining({ p_request_id: expect.any(String), p_order: expect.objectContaining({ id: ids.draft, outlet_id: ids.outlet, supplier_id: ids.supplierA, status: "draft" }), p_items: [expect.objectContaining({ item_id: ids.item, requested_qty: 12, unit: "kg" })] }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit Draft PO" })).toBeNull());
    expect(mocks.from.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Draft PO saved" }));
  });

  it("keeps Draft save retryable and prevents repeat submission while the trusted request is pending", async () => {
    mount(); await ready(); let resolveSave;
    mocks.rpcResponses.inventory_save_purchase_order = [new Promise((resolve) => { resolveSave = resolve; })];
    fireEvent.click(within(orderCard("PO-DRAFT")).getByRole("button", { name: "Edit" }));
    const dialog = await modal("Edit Draft PO");
    const save = within(dialog).getByRole("button", { name: "Save Draft PO" });
    fireEvent.click(save); fireEvent.click(save);
    expect(rpcCalls("inventory_save_purchase_order")).toHaveLength(1);
    resolveSave({ data: { order: mocks.tables.inventory_purchase_orders[0], items: [mocks.tables.inventory_purchase_order_items[0]] }, error: null });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit Draft PO" })).toBeNull());
  });

  it("keeps a rejected Draft save open, then retries through the same trusted RPC without a false success", async () => {
    mount(); await ready();
    mocks.rpcResponses.inventory_save_purchase_order = [{ data: null, error: new Error("draft rejected") }, { data: { order: mocks.tables.inventory_purchase_orders[0], items: [mocks.tables.inventory_purchase_order_items[0]] }, error: null }];
    fireEvent.click(within(orderCard("PO-DRAFT")).getByRole("button", { name: "Edit" }));
    const dialog = await modal("Edit Draft PO");
    const save = within(dialog).getByRole("button", { name: "Save Draft PO" });
    fireEvent.click(save);
    await waitFor(() => expect(rpcCalls("inventory_save_purchase_order")).toHaveLength(1));
    expect(screen.getByRole("heading", { name: "Edit Draft PO" })).toBeTruthy();
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Failed to update Draft PO", tone: "error" }));
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(rpcCalls("inventory_save_purchase_order")).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit Draft PO" })).toBeNull());
  });

  it("keeps status actions status-specific and uses the current direct status mutation path", async () => {
    mount(); await ready();
    expect(screen.getAllByRole("button", { name: "Submit Order" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Mark Confirmed" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Complete PO" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Submit Order" })[0]);
    await waitFor(() => expect(mutations("inventory_purchase_orders")).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ status: "submitted" }) })));
    expect(rpcCalls("inventory_save_purchase_order")).toHaveLength(0);
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "PO submitted" }));
  });

  it("characterizes Supplier Confirm, Complete, and Cancel as their current status-gated direct mutation flows", async () => {
    mount(); await ready();
    fireEvent.click(within(orderCard("PO-SUBMITTED")).getByRole("button", { name: "Mark Confirmed" }));
    await waitFor(() => expect(mutations("inventory_purchase_orders")).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ status: "supplier_confirmed" }) })));
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "PO supplier confirmed" }));

    fireEvent.click(within(orderTableRow("PO-PARTIAL")).getByRole("button", { name: "Complete PO" }));
    const complete = await modal("Complete Purchase Order?");
    fireEvent.change(within(complete).getByLabelText("Completion Reason"), { target: { value: "Supplier cannot fulfill the balance" } });
    fireEvent.click(within(complete).getByRole("button", { name: "Complete PO" }));
    await waitFor(() => expect(mutations("inventory_purchase_orders")).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ status: "completed", completion_reason: "Supplier cannot fulfill the balance" }) })));
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "PO completed" }));

    fireEvent.click(within(orderCard("PO-DRAFT")).getByRole("button", { name: "Cancel" }));
    const cancel = await modal("Cancel Purchase Order");
    fireEvent.change(within(cancel).getByLabelText("Cancellation Reason"), { target: { value: "Ordering no longer needed" } });
    fireEvent.click(within(cancel).getByRole("button", { name: "Cancel PO" }));
    await waitFor(() => expect(mutations("inventory_purchase_orders")).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ status: "cancelled", cancellation_reason: "Ordering no longer needed" }) })));
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "PO cancelled" }));
    expect(rpcCalls("inventory_save_purchase_order")).toHaveLength(0);
    expect(rpcCalls("inventory_receive_purchase_order")).toHaveLength(0);
  });

  it("keeps a rejected Submit status transition visible for retry and does not report false success", async () => {
    mount(); await ready();
    mocks.singleResponses.inventory_purchase_orders = [{ data: null, error: new Error("submit rejected") }];
    fireEvent.click(within(orderCard("PO-DRAFT")).getByRole("button", { name: "Submit Order" }));
    await waitFor(() => expect(mutations("inventory_purchase_orders")).toHaveLength(1));
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Failed to submit PO", tone: "error" }));
    expect(within(orderCard("PO-DRAFT")).getByRole("button", { name: "Submit Order" })).toBeTruthy();
    fireEvent.click(within(orderCard("PO-DRAFT")).getByRole("button", { name: "Submit Order" }));
    await waitFor(() => expect(mutations("inventory_purchase_orders")).toHaveLength(2));
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "PO submitted" }));
  });

  it("opens eligible PO receiving, preserves line identity/UOM, retries after rejection, and refreshes only after success", async () => {
    mount(); await ready();
    mocks.rpcResponses.inventory_receive_purchase_order = [{ data: null, error: new Error("receipt rejected") }, { data: { receipt_id: ids.receipt, purchase_order_id: ids.confirmed, status: "partial_received" }, error: null }];
    fireEvent.click(within(orderCard("PO-CONFIRMED")).getByRole("button", { name: "Receive" }));
    const dialog = await modal("Receive Inventory");
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText("Receipt Remark"), { target: { value: "Invoice 2" } });
    const confirm = within(dialog).getByRole("button", { name: "Confirm Receive" });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(rpcCalls("inventory_receive_purchase_order")).toHaveLength(1));
    expect(screen.getByRole("heading", { name: "Receive Inventory" })).toBeTruthy();
    await waitFor(() => expect(confirm.disabled).toBe(false));
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Failed to receive inventory", tone: "error" }));
    fireEvent.click(confirm);
    await waitFor(() => expect(rpcCalls("inventory_receive_purchase_order")).toHaveLength(2));
    expect(rpcCalls("inventory_receive_purchase_order")[1].payload).toEqual(expect.objectContaining({ p_purchase_order_id: ids.confirmed, p_remark: "Invoice 2", p_items: [expect.objectContaining({ item_id: ids.item, received_qty: 3, unit: "kg", remark: null })] }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Receive Inventory" })).toBeNull());
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Inventory received" }));
  });

  it("prevents repeat receive submission while the trusted receiving RPC is pending", async () => {
    mount(); await ready(); let resolveReceive;
    mocks.rpcResponses.inventory_receive_purchase_order = [new Promise((resolve) => { resolveReceive = resolve; })];
    fireEvent.click(within(orderCard("PO-CONFIRMED")).getByRole("button", { name: "Receive" }));
    const dialog = await modal("Receive Inventory");
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "2" } });
    const confirm = within(dialog).getByRole("button", { name: "Confirm Receive" });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(rpcCalls("inventory_receive_purchase_order")).toHaveLength(1);
    resolveReceive({ data: { receipt_id: ids.receipt, purchase_order_id: ids.confirmed, status: "partial_received" }, error: null });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Receive Inventory" })).toBeNull());
  });

  it("renders partial/full fulfillment and keeps only eligible receiving actions", async () => {
    mount(); await ready();
    fireEvent.click(within(orderCard("PO-PARTIAL")).getByRole("button", { name: "View" }));
    const partial = await modal("Purchase Order Detail");
    expect(within(partial).getByText("4 / 10 received")).toBeTruthy();
    expect(within(partial).getAllByText("Balance").length).toBeGreaterThan(0);
    expect(within(partial).getByRole("button", { name: "Receive" })).toBeTruthy();
    fireEvent.click(within(partial).getByRole("button", { name: "Close" }));
    fireEvent.click(within(orderCard("PO-FULL")).getByRole("button", { name: "View" }));
    const full = await modal("Purchase Order Detail");
    expect(within(full).getByText("10 / 10 received")).toBeTruthy();
    expect(within(full).queryByRole("button", { name: "Receive" })).toBeNull();
  });

  it("guards protected PO mutations for a view-only permission profile", async () => {
    mount({ granted: new Set(["inventory_orders.view"]) }); await ready();
    fireEvent.click(within(orderCard("PO-DRAFT")).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Permission required", tone: "error" })));
    expect(screen.queryByRole("heading", { name: "Edit Draft PO" })).toBeNull();
    expect(rpcCalls("inventory_save_purchase_order")).toHaveLength(0);
    expect(mutations("inventory_purchase_orders")).toHaveLength(0);
  });

  it("hands a submitted shortage check to one per-supplier trusted draft-PO intent", async () => {
    window.history.replaceState(null, "", "#inventory_stock_check?date=2026-08-10");
    mount({ tab: "stock-check", includeCheck: true });
    await screen.findByText("Daily Count");
    fireEvent.click(screen.getByRole("button", { name: "Review Purchase Suggestions" }));
    const dialog = await modal("Purchase Suggestions");
    expect(within(dialog).getAllByText("Chilli Supplier").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("6")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Draft PO" }));
    await waitFor(() => expect(rpcCalls("inventory_save_purchase_order")).toHaveLength(1));
    expect(rpcCalls("inventory_save_purchase_order")[0].payload).toEqual(expect.objectContaining({ p_order: expect.objectContaining({ outlet_id: ids.outlet, supplier_id: ids.supplierA, status: "draft", source_type: "stock_check", source_stock_check_id: ids.check }), p_items: [expect.objectContaining({ item_id: ids.item, requested_qty: 6, unit: "kg", source_stock_check_item_id: ids.checkItem })] }));
  });
});
