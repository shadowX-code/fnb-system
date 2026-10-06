import Badge from "../../../components/ui/Badge.jsx";
import RecordViewAction from "../../../components/ui/RecordViewAction.jsx";

export default function PayrollTimeEvidenceCell({ employeeName, needsReview, exceptionCount, summary, onOpen }) {
  return <div className="space-y-1">
    <div className="flex items-center gap-2">
      <Badge tone={needsReview ? "warning" : "success"}>{needsReview ? `${exceptionCount} exception${exceptionCount === 1 ? "" : "s"}` : "Ready"}</Badge>
      {needsReview ? <button type="button" className="btn-secondary whitespace-nowrap" aria-label={`Review Time for ${employeeName}`} onClick={onOpen}>Review Time</button>
        : <RecordViewAction label={`View time evidence for ${employeeName}`} title="View time evidence" onClick={onOpen} />}
    </div>
    {summary && <small className="block text-text-secondary">{summary}</small>}
  </div>;
}
