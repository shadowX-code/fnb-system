import { AdminEvidenceDisclosure } from "../../../../components/layout/AdminAnalyticalSurface.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import { formatOperationalMoment } from "../../../../lib/dateTime.js";
import { MONTH_END_CLOSING } from "./monthEndClosing.js";

export default function AuditCorrectionHistory({ check, history, published, canCorrect, onOpen, onCreate, busy, error }) {
  if (!history) return null;
  const entries = history.entries || [];
  const current = entries.findLast(entry => entry.status === "submitted");
  const successor = entries.find(entry => entry.correction_of_id === check.id);
  const canViewSuccessor = successor && (successor.status === "submitted" || canCorrect);
  const isCorrectionSource = check.id === current?.id && !successor;
  const blockedReason = isCorrectionSource ? history.blocked_reason : null;
  const showCreate = canCorrect && isCorrectionSource && !blockedReason;
  const isClosing = check.auditType === MONTH_END_CLOSING;

  return <section aria-label="Audit correction history" className="space-y-2">
    {(showCreate || canViewSuccessor) && <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="type-section-title font-semibold">Audit corrections</h3>
      {showCreate && <button type="button" className="btn-primary" onClick={onCreate} disabled={busy}>
        {busy ? "Creating…" : isClosing ? "Edit Closing" : "Create Correction"}
      </button>}
      {canViewSuccessor && <button type="button" className="btn-primary" onClick={() => onOpen(successor.id)}>
        {isClosing ? "View Closing Update" : "View Correction"}
      </button>}
    </div>}
    {blockedReason && !isClosing && <p className="type-body-sm text-text-secondary">{blockedReason}</p>}
    {!canCorrect && isCorrectionSource && !blockedReason && (
      <p className="type-body-sm text-text-secondary">{isClosing ? "Closing updates require edit, submit and publication permissions for this outlet." : "Stock Check edit and submit permissions are required to create a correction."}</p>
    )}
    {successor?.status === "draft" && !canCorrect && (
      <p className="type-body-sm text-text-secondary">Stock Check edit and submit permissions are required to open the correction draft.</p>
    )}
    <AdminEvidenceDisclosure label="Audit history">
      <ul className="divide-y divide-border text-sm">
        {entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{entry.version ? `Correction ${entry.version}` : "Original audit"}</span>
              {entry.status === "draft" ? <Badge tone="warning">Draft</Badge>
                : entry.id === current?.id ? <Badge tone="success">Current submitted evidence</Badge> : <Badge>Superseded evidence</Badge>}
              {entry.id === published?.source_audit_id && <Badge tone="info">Published valuation source</Badge>}
            </div>
            <p className="type-caption break-words text-text-secondary">
              {formatOperationalMoment(entry.submitted_at || entry.created_at)} MYT
              {entry.correction_reason ? ` · ${entry.correction_reason}` : ""}
            </p>
          </div>
          {entry.id !== check.id && entry.id !== successor?.id && entry.status === "submitted" &&
            <button type="button" className="btn-secondary" onClick={() => onOpen(entry.id)}>
              {entry.version ? `View Correction ${entry.version}` : "View Original"}
            </button>}
        </li>)}
      </ul>
    </AdminEvidenceDisclosure>
    {error && <p className="type-body-sm text-rose-700" role="alert">{error}</p>}
  </section>;
}
