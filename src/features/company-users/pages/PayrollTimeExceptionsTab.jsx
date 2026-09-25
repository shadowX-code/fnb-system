import { useCallback, useEffect, useMemo, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { payrollService } from "../../../services/payrollService.js";

const localDate = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const titleCase = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const duration = (minutes) => minutes == null ? "—" : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
const time = (value) => value ? new Intl.DateTimeFormat("en-MY", {
  timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(value)) : "—";
const monthRange = (month) => ({
  from: `${month}-01`,
  to: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10),
});

function DecisionModal({ row, onClose, onSaved }) {
  const [action, setAction] = useState("approve");
  const [minutes, setMinutes] = useState(row.proposed_minutes ?? "");
  const [extra, setExtra] = useState(0);
  const [classification, setClassification] = useState(row.classification);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try {
      await payrollService.decideTime({ id: row.id, action,
        approvedMinutes: action === "reject" ? 0 : Number(minutes),
        extraMinutes: action === "reject" ? 0 : Number(extra),
        classification: action === "reject" ? "non_payable" : classification, reason });
      await onSaved();
      onClose();
    } catch (cause) { setError(cause.message || "Unable to decide payable time."); }
    finally { setBusy(false); }
  };
  const evidence = row.evidence || {};
  return <Modal title={`${row.employee_name} · ${row.work_date}`} description="Approve Payroll time only. Original Roster, Attendance and Leave evidence is never edited."
    size="lg" onClose={onClose}
    footer={<><button className="btn-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn-primary" type="button" onClick={save} disabled={busy || !reason.trim() || (action !== "reject" && (minutes === "" || Number(minutes) < 0))}>{busy ? "Saving..." : "Record Decision"}</button></>}>
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
        <div><strong>Published Roster</strong><p>{time(evidence.scheduled_start_at)} – {time(evidence.scheduled_end_at)} · {evidence.roster_break_minutes ?? "—"}m unpaid break</p><small className="text-text-muted">Entry {evidence.roster_entry_id || "None"}</small></div>
        <div><strong>Attendance</strong><p>{time(evidence.clock_in_at)} – {time(evidence.clock_out_at)} · {duration(row.actual_minutes)}</p><small className="text-text-muted">Record {evidence.attendance_id || "None"}</small></div>
        <div><strong>Leave / Holiday</strong><p>{titleCase(evidence.leave_type) || "No approved leave"} · {evidence.holiday_id ? "Public holiday" : "No matching public holiday"}</p></div>
        <div><strong>Proposed Payable</strong><p>{duration(row.proposed_minutes)} · extra candidate {duration(evidence.extra_candidate_minutes)}</p></div>
      </div>
      <div><strong>Issues requiring review</strong><p className="text-text-secondary">{row.issue_codes?.map(titleCase).join(" · ") || "—"}</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminFormField label="Decision"><select className="control" value={action} onChange={(event) => setAction(event.target.value)}>
          <option value="approve">Approve proposed time</option><option value="adjust">Adjust payable time</option><option value="reject">Reject / Non-payable</option>
        </select></AdminFormField>
        {action !== "reject" && <AdminFormField label="Classification"><select className="control" value={classification} onChange={(event) => setClassification(event.target.value)}>
          {["regular", "overtime", "rest_day", "public_holiday", "public_holiday_ot", "leave", "non_payable"].map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}
        </select></AdminFormField>}
        {action !== "reject" && <AdminFormField label="Approved payable minutes" required><input className="control" type="number" min="0" max="1440" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></AdminFormField>}
        {action !== "reject" && <AdminFormField label="Approved extra / OT minutes"><input className="control" type="number" min="0" max="1440" step="1" value={extra} onChange={(event) => setExtra(event.target.value)} /></AdminFormField>}
      </div>
      <AdminFormField label="Decision reason" required><textarea className="control min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the evidence and any manual adjustment" /></AdminFormField>
      {!!row.history?.length && <details><summary className="font-semibold">Decision history ({row.history.length})</summary>
        <div className="mt-2 divide-y divide-border rounded-xl border border-border">{row.history.map((item) => <p key={item.id} className="p-2">v{item.revision} · {titleCase(item.status)} · {duration(item.approved_minutes)} · {item.reason || "Automatic reconciliation"}</p>)}</div>
      </details>}
      {error && <p role="alert" className="font-semibold text-rose-700">{error}</p>}
    </div>
  </Modal>;
}

