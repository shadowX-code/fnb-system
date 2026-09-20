import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, FilePlus2, MoreHorizontal } from "lucide-react";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
import AdminEvidenceFilePicker from "../../../components/forms/AdminEvidenceFilePicker.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { formatDateTime } from "../../../lib/dateTime.js";
import { employeeDisciplinaryService } from "../../../services/employeeDisciplinaryService.js";

const typeOptions = [
  { value: "written_warning", label: "Written Warning" },
  { value: "final_written_warning", label: "Final Written Warning" },
];
const typeLabels = { first_written_warning: "First Written Warning", written_warning: "Written Warning", final_written_warning: "Final Written Warning" };
const statusCopy = { draft: "Draft", issued: "Issued", delivered: "Delivered", viewed: "Viewed", acknowledged: "Acknowledged", not_acknowledged: "Not Acknowledged", withdrawn: "Withdrawn", superseded: "Superseded" };
const statusTone = { draft: "neutral", issued: "warning", delivered: "info", viewed: "info", acknowledged: "success", not_acknowledged: "warning", withdrawn: "danger", superseded: "neutral" };
const eventCopy = { draft_created: "Draft created", draft_updated: "Draft updated", evidence_attached: "Supporting evidence attached", issued: "Warning issued", delivered: "Delivered to Crew Mobile", viewed: "Viewed by employee", response_added: "Employee response added", acknowledged: "Receipt acknowledged", not_acknowledged: "Marked not acknowledged", withdrawn: "Warning withdrawn", superseded: "Warning superseded" };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const emptyForm = () => ({ warning_type: "written_warning", incident_date: today(), subject: "", warning_details: "", required_action: "", issued_date: today(), related_previous_warning_id: "" });
const warningNumber = (item) => item?.display_sequence ? `Warning #${item.display_sequence}` : "Draft warning";

