import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ operations: [], responses: {}, rpcResponses: {}, from: vi.fn(), rpc: vi.fn() }));

vi.mock("../../../../lib/supabase.ts", () => {
  const nextResponse = (table) => mocks.responses[table]?.shift() ?? { data: [], error: null };
  const from = (table) => {
    const builder = {};
    const mutation = (kind) => vi.fn((payload) => {
      mocks.operations.push({ table, kind, payload });
      return builder;
    });
    builder.select = vi.fn(() => builder);
    builder.insert = mutation("insert");
    builder.update = mutation("update");
    builder.delete = mutation("delete");
    builder.upsert = mutation("upsert");
    builder.eq = vi.fn(() => builder);
    builder.in = vi.fn(() => builder);
    builder.ilike = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.neq = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.single = vi.fn(async () => nextResponse(table));
    builder.then = (resolve, reject) => Promise.resolve(nextResponse(table)).then(resolve, reject);
    return builder;
  };
  mocks.from.mockImplementation(from);
  mocks.rpc.mockImplementation(async (name, payload) => {
    mocks.operations.push({ kind: "rpc", name, payload });
    return mocks.rpcResponses[name]?.shift() ?? { data: {}, error: null };
  });
  return { supabase: { from: mocks.from, rpc: mocks.rpc } };
});

vi.mock("../../../../services/auditLogService.js", () => ({ auditLogService: { createAuditLog: vi.fn().mockResolvedValue(undefined) } }));

import { inventoryLifecycleContracts, ReceiveInventoryModal, RecipeModal } from "../InventoryControlPage.jsx";

const ids = {
  order: "00000000-0000-4000-8000-000000000001",
  orderItem: "00000000-0000-4000-8000-000000000002",
  receipt: "00000000-0000-4000-8000-000000000003",
  receiptItem: "00000000-0000-4000-8000-000000000004",
  outlet: "00000000-0000-4000-8000-000000000005",
  supplier: "00000000-0000-4000-8000-000000000006",
  item: "00000000-0000-4000-8000-000000000007",
  movement: "00000000-0000-4000-8000-000000000008",
  check: "00000000-0000-4000-8000-000000000009",
  group: "00000000-0000-4000-8000-000000000010",
  waste: "00000000-0000-4000-8000-000000000011",
  recipe: "00000000-0000-4000-8000-000000000012",
};

const order = {
  id: ids.order,
  poNo: "PO-100",
  outletId: ids.outlet,
  supplierId: ids.supplier,
  status: "supplier_confirmed",
  lines: [{ id: ids.orderItem, itemId: ids.item, requestedQty: 10, receivedQty: 2, unit: "kg" }],
};

function response(table, ...values) {
  mocks.responses[table] = [...(mocks.responses[table] || []), ...values.map((value) => ({ error: null, ...value }))];
}

function mutation(table, kind) {
  return mocks.operations.filter((entry) => entry.table === table && entry.kind === kind);
}

function rpcResponse(name, ...values) {
  mocks.rpcResponses[name] = [...(mocks.rpcResponses[name] || []), ...values.map((value) => ({ error: null, ...value }))];
}

function queueReceivedPurchaseOrder() {
  response("inventory_purchase_receipts", { data: { id: ids.receipt, purchase_order_id: ids.order, received_at: "2026-08-10T00:00:00.000Z" } }, { data: [] });
  response("inventory_purchase_receipt_items", { data: [{ id: ids.receiptItem, receipt_id: ids.receipt, item_id: ids.item, received_qty: 3, unit: "kg" }] }, { data: [] });
  response("inventory_purchase_order_items", { data: { id: ids.orderItem, purchase_order_id: ids.order, item_id: ids.item, requested_qty: 10, received_qty: 5, unit: "kg" } }, { data: [{ id: ids.orderItem, purchase_order_id: ids.order, item_id: ids.item, requested_qty: 10, received_qty: 5, unit: "kg" }] });
  response("inventory_purchase_orders", { data: { id: ids.order, po_no: "PO-100", outlet_id: ids.outlet, supplier_id: ids.supplier, status: "partial_received" } }, { data: { id: ids.order, po_no: "PO-100", outlet_id: ids.outlet, supplier_id: ids.supplier, status: "partial_received" } });
  response("inventory_movements", { data: [{ id: ids.movement, outlet_id: ids.outlet, inventory_item_id: ids.item, movement_type: "Purchase", quantity: 3, unit: "kg", reference_type: "purchase_order", reference_id: ids.order, reference_no: "PO-100" }] });
}

beforeEach(() => {
  mocks.operations.length = 0;
  mocks.responses = {};
  mocks.rpcResponses = {};
  mocks.from.mockClear();
  mocks.rpc.mockClear();
});

afterEach(cleanup);

