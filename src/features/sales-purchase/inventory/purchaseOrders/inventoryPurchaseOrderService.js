import { supabase } from "../../../../lib/supabase.ts";
import { readCompleteInventoryRows } from "../../../../services/inventoryCompleteRead.js";
import { inventoryLifecycleService } from "../../../../services/inventoryLifecycleService.js";
import { isUuid, mapRemoteInventoryItem } from "../inventoryItemModel.js";
import { remainingQty } from "./inventoryPurchaseOrderHelpers.js";

export async function fetchRemotePurchaseOrder(orderId) {
  if (!isUuid(orderId)) throw new Error("Valid purchase order is required.");
  const [header, lines, receipts] = await Promise.all([
    supabase.from("inventory_purchase_orders").select("*").eq("id", orderId).single(),
    readCompleteInventoryRows("inventory_purchase_order_items", { eq: { purchase_order_id: orderId }, order: "created_at" }),
    readCompleteInventoryRows("inventory_purchase_receipts", { eq: { purchase_order_id: orderId }, order: "received_at", ascending: false }),
  ]);
  if (header.error) throw header.error;
  if (!header.data) throw new Error("Purchase order unavailable.");
  const receiptIds = receipts.data.map(row => row.id);
  const receiptItems = receiptIds.length ? (await readCompleteInventoryRows("inventory_purchase_receipt_items", { in: { receipt_id: receiptIds }, order: "created_at" })).data : [];
  return mapRemotePurchaseOrder(header.data, lines.data, receipts.data.map(receipt => ({
    ...receipt, items: receiptItems.filter(item => item.receipt_id === receipt.id),
  })));
}

export async function loadPurchaseOrderDetail(orderId) {
  const order = await fetchRemotePurchaseOrder(orderId);
  const itemIds = [...new Set(order.lines.map(line => line.itemId))];
  const actorIds = [...new Set([order.createdBy, ...order.receipts.map(receipt => receipt.receivedBy)].filter(Boolean))];
  const [items, people, check] = await Promise.all([
    itemIds.length ? readCompleteInventoryRows("inventory_items", { in: { id: itemIds } }) : { data: [] },
    // Both Employee ID and Auth ID occur in historical actor evidence.
    readCompleteInventoryRows("employees", { select: "id,auth_user_id,full_name,nickname,email" }),
    order.sourceStockCheckId ? supabase.from("inventory_stock_checks").select("*").eq("id", order.sourceStockCheckId).single() : { data: null, error: null },
  ]);
  if (check.error) throw check.error;
  const source = check.data;
  let group = null;
  if (source?.group_id) {
    const result = await supabase.from("inventory_stock_check_groups").select("id,name").eq("id", source.group_id).single();
    if (result.error) throw result.error;
    group = result.data;
  }
  return {
    order, items: items.data.map(row => mapRemoteInventoryItem(row)),
    people: people.data.filter(person => actorIds.includes(person.id) || actorIds.includes(person.auth_user_id)),
    checks: source ? [{ id: source.id, date: source.check_date, auditName: source.audit_name || source.check_name || "", groupName: group?.name || "" }] : [],
  };
}

export function mapRemotePurchaseOrderItem(row = {}) {
  return {
    id: row.id,
    itemId: row.item_id || "",
    requestedQty: row.requested_qty === null || row.requested_qty === undefined ? 0 : Number(row.requested_qty),
    receivedQty: row.received_qty === null || row.received_qty === undefined ? 0 : Number(row.received_qty),
    unit: row.unit || "",
    remark: row.remark || "",
    sourceStockCheckItemId: row.source_stock_check_item_id || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

export function mapRemotePurchaseReceiptItem(row = {}) {
  return {
    id: row.id,
    receiptId: row.receipt_id || "",
    purchaseOrderItemId: row.purchase_order_item_id || "",
    itemId: row.item_id || "",
    receivedQty: row.received_qty === null || row.received_qty === undefined ? 0 : Number(row.received_qty),
    unit: row.unit || "",
    remark: row.remark || "",
    createdAt: row.created_at || "",
  };
}

export function mapRemotePurchaseReceipt(row = {}, items = []) {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id || "",
    outletId: row.outlet_id || "",
    supplierId: row.supplier_id || "",
    receivedBy: row.received_by || "",
    receivedAt: row.received_at || row.created_at || "",
    remark: row.remark || "",
    createdAt: row.created_at || "",
    items: items.map(mapRemotePurchaseReceiptItem),
  };
}

export function mapRemotePurchaseOrder(row = {}, lines = [], receipts = []) {
  return {
    id: row.id,
    poNo: row.po_no || "PO",
    businessPoNo: row.business_po_no || "",
    supplierId: row.supplier_id || "",
    outletId: row.outlet_id || "",
    outletIds: row.outlet_id ? [row.outlet_id] : [],
    requestIds: row.source_stock_request_id ? [row.source_stock_request_id] : [],
    status: row.status || "draft",
    sourceType: row.source_type || "manual",
    sourceStockCheckId: row.source_stock_check_id || row.source_check_id || "",
    sourceStockRequestId: row.source_stock_request_id || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    submittedAt: row.submitted_at || "",
    confirmedAt: row.confirmed_at || "",
    completedAt: row.completed_at || "",
    cancelledAt: row.cancelled_at || "",
    cancellationReason: row.cancellation_reason || "",
    completionType: row.completion_type || "",
    completionReason: row.completion_reason || "",
    unfulfilledQty: Number(row.unfulfilled_qty || 0),
    lines: lines.map(mapRemotePurchaseOrderItem),
    receipts: receipts.map((receipt) => mapRemotePurchaseReceipt(receipt, receipt.items || [])),
  };
}

export async function persistRemotePurchaseOrderReceive(order = {}, rows = [], receiptRemark = "", userId, requestId) {
  if (["cancelled", "completed"].includes(order.status)) throw new Error("Cannot receive a Cancelled or Completed PO.");
  const invalidRow = rows.find((row) => Number(row.receiveNowQty || 0) < 0 || Number(row.receiveNowQty || 0) > remainingQty(row));
  if (invalidRow) throw new Error("Receive quantity cannot exceed remaining quantity.");
  return inventoryLifecycleService.receivePurchaseOrder({ order, rows, receiptRemark, requestId });
}
