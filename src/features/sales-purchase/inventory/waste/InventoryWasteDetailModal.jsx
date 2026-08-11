import Modal from "../../../../components/feedback/Modal.jsx";
import MetricCard from "../../../../components/ui/MetricCard.jsx";

export default function InventoryWasteDetailModal({ waste, item, outlet, category, movement, actorName, formatDate, outletDisplayCode, onClose, onPreviewPhoto }) {
  const evidenceUrl = waste.photoUrl || waste.photo_url || "";
  return (
    <Modal title="Waste Record Detail" description={`${outlet?.name || "Outlet"} · ${formatDate(waste.date || waste.createdAt)}`} size="lg" onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}>
      <div className="grid gap-3 md:grid-cols-2">
        <MetricCard label="Date" value={formatDate(waste.date || waste.createdAt)} helper="Waste date" size="compact" />
        <MetricCard label="Outlet" value={outlet?.name || "Outlet"} helper={outletDisplayCode(outlet)} size="compact" />
        <MetricCard label="Item" value={item?.name || "Inventory item"} helper={item?.sku || "No SKU"} size="compact" />
        <MetricCard label="Category" value={category?.name || "Uncategorized"} helper="Inventory category" size="compact" />
        <MetricCard label="Waste Type" value={String(waste.wasteType || "waste").replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase())} helper="Recorded classification" tone="warning" size="compact" />
        <MetricCard label="Quantity" value={`${waste.quantity || 0} ${waste.unit || item?.unit || ""}`.trim()} helper="Recorded waste amount" tone="warning" size="compact" />
        <MetricCard label="Recorded By" value={actorName} helper="Record owner" size="compact" />
        <MetricCard label="Movement Reference" value={movement?.reference || "—"} helper={movement ? "Inventory movement created" : "No movement linked"} size="compact" />
      </div>
      <div className="mt-3 rounded-2xl border border-border bg-slate-50 p-3 type-body-sm text-text-secondary">{waste.notes || "No notes recorded."}</div>
      <div className="mt-3 rounded-2xl border border-border bg-slate-50 p-3"><div className="type-caption font-semibold text-text-secondary">Evidence Photo</div>{evidenceUrl ? <button className="mt-2 block overflow-hidden rounded-2xl border border-border bg-white" type="button" onClick={() => onPreviewPhoto({ src: evidenceUrl, title: `${item?.name || "Waste"} evidence` })}><img className="max-h-72 w-full object-cover" src={evidenceUrl} alt="Waste evidence" /></button> : <div className="mt-2 type-body-sm font-semibold text-text-muted">No evidence photo uploaded.</div>}</div>
    </Modal>
  );
}
