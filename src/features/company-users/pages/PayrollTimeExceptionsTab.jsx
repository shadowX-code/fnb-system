import { useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { payrollService } from "../../../services/payrollService.js";

const titleCase = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const duration = (minutes) => minutes == null ? "—" : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
const time = (value) => value ? new Intl.DateTimeFormat("en-MY", {
  timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(value)) : "—";

export function DecisionModal({ row, onClose, onSaved, progress, saveLabel = 'Record Decision', onPrevious, onNext, runId, correction = false }) {
  const evidence = row.evidence || {};
  const hasProposal = row.proposed_minutes != null;
  const rosterClassification = evidence.classification || row.classification;
  const rosterAvailable = row.issue_codes?.some(code => ['missing_punch', 'missing_clock_in', 'missing_clock_out'].includes(code))
    && evidence.roster_publication_id && evidence.roster_entry_id && evidence.roster_entry_type === 'working'
    && row.scheduled_minutes != null && ['regular', 'rest_day', 'public_holiday'].includes(rosterClassification);
  const reviewed = row.status !== 'review_required';
  const editing = !reviewed || correction;
  const [requestId] = useState(() => crypto.randomUUID());
  const [action, setAction] = useState(correction ? "adjust" : hasProposal ? "approve" : "adjust");
  const [minutes, setMinutes] = useState(reviewed ? row.approved_minutes ?? "" : row.proposed_minutes ?? "");
  const [extra, setExtra] = useState(reviewed ? row.approved_extra_minutes || 0 : 0);
  const [classification, setClassification] = useState(row.classification);
  const [reason, setReason] = useState(reviewed && !correction ? row.decision_reason || "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recorded, setRecorded] = useState(false);
  const [savedResult, setSavedResult] = useState(null);
  const [pendingIntent, setPendingIntent] = useState(null);
  const save = async () => {
    setBusy(true); setError("");
    try {
      if (!recorded) { const intent = pendingIntent || { id: row.id, runId, requestId, correction, action: action === "roster" ? "adjust" : action,
        approvedMinutes: action === "reject" ? 0 : Number(minutes),
        extraMinutes: action === "reject" ? 0 : Number(extra),
        classification: action === "reject" ? "non_payable" : classification, reason };
        setPendingIntent(intent);
        const result = await payrollService.decideTime(intent);
        setSavedResult(result); setRecorded(true); setPendingIntent(null);
        await onSaved(result);
      } else await onSaved(savedResult);
      if (!progress) onClose();
    } catch (cause) {
      if (!cause.saveUncertain) setPendingIntent(null);
      setError(cause.message || "Unable to confirm payable time.");
    }
    finally { setBusy(false); }
  };
  const chooseAction = value => {
    setAction(value);
    setExtra(0);
    setClassification(row.classification);
    if (value === 'roster') { setMinutes(row.scheduled_minutes); setClassification(rosterClassification); }
    else if (value === 'approve') setMinutes(row.proposed_minutes);
    else if (value === 'reject') setMinutes(0);
  };
  const shortcuts = [
    ['Attendance confirmed', 'Missing punch reviewed; attendance confirmed using supporting evidence.'],
    ['Roster hours verified', 'Published roster hours approved after attendance verification.'],
    ['Clock evidence reviewed', 'Payable time adjusted after reviewing clock evidence.'],
    ['Absence confirmed', 'Non-payable: absence confirmed after evidence review.'],
  ];
  return <Modal title={`${row.employee_name} · ${row.work_date}`} description="Approve Payroll time only. Original Roster, Attendance and Leave evidence is never edited."
    size="lg" onClose={() => !busy && !pendingIntent && onClose()}
    footer={<><button className="btn-secondary" type="button" onClick={onClose} disabled={busy || !!pendingIntent}>{progress ? 'Back to Employee Review' : 'Cancel'}</button>
      {onPrevious && <button className="btn-secondary" type="button" disabled={busy || recorded || !!pendingIntent} onClick={onPrevious}>Previous</button>}
      {!editing ? <button className="btn-primary" type="button" onClick={onNext}>Next unresolved exception</button> :
      <button className="btn-primary" type="button" onClick={save} disabled={busy || (!recorded && (!reason.trim() || (action !== "reject" && (minutes === "" || !Number.isInteger(Number(minutes)) || !Number.isInteger(Number(extra)) || Number(minutes) < 0 || Number(extra) < 0 || Number(minutes) + Number(extra) > 1440))))}>{busy ? "Saving..." : recorded ? "Refresh Review" : pendingIntent ? "Verify / Retry Decision" : saveLabel}</button>}</>}>
    <div className="space-y-4 text-sm">
      {progress && <p role="status" className="font-semibold">{progress}</p>}
      {correction && <p role="status">Correct Decision · The prior decision is retained. A new reason is required.</p>}
      {reviewed && <p role="status">Decision already recorded · {duration(row.approved_minutes)} · {titleCase(row.classification)}</p>}
      {recorded && <p role="status">Decision recorded. Refresh the review to restore the latest payroll result; this will not submit another decision.</p>}
      <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
        <div><strong>Published Roster</strong><p>{time(evidence.scheduled_start_at)} – {time(evidence.scheduled_end_at)} · {evidence.roster_break_minutes ?? "—"}m unpaid break</p><small className="text-text-muted">Entry {evidence.roster_entry_id || "None"}</small></div>
        <div><strong>Attendance</strong><p>{time(evidence.clock_in_at)} – {time(evidence.clock_out_at)} · {duration(row.actual_minutes)}</p><small className="text-text-muted">Record {evidence.attendance_id || "None"}</small></div>
        <div><strong>Leave / Holiday</strong><p>{titleCase(evidence.leave_type) || "No approved leave"} · {evidence.holiday_id ? "Public holiday" : "No matching public holiday"}</p></div>
        <div><strong>Proposed Payable</strong><p>{duration(row.proposed_minutes)} · extra candidate {duration(evidence.extra_candidate_minutes)}</p></div>
      </div>
      <div><strong>Issues requiring review</strong><p className="text-text-secondary">{row.issue_codes?.map(titleCase).join(" · ") || "—"}</p></div>
      <fieldset disabled={busy || recorded || !!pendingIntent || !editing} className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Decision" value={action} onChange={chooseAction} options={[
          ...(hasProposal ? [{ value: "approve", label: "Approve proposed time" }] : []), ...(rosterAvailable ? [{ value: "roster", label: "Approve Roster Hours" }] : []), { value: "adjust", label: "Adjust Payable Time" }, { value: "reject", label: "Reject / Non-payable" },
        ]} />
        {action !== "reject" && <SelectField label="Classification" value={classification} onChange={setClassification}
          options={["regular", "overtime", "rest_day", "public_holiday", "public_holiday_ot", "leave", "non_payable"].map((value) => ({ value, label: titleCase(value) }))} />}
        {action !== "reject" && <AdminFormField label="Approved payable minutes" required><input className="control" type="number" readOnly={action !== "adjust"} min="0" max="1440" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></AdminFormField>}
        {action !== "reject" && <AdminFormField label="Approved extra / OT minutes"><input className="control" type="number" min="0" max="1440" step="1" value={extra} onChange={(event) => setExtra(event.target.value)} /></AdminFormField>}
      </fieldset>
      {action === 'roster' && <p className="text-xs text-text-secondary">Roster hours are a schedule, not proof of attendance. Confirm supporting evidence before saving.</p>}
      {editing && <div className="flex flex-wrap gap-2" aria-label="Reason shortcuts">{shortcuts.map(([label, text]) => <button key={label} type="button" className="btn-secondary text-xs" disabled={busy || recorded || !!pendingIntent} onClick={() => setReason(text)}>{label}</button>)}</div>}
      <AdminFormField label={correction ? "Correction reason" : "Decision reason"} required><textarea disabled={busy || recorded || !!pendingIntent || !editing} className="control min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the evidence and any manual adjustment" /></AdminFormField>
      {!!row.history?.length && <details><summary className="font-semibold">Decision history ({row.history.length})</summary>
        <div className="mt-2 divide-y divide-border rounded-xl border border-border">{row.history.map((item) => <p key={item.id} className="p-2">v{item.revision} · {titleCase(item.status)} · {duration(item.approved_minutes)} · {item.reason || "Automatic reconciliation"}</p>)}</div>
      </details>}
      {error && <p role="alert" className="font-semibold text-rose-700">{error}</p>}
    </div>
  </Modal>;
}
