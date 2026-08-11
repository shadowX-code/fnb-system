import { Copy, Download, FileText, Truck } from "lucide-react";
import Modal from "../../../../components/feedback/Modal.jsx";
import MetricCard from "../../../../components/ui/MetricCard.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import { poSourceLabel, poStatusLabel, remainingQty, poProgress } from "./inventoryPurchaseOrderHelpers.js";

/**
 * Canonical, unwired read-only PO Detail presentation. Its caller owns all
 * lifecycle actions; this component only renders and forwards explicit intent.
 */
export default function InventoryPurchaseOrderDetail({
  order,
  getBusinessPoNo,
  suppliers,
  outletById,
  itemById,
  checks,
  actorNameByAnyId,
  formatDate,
  statusTone,
  onClose,
  onRequestReceive,
  onCopyPurchaseOrder,
  onNotify,
  onPrint,
}) {
  const progress = poProgress(order);
  const supplier = suppliers.find((entry) => entry.id === order.supplierId);
  const outlet = outletById.get(order.outletId || order.outletIds?.[0]);
  const sourceCheck = checks.find((check) => check.id === order.sourceStockCheckId);
  const balance = Math.max(0, progress.ordered - progress.received);
  const isReceivable = ["submitted", "supplier_confirmed", "partial_received"].includes(order.status) && balance > 0;
  const workflowSteps = [
    { key: "created", label: "Created", date: order.createdAt, complete: Boolean(order.createdAt) },
    { key: "submitted", label: "Submitted", date: order.submittedAt, complete: Boolean(order.submittedAt) || order.status !== "draft" },
    { key: "receiving", label: "Receiving", date: order.receipts?.[0]?.receivedAt, complete: progress.received > 0 || ["fully_received", "completed"].includes(order.status) },
    { key: "completed", label: "Completed", date: order.completedAt, complete: Boolean(order.completedAt) || order.status === "completed" },
  ];
  const workflowIndex = order.status === "draft" ? 0 : ["submitted", "supplier_confirmed"].includes(order.status) ? 1 : ["partial_received", "fully_received"].includes(order.status) ? 2 : order.status === "completed" ? 3 : -1;
  const sourceName = sourceCheck ? `${sourceCheck.auditName || sourceCheck.groupName || "Stock Check"} · ${formatDate(sourceCheck.date)}` : order.sourceStockCheckId || "Manual purchase planning";
  const displayPoNo = getBusinessPoNo(order);

  return <Modal title="Purchase Order Detail" description={`${displayPoNo} · ${supplier?.name || "Supplier"} · ${outlet?.name || "Outlet"}`} size="xl" onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={order.status === "partial_received" ? "warning" : statusTone(order.status)}>{poStatusLabel(order.status)}</Badge>
        <div className="flex flex-wrap justify-end gap-2">
          {isReceivable ? <button className="btn-primary" type="button" onClick={() => onRequestReceive(order)}><Truck size={15} /> Receive</button> : null}
          <button className="btn-secondary" type="button" onClick={() => onCopyPurchaseOrder(order)}><Copy size={15} /> Copy PO Text</button>
          <button className="btn-secondary" type="button" onClick={() => { onNotify("Export PDF", "Use the print dialog to save this PO as PDF."); onPrint(); }}><Download size={15} /> Export PDF</button>
          <button className="btn-secondary" type="button" onClick={onPrint}><FileText size={15} /> Print</button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3"><div className="type-caption font-semibold text-text-muted">Business PO Number</div><div className="mt-1 font-mono text-lg font-black text-text-primary">{displayPoNo}</div></div>
        <div className="rounded-2xl border border-border bg-surface p-3"><div className="type-caption font-semibold text-text-muted">Internal System ID</div><div className="mt-1 font-mono text-sm font-bold text-text-secondary">{order.poNo}</div></div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-border bg-surface p-3"><div className="mb-3 type-title font-bold text-text-primary">Generated From</div><div className="grid gap-3 sm:grid-cols-3"><div><div className="type-caption font-semibold text-text-muted">Source Type</div><div className="mt-1 type-body-sm font-bold text-text-primary">{poSourceLabel(order.sourceType)}</div></div><div><div className="type-caption font-semibold text-text-muted">Source Name</div><div className="mt-1 type-body-sm font-bold text-text-primary">{sourceName}</div></div><div><div className="type-caption font-semibold text-text-muted">Created Date</div><div className="mt-1 type-body-sm font-bold text-text-primary">{formatDate(order.createdAt)}</div></div></div></div>
        <div className="rounded-2xl border border-border bg-surface p-3"><div className="mb-3 type-title font-bold text-text-primary">Supplier Contact</div><div className="grid gap-2 type-body-sm"><div className="flex justify-between gap-3"><span className="text-text-secondary">Supplier</span><span className="font-bold text-text-primary">{supplier?.name || "Supplier"}</span></div><div className="flex justify-between gap-3"><span className="text-text-secondary">Phone</span><span className="font-bold text-text-primary">{supplier?.phone || supplier?.contactPhone || "Not configured"}</span></div><div className="flex justify-between gap-3"><span className="text-text-secondary">Email</span><span className="font-bold text-text-primary">{supplier?.email || "Not configured"}</span></div></div></div>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-3"><div className="mb-3 type-title font-bold text-text-primary">Workflow Progress</div><div className="grid gap-2 sm:grid-cols-4">{workflowSteps.map((step, index) => { const active = workflowIndex === index; const complete = step.complete || workflowIndex > index; return <div key={step.key} className={`rounded-2xl border p-3 ${active ? "border-primary/30 bg-primary/8" : complete ? "border-emerald-200 bg-emerald-50/70" : "border-border bg-slate-50"}`}><div className="flex items-center gap-2"><span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-black ${complete ? "bg-emerald-600 text-white" : active ? "bg-primary text-white" : "bg-slate-200 text-text-muted"}`}>{index + 1}</span><span className="type-body-sm font-black text-text-primary">{step.label}</span></div><div className="mt-2 type-caption font-semibold text-text-secondary">{step.date ? formatDate(step.date) : "Pending"}</div></div>; })}</div></div>
      <div className="rounded-2xl border border-border bg-surface p-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><div className="type-title font-bold text-text-primary">Fulfillment</div><div className="type-caption text-text-secondary">{progress.received} / {progress.ordered} received</div></div><Badge tone={order.status === "partial_received" ? "warning" : progress.percent >= 100 ? "success" : "info"}>{progress.percent}% fulfilled</Badge></div><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${order.status === "partial_received" ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(100, progress.percent)}%` }} /></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><MetricCard label="Ordered Qty" value={progress.ordered} helper="Original order" size="compact" /><MetricCard label="Received Qty" value={progress.received} helper="Confirmed received" tone={progress.received ? "success" : "neutral"} size="compact" /><MetricCard label="Balance" value={balance} helper={order.status === "completed" && order.completionType === "partial" ? "Unfulfilled" : "Open balance"} tone={balance ? "warning" : "success"} size="compact" /></div></div>
      <div className="overflow-x-auto rounded-2xl border border-border"><table className="w-full min-w-[760px] text-left"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted"><tr><th className="px-3 py-2">Item</th><th>Order Qty</th><th>Received</th><th>Balance</th><th>Unit</th><th>Remark</th></tr></thead><tbody className="divide-y divide-border text-[13px]">{order.lines.map((line) => { const item = itemById.get(line.itemId); return <tr key={line.id || line.itemId}><td className="px-3 py-2 font-bold text-text-primary">{item?.name || "Inventory item"}</td><td>{line.requestedQty}</td><td>{line.receivedQty || 0}</td><td className={remainingQty(line) ? "font-bold text-amber-700" : "font-semibold text-emerald-700"}>{remainingQty(line)}</td><td>{line.unit || item?.unit || ""}</td><td>{line.remark || "-"}</td></tr>; })}</tbody></table></div>
      <div className="rounded-2xl border border-border p-3"><div className="mb-3 type-title font-bold text-text-primary">Receiving History</div>{order.receipts?.length ? <div className="space-y-3">{order.receipts.map((receipt) => { const receiptQty = (receipt.items || []).reduce((sum, line) => sum + Number(line.receivedQty || 0), 0); return <div key={receipt.id} className="relative pl-5"><span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-primary" /><div className="rounded-xl bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="type-body-sm font-black text-text-primary">{formatDate(receipt.receivedAt)}</div><Badge tone="success">+{receiptQty} qty</Badge></div><div className="mt-1 type-caption font-semibold text-text-secondary">Received By: {actorNameByAnyId(receipt.receivedBy)}</div>{receipt.remark ? <div className="mt-1 type-caption text-text-secondary">Remark: {receipt.remark}</div> : null}<div className="mt-2 space-y-1">{(receipt.items || []).map((line) => <div key={line.id} className="type-caption text-text-secondary">{itemById.get(line.itemId)?.name || "Inventory item"} · +{line.receivedQty} {line.unit}{line.remark ? ` · ${line.remark}` : ""}</div>)}</div></div></div>; })}</div> : <div className="type-caption font-semibold text-text-muted">No receiving records yet.</div>}</div>
      {order.cancellationReason ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 type-body-sm font-semibold text-rose-800">Cancellation reason: {order.cancellationReason}</div> : null}
    </div>
  </Modal>;
}
