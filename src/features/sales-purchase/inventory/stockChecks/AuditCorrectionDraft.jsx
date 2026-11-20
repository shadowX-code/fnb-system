import { useId, useRef, useState } from "react";
import Modal from "../../../../components/feedback/Modal.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import DataTable from "../../../../components/tables/DataTable.jsx";
import { inventoryLifecycleService } from "../../../../services/inventoryLifecycleService.js";
import { invalidateInventoryReads } from "../../../../services/inventoryRevalidation.js";
import { auditItemChanged, sourceCountLabel } from "./inventoryStockCheckReadModel.js";

export default function AuditCorrectionDraft({ check, source, itemById, onClose, onOpenSource, onSubmitted }) {
  const [rows, setRows] = useState(check.rows);
  const [reason, setReason] = useState(check.correctionReason || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const pending = useRef(null);
  const formId = useId();
  const sourceByItem = new Map(source.rows.map(row => [row.itemId, row]));
  const changed = new Set(rows.filter(row => auditItemChanged(row, sourceByItem.get(row.itemId))).map(row => row.itemId));
  const visibleRows = onlyChanged ? rows.filter(row => changed.has(row.itemId)) : rows;
  const missing = rows.some(row => row.actualCount === "" && (check.accountingMonth || sourceByItem.get(row.itemId)?.actualCount !== ""));

  function update(itemId, patch) {
    setNotice("");
    setRows(current => current.map(row => row.itemId === itemId ? { ...row, ...patch } : row));
  }

  async function save(event, status) {
    event.preventDefault();
    if (busy || (status === "draft" && !event.currentTarget.form?.reportValidity())) return;
    if (status === "submitted" && (!reason.trim() || !changed.size || missing)) return;
    const payload = {
      check: { id: check.id, outlet_id: check.outletId, stock_check_type: "audit", status, correction_reason: reason.trim() || null },
      items: rows.map(row => ({ item_id: row.itemId, actual_count_quantity: row.actualCount === "" ? null : Number(row.actualCount), notes: row.notes })),
    };
    const signature = JSON.stringify(payload);
    if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await inventoryLifecycleService.saveInventoryStockCheck({ ...payload, requestId: pending.current.id });
      pending.current = null;
      invalidateInventoryReads({ source: "stock-check", outletId: check.outletId, checkId: check.id });
      if (status === "submitted") onSubmitted();
      else setNotice("Correction draft saved.");
    } catch (cause) {
      setError(cause.message || "Unable to save the correction.");
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: "item", header: "Item", render: row => <div className="flex flex-wrap items-center gap-2">
      <strong>{itemById.get(row.itemId)?.name || "Inventory item"}</strong>
      {changed.has(row.itemId) && <Badge tone="info">Changed</Badge>}
    </div> },
    { key: "source", header: "Source count", className: "tabular-nums", render: row => sourceCountLabel(sourceByItem.get(row.itemId)) },
    { key: "count", header: "Corrected count", render: row => <div className="flex items-center gap-2">
      <input className="control w-28 tabular-nums" type="number" min="0" max="99999999999.999" step="0.001"
        aria-label={`Corrected count for ${itemById.get(row.itemId)?.name || "inventory item"}`}
        value={row.actualCount} disabled={busy} onChange={event => update(row.itemId, { actualCount: event.target.value })} />
      <span className="type-caption text-text-secondary">{row.unit}</span>
    </div> },
    { key: "notes", header: "Item notes", className: "max-[700px]:w-full", render: row => {
      const original = sourceByItem.get(row.itemId);
      return <>
        <input className="control w-full" aria-label={`Notes for ${itemById.get(row.itemId)?.name || "inventory item"}`}
          value={row.notes} disabled={busy} onChange={event => update(row.itemId, { notes: event.target.value })} />
        {row.notes !== original?.notes && <div className="mt-1 type-caption text-text-secondary">Source note · {original?.notes || "—"}</div>}
        {original?.skipReason && <div className="mt-1 type-caption text-text-secondary">Source skip reason · {original.skipReason}</div>}
      </>;
    } },
  ];

  return <Modal title="Audit Correction Draft" description={check.auditName} size="2xl"
    onClose={busy ? undefined : onClose} footer={<>
      <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Close</button>
      <button type="button" className="btn-secondary" form={formId} disabled={busy} onClick={event => save(event, "draft")}>Save Draft</button>
      <button type="submit" form={formId} className="btn-primary" disabled={busy || !reason.trim() || !changed.size || missing}>
        {busy ? "Saving…" : "Submit Correction"}
      </button>
    </>}>
    <form id={formId} onSubmit={event => save(event, "submitted")} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="type-body-sm text-text-secondary">Source audit · {source.auditName}</p>
          {check.accountingMonth && <p className="type-caption text-text-secondary">Accounting Month · {check.accountingMonth.slice(0, 7)}</p>}
          {check.notes && <p className="type-caption break-words text-text-secondary">Audit notes · {check.notes}</p>}
        </div>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onOpenSource}>View Source Audit</button>
      </div>
      <label className="grid gap-1 type-body-sm font-semibold">Correction Reason
        <textarea className="control min-h-20 w-full py-2" value={reason} maxLength={2000} disabled={busy}
          onChange={event => { setReason(event.target.value); setNotice(""); }} />
      </label>
      {check.accountingMonth && <p className="type-caption text-text-secondary">Closing Approval publishes the corrected valuation after submission.</p>}
      {error && <p className="type-body-sm text-rose-700" role="alert">{error}</p>}
      {notice && <p className="type-body-sm text-text-secondary" role="status">{notice}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="type-body-sm font-semibold" aria-live="polite">{changed.size} of {rows.length} items affected</p>
        <label className="flex items-center gap-2 type-body-sm">
          <input type="checkbox" checked={onlyChanged} onChange={event => setOnlyChanged(event.target.checked)} /> Affected items only
        </label>
      </div>
      {missing && <p className="type-caption text-text-secondary">Enter an actual count for every required item before submitting.</p>}
      <div className="overflow-hidden rounded-xl border border-border">
        <DataTable columns={columns} rows={visibleRows} getRowKey={row => row.itemId}
          density="compact" columnSpacing="compact" mobileLayout="stack" minWidth={0} />
      </div>
      {visibleRows.length === 0 && <p className="type-caption text-text-secondary">No affected items yet.</p>}
    </form>
  </Modal>;
}
