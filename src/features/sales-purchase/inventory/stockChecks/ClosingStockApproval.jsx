import { useRef, useState } from "react";
import { inventoryLifecycleService } from "../../../../services/inventoryLifecycleService.js";
import { invalidateInventoryReads } from "../../../../services/inventoryRevalidation.js";
import DateTimePickerField from "../../../../components/forms/DateTimePickerField.jsx";
import { formatClosingError, formatClosingMonthLabel, isValidClosingQuantity, toClosingLocalTime, toPhysicalCountCutoff } from "./monthEndClosing.js";

import { hasPinnedAuditCost, hasUsableAuditCount } from "./auditStockCheckValuation.js";

function formatCutoff(value) {
  return toClosingLocalTime(value).replace("T", " ");
}

export default function ClosingStockApproval({ check, context, itemById, canApprove, formatCurrency, onShowUnvalued, onStartClosing }) {
  const [published, setPublished] = useState(context?.published);
  const [lines, setLines] = useState(null);
  const [reason, setReason] = useState("");
  const [cutoffInput, setCutoffInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(null);
  const isSource = Boolean(published && published.source_audit_id === check.id);
  const legacyCutoff = check.physicalCountCutoff;
  const recordedCutoff = legacyCutoff || (isSource ? published.physical_count_cutoff : context?.prior_confirmed_cutoff);
  const physicalCountCutoff = legacyCutoff || toPhysicalCountCutoff(cutoffInput);
  const physicalTime = Date.parse(physicalCountCutoff);
  const submittedTime = Date.parse(context?.count_evidence_submitted_at || check.submittedAt);
  const cutoffAfterSubmit = physicalTime > submittedTime;
  const validCutoff = Number.isFinite(physicalTime) && Number.isFinite(submittedTime) && !cutoffAfterSubmit;
  const requiresReconciliation = validCutoff && physicalTime !== Date.parse(context?.month_end_cutoff);
  const validLines = !requiresReconciliation || lines?.every(line =>
    isValidClosingQuantity(line.quantity) && line.evidence.trim().length > 0);
  const itemIds = check.rows.map(row => row.itemId).sort();
  const rosterMatches = itemIds.length > 0 && itemIds.length === check.closingItemIds?.length
    && new Set(itemIds).size === itemIds.length && itemIds.every((id, index) => id && id === check.closingItemIds[index]);
  const uncounted = check.rows.filter(row => !hasUsableAuditCount(row)).length;
  const missingUnits = check.rows.filter(row => !row.unit?.trim()).length;
  const missingCosts = check.rows.filter(row => !hasPinnedAuditCost(row)).length;
  const month = formatClosingMonthLabel(check.accountingMonth);
  const evidenceIssues = [
    !month && "This audit has no recorded Closing Month.",
    !rosterMatches && "A complete frozen item list is required.",
    uncounted > 0 && `${uncounted} ${uncounted === 1 ? "item has" : "items have"} no usable count.`,
    missingUnits > 0 && `${missingUnits} ${missingUnits === 1 ? "item has" : "items have"} no recorded count unit.`,
    missingCosts > 0 && `${missingCosts} ${missingCosts === 1 ? "item is" : "items are"} missing a valid pinned unit cost.`,
  ].filter(Boolean);
  const blocked = evidenceIssues.length > 0 || !context?.period_ended || context.approval_blocked;
  const status = published ? `Approved · ${formatCurrency(published.amount)}`
    : blocked ? "Not ready to confirm" : "Awaiting closing review";

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
    if (!canApprove || blocked || busy || !validCutoff || !validLines || (published && !reason.trim())) return;
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
      invalidateInventoryReads({ source: "closing-stock", outletId: check.outletId, checkId: check.id });
    } catch (cause) {
      setError(formatClosingError(cause.message));
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="Closing Stock" className="space-y-3 rounded-xl border border-border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="font-semibold">Closing Stock</h3>
        <p className="type-caption text-text-secondary">Closing Month · {month || "Not recorded"}</p>
      </div>
      <p className="type-body-sm font-semibold" role="status">{status}</p>
    </div>
    {published && <p className="type-body-sm text-text-secondary">{isSource ? "Confirmed from this audit." : "Confirmed from another audit for this outlet and month."} The approved value appears in Outlet P&amp;L.</p>}
    {evidenceIssues.length > 0 && <>
      <ul className="list-disc space-y-1 pl-5 type-body-sm text-text-secondary">
        {evidenceIssues.map(issue => <li key={issue}>{issue}</li>)}
      </ul>
      <p className="type-body-sm text-text-secondary">{missingCosts > 0 ? "Configure missing costs before submitting new evidence. " : ""}Use a new complete audit only if you can verify the evidence for the selected Closing Month.</p>
      <div className="flex flex-wrap gap-2">
        {(missingCosts > 0 || missingUnits > 0 || uncounted > 0) && onShowUnvalued &&
          <button className="btn-secondary" type="button" onClick={onShowUnvalued}>Review Unvalued Items</button>}
        {onStartClosing && !context?.approval_blocked && <button className="btn-secondary" type="button" onClick={onStartClosing}>Start New Closing Audit</button>}
      </div>
      {!onStartClosing && !context?.approval_blocked && <p className="type-caption text-text-secondary">Stock Check submit permission is required to start a new closing audit here.</p>}
    </>}
    {!published && month && context?.period_ended && lines === null && <p className="type-body-sm text-text-secondary">
      Closing review requires the actual count time. A count taken outside month-end needs a verified month-end quantity and supporting evidence for every item.
    </p>}
    {context?.approval_blocked && <p className="type-body-sm text-text-secondary">Open the current submitted correction or resolve its draft before confirming this closing.</p>}
    {context && !context.period_ended && <p className="type-body-sm text-text-secondary">Confirmation opens after the Closing Month ends.</p>}
    {month && !context && <p className="type-body-sm text-text-secondary">Closing status is unavailable. Reopen the audit to check again.</p>}
    {!canApprove && !blocked && !published && <p className="type-body-sm text-text-secondary">Ask a user with Closing Approval permission for this outlet to review the evidence.</p>}
    {canApprove && !blocked && lines === null &&
      <button className="btn-primary" type="button" onClick={startApproval}>{published ? "Review Closing Revision" : "Review Closing"}</button>}
    {lines !== null && <form onSubmit={approve} className="space-y-3 border-t border-border pt-3">
      <p className="type-body-sm text-text-secondary">Review the physical count against {month} month-end. Confirmation publishes the approved amount to Outlet P&amp;L for this outlet and month.</p>
      {legacyCutoff ? <p className="type-body-sm">Recorded count time · <time dateTime={legacyCutoff}>{formatCutoff(legacyCutoff)} MYT</time></p>
        : <div className="max-w-lg">
          <DateTimePickerField label="Actual Count Date and Time" dateLabel="Physical Count Date" timeLabel="Physical Count Time"
            value={cutoffInput} onChange={setCutoffInput} disabled={busy} withSeconds timezone="Malaysia time"
            helper="Use the actual count time supported by your count evidence."
            error={cutoffAfterSubmit ? "Choose a time on or before the original count submission." : ""} />
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
      </> : validCutoff && <p className="text-sm text-text-secondary">The count matches month-end. Closing Stock uses the submitted quantities and pinned unit costs.</p>}
      {published && <label className="grid gap-1 text-sm">Correction Reason
        <textarea className="control w-full" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} required disabled={busy} />
      </label>}
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" type="submit" disabled={busy || !validCutoff || !validLines || Boolean(published && !reason.trim())}>
          {busy ? "Publishing…" : published ? "Confirm Closing Revision" : "Confirm Closing"}
        </button>
        <button className="btn-secondary" type="button" disabled={busy} onClick={() => setLines(null)}>Cancel</button>
      </div>
    </form>}
  </section>;
}