export default function PayrollTimeExceptionsTab({ data, canManage }) {
  const [entityId, setEntityId] = useState(data.legal_entities?.[0]?.id || "");
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const range = useMemo(() => monthRange(month), [month]);
  const reload = useCallback(async () => {
    if (!entityId || !month) { setRows([]); return; }
    setRows([]); setLoading(true); setError("");
    try { setRows(await payrollService.readTime(entityId, range.from, range.to)); }
    catch (cause) { setError(cause.message || "Unable to read Time Exceptions."); }
    finally { setLoading(false); }
  }, [entityId, month, range.from, range.to]);
  useEffect(() => { reload(); }, [reload]);
  const reconcile = async () => {
    setBusy(true); setError("");
    try { await payrollService.reconcileTime(entityId, range.from,
      range.to < localDate() ? range.to : localDate()); await reload(); }
    catch (cause) { setError(cause.message || "Unable to reconcile time evidence."); }
    finally { setBusy(false); }
  };
  const columns = [
    { key: "employee", header: "Employee", render: (row) => <span><strong>{row.employee_name}</strong><small className="block text-text-muted">{row.employee_code} · {titleCase(row.pay_basis)}</small></span> },
    { key: "date", header: "Date", render: (row) => row.work_date },
    { key: "issue", header: "Issue", render: (row) => row.issue_codes?.map(titleCase).join(", ") || "Normal shift" },
    { key: "roster", header: "Roster", render: (row) => `${time(row.evidence?.scheduled_start_at)} – ${time(row.evidence?.scheduled_end_at)}` },
    { key: "actual", header: "Actual", render: (row) => `${time(row.evidence?.clock_in_at)} – ${time(row.evidence?.clock_out_at)}` },
    { key: "proposed", header: "Proposed Payable", align: "right", render: (row) => duration(row.proposed_minutes) },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "review_required" ? "warning" : "success"}>{titleCase(row.status)}</Badge> },
    { key: "actions", header: "Actions", render: (row) => row.status === "review_required" && canManage ? <button className="btn-secondary" type="button" onClick={() => setSelected(row)}>Review</button> : "—" },
  ];
  const exceptions = rows.filter((row) => row.status === "review_required");
  const displayedRows = showAll ? [...exceptions, ...rows.filter((row) => row.status !== "review_required")] : exceptions;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold">Time Exceptions</h2><p className="text-sm text-text-secondary">Only meaningful discrepancies require review. Approved time is Payroll evidence; source records stay unchanged.</p></div>
      {canManage && <button className="btn-primary" type="button" disabled={busy || loading || !entityId || range.from > localDate()} onClick={reconcile}>{busy ? "Reconciling..." : "Reconcile Evidence"}</button>}</div>
    <Card className="grid gap-3 p-4 sm:grid-cols-2"><AdminFormField label="Legal Entity"><select className="control" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
      {(data.legal_entities || []).map((item) => <option key={item.id} value={item.id}>{item.display_name || item.name}</option>)}</select></AdminFormField>
      <AdminFormField label="Month"><input className="control" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></AdminFormField></Card>
    {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    <Card><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm font-semibold"><span>{exceptions.length} exception{exceptions.length === 1 ? "" : "s"} requiring review · {rows.length} time result{rows.length === 1 ? "" : "s"}</span>
      {rows.length > exceptions.length && <button className="text-teal-700 underline-offset-2 hover:underline" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show exceptions only" : "Show all results"}</button>}</div>
      {loading ? <p className="p-6 text-sm text-text-secondary">Loading payable-time evidence...</p>
        : displayedRows.length ? <DataTable columns={columns} rows={displayedRows} getRowKey={(row) => row.id} density="compact" />
          : <p className="p-6 text-sm text-text-secondary">{rows.length ? "No Time Exceptions require review." : "No time results for this month. Reconcile source evidence to evaluate payable time."}</p>}</Card>
    {selected && <DecisionModal row={selected} onClose={() => setSelected(null)} onSaved={reload} />}
  </div>;
}
