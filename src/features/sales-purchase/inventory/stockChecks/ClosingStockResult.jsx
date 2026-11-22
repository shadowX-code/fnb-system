import { useRef, useState } from "react";
import { inventoryLifecycleService } from "../../../../services/inventoryLifecycleService.js";
import { invalidateInventoryReads } from "../../../../services/inventoryRevalidation.js";
import { formatClosingMonthLabel, formatPhysicalCountDate } from "./monthEndClosing.js";
import { hasUsableAuditCount } from "./auditStockCheckValuation.js";

export default function ClosingStockResult({ check, context, canPublish, formatCurrency, onShowUnvalued, onStartClosing, onPublished }) {
  const [published, setPublished] = useState(context?.published);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(null);
  const month = formatClosingMonthLabel(check.accountingMonth);
  const itemIds = check.rows.map(row => row.itemId).sort();
  const rosterMatches = itemIds.length > 0 && itemIds.length === check.closingItemIds?.length
    && new Set(itemIds).size === itemIds.length && itemIds.every((id, index) => id && id === check.closingItemIds[index]);
  const issues = [
    !month && "This audit has no recorded Closing Month.",
    !rosterMatches && "A complete frozen item list is required.",
    check.rows.some(row => !hasUsableAuditCount(row)) && "Every item needs a usable submitted count.",
    check.rows.some(row => !row.unit?.trim()) && "Every item needs a recorded count unit.",
  ].filter(Boolean);
  const isSource = published?.source_audit_id === check.id;
  const canPublishExisting = Boolean(canPublish && context && !issues.length && !context.approval_blocked
    && !isSource && (!published || context.same_evidence_chain));

  async function publish() {
    if (!canPublishExisting || busy) return;
    request.current ??= crypto.randomUUID();
    setBusy(true);
    setError("");
    try {
      setPublished(await inventoryLifecycleService.publishExistingClosing({ checkId: check.id, requestId: request.current }));
      invalidateInventoryReads({ source: "closing-stock", outletId: check.outletId, checkId: check.id });
      onPublished?.();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="Closing Stock" className="space-y-2 rounded-xl border border-border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="font-semibold">Closing Stock</h3>
        <p className="type-caption text-text-secondary">Closing Month · {month || "Not recorded"}</p>
      </div>
      <p className="type-body-sm font-semibold" role="status">{published
        ? `Published${published.valuation_status === "partial" ? " · Partial" : ""} · ${published.amount == null ? "—" : formatCurrency(published.amount)}`
        : issues.length ? "Ineligible for publication" : "Unpublished"}</p>
      {canPublishExisting && <button type="button" className="btn-primary" onClick={publish} disabled={busy}>
        {busy ? "Publishing…" : published ? "Publish Closing Update" : "Publish Closing"}
      </button>}
    </div>
    {published && <p className="type-body-sm text-text-secondary">
      {!isSource && "Published from another submitted version for this month. "}
      {published.total_item_count != null && `${published.valued_item_count} of ${published.total_item_count} items valued. `}
      {published.actual_count_date ? `Actual count ${formatPhysicalCountDate(published.actual_count_date)} (MYT).` : "Actual count date not recorded."}
    </p>}
    {issues.length > 0 && <>
      <ul className="list-disc space-y-1 pl-5 type-body-sm text-text-secondary">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
      {onStartClosing && !published && !context?.approval_blocked && <button className="btn-secondary" type="button" onClick={onStartClosing}>Start New Closing Audit</button>}
      {!onStartClosing && !published && !context?.approval_blocked && <p className="type-caption text-text-secondary">Stock Check submit permission is required to start a new closing audit here.</p>}
    </>}
    {onShowUnvalued && check.rows.some(row => row.unitCostSnapshot == null) &&
      <button className="btn-secondary" type="button" onClick={onShowUnvalued}>View Unvalued Items</button>}
    {context?.approval_blocked && !isSource && <p className="type-caption text-text-secondary">Open the latest evidence to publish this closing.</p>}
    {month && !context && <p className="type-caption text-text-secondary">Closing publication status is unavailable.</p>}
    {error && <p className="type-body-sm text-rose-700" role="alert">{error}</p>}
  </section>;
}
