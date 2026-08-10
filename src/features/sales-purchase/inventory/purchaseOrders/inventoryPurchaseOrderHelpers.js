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
