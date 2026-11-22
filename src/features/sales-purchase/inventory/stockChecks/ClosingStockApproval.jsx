import { useRef, useState } from "react";
import { inventoryLifecycleService } from "../../../../services/inventoryLifecycleService.js";
import { invalidateInventoryReads } from "../../../../services/inventoryRevalidation.js";
import DatePickerField from "../../../../components/forms/DatePickerField.jsx";
import { formatClosingError, formatClosingMonthLabel, formatPhysicalCountDate, toClosingLocalTime } from "./monthEndClosing.js";

import { auditStockCheckValuation, hasUsableAuditCount } from "./auditStockCheckValuation.js";

export default function ClosingStockApproval({ check, context, canApprove, formatCurrency, onShowUnvalued, onStartClosing }) {
  const [published, setPublished] = useState(context?.published);
  const [reviewing, setReviewing] = useState(false);
  const [reason, setReason] = useState("");
  const [countDate, setCountDate] = useState("");
  const [invalidDateInput, setInvalidDateInput] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(null);
  const isSource = published?.source_audit_id === check.id;
  const recordedDate = toClosingLocalTime(check.physicalCountCutoff).slice(0, 10);
  const submittedDate = toClosingLocalTime(context?.count_evidence_submitted_at || check.submittedAt).slice(0, 10);
  const countAfterSubmit = Boolean(submittedDate && countDate > submittedDate);
  const validDate = Boolean(countDate && submittedDate && !countAfterSubmit && !invalidDateInput);
  const itemIds = check.rows.map(row => row.itemId).sort();
  const rosterMatches = itemIds.length > 0 && itemIds.length === check.closingItemIds?.length
    && new Set(itemIds).size === itemIds.length && itemIds.every((id, index) => id && id === check.closingItemIds[index]);
  const uncounted = check.rows.filter(row => !hasUsableAuditCount(row)).length;
  const missingUnits = check.rows.filter(row => !row.unit?.trim()).length;
  const { valuedItemCount, missingCostCount, knownStockValue } = auditStockCheckValuation(check.rows);
  const month = formatClosingMonthLabel(check.accountingMonth);
  const evidenceIssues = [
    !month && "This audit has no recorded Closing Month.",
    !rosterMatches && "A complete frozen item list is required.",
    uncounted > 0 && `${uncounted} ${uncounted === 1 ? "item has" : "items have"} no usable count.`,
    missingUnits > 0 && `${missingUnits} ${missingUnits === 1 ? "item has" : "items have"} no recorded count unit.`,
  ].filter(Boolean);
  const blocked = evidenceIssues.length > 0 || !context?.period_ended || context.approval_blocked;
  const partial = valuedItemCount < itemIds.length;
  const showAmount = amount => amount == null ? "—" : formatCurrency(amount);
  const status = published ? `Approved${published.valuation_status === "partial" ? " · Partial" : ""} · ${showAmount(published.amount)}`
    : blocked ? "Not ready to confirm" : "Awaiting closing review";
  const canConfirm = canApprove && !blocked && !busy && validDate && confirmed && (!published || reason.trim());

  function startApproval() {
    setCountDate(recordedDate || (isSource ? published.actual_count_date : context?.prior_actual_count_date) || "");
    setConfirmed(false);
    setInvalidDateInput(false);
    setReason("");
    setError("");
    setReviewing(true);
  }

  async function approve(event) {
    event.preventDefault();
    if (!canConfirm) return;
    const payload = { checkId: check.id, confirmedClosingMonth: check.accountingMonth, actualCountDate: countDate,
      supersedesId: published?.id ?? null, reason: reason.trim() || null };
    const signature = JSON.stringify(payload);
    if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const result = await inventoryLifecycleService.approveClosingStock({ ...payload, requestId: pending.current.requestId });
      setPublished(result);
      setReviewing(false);
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
    {published && <p className="type-body-sm text-text-secondary">
      {isSource ? "Confirmed from this audit." : "Confirmed from another audit for this outlet and month."}
      {published.total_item_count != null && ` ${published.valued_item_count} of ${published.total_item_count} items valued.`}
      {published.actual_count_date && ` Actual count ${formatPhysicalCountDate(published.actual_count_date)} (MYT).`}
    </p>}
    {evidenceIssues.length > 0 && <ul className="list-disc space-y-1 pl-5 type-body-sm text-text-secondary">
      {evidenceIssues.map(issue => <li key={issue}>{issue}</li>)}
    </ul>}
    {missingCostCount > 0 && <p className="type-body-sm text-text-secondary">
      {missingCostCount} {missingCostCount === 1 ? "item has" : "items have"} no valid pinned cost and will remain unvalued.
    </p>}
    {((missingCostCount > 0 || missingUnits > 0 || uncounted > 0) && onShowUnvalued
      || evidenceIssues.length > 0 && onStartClosing && !context?.approval_blocked) && <div className="flex flex-wrap gap-2">
      {(missingCostCount > 0 || missingUnits > 0 || uncounted > 0) && onShowUnvalued &&
        <button className="btn-secondary" type="button" onClick={onShowUnvalued}>Review Unvalued Items</button>}
      {evidenceIssues.length > 0 && onStartClosing && !context?.approval_blocked &&
        <button className="btn-secondary" type="button" onClick={onStartClosing}>Start New Closing Audit</button>}
    </div>}
    {evidenceIssues.length > 0 && !onStartClosing && !context?.approval_blocked && <p className="type-caption text-text-secondary">Stock Check submit permission is required to start a new closing audit here.</p>}
    {context?.approval_blocked && <p className="type-body-sm text-text-secondary">Open the current submitted correction or resolve its draft before confirming this closing.</p>}
    {context && !context.period_ended && <p className="type-body-sm text-text-secondary">Confirmation opens after the Closing Month ends.</p>}
    {month && !context && <p className="type-body-sm text-text-secondary">Closing status is unavailable. Reopen the audit to check again.</p>}
    {!canApprove && !blocked && !published && <p className="type-body-sm text-text-secondary">Ask a user with Closing Approval permission for this outlet to review the evidence.</p>}
    {canApprove && !blocked && !reviewing &&
      <button className="btn-primary" type="button" onClick={startApproval}>{published ? "Review Closing Revision" : "Review Closing"}</button>}
    {reviewing && <form onSubmit={approve} className="space-y-3 border-t border-border pt-3">
      <p className="type-body-sm">
        Outlet P&amp;L · {month} · {partial ? "Known Stock Value (Partial)" : "Closing Stock"} {showAmount(knownStockValue)}
        {" · "}{valuedItemCount} of {itemIds.length} items valued
      </p>
      <p className="type-body-sm text-text-secondary">This publication uses the submitted counts and pinned costs at the actual count date. Item quantities stay as recorded.</p>
      {recordedDate ? <p className="type-body-sm">Actual Count Date (MYT) · <time dateTime={recordedDate}>{formatPhysicalCountDate(recordedDate)}</time></p>
        : <div className="max-w-xs">
          <DatePickerField label="Actual Count Date (MYT)" value={countDate} disabled={busy} required
            onChange={date => { setCountDate(date); setInvalidDateInput(false); setConfirmed(false); }}
            onInvalidInput={() => { setInvalidDateInput(true); setConfirmed(false); }}
            helper={submittedDate ? `Confirm the date from count evidence. Original submission: ${formatPhysicalCountDate(submittedDate)} (MYT).` : "The original submission date is unavailable."}
            error={invalidDateInput ? "Enter a valid count date." : countAfterSubmit ? "Choose a date on or before the original count submission." : ""} />
        </div>}
      {validDate && countDate.slice(0, 7) !== check.accountingMonth.slice(0, 7) &&
        <p className="type-body-sm text-text-secondary" role="note">Actual count on {formatPhysicalCountDate(countDate)} (MYT) falls outside the selected Closing Month of {month}.</p>}
      {published && <label className="grid gap-1 text-sm">Correction Reason
        <textarea className="control w-full" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} required disabled={busy} />
      </label>}
      <label className="flex items-start gap-2 text-sm">
        <input className="mt-0.5 size-4" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required disabled={busy || !validDate} />
        <span>I confirm the actual count date and approve reporting this value in {month}.</span>
      </label>
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" type="submit" disabled={!canConfirm}>
          {busy ? "Publishing…" : published ? "Confirm Closing Revision" : "Confirm Closing"}
        </button>
        <button className="btn-secondary" type="button" disabled={busy} onClick={() => setReviewing(false)}>Cancel</button>
      </div>
    </form>}
  </section>;
}