describe("Inventory lifecycle persistence contracts", () => {
  it("sends a receipt intent through one trusted RPC with a request ID", async () => {
    rpcResponse("inventory_receive_purchase_order", { data: { receipt_id: ids.receipt, purchase_order_id: ids.order, status: "partial_received" } });

    const result = await inventoryLifecycleContracts.persistRemotePurchaseOrderReceive(order, [{ ...order.lines[0], receiveNowQty: 3, receiveRemark: "Invoice 1" }], "Delivery received", "employee-1");

    expect(mocks.operations).toEqual([expect.objectContaining({ kind: "rpc", name: "inventory_receive_purchase_order", payload: expect.objectContaining({ p_purchase_order_id: ids.order, p_remark: "Delivery received", p_request_id: expect.any(String), p_items: [expect.objectContaining({ purchase_order_item_id: ids.orderItem, item_id: ids.item, received_qty: 3, unit: "kg", remark: "Invoice 1" })] }) })]);
    expect(result.status).toBe("partial_received");
    expect(mutation("inventory_purchase_receipts", "insert")).toHaveLength(0);
  });

  it("surfaces a trusted receipt RPC rejection without client-side writes", async () => {
    rpcResponse("inventory_receive_purchase_order", { data: null, error: new Error("receipt rejected") });

    await expect(inventoryLifecycleContracts.persistRemotePurchaseOrderReceive(order, [{ ...order.lines[0], receiveNowQty: 3 }], "", "employee-1")).rejects.toThrow("receipt rejected");

    expect(mutation("inventory_purchase_receipts", "insert")).toHaveLength(0);
    expect(mutation("inventory_purchase_order_items", "update")).toHaveLength(0);
    expect(mutation("inventory_purchase_orders", "update")).toHaveLength(0);
    expect(mutation("inventory_movements", "insert")).toHaveLength(0);
  });

  it("sends submitted stock checks through one trusted RPC with current values and a request ID", async () => {
    rpcResponse("inventory_save_stock_check", { data: { check: { id: ids.check, outlet_id: ids.outlet, group_id: ids.group, stock_check_type: "scheduled", check_name: "Morning", check_date: "2026-08-10", status: "submitted" }, items: [] } });

    const saved = await inventoryLifecycleContracts.persistRemoteStockCheck({ id: ids.group, outletId: ids.outlet, name: "Morning", date: "2026-08-10", shift: "Opening", stockCheckType: "scheduled" }, [{ itemId: ids.item, expectedQty: 10, actualCount: 8, variance: -2, unit: "kg" }], "submitted", "user-1", "employee-1");

    expect(mocks.operations).toEqual([expect.objectContaining({ kind: "rpc", name: "inventory_save_stock_check", payload: expect.objectContaining({ p_request_id: expect.any(String), p_check: expect.objectContaining({ outlet_id: ids.outlet, group_id: ids.group, stock_check_type: "scheduled", status: "submitted" }), p_items: [expect.objectContaining({ item_id: ids.item, actual_count_quantity: 8, variance: -2, unit: "kg" })] }) })]);
    expect(saved.status).toBe("submitted");
  });

  it("surfaces a rejected stock-check RPC without client-side header or row writes", async () => {
    rpcResponse("inventory_save_stock_check", { data: null, error: new Error("stock check rejected") });

    await expect(inventoryLifecycleContracts.persistRemoteStockCheck({ id: ids.group, outletId: ids.outlet, name: "Morning", date: "2026-08-10", stockCheckType: "scheduled" }, [{ itemId: ids.item, expectedQty: 10, actualCount: 8, variance: -2, unit: "kg" }], "draft", "user-1", "employee-1")).rejects.toThrow("stock check rejected");

    expect(mutation("inventory_stock_checks", "insert")).toHaveLength(0);
    expect(mutation("inventory_stock_check_items", "insert")).toHaveLength(0);
  });

  it("sends a signed manual movement through one trusted RPC without a balance-table write", async () => {
    rpcResponse("inventory_save_manual_movement", { data: { movement: { id: ids.movement, outlet_id: ids.outlet, inventory_item_id: ids.item, movement_type: "Waste", quantity: -2, unit: "kg", reference_type: "manual" } } });

    await inventoryLifecycleContracts.persistRemoteInventoryMovement({ outletId: ids.outlet, itemId: ids.item, type: "waste", quantity: 2, unit: "kg", date: "2026-08-10" }, "employee-1");

    expect(mocks.operations).toEqual([expect.objectContaining({ kind: "rpc", name: "inventory_save_manual_movement", payload: expect.objectContaining({ p_request_id: expect.any(String), p_movement: expect.objectContaining({ outlet_id: ids.outlet, inventory_item_id: ids.item, movement_type: "Waste", quantity: -2, unit: "kg", reference_type: "manual" }) }) })]);
    expect(mocks.operations.filter((entry) => entry.table === "inventory_items" && entry.kind === "update")).toHaveLength(0);
  });

  it("propagates a rejected manual-movement RPC and succeeds on retry with a new request ID", async () => {
    rpcResponse("inventory_save_manual_movement", { data: null, error: new Error("movement rejected") }, { data: { movement: { id: ids.movement } } });
    const { inventoryLifecycleService } = await import("../../../../services/inventoryLifecycleService.js");
    const movement = { outlet_id: ids.outlet, inventory_item_id: ids.item, movement_type: "Adjustment", quantity: -2, unit: "kg", reference_type: "manual", reference_no: "COUNT", created_at: "2026-08-10T00:00:00.000Z" };
    await expect(inventoryLifecycleService.saveInventoryMovement({ movement })).rejects.toThrow("movement rejected");
    await inventoryLifecycleService.saveInventoryMovement({ movement });
    const calls = mocks.operations.filter((entry) => entry.name === "inventory_save_manual_movement");
    expect(calls).toHaveLength(2);
    expect(calls[0].payload.p_request_id).not.toBe(calls[1].payload.p_request_id);
  });

  it("sends waste through one trusted RPC with no client-side second movement write", async () => {
    rpcResponse("inventory_save_waste", { data: { waste_id: ids.waste, movement_id: ids.movement } });

    await inventoryLifecycleContracts.persistRemoteWasteRecord({ outletId: ids.outlet, itemId: ids.item, wasteType: "Spoilage", quantity: 2, unit: "kg", date: "2026-08-10" }, "employee-1");
    expect(mocks.operations).toEqual([expect.objectContaining({ kind: "rpc", name: "inventory_save_waste", payload: expect.objectContaining({ p_request_id: expect.any(String), p_outlet_id: ids.outlet, p_inventory_item_id: ids.item, p_waste_type: "Spoilage", p_quantity: 2, p_unit: "kg" }) })]);
    expect(mutation("inventory_waste_records", "insert")).toHaveLength(0);
    expect(mutation("inventory_movements", "insert")).toHaveLength(0);
  });

  it("sends a paired transfer through one trusted RPC rather than two independent movement writes", async () => {
    rpcResponse("inventory_transfer_inventory", { data: { outgoing_movement_id: ids.movement, incoming_movement_id: ids.receiptItem, reference_no: "TRF-100" } });

    const { inventoryLifecycleService } = await import("../../../../services/inventoryLifecycleService.js");
    await inventoryLifecycleService.transferInventory({ movement: { fromOutletId: ids.outlet, toOutletId: ids.supplier, itemId: ids.item, quantity: 4, unit: "kg", reference: "TRF-100", notes: "Move stock" } });

    expect(mocks.operations).toEqual([expect.objectContaining({ kind: "rpc", name: "inventory_transfer_inventory", payload: expect.objectContaining({ p_request_id: expect.any(String), p_from_outlet_id: ids.outlet, p_to_outlet_id: ids.supplier, p_inventory_item_id: ids.item, p_quantity: 4, p_unit: "kg", p_reference_no: "TRF-100" }) })]);
    expect(mutation("inventory_movements", "insert")).toHaveLength(0);
  });

  it("sends recipe header and ingredient replacement intent through one trusted RPC", async () => {
    rpcResponse("inventory_save_recipe", { data: { recipe: { id: ids.recipe, outlet_id: ids.outlet, recipe_code: "R-1", recipe_name: "Sambal", recipe_name_en: "Sambal", recipe_name_cn: "叁巴", status: "active" }, items: [{ id: "ingredient-1", recipe_id: ids.recipe, inventory_item_id: ids.item, quantity_used: 1.5, unit: "kg", wastage_percent: 2 }] } });

    const saved = await inventoryLifecycleContracts.persistRemoteRecipe({ outletId: ids.outlet, recipeCode: "R-1", recipeNameEn: "Sambal", recipeNameCn: "叁巴", ingredients: [{ itemId: ids.item, quantityUsed: 1.5, unit: "kg", wastagePercent: 2 }] }, "employee-1");

    expect(mocks.operations).toEqual([expect.objectContaining({ kind: "rpc", name: "inventory_save_recipe", payload: expect.objectContaining({ p_request_id: expect.any(String), p_recipe: expect.objectContaining({ outlet_id: ids.outlet, recipe_code: "R-1", recipe_name_en: "Sambal", recipe_name_cn: "叁巴" }), p_items: [expect.objectContaining({ inventory_item_id: ids.item, quantity_used: 1.5, unit: "kg", wastage_percent: 2 })] }) })]);
    expect(saved.id).toBe(ids.recipe);
  });

  it("propagates a rejected recipe RPC and retries through the single trusted replacement boundary", async () => {
    rpcResponse("inventory_save_recipe", { data: null, error: new Error("recipe rejected") }, { data: { recipe: { id: ids.recipe }, items: [] } });
    const { inventoryLifecycleService } = await import("../../../../services/inventoryLifecycleService.js");
    const recipe = { outlet_id: ids.outlet, recipe_code: "R-1", recipe_name: "Sambal", recipe_name_en: "Sambal", recipe_name_cn: "叁巴", ingredients: [{ inventory_item_id: ids.item, quantity_used: 1, unit: "kg", wastage_percent: 0 }] };
    await expect(inventoryLifecycleService.saveInventoryRecipe({ recipe })).rejects.toThrow("recipe rejected");
    await inventoryLifecycleService.saveInventoryRecipe({ recipe });
    const calls = mocks.operations.filter((entry) => entry.name === "inventory_save_recipe");
    expect(calls).toHaveLength(2);
    expect(calls[0].payload.p_request_id).not.toBe(calls[1].payload.p_request_id);
    expect(mutation("inventory_recipes", "insert")).toHaveLength(0);
    expect(mutation("inventory_recipe_items", "insert")).toHaveLength(0);
  });

  it("keeps the mounted recipe modal retryable after a rejected save", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("recipe rejected")).mockResolvedValueOnce(undefined);
    render(<RecipeModal recipe={{ id: ids.recipe, outletId: ids.outlet, recipeCode: "R-1", recipeNameEn: "Sambal", recipeNameCn: "叁巴", sellingPrice: 12, ingredients: [{ id: "line-1", itemId: ids.item, quantityUsed: 1, unit: "kg", wastagePercent: 0 }] }} outletId={ids.outlet} outlet={{ id: ids.outlet, name: "Outlet A" }} items={[{ id: ids.item, name: "Rice", unit: "kg", linkedOutletIds: [ids.outlet], status: "active" }]} menuCategories={[]} onClose={vi.fn()} onSave={onSave} />);
    const save = screen.getByRole("button", { name: "Save Recipe" });
    fireEvent.click(save);
    await waitFor(() => expect(save.disabled).toBe(false));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  });

  it("sends Draft PO edits and replacement lines through one trusted RPC", async () => {
    rpcResponse("inventory_save_purchase_order", { data: { order: { id: ids.order, po_no: "PO-100", outlet_id: ids.outlet, supplier_id: ids.supplier, status: "draft" }, items: [{ id: ids.orderItem, purchase_order_id: ids.order, item_id: ids.item, requested_qty: 12, received_qty: 0, unit: "kg" }] } });

    const saved = await inventoryLifecycleContracts.persistRemotePurchaseOrderEdit({ ...order, status: "draft", lines: [{ id: ids.orderItem, itemId: ids.item, requestedQty: 12, unit: "kg" }] });

    expect(mocks.operations).toEqual([expect.objectContaining({ kind: "rpc", name: "inventory_save_purchase_order", payload: expect.objectContaining({ p_request_id: expect.any(String), p_order: expect.objectContaining({ id: ids.order, outlet_id: ids.outlet, supplier_id: ids.supplier }), p_items: [expect.objectContaining({ item_id: ids.item, requested_qty: 12, unit: "kg" })] }) })]);
    expect(saved.lines[0]).toEqual(expect.objectContaining({ requestedQty: 12, receivedQty: 0, unit: "kg" }));
  });

  it("mounts the current receiving UI and forwards the entered row quantity, UOM, and receipt remark", () => {
    const onReceive = vi.fn();
    render(<ReceiveInventoryModal order={order} supplier={{ id: ids.supplier, name: "Supplier A" }} outlet={{ id: ids.outlet, name: "Outlet A" }} items={[{ id: ids.item, name: "Rice", unit: "kg" }]} onClose={vi.fn()} onReceive={onReceive} />);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Receipt Remark"), { target: { value: "Invoice 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Receive" }));

    expect(onReceive).toHaveBeenCalledTimes(1);
    expect(onReceive).toHaveBeenCalledWith([expect.objectContaining({ id: ids.orderItem, itemId: ids.item, receiveNowQty: 3, unit: "kg" })], "Invoice 1");
  });

  it("prevents duplicate receiving submission while the current request is pending", () => {
    const onReceive = vi.fn(() => new Promise(() => {}));
    render(<ReceiveInventoryModal order={order} supplier={{ id: ids.supplier, name: "Supplier A" }} outlet={{ id: ids.outlet, name: "Outlet A" }} items={[{ id: ids.item, name: "Rice", unit: "kg" }]} onClose={vi.fn()} onReceive={onReceive} />);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
    const confirm = screen.getByRole("button", { name: "Confirm Receive" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(confirm.disabled).toBe(true);
    expect(onReceive).toHaveBeenCalledTimes(1);
  });
});
