export function formatPurchaseOrderText(order, { supplierName, outletName, itemById, businessPoNo, formatDate, today }) {
  const statusLine = ["cancelled", "completed"].includes(order.status)
    ? [`Status: ${order.status === "cancelled" ? "Cancelled" : "Completed"}`] : [];
  const itemLines = (order.lines || []).map((line, index) => {
    const item = itemById.get(line.itemId);
    const base = `${index + 1}. ${item?.name || "Inventory item"} — ${Number(line.requestedQty || 0)} ${line.unit || item?.unit || ""}`.trim();
    return line.remark ? `${base}\n   Remark: ${line.remark}` : base;
  });
  const remarks = order.remark || order.notes || "";
  return [
    `Hi ${supplierName || "Supplier"},`,
    "",
    "Please arrange the following order:",
    "",
    `PO No.: ${businessPoNo(order) || "-"}`,
    `Date: ${formatDate(order.createdAt || today)}`,
    `Outlet: ${outletName || "Outlet"}`,
    ...statusLine,
    "",
    "Items:",
    ...(itemLines.length ? itemLines : ["1. No items listed"]),
    ...(remarks ? ["", "Remarks:", remarks] : []),
    "",
    "Please confirm stock availability and delivery date.",
    "",
    "Thank you.",
  ].join("\n");
}
