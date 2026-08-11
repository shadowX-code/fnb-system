import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import Modal from "../../../../components/feedback/Modal.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import { Field, inputClass } from "../FactoryBulkSelectionModal.jsx";
import { formatFactoryDate } from "../../utils/factoryDates.js";
import { packSizeText, packagingTypeLabel, pluralizePackagingType, quantity } from "../../utils/factoryFormatters.js";
import { operatorFinishedGoodBatchNo } from "../../utils/factoryReferences.js";

function batchTypeLabel(value) {
  if (value === "adjustment") return "Adjustment";
  if (value === "legacy_unallocated") return "Legacy / Unallocated";
  return "Production";
}

export default function DispatchBatchAllocationModal({ item, sku, batches, unavailableBatches = [], batchAvailable = null, availableToThisLine = null, otherLinesAllocated = 0, loading, error, errorKind = "", isStale = false, autoAllocateOnLoad, allowExpired = false, referenceDate = "", purpose = "dispatch", onRetry, onClose, onApply }) {
  const [quantities, setQuantities] = useState(() => Object.fromEntries((item.allocations || []).map((allocation) => [allocation.batch_id || allocation.batch_balance_id, String(allocation.quantity)])));
  const [manualEditing, setManualEditing] = useState(false);
  const autoAllocatedRef = useRef(false);
  const requiredQty = Number(item.quantity || 0);
  const eligibleBatchIds = new Set(batches.map((batch) => batch.batch_id));
  const eligibleBatchCapacity = batches.reduce((sum, batch) => sum + Number(batch.available_qty || 0), 0);
  const explicitBatchAvailable = batchAvailable != null && Number.isFinite(Number(batchAvailable));
  const explicitAvailableToThisLine = availableToThisLine != null && Number.isFinite(Number(availableToThisLine));
  const resolvedBatchAvailable = Math.max(explicitBatchAvailable ? Number(batchAvailable) : eligibleBatchCapacity, 0);
  const resolvedAvailableToThisLine = Math.max(
    explicitAvailableToThisLine
      ? Number(availableToThisLine)
      : explicitBatchAvailable
        ? resolvedBatchAvailable
        : eligibleBatchCapacity,
    0,
  );
  const staleAllocationKeys = Object.entries(quantities).filter(([batchId, value]) => value !== "" && !eligibleBatchIds.has(batchId));
  const allocatedQty = Object.entries(quantities).reduce((sum, [batchId, value]) => eligibleBatchIds.has(batchId) ? sum + Number(value || 0) : sum, 0);
  const shortage = Math.max(requiredQty - resolvedAvailableToThisLine, 0);
  const hasProvisionalReservations = batches.some((batch) => Number(batch.provisional_qty || 0) > 0);
  const invalidQuantity = Object.values(quantities).some((value) => value !== "" && (!Number.isInteger(Number(value)) || Number(value) < 0));
  const exceedsAvailability = batches.some((batch) => Number(quantities[batch.batch_id] || 0) > Number(batch.available_qty || 0));
  const invalidLocationAllocations = (item.allocations || []).filter((allocation) => (
    allocation.location_valid === false && Number(quantities[allocation.batch_id || allocation.batch_balance_id] || 0) > 0
  ));
  const canApply = !loading && !error && !isStale
    && Number.isInteger(requiredQty) && requiredQty > 0
    && requiredQty <= resolvedAvailableToThisLine
    && allocatedQty === requiredQty
    && !staleAllocationKeys.length
    && !invalidQuantity
    && !exceedsAvailability
    && !invalidLocationAllocations.length;
  const isExpired = (batch) => Boolean(referenceDate && batch.expiry_date && batch.expiry_date < referenceDate);
  const isStockCheck = purpose === "stock-check";

  function autoAllocate() {
    let remaining = requiredQty;
    const next = {};
    batches.forEach((batch) => {
      const allocation = Math.min(remaining, Math.floor(Number(batch.available_qty || 0)));
      if (allocation > 0) next[batch.batch_id] = String(allocation);
      remaining -= allocation;
    });
    setQuantities(next);
  }

  useEffect(() => {
    if (!autoAllocateOnLoad || loading || error || autoAllocatedRef.current) return;
    autoAllocatedRef.current = true;
    autoAllocate();
  }, [autoAllocateOnLoad, batches, error, loading]);

  function applyAllocation() {
    if (!canApply) return;
    onApply(batches.flatMap((batch) => {
      const allocationQty = Number(quantities[batch.batch_id] || 0);
      return allocationQty > 0 ? [{ ...batch, quantity: allocationQty }] : [];
    }));
  }

  return (
    <Modal
      title={isStockCheck ? "Suggested Batch Resolution (FEFO)" : "Batch Allocation"}
      description={[sku?.product_family_name || sku?.product_name_en || sku?.product_name, sku?.product_code, sku?.variant_name || packSizeText(sku)].filter(Boolean).join(" · ")}
      size="xl"
      onClose={onClose}
      panelClassName="max-md:h-[calc(100dvh-1rem)] max-md:max-h-none max-md:rounded-xl"
      footerClassName="max-md:sticky"
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!canApply} onClick={applyAllocation}>{isStockCheck ? "Accept Suggested Resolution" : "Apply Allocation"}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {[
            [isStockCheck ? "Missing Qty" : "Required Qty", requiredQty],
            [isStockCheck ? "Resolved Qty" : "Allocated Qty", allocatedQty],
            ["Stock Available", resolvedAvailableToThisLine],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-slate-50 px-3 py-2">
              <div className="text-[10.5px] font-semibold text-text-muted">{label}</div>
              <div className="mt-1 text-sm font-black text-text-primary">{quantity(value, pluralizePackagingType(packagingTypeLabel(sku), value))}</div>
            </div>
          ))}
        </div>
        {otherLinesAllocated > 0 || hasProvisionalReservations ? <div className="text-xs font-semibold text-text-secondary">Availability considers other active Draft Dispatches.</div> : null}

        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" type="button" disabled={loading || !batches.length} onClick={autoAllocate}><RefreshCw size={14} /> Auto Allocate FEFO</button>
          {isStockCheck ? <button className="btn-secondary" type="button" disabled={loading} onClick={() => {
            if (manualEditing) autoAllocate();
            setManualEditing((current) => !current);
          }}>{manualEditing ? "Use Suggested Values" : "Edit Manually"}</button> : null}
          <button className="btn-secondary" type="button" disabled={loading} onClick={() => setQuantities({})}>Clear Allocation</button>
        </div>

        {isStockCheck && unavailableBatches.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">{unavailableBatches.length} batch balance{unavailableBatches.length === 1 ? " is" : "s are"} excluded: {[...new Set(unavailableBatches.map((batch) => batch.exclusion_reason).filter(Boolean))].join(" · ") || "Storage or reconciliation metadata unavailable"}.</div> : null}

        {loading ? <div className="rounded-xl border border-border bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-text-secondary">Loading available batches...</div> : null}
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            <div>{error}</div>
            {errorKind === "load" ? <button className="mt-2 underline" type="button" onClick={onRetry}>Retry</button> : null}
          </div>
        ) : null}
        {isStale ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800"><div>Unable to load the latest batch availability. Showing the last successfully loaded results.</div><button className="mt-2 underline" type="button" onClick={onRetry}>Retry</button></div> : null}
        {staleAllocationKeys.length ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">One or more selected batches are no longer available. Please reallocate.</div> : null}
        {!loading && invalidLocationAllocations.length ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <div className="font-bold">This batch is not available from an active Finished Goods location.</div>
            <div className="mt-1 text-xs">Clear or auto-allocate again before applying.</div>
          </div>
        ) : null}
        {!loading && !error && !batches.length ? <EmptyState title="No Available Batches" description={allowExpired ? "No active Finished Goods batches have available pack balance." : "No active, unexpired Finished Goods batches have available pack balance."} /> : null}

        {!error && batches.length ? (
          <div className="space-y-3 md:hidden">
            {batches.map((batch) => (
              <div key={batch.batch_id} className="rounded-xl border border-border bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div><div className="flex flex-wrap items-center gap-2"><span className="font-bold text-text-primary">{operatorFinishedGoodBatchNo(batch)}</span><Badge tone={batch.batch_type === "legacy_unallocated" ? "warning" : "neutral"}>{batchTypeLabel(batch.batch_type)}</Badge>{isExpired(batch) ? <Badge tone="danger">Expired</Badge> : null}</div><div className="text-xs text-text-secondary">{batch.storage_location || "—"}</div></div>
                  <div className="text-right text-xs"><div className="font-bold text-text-primary">{quantity(batch.available_qty, pluralizePackagingType(packagingTypeLabel(sku), batch.available_qty))}</div><div className="text-text-muted">Available</div></div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-secondary">
                  <div><div className="font-semibold text-text-muted">Manufactured</div>{formatFactoryDate(batch.manufacturing_date)}</div>
                  <div><div className="font-semibold text-text-muted">Expiry</div>{batch.expiry_date ? formatFactoryDate(batch.expiry_date) : <span className="font-semibold text-amber-700">No Expiry Recorded</span>}</div>
                </div>
                {isStockCheck && !manualEditing ? <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><div className="text-xs font-semibold text-text-muted">Suggested Reduction</div><div className="font-bold text-rose-700">-{Number(quantities[batch.batch_id] || 0)}</div></div><div><div className="text-xs font-semibold text-text-muted">Remaining Qty</div><div className="font-bold text-text-primary">{Number(batch.available_qty || 0) - Number(quantities[batch.batch_id] || 0)}</div></div></div> : <div className="mt-3"><Field label={isStockCheck ? "Reduction Qty" : "Allocate Qty"}><input className={inputClass()} type="number" min="0" step="1" value={quantities[batch.batch_id] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [batch.batch_id]: event.target.value }))} /></Field></div>}
              </div>
            ))}
          </div>
        ) : null}
        {!error && batches.length ? (
          <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
            <table className="w-full min-w-[760px] text-left">
              <thead><tr className="border-b border-border bg-slate-50 text-[11px] font-semibold text-text-muted">
                <th className="px-3 py-2.5">Batch No.</th>{isStockCheck ? <><th className="px-3 py-2.5">Current Qty</th><th className="px-3 py-2.5">Suggested Reduction</th><th className="px-3 py-2.5">Remaining Qty</th></> : <><th className="px-3 py-2.5">Manufacturing Date</th><th className="px-3 py-2.5">Expiry Date</th><th className="px-3 py-2.5">Storage Location</th><th className="px-3 py-2.5">Available Qty</th><th className="px-3 py-2.5">Allocate Qty</th></>}
              </tr></thead>
              <tbody>{batches.map((batch) => (
                <tr key={batch.batch_id} className="border-b border-border last:border-0">
                  <td className="px-3 py-3 text-sm font-bold text-text-primary"><div className="flex flex-wrap items-center gap-2"><span>{operatorFinishedGoodBatchNo(batch)}</span><Badge tone={batch.batch_type === "legacy_unallocated" ? "warning" : "neutral"}>{batchTypeLabel(batch.batch_type)}</Badge>{isExpired(batch) ? <Badge tone="danger">Expired</Badge> : null}</div></td>
                  {isStockCheck ? <><td className="px-3 py-3 text-sm font-bold text-text-primary">{quantity(batch.available_qty, "Packs")}</td><td className="w-44 px-3 py-3">{manualEditing ? <input className={inputClass()} type="number" min="0" step="1" value={quantities[batch.batch_id] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [batch.batch_id]: event.target.value }))} /> : <span className="font-bold text-rose-700">-{Number(quantities[batch.batch_id] || 0)} Packs</span>}</td><td className="px-3 py-3 text-sm font-bold text-text-primary">{quantity(Number(batch.available_qty || 0) - Number(quantities[batch.batch_id] || 0), "Packs")}</td></> : <><td className="whitespace-nowrap px-3 py-3 text-sm text-text-secondary">{formatFactoryDate(batch.manufacturing_date)}</td><td className="whitespace-nowrap px-3 py-3 text-sm text-text-secondary">{batch.expiry_date ? formatFactoryDate(batch.expiry_date) : <span className="font-semibold text-amber-700">No Expiry Recorded</span>}</td><td className="px-3 py-3 text-sm text-text-secondary"><div className="font-semibold text-text-primary">{batch.storage_location || "—"}</div><div className="text-xs">{batch.storage_location_type || "—"}</div></td><td className="px-3 py-3 text-sm font-bold text-text-primary">{quantity(batch.available_qty, pluralizePackagingType(packagingTypeLabel(sku), batch.available_qty))}</td><td className="w-40 px-3 py-3"><input className={inputClass()} type="number" min="0" step="1" value={quantities[batch.batch_id] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [batch.batch_id]: event.target.value }))} /></td></>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}

        {!loading && !error && shortage > 0 ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">Only {quantity(resolvedAvailableToThisLine, pluralizePackagingType(packagingTypeLabel(sku), resolvedAvailableToThisLine).toLowerCase())} {resolvedAvailableToThisLine === 1 ? "is" : "are"} available. {isStockCheck ? "Review batch reconciliation before submitting." : "Reduce the Dispatch quantity."}</div> : null}
        {!loading && !error && shortage === 0 && allocatedQty !== requiredQty ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">Allocate exactly {quantity(requiredQty, pluralizePackagingType(packagingTypeLabel(sku), requiredQty))} before applying.</div> : null}
        {shortage === 0 && exceedsAvailability ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">One or more selected batches exceed the available quantity. Please reallocate.</div> : null}
      </div>
    </Modal>
  );
}
