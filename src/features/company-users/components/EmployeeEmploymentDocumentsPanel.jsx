import { useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, Download, Eye, FilePlus2 } from "lucide-react";
import AdminEvidenceFilePicker from "../../../components/forms/AdminEvidenceFilePicker.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { formatDateTime } from "../../../lib/dateTime.js";
import { employmentDocumentService } from "../../../services/employmentDocumentService.js";
import EmploymentContractBuilderModal from "./EmploymentContractBuilderModal.jsx";

const statusCopy = { draft: "Draft", sent: "Sent", viewed: "Viewed", completed: "Completed", withdrawn: "Withdrawn", superseded: "Superseded" };
const statusTone = { draft: "neutral", sent: "warning", viewed: "info", completed: "success", withdrawn: "danger", superseded: "neutral" };
const eventCopy = { draft_created: "Draft created", draft_updated: "Draft updated", document_attached: "PDF attached", contract_preview_generated: "Exact PDF preview generated", sent: "Sent to employee", viewed: "Viewed by employee", completed: "Acknowledged by employee", withdrawn: "Withdrawn", superseded: "Superseded" };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function DocumentForm({ employeeId, employer, initial, supersedesDocumentId, onClose, onSaved }) {
  const [documentId, setDocumentId] = useState(initial?.id || null);
  const [requestId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(initial?.title || "Employment Contract");
  const [effectiveDate, setEffectiveDate] = useState(initial?.effective_date || today());
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(send) {
    if (!title.trim() || !effectiveDate) return;
    if (file && (file.type !== "application/pdf" || file.size > 10 * 1024 * 1024)) { setError("Choose one PDF file up to 10 MB."); return; }
    setBusy(true); setError("");
    try {
      const saved = await employmentDocumentService.saveDraft({ documentId, employeeId, title, effectiveDate, requestId, supersedesDocumentId });
      setDocumentId(saved.id);
      if (file) await employmentDocumentService.upload({ documentId: saved.id, requestId: crypto.randomUUID(), file });
      if (send) await employmentDocumentService.send(saved.id);
      await onSaved(send ? "Employment document sent." : "Employment document draft saved.");
      onClose();
    } catch (cause) { setError(cause.message || "Unable to save employment document."); }
    finally { setBusy(false); }
  }
  return <Modal size="md" title={supersedesDocumentId ? "Supersede Employment Contract" : initial ? "Edit Employment Contract Draft" : "Upload Employment Contract"} description="Drafts can be edited. Sending pins the exact PDF, document metadata, employee and legal-employer snapshot." onClose={onClose} footer={<><button className="btn-secondary" type="button" disabled={busy} onClick={() => save(false)}>{busy ? "Saving..." : "Save Draft"}</button><button className="btn-primary" type="button" disabled={busy || !title.trim() || !effectiveDate || (!file && !initial?.has_document) || !employer?.is_active} onClick={() => save(true)}>{busy ? "Sending..." : "Send to Employee"}</button></>}>
    <div className="space-y-4">
      <div className={`rounded-xl border px-3 py-3 text-sm ${employer?.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}><strong className="block">Legal Employer</strong><span>{employer ? `${employer.display_name || employer.legal_company_name} · ${employer.company_registration_no}` : "Not assigned — assign an active Legal Employer before Send."}</span></div>
      <AdminFormField label="Document Title" required><input className="control" value={title} onChange={(event) => setTitle(event.target.value)} /></AdminFormField>
      <DatePickerField label="Effective Date" required value={effectiveDate} onChange={setEffectiveDate} />
      <AdminFormField as="div" label="Employment Contract PDF" required={!initial?.has_document}><AdminEvidenceFilePicker file={file} onChange={setFile} disabled={busy} accept="application/pdf" helper="PDF only · Maximum 10 MB" /></AdminFormField>
      <p className="text-xs leading-5 text-text-muted">This V1 action records document review and acknowledgement. FeedX does not represent it as a legal electronic signature.</p>
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700" role="alert">{error}</div> : null}
    </div>
  </Modal>;
}

function DocumentDetail({ item, canManage, onClose, onChanged, onSupersede }) {
  const [evidence, setEvidence] = useState(null);
  const [error, setError] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (item.has_document) employmentDocumentService.adminRead(item.id).then(setEvidence).catch((cause) => setError(cause.message)); }, [item.id, item.has_document]);
  async function withdraw() { setBusy(true); setError(""); try { await employmentDocumentService.withdraw(item.id, reason); await onChanged(); setWithdrawOpen(false); onClose(); } catch (cause) { setError(cause.message); } finally { setBusy(false); } }
  const canWithdraw = canManage && ["sent", "viewed"].includes(item.status);
  const canSupersede = canManage && ["sent", "viewed", "completed"].includes(item.status);
  return <><Modal size="lg" title={item.title} description={`Employment Contract · Effective ${item.effective_date}`} onClose={onClose} footer={<>{canWithdraw ? <button className="btn-danger mr-auto" type="button" onClick={() => setWithdrawOpen(true)}>Withdraw</button> : null}{canSupersede ? <button className="btn-secondary" type="button" onClick={onSupersede}>Supersede</button> : null}<button className="btn-secondary" type="button" onClick={onClose}>Close</button></>}>
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><Badge tone={statusTone[item.status]}>{statusCopy[item.status]}</Badge>{evidence?.download_url ? <a className="btn-secondary" href={evidence.download_url}><Download size={15} /> Download exact PDF</a> : null}</div>
      {item.legal_company_name_snapshot ? <section className="rounded-xl border border-border bg-slate-50 p-3 text-sm"><strong>{item.legal_entity_display_name_snapshot || item.legal_company_name_snapshot}</strong><p className="mt-1 text-text-secondary">{item.legal_company_name_snapshot} · {item.company_registration_no_snapshot}</p><p className="mt-1 whitespace-pre-wrap text-text-muted">{item.registered_address_snapshot}</p></section> : null}
      {evidence?.document_url ? <iframe className="h-[480px] w-full rounded-xl border border-border" title={item.title} src={evidence.document_url} /> : error ? <p className="text-sm text-rose-700">{error}</p> : <p className="text-sm text-text-muted">Loading PDF...</p>}
      {item.document_sha256 ? <div className="break-all text-xs text-text-muted"><strong>SHA-256</strong> {item.document_sha256}</div> : null}
      {item.withdrawal_reason ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><strong>Withdrawal reason</strong><p>{item.withdrawal_reason}</p></div> : null}
      <section><h3 className="text-xs font-bold uppercase text-text-muted">History</h3><div className="mt-2 divide-y divide-border">{item.activity.map((event) => <div className="py-2 text-sm" key={event.id}><div className="flex justify-between gap-3"><strong>{eventCopy[event.type] || event.type}</strong><span className="shrink-0 text-xs text-text-muted">{formatDateTime(event.occurred_at)}</span></div>{event.actor_name ? <small className="text-text-muted">by {event.actor_name}</small> : null}</div>)}</div></section>
    </div>
  </Modal>{withdrawOpen ? <Modal size="sm" title="Withdraw Employment Document" description="The exact PDF and history remain immutable and accessible to authorised Admin users." onClose={() => setWithdrawOpen(false)} footer={<><button className="btn-secondary" type="button" disabled={busy} onClick={() => setWithdrawOpen(false)}>Cancel</button><button className="btn-danger" type="button" disabled={busy || !reason.trim()} onClick={withdraw}>{busy ? "Withdrawing..." : "Withdraw"}</button></>}><AdminFormField label="Reason" required><textarea className="control min-h-28 py-3" value={reason} onChange={(event) => setReason(event.target.value)} /></AdminFormField>{error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}</Modal> : null}</>;
}

export default function EmployeeEmploymentDocumentsPanel({ employeeId, employeeName, canView, canManage, ui }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);
  const [builder, setBuilder] = useState(null);
  const [detail, setDetail] = useState(null);
  const documents = useMemo(() => data?.documents ?? [], [data]);
  async function load() { if (!employeeId || !canView) return; setLoading(true); setError(""); try { setData(await employmentDocumentService.adminDetail(employeeId)); } catch (cause) { setError(cause.message || "Unable to load employment documents."); } finally { setLoading(false); } }
  useEffect(() => { load(); }, [employeeId, canView]);
  if (!employeeId || !canView) return null;
  async function saved(message) { ui?.notify?.({ title: message }); await load(); }
  return <section className="rounded-2xl border border-border bg-slate-50/60 p-3.5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><div className="flex items-center gap-2 text-xs font-black uppercase text-[#94A3B8]"><span className="flex h-7 w-7 items-center justify-center rounded-xl border border-border bg-white text-text-secondary"><BriefcaseBusiness size={14} /></span>Employment Documents</div>{data?.legal_employer ? <p className="mt-1 text-xs text-text-muted">Legal Employer: {data.legal_employer.display_name || data.legal_employer.legal_company_name}</p> : <p className="mt-1 text-xs font-semibold text-amber-700">Legal Employer not assigned</p>}</div>{canManage ? <div className="flex flex-wrap gap-2"><button className="btn-primary h-9 px-3 text-xs" type="button" onClick={() => setBuilder({ supersedesDocumentId: null })}>Create Contract</button><button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => setForm({ initial: null, supersedesDocumentId: null })}><FilePlus2 size={14} /> Upload Existing</button></div> : null}</div>
    {loading ? <p className="text-sm font-semibold text-text-muted">Loading employment documents...</p> : error && !data ? <div className="flex items-center justify-between gap-3 text-sm text-rose-700"><span>{error}</span><button className="btn-secondary px-3 py-2 text-xs" onClick={load}>Retry</button></div> : documents.length ? <div className="divide-y divide-border rounded-xl border border-border bg-white">{documents.map((item) => <div className="flex items-center gap-3 px-3 py-3" key={item.id}><button className="min-w-0 flex-1 text-left" type="button" onClick={() => setDetail(item)}><strong className="block truncate text-sm text-text-primary">{item.title}</strong><span className="mt-1 block text-xs text-text-muted">Effective {item.effective_date}{item.sent_at ? ` · Sent ${new Date(item.sent_at).toLocaleDateString()}` : ""}</span></button><Badge tone={statusTone[item.status]}>{statusCopy[item.status]}</Badge>{item.status === "draft" && canManage ? <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => setForm({ initial: item, supersedesDocumentId: null })}>Edit</button> : <button className="icon-btn" type="button" aria-label={`View ${item.title}`} onClick={() => setDetail(item)}><Eye size={15} /></button>}</div>)}</div> : <div className="rounded-xl border border-dashed border-border bg-white px-4 py-4 text-sm text-text-secondary">No employment contracts.</div>}
    {form ? <DocumentForm employeeId={employeeId} employeeName={employeeName} employer={data?.legal_employer} initial={form.initial} supersedesDocumentId={form.supersedesDocumentId} onClose={() => setForm(null)} onSaved={saved} /> : null}
    {builder ? <EmploymentContractBuilderModal employee={data?.employee || { id: employeeId, full_name: employeeName }} employer={data?.legal_employer} supersedesDocumentId={builder.supersedesDocumentId} ui={ui} onClose={() => setBuilder(null)} onSaved={async () => { await saved("Employment contract sent."); }} /> : null}
    {detail ? <DocumentDetail item={detail} canManage={canManage} onClose={() => setDetail(null)} onChanged={load} onSupersede={() => { const current = detail; setDetail(null); setForm({ initial: { title: current.title, effective_date: current.effective_date }, supersedesDocumentId: current.id }); }} /> : null}
  </section>;
}
