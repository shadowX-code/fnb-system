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

export function DecisionModal({ row, onClose, onSaved }) {
  const [action, setAction] = useState("approve");
  const [minutes, setMinutes] = useState(row.proposed_minutes ?? "");
  const [extra, setExtra] = useState(0);
  const [classification, setClassification] = useState(row.classification);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recorded, setRecorded] = useState(false);
  const save = async () => {
    setBusy(true); setError("");
    try {
      if (!recorded) { await payrollService.decideTime({ id: row.id, action,
        approvedMinutes: action === "reject" ? 0 : Number(minutes),
        extraMinutes: action === "reject" ? 0 : Number(extra),
        classification: action === "reject" ? "non_payable" : classification, reason });
        setRecorded(true); }
      await onSaved();
      onClose();
    } catch (cause) { setError(cause.message || "Unable to refresh payable time."); }
    finally { setBusy(false); }
  };
  const evidence = row.evidence || {};
  return <Modal title={`${row.employee_name} · ${row.work_date}`} description="Approve Payroll time only. Original Roster, Attendance and Leave evidence is never edited."
    size="lg" onClose={() => !busy && onClose()}
    footer={<><button className="btn-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn-primary" type="button" onClick={save} disabled={busy || (!recorded && (!reason.trim() || (action !== "reject" && (minutes === "" || !Number.isInteger(Number(minutes)) || !Number.isInteger(Number(extra)) || Number(minutes) < 0 || Number(extra) < 0 || Number(minutes) + Number(extra) > 1440))))}>{busy ? "Saving..." : recorded ? "Refresh Review" : "Record Decision"}</button></>}>
    <div className="space-y-4 text-sm">
      {recorded && <p role="status">Decision recorded. Refresh the review to restore the latest payroll result; this will not submit another decision.</p>}
      <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
        <div><strong>Published Roster</strong><p>{time(evidence.scheduled_start_at)} – {time(evidence.scheduled_end_at)} · {evidence.roster_break_minutes ?? "—"}m unpaid break</p><small className="text-text-muted">Entry {evidence.roster_entry_id || "None"}</small></div>
        <div><strong>Attendance</strong><p>{time(evidence.clock_in_at)} – {time(evidence.clock_out_at)} · {duration(row.actual_minutes)}</p><small className="text-text-muted">Record {evidence.attendance_id || "None"}</small></div>
        <div><strong>Leave / Holiday</strong><p>{titleCase(evidence.leave_type) || "No approved leave"} · {evidence.holiday_id ? "Public holiday" : "No matching public holiday"}</p></div>
        <div><strong>Proposed Payable</strong><p>{duration(row.proposed_minutes)} · extra candidate {duration(evidence.extra_candidate_minutes)}</p></div>
      </div>
      <div><strong>Issues requiring review</strong><p className="text-text-secondary">{row.issue_codes?.map(titleCase).join(" · ") || "—"}</p></div>
      <fieldset disabled={busy || recorded} className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Decision" value={action} onChange={setAction} options={[
          { value: "approve", label: "Approve proposed time" }, { value: "adjust", label: "Adjust payable time" }, { value: "reject", label: "Reject / Non-payable" },
        ]} />
        {action !== "reject" && <SelectField label="Classification" value={classification} onChange={setClassification}
          options={["regular", "overtime", "rest_day", "public_holiday", "public_holiday_ot", "leave", "non_payable"].map((value) => ({ value, label: titleCase(value) }))} />}
        {action !== "reject" && <AdminFormField label="Approved payable minutes" required><input className="control" type="number" min="0" max="1440" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></AdminFormField>}
        {action !== "reject" && <AdminFormField label="Approved extra / OT minutes"><input className="control" type="number" min="0" max="1440" step="1" value={extra} onChange={(event) => setExtra(event.target.value)} /></AdminFormField>}
      </fieldset>
      <AdminFormField label="Decision reason" required><textarea disabled={busy || recorded} className="control min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the evidence and any manual adjustment" /></AdminFormField>
      {!!row.history?.length && <details><summary className="font-semibold">Decision history ({row.history.length})</summary>
        <div className="mt-2 divide-y divide-border rounded-xl border border-border">{row.history.map((item) => <p key={item.id} className="p-2">v{item.revision} · {titleCase(item.status)} · {duration(item.approved_minutes)} · {item.reason || "Automatic reconciliation"}</p>)}</div>
      </details>}
      {error && <p role="alert" className="font-semibold text-rose-700">{error}</p>}
    </div>
  </Modal>;
}
