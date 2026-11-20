import { useRef, useState } from "react";
import { inventoryLifecycleService } from "../../../../services/inventoryLifecycleService.js";
import DateTimePickerField from "../../../../components/forms/DateTimePickerField.jsx";
import { toClosingLocalTime, toPhysicalCountCutoff } from "./monthEndClosing.js";

function formatCutoff(value) {
  return toClosingLocalTime(value).replace("T", " ");
}

export default function ClosingStockApproval({ check, context, itemById, canApprove, formatCurrency }) {
  const [published, setPublished] = useState(context.published);
  const [lines, setLines] = useState(null);
  const [reason, setReason] = useState("");
  const [cutoffInput, setCutoffInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(null);
  const isSource = published?.source_audit_id === check.id;
  const legacyCutoff = check.physicalCountCutoff;
  const recordedCutoff = legacyCutoff || (isSource ? published.physical_count_cutoff : null);
  const physicalCountCutoff = legacyCutoff || toPhysicalCountCutoff(cutoffInput);
  const physicalTime = Date.parse(physicalCountCutoff);
  const cutoffAfterSubmit = physicalTime > Date.parse(check.submittedAt);
  const validCutoff = Number.isFinite(physicalTime) && !cutoffAfterSubmit;
  const requiresReconciliation = validCutoff && physicalTime !== Date.parse(context.month_end_cutoff);
  const hasCosts = check.rows.length > 0 && check.rows.every(row => row.unit && Number.isFinite(row.unitCostSnapshot));
  const validLines = !requiresReconciliation || lines?.every(line =>
    line.quantity !== "" && Number.isFinite(Number(line.quantity)) && Number(line.quantity) >= 0 && line.evidence.trim());

  function startApproval() {
    const existing = new Map((isSource ? published.reconciliation ?? [] : []).map(line => [line.item_id, line]));
    setCutoffInput(toClosingLocalTime(recordedCutoff));
    setLines(check.rows.map(row => ({
      itemId: row.itemId, actualCount: row.actualCount, unit: row.unit, quantity: existing.get(row.itemId)?.month_end_quantity ?? "",
      evidence: existing.get(row.itemId)?.evidence || "",
    })));
    setReason("");
    setError("");
  }

  function updateLine(itemId, patch) {
    setLines(current => current.map(line => line.itemId === itemId ? { ...line, ...patch } : line));
  }

  async function approve(event) {
    event.preventDefault();
    if (busy || !validCutoff || !validLines || (published && !reason.trim())) return;
    const reconciliation = requiresReconciliation ? lines.map(line => ({
      item_id: line.itemId, month_end_quantity: Number(line.quantity), evidence: line.evidence.trim(),
    })) : [];
    const payload = { checkId: check.id, reconciliation, supersedesId: published?.id ?? null, reason: reason.trim() || null,
      physicalCountCutoff: legacyCutoff ? null : physicalCountCutoff };
    const signature = JSON.stringify(payload);
    if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const result = await inventoryLifecycleService.approveClosingStock({ ...payload, requestId: pending.current.requestId });
      setPublished({ ...result, reconciliation });
      setLines(null);
      pending.current = null;
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="Closing Stock approval" className="space-y-3 rounded-xl border border-border p-4">
    <h3 className="font-semibold">Month-End Closing</h3>
    <dl className="grid gap-2 text-sm sm:grid-cols-3">
      <div><dt className="text-text-secondary">Accounting Month</dt><dd>{check.accountingMonth.slice(0, 7)}</dd></div>
      <div><dt className="text-text-secondary">Accounting Cutoff (MYT)</dt><dd><time dateTime={context.month_end_cutoff}>{formatCutoff(context.month_end_cutoff)}</time></dd></div>
      <div><dt className="text-text-secondary">Physical Count Cutoff (MYT)</dt><dd>{recordedCutoff
        ? <time dateTime={recordedCutoff}>{formatCutoff(recordedCutoff)}</time> : "Awaiting confirmation"}</dd></div>
    </dl>
    <p className="text-sm" role="status">{published
      ? `Published revision ${published.revision} · ${formatCurrency(published.amount)} · ${isSource ? "This audit" : "Another audit for this month"}`
      : "Awaiting approval"}</p>
    {canApprove && !hasCosts && <p className="text-sm text-text-secondary">A pinned unit cost is required for every item. Submit a new closing audit after the costs are configured.</p>}
    {canApprove && !context.period_ended && <p className="text-sm text-text-secondary">Approval opens after the accounting month ends.</p>}
    {canApprove && hasCosts && context.period_ended && lines === null &&
      <button className="btn-secondary" type="button" onClick={startApproval}>{published ? "Prepare Closing Correction" : "Review Closing Approval"}</button>}
    {lines !== null && <form onSubmit={approve} className="space-y-3">
      {!legacyCutoff && <div className="max-w-lg">
        <DateTimePickerField label="Confirm Physical Count Cutoff" dateLabel="Physical Count Date" timeLabel="Physical Count Time"
          value={cutoffInput} onChange={setCutoffInput} disabled={busy} withSeconds timezone="Malaysia time"
          helper="Use the actual count time supported by your count evidence."
          error={cutoffAfterSubmit ? "Choose a time on or before Count Submitted At." : ""} />
      </div>}
      {requiresReconciliation ? <>
        <p className="text-sm text-text-secondary">For each item, verify the quantity at month-end and record the supporting evidence, including when the quantity stayed the same.</p>
        <div className="grid max-h-80 gap-3 overflow-auto pr-1">{lines.map(line => {
          const name = itemById.get(line.itemId)?.name || "Inventory item";
          return <fieldset key={line.itemId} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <legend className="px-1 text-sm font-semibold">{name} · Counted {line.actualCount} {line.unit}</legend>
            <label className="grid min-w-0 gap-1 text-sm">Month-End Quantity
              <input className="control w-full" aria-label={`Month-End Quantity for ${name}`} type="number" min="0" max="99999999999.999" step="0.001"
                value={line.quantity} onChange={event => updateLine(line.itemId, { quantity: event.target.value })} required disabled={busy} />
            </label>
            <label className="grid min-w-0 gap-1 text-sm">Supporting Evidence
              <input className="control w-full" aria-label={`Supporting Evidence for ${name}`} value={line.evidence}
                onChange={event => updateLine(line.itemId, { evidence: event.target.value })} maxLength={2000} required disabled={busy} />
            </label>
          </fieldset>;
        })}</div>
      </> : validCutoff && <p className="text-sm text-text-secondary">The confirmed count matches the accounting cutoff. Approval uses the submitted actual quantities and pinned unit costs.</p>}
      {published && <label className="grid gap-1 text-sm">Correction Reason
        <textarea className="control w-full" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} required disabled={busy} />
      </label>}
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" type="submit" disabled={busy || !validCutoff || !validLines || Boolean(published && !reason.trim())}>
          {busy ? "Publishing…" : published ? "Approve Closing Correction" : "Approve Closing Stock"}
        </button>
        <button className="btn-secondary" type="button" disabled={busy} onClick={() => setLines(null)}>Cancel</button>
      </div>
    </form>}
  </section>;
}