function WarningForm({ employeeId, employeeName, initial, supersedesWarningId, history, onClose, onSaved }) {
  const [values, setValues] = useState(() => initial ? {
    warning_type: initial.warning_type === "first_written_warning" ? "written_warning" : initial.warning_type, incident_date: initial.incident_date, subject: initial.subject,
    warning_details: initial.warning_details, required_action: initial.required_action, issued_date: initial.issued_date,
    related_previous_warning_id: initial.related_previous_warning_id || "",
  } : emptyForm());
  const [warningId, setWarningId] = useState(initial?.id || null);
  const [requestId] = useState(() => crypto.randomUUID());
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = values.warning_type && values.incident_date && values.subject.trim() && values.warning_details.trim() && values.required_action.trim() && values.issued_date;
  const patch = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const previousWarnings = useMemo(() => history.filter((item) => item.status !== "draft" && item.display_sequence && item.id !== warningId), [history, warningId]);
  const relatedOptions = [{ value: "", label: "None" }, ...previousWarnings.map((item) => ({ value: item.id, label: `${warningNumber(item)} · ${typeLabels[item.warning_type]} · ${item.subject} · ${item.issued_date}` }))];

  async function save(issue) {
    if (!valid) { setError("Complete every required warning field."); return; }
    setBusy(true); setError("");
    try {
      const saved = await employeeDisciplinaryService.saveDraft({ warningId, employeeId, payload: values, requestId, supersedesWarningId });
      setWarningId(saved.id);
      if (file) await employeeDisciplinaryService.uploadEvidence({ warningId: saved.id, requestId: crypto.randomUUID(), file });
      if (issue) await employeeDisciplinaryService.issue(saved.id);
      await onSaved(issue ? "Warning issued." : "Draft saved.");
      onClose();
    } catch (cause) { setError(cause.message || "Unable to save this warning."); }
    finally { setBusy(false); }
  }

  return <Modal size="md" title={supersedesWarningId ? "Supersede Warning" : initial ? "Edit Warning Draft" : "Create Warning"} description={supersedesWarningId ? "The original remains in history and is superseded only when this replacement is issued." : "Issued content becomes immutable."} onClose={onClose} footer={<><button className="btn-secondary" type="button" disabled={busy} onClick={() => save(false)}>{busy ? "Saving..." : "Save Draft"}</button><button className="btn-primary" type="button" disabled={busy || !valid} onClick={() => save(true)}>{busy ? "Saving..." : "Issue Warning"}</button></>}>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2 rounded-xl border border-border bg-slate-50 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><span className="text-xs font-semibold text-text-muted">Employee</span><strong className="mt-0.5 block text-sm text-text-primary">{employeeName}</strong><p className="mt-0.5 text-xs text-text-secondary">{previousWarnings.length} previous {previousWarnings.length === 1 ? "warning" : "warnings"}</p></div>{previousWarnings.length ? <details className="text-xs"><summary className="cursor-pointer font-semibold text-primary">View history</summary><div className="mt-2 grid gap-1.5">{previousWarnings.map((item) => <span key={item.id}>{warningNumber(item)} · {typeLabels[item.warning_type]} · {item.subject}</span>)}</div></details> : null}</div>
      </div>
      <AdminFormField label="Warning Type" required helper="Select the appropriate level; FeedX does not escalate automatically."><SelectField value={values.warning_type} options={typeOptions} onChange={(value) => patch("warning_type", value)} /></AdminFormField>
      <AdminFormField label="Related Previous Warning" helper="Optional · Link repeated or related misconduct without changing warning level."><SelectField value={values.related_previous_warning_id} options={relatedOptions} searchable={previousWarnings.length > 6} onChange={(value) => patch("related_previous_warning_id", value)} /></AdminFormField>
      <DatePickerField label="Incident Date" required value={values.incident_date} onChange={(value) => patch("incident_date", value)} />
      <DatePickerField label="Issued Date" required value={values.issued_date} onChange={(value) => patch("issued_date", value)} />
      <AdminFormField label="Subject" required className="md:col-span-2"><input className="control" value={values.subject} onChange={(event) => patch("subject", event.target.value)} placeholder="Concise description of the matter" /></AdminFormField>
      <AdminFormField label="Warning Details" required className="md:col-span-2"><textarea className="control min-h-32 py-3" value={values.warning_details} onChange={(event) => patch("warning_details", event.target.value)} placeholder="Record the facts and context clearly." /></AdminFormField>
      <AdminFormField label="Expected Improvement / Required Action" required className="md:col-span-2"><textarea className="control min-h-28 py-3" value={values.required_action} onChange={(event) => patch("required_action", event.target.value)} placeholder="Explain what is expected and any required next step." /></AdminFormField>
      <AdminFormField as="div" label="Supporting Evidence" helper="Optional · Stored privately with the warning record." className="md:col-span-2"><AdminEvidenceFilePicker file={file} onChange={setFile} disabled={busy} accept="image/jpeg,image/png,image/webp,application/pdf" /></AdminFormField>
      {error ? <div className="md:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700" role="alert">{error}</div> : null}
    </div>
  </Modal>;
}

