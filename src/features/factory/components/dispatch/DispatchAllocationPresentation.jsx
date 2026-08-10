import { AlertTriangle } from "lucide-react";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import Modal from "../../../../components/feedback/Modal.jsx";
import { formatFactoryDate } from "../../utils/factoryDates.js";
import { packagingTypeLabel, pluralizePackagingType, quantity } from "../../utils/factoryFormatters.js";
import { dispatchAllocationTotal } from "../allocation/finishedGoodBatchAllocationHelpers.js";
import { validDispatchPackQty } from "./finishedGoodDispatchHelpers.js";

function batchTypeLabel(value) {
  if (value === "adjustment") return "Adjustment";
  if (value === "legacy_unallocated") return "Legacy / Unallocated";
  return "Production";
}

export function DispatchAllocationSummary({ item, sku, onEdit }) {
  const allocations = item.allocations || [];
  const total = dispatchAllocationTotal(allocations);
  const needsUpdate = Boolean(item.allocation_required) || total !== Number(item.quantity || 0);
  const singleAllocationLabel = allocations.length === 1 && allocations[0].batch_type !== "production"
    ? batchTypeLabel(allocations[0].batch_type)
    : allocations[0]?.batch_no || "Batch";
  if (!allocations.length) {
    return (
      <div className="space-y-1">
        <div className="text-xs font-semibold text-text-muted">{item.batch_no ? `${item.batch_no} · Legacy batch reference` : "No allocation"}</div>
        {onEdit && validDispatchPackQty(item.quantity) ? <button className="text-xs font-bold text-primary hover:underline" type="button" onClick={onEdit}>Allocate batches</button> : null}
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs font-bold text-text-primary">{allocations.length === 1 ? `${singleAllocationLabel} · ${quantity(total, pluralizePackagingType(packagingTypeLabel(sku), total))}` : `${allocations.length} Batches · ${quantity(total, pluralizePackagingType(packagingTypeLabel(sku), total))}`}</div>
      {!item.read_only ? allocations.slice(0, 2).map((allocation) => <div key={allocation.batch_id || allocation.batch_balance_id} className="truncate text-[11px] text-text-secondary">{allocation.batch_no || "Batch"} · {quantity(allocation.quantity)}</div>) : null}
      {allocations.length === 1 && allocations[0].expiry_date ? <div className="text-[11px] text-text-secondary">Expiry {formatFactoryDate(allocations[0].expiry_date)}</div> : null}
      {needsUpdate ? <div className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800"><AlertTriangle size={11} /> Allocation update required</div> : null}
      {onEdit ? <button className="block text-xs font-bold text-primary hover:underline" type="button" onClick={onEdit}>{item.read_only ? "View Batch Allocation" : "Edit Allocation"}</button> : null}
    </div>
  );
}

export function DispatchStockAvailability({ sku, availability, onRetry }) {
  const label = <div className="text-[10.5px] font-semibold text-text-muted">Stock Available</div>;
  if (!sku) return <div>{label}<div className="mt-1 text-sm font-bold text-text-muted">—</div></div>;
  if (!availability || availability.loading) return <div>{label}<div className="mt-1 text-xs font-semibold text-text-muted">Loading…</div></div>;
  if (!availability.data || availability.isStale || availability.errorKind) return (
    <div className="space-y-1">
      {label}
      <div className="text-sm font-bold text-text-muted">—</div>
      {availability.errorKind === "load" && onRetry ? <button className="text-xs font-bold text-primary hover:underline" type="button" onClick={onRetry}>Retry</button> : null}
    </div>
  );
  const allocatable = Number(availability.data.allocatable_batch_balance || 0);
  const packagingType = pluralizePackagingType(packagingTypeLabel(sku), allocatable);
  return (
    <div className="min-w-[120px]">
      {label}
      <div className={`mt-1 text-sm font-black ${allocatable > 0 ? "text-emerald-700" : "text-rose-700"}`}>{quantity(allocatable, packagingType)}</div>
    </div>
  );
}

export function ReadOnlyBatchAllocationModal({ title = "Batch Allocation", subtitle = "", allocations = [], onClose }) {
  return (
    <Modal title={title} description={subtitle} size="lg" onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}>
      <div className="space-y-3">
        {allocations.length ? allocations.map((allocation) => (
          <div key={allocation.id || allocation.allocation_id || allocation.batch_id || allocation.batch_balance_id} className="rounded-xl border border-border bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-bold text-text-primary">{allocation.batch_no || batchTypeLabel(allocation.batch_type)}</div>
                <div className="mt-1 text-xs font-semibold text-text-secondary">{batchTypeLabel(allocation.batch_type)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10.5px] font-semibold text-text-muted">Allocated Qty</div>
                <div className="font-black text-text-primary">{quantity(allocation.quantity)}</div>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div><span className="font-semibold text-text-muted">Manufacturing Date:</span> <span className="font-semibold text-text-primary">{formatFactoryDate(allocation.manufacturing_date)}</span></div>
              <div><span className="font-semibold text-text-muted">Expiry Date:</span> <span className="font-semibold text-text-primary">{allocation.expiry_date ? formatFactoryDate(allocation.expiry_date) : "No Expiry Recorded"}</span></div>
              <div><span className="font-semibold text-text-muted">Storage:</span> <span className="font-semibold text-text-primary">{allocation.storage_location || "—"}</span></div>
              <div><span className="font-semibold text-text-muted">Current Balance:</span> <span className="font-semibold text-text-primary">{allocation.current_balance == null ? "—" : quantity(allocation.current_balance)}</span></div>
            </div>
            {allocation.location_valid === false ? <div className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-xs font-bold text-rose-700">Storage location unavailable · {allocation.location_issue}</div> : null}
          </div>
        )) : <EmptyState title="No Batch Allocations" description="No batch allocation rows are linked to this record." />}
      </div>
    </Modal>
  );
}
