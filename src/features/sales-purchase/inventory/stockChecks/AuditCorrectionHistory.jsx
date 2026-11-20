import Badge from "../../../../components/ui/Badge.jsx";
import { formatOperationalMoment } from "../../../../lib/dateTime.js";

export default function AuditCorrectionHistory({ check, history, published, canCorrect, onOpen, onCreate, busy, error }) {
  if (!history) return null;
  const entries = history.entries || [];
  const current = entries.findLast(entry => entry.status === "submitted");
  const draft = entries.find(entry => entry.status === "draft");
  const showCreate = canCorrect && check.id === current?.id && !draft && !history.blocked_reason;

  return <section aria-label="Audit correction history" className="space-y-3 rounded-xl border border-border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="type-section-title font-semibold">Audit evidence</h3>
      {showCreate && <button type="button" className="btn-secondary" onClick={onCreate} disabled={busy}>
        {busy ? "Creating…" : "Create Correction"}
      </button>}
      {canCorrect && draft && <button type="button" className="btn-secondary" onClick={() => onOpen(draft.id)}>
        Continue Correction Draft
      </button>}
    </div>
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
        {entry.id !== check.id && entry.status === "submitted" &&
          <button type="button" className="btn-secondary" onClick={() => onOpen(entry.id)}>
            {entry.version ? `View Correction ${entry.version}` : "View Original"}
          </button>}
      </li>)}
    </ul>
    {canCorrect && check.id === current?.id && !draft && history.blocked_reason &&
      <p className="type-body-sm text-text-secondary">{history.blocked_reason}</p>}
    {error && <p className="type-body-sm text-rose-700" role="alert">{error}</p>}
  </section>;
}