function WarningDetail({ item, canManage, onClose, onChanged, onSelectWarning, ui }) {
  const [evidence, setEvidence] = useState(null);
  const [evidenceError, setEvidenceError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [transitionBusy, setTransitionBusy] = useState(false);
  const canWithdraw = canManage && !["draft", "withdrawn", "superseded"].includes(item.status);
  const canNotAcknowledge = canManage && ["delivered", "viewed"].includes(item.status);
  const canSupersede = canManage && !["draft", "withdrawn", "superseded"].includes(item.status);
  useEffect(() => {
    if (!item.has_evidence) return;
    employeeDisciplinaryService.adminEvidence(item.id).then(setEvidence).catch(() => setEvidenceError("Supporting evidence is unavailable."));
  }, [item.id, item.has_evidence]);
  async function transition(action, reason = null) {
    setMenuOpen(false);
    setTransitionBusy(true);
    try { await employeeDisciplinaryService.transition({ warningId: item.id, action, reason }); await onChanged(); setWithdrawOpen(false); onClose(); }
    catch (cause) { ui?.notify?.({ title: "Unable to update warning", message: cause.message, tone: "error" }); }
    finally { setTransitionBusy(false); }
  }
  return <><Modal size="md" title={item.subject} description={`${warningNumber(item)} · ${typeLabels[item.warning_type]}`} onClose={onClose} headerActions={(canWithdraw || canNotAcknowledge) ? <ActionMenu open={menuOpen} onOpenChange={setMenuOpen} ariaLabel="Warning actions" trigger={({ toggle, ariaLabel }) => <button className="icon-btn" type="button" aria-label={ariaLabel} onClick={toggle}><MoreHorizontal size={17} /></button>}><>{canNotAcknowledge ? <button type="button" onClick={() => transition("not_acknowledged")}>Mark Not Acknowledged</button> : null}{canWithdraw ? <button className="text-rose-700" type="button" onClick={() => { setMenuOpen(false); setWithdrawOpen(true); }}>Withdraw Warning</button> : null}</></ActionMenu> : null} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}>
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><Badge tone={statusTone[item.status]}>{statusCopy[item.status]}</Badge><span className="text-xs font-semibold text-text-muted">Issued {item.issued_date}</span></div>
      {item.status === "draft" ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">This draft is not visible to the employee.</div> : null}
      <dl className="grid gap-3 sm:grid-cols-2">
        <div><dt className="text-xs font-semibold text-text-muted">Incident date</dt><dd className="mt-1 text-sm font-semibold">{item.incident_date}</dd></div>
        <div><dt className="text-xs font-semibold text-text-muted">Outlet at issue</dt><dd className="mt-1 text-sm font-semibold">{item.outlet_name_snapshot || "—"}</dd></div>
      </dl>
      <section><h3 className="text-xs font-bold uppercase text-text-muted">Warning details</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-primary">{item.warning_details}</p></section>
      <section><h3 className="text-xs font-bold uppercase text-text-muted">Expected improvement / required action</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-primary">{item.required_action}</p></section>
      {item.related_warning ? <section className="rounded-xl border border-border bg-slate-50 p-3"><h3 className="text-xs font-bold uppercase text-text-muted">Related previous warning</h3><div className="mt-2 flex items-start justify-between gap-3"><div><strong className="text-sm text-text-primary">{warningNumber(item.related_warning)} · {typeLabels[item.related_warning.warning_type]}</strong><p className="mt-1 text-sm text-text-secondary">{item.related_warning.subject} · {item.related_warning.issued_date}</p></div><button className="btn-secondary h-9 shrink-0 px-3 text-xs" type="button" onClick={() => onSelectWarning(item.related_warning.id)}>View</button></div></section> : null}
      {item.response ? <section className="rounded-xl border border-border bg-slate-50 p-3"><h3 className="text-xs font-bold uppercase text-text-muted">Employee response</h3><p className="mt-2 whitespace-pre-wrap text-sm">{item.response.text}</p><small className="mt-2 block text-text-muted">Submitted {formatDateTime(item.response.submitted_at)}</small></section> : null}
      {evidence?.evidence_url ? <section><h3 className="mb-2 text-xs font-bold uppercase text-text-muted">Supporting evidence</h3>{evidence.mime_type === "application/pdf" ? <a className="btn-secondary inline-flex" href={evidence.evidence_url} target="_blank" rel="noreferrer">View PDF</a> : <img className="max-h-[360px] w-full rounded-xl bg-slate-50 object-contain" src={evidence.evidence_url} alt="Supporting evidence" />}</section> : evidenceError ? <p className="text-sm text-rose-700">{evidenceError}</p> : null}
      <section><h3 className="text-xs font-bold uppercase text-text-muted">Activity</h3><div className="mt-2 divide-y divide-border">{item.activity.map((event) => <div className="py-2 text-sm" key={event.id}><div className="flex justify-between gap-3"><strong>{eventCopy[event.type] || event.type}</strong><span className="shrink-0 text-xs text-text-muted">{formatDateTime(event.occurred_at)}</span></div>{event.actor_name ? <p className="mt-0.5 text-xs text-text-muted">by {event.actor_name}</p> : null}{event.details?.reason ? <p className="mt-1 text-xs text-text-secondary">{event.details.reason}</p> : null}</div>)}</div></section>
    </div>
  </Modal>{withdrawOpen ? <Modal size="sm" title="Withdraw Warning" description="The issued record and its activity remain in history." onClose={() => setWithdrawOpen(false)} footer={<><button className="btn-secondary" type="button" disabled={transitionBusy} onClick={() => setWithdrawOpen(false)}>Cancel</button><button className="btn-danger" type="button" disabled={transitionBusy || !withdrawReason.trim()} onClick={() => transition("withdraw", withdrawReason.trim())}>{transitionBusy ? "Withdrawing..." : "Withdraw Warning"}</button></>}><AdminFormField label="Reason for withdrawal" required helper="Explain why this issued warning is being withdrawn."><textarea className="control min-h-28 py-3" value={withdrawReason} onChange={(event) => setWithdrawReason(event.target.value)} /></AdminFormField></Modal> : null}</>;
}

export default function EmployeeDisciplinaryPanel({ employeeId, employeeName, canView, canManage, ui }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const warnings = useMemo(() => data?.warnings ?? [], [data]);
  async function load() { if (!employeeId || !canView) return; setLoading(true); setError(""); try { setData(await employeeDisciplinaryService.adminDetail(employeeId)); } catch (cause) { setError(cause.message || "Unable to load disciplinary records."); } finally { setLoading(false); } }
  useEffect(() => { load(); }, [employeeId, canView]);
  if (!employeeId || !canView) return null;
  const notifySaved = async (message) => { ui?.notify?.({ title: message }); await load(); };
  return <section className="rounded-2xl border border-border bg-slate-50/60 p-3.5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-black uppercase text-[#94A3B8]"><span className="flex h-7 w-7 items-center justify-center rounded-xl border border-border bg-white text-text-secondary"><AlertTriangle size={14} /></span>Disciplinary Records</div>{canManage ? <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => setForm({ initial: null, supersedesWarningId: null })}><FilePlus2 size={14} /> Create Warning</button> : null}</div>
    {loading ? <p className="text-sm font-semibold text-text-muted">Loading disciplinary records...</p> : error && !data ? <div className="flex items-center justify-between gap-3 text-sm text-rose-700"><span>{error}</span><button className="btn-secondary px-3 py-2 text-xs" type="button" onClick={load}>Retry</button></div> : warnings.length ? <div className="divide-y divide-border rounded-xl border border-border bg-white">{warnings.map((item) => <div className="flex items-center gap-3 px-3 py-3" key={item.id}><button className="min-w-0 flex-1 text-left" type="button" onClick={() => setDetail(item)}><strong className="block truncate text-sm text-text-primary">{item.subject}</strong><span className="mt-1 block text-xs text-text-muted">{warningNumber(item)} · {typeLabels[item.warning_type]} · {item.issued_date}</span></button><Badge tone={statusTone[item.status]}>{statusCopy[item.status]}</Badge>{item.status === "draft" && canManage ? <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => setForm({ initial: item, supersedesWarningId: null })}>Edit</button> : null}{canManage && !["draft", "withdrawn", "superseded"].includes(item.status) ? <button className="icon-btn" type="button" aria-label="Supersede warning" onClick={() => setForm({ initial: { ...item, id: null }, supersedesWarningId: item.id })}><FilePlus2 size={15} /></button> : null}</div>)}</div> : <div className="rounded-xl border border-dashed border-border bg-white px-4 py-4 text-sm text-text-secondary">No disciplinary records.</div>}
    {form ? <WarningForm employeeId={employeeId} employeeName={employeeName} initial={form.initial} supersedesWarningId={form.supersedesWarningId} history={warnings} onClose={() => setForm(null)} onSaved={notifySaved} /> : null}
    {detail ? <WarningDetail item={detail} canManage={canManage} ui={ui} onClose={() => setDetail(null)} onChanged={load} onSelectWarning={(warningId) => setDetail(warnings.find((item) => item.id === warningId) || detail)} /> : null}
  </section>;
}
