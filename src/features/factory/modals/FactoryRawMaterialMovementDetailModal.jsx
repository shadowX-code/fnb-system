import Modal from "../../../components/feedback/Modal.jsx";
import Badge from "../../../components/ui/Badge.jsx";

export default function FactoryRawMaterialMovementDetailModal({ movement, movementMeta, formatQuantity, formatDateTime, onOpenReference, openingReference = false, onClose }) {
  const details = [
    ["Movement Type", <Badge tone={movementMeta.tone}>{movementMeta.label}</Badge>],
    ["Reference", movement.reference_no ? <button className="font-bold text-primary underline decoration-dotted underline-offset-4 hover:text-emerald-800 disabled:cursor-wait disabled:opacity-60" type="button" disabled={openingReference} onClick={() => onOpenReference?.(movement)}>{openingReference ? "Opening..." : movement.reference_no}</button> : "—"],
    ["Raw Material", [movement.raw_material_code, movement.raw_material_name].filter(Boolean).join(" · ") || "—"],
    ["Internal Batch", movement.internal_batch_no || "—"], ["Supplier Lot", movement.supplier_lot_no || "—"],
    ["Qty", formatQuantity(movement.quantity, movement.uom, { signed: true })],
    ["Balance After", movement.balance_after == null ? "—" : formatQuantity(movement.balance_after, movement.uom)],
    ["Storage", movement.storage_location || "—"], ["Operator", movement.created_by_name || "—"],
    ["Created At", formatDateTime(movement.created_at)], ["Remarks", movement.remarks || movement.notes || "—"],
  ];
  return <Modal title="Movement Detail" description="Read-only Raw Material Movement audit record" onClose={onClose} size="lg"><div className="divide-y divide-border rounded-lg border border-border bg-white px-5">{details.map(([label, value]) => <div key={label} className="grid gap-1 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-start"><div className="text-sm font-semibold text-text-secondary">{label}</div><div className="min-w-0 break-words text-sm font-bold text-text-primary">{value}</div></div>)}</div></Modal>;
}
