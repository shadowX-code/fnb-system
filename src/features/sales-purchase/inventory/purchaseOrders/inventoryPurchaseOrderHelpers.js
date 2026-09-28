import { canonical } from "../inventoryItemModel.js";

export const businessPoNo = order => order.businessPoNo || order.poNo || 'PO';
export const linkedPurchaseOrdersForStockCheck = (orders, checkId) => checkId ? orders.filter(order => order.sourceType === 'stock_check' && order.sourceStockCheckId === checkId && order.status !== 'cancelled') : [];
export const poStatusTone = status => ['completed', 'fully_received'].includes(status) ? 'success' : ['draft', 'partial_received'].includes(status) ? 'warning' : status === 'cancelled' ? 'danger' : ['submitted', 'supplier_confirmed'].includes(status) ? 'info' : 'neutral';

export function isPurchaseOrderReference(movement = {}) {
  return ["purchaseorder", "po"].includes(canonical(movement.referenceType || movement.reference_type || ""));
}

function toTitle(value = "") {
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function poStatusLabel(status) {
  const labels = {
    supplier_confirmed: "Supplier Confirmed",
    partial_received: "Partial Received",
    fully_received: "Fully Received",
  };
  return labels[status] || toTitle(status);
}

export function poSourceLabel(source) {
  const labels = { stock_check: "Stock Check", stock_request: "Stock Request", manual: "Manual" };
  return labels[source] || toTitle(source || "manual");
}

export function orderedQty(order = {}) {
  return (order.lines || []).reduce((sum, line) => sum + Number(line.requestedQty || 0), 0);
}

export function receivedQty(order = {}) {
  return (order.lines || []).reduce((sum, line) => sum + Number(line.receivedQty || 0), 0);
}

export function remainingQty(line = {}) {
  return Math.max(0, Number(line.requestedQty || 0) - Number(line.receivedQty || 0));
}

export function poProgress(order = {}) {
  const ordered = orderedQty(order);
  const received = receivedQty(order);
  const percent = ordered ? Math.round((received / ordered) * 100) : 0;
  return { ordered, received, percent };
}
