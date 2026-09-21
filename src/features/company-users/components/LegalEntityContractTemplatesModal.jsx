import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Eye, Plus, Search, Sparkles, X } from "lucide-react";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { employmentContractTemplateService } from "../../../services/employmentDocumentService.js";
import { employmentAgreementV1 } from "../constants/employmentAgreementV1.js";

const variableGroups = [
  { label: "Legal Entity", variables: ["{{legal_entity.legal_company_name}}", "{{legal_entity.company_registration_no}}", "{{legal_entity.registered_address}}", "{{legal_entity.display_name}}"] },
  { label: "Employee", variables: ["{{employee.full_name}}", "{{employee.employee_code}}", "{{employee.ic_no}}", "{{employee.residential_address}}"] },
  { label: "Contract", variables: ["{{contract.title}}", "{{contract.contract_date}}", "{{contract.position}}", "{{contract.workplace}}", "{{contract.employment_type}}", "{{contract.commencement_date}}", "{{contract.effective_date}}", "{{contract.basic_salary}}", "{{contract.salary_payment_period}}", "{{contract.probation}}", "{{contract.working_days}}", "{{contract.normal_working_hours}}", "{{contract.rest_days}}", "{{contract.notice_period}}", "{{contract.probation_notice_period}}", "{{contract.confirmed_notice_period}}", "{{contract.additional_terms}}"] },
  { label: "Structured Blocks", variables: ["{{allowances_table}}", "{{annual_leave_table}}", "{{sick_hospitalisation_leave_table}}", "{{signature_block}}"] },
];
const blank = (legalEntityId) => ({ legal_entity_id: legalEntityId, title: "", contract_kind: "full_time", language_code: "en", is_active: true, is_default: false, sections: [{ heading: "", body: "" }] });
const summary = (body) => String(body || "").replace(/\s+/g, " ").trim() || "No clause text yet.";

function base64PdfUrl(value) {
  const bytes = Uint8Array.from(window.atob(value), (character) => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

function TemplatePreviewModal({ preview, employees, selectedEmployeeId, onSelectEmployee, onRefresh, loading, onClose }) {
  const employee = employees.find((item) => item.id === selectedEmployeeId);
  const missing = preview?.missing_variables || [];
  return <Modal size="3xl" panelClassName="max-h-[92vh] max-w-[1240px]" bodyClassName="p-0" title="Contract Preview" description="Draft preview · rendered by the canonical Employment Documents PDF renderer. It does not publish a template or create an employee document." onClose={onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Back to Editor</button><button className="btn-primary" type="button" disabled={loading || !selectedEmployeeId} onClick={onRefresh}>{loading ? "Refreshing..." : "Refresh Preview"}</button></>}>
    <div className="grid min-h-[620px] lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="border-b border-border bg-slate-50/70 p-5 lg:border-b-0 lg:border-r">
        <div className="text-sm font-bold text-text-primary">Preview as Employee</div>
        <p className="mt-1 text-sm text-text-secondary">Only active employees linked to this Legal Entity and within your scope are available.</p>
        <select aria-label="Preview employee" className="control mt-3" value={selectedEmployeeId} onChange={(event) => onSelectEmployee(event.target.value)}>
          <option value="">Select an employee</option>
          {employees.map((item) => <option key={item.id} value={item.id}>{item.full_name}{item.employee_code ? ` · ${item.employee_code}` : ""}</option>)}
        </select>
        {employee ? <div className="mt-4 border-t border-border pt-4 text-sm"><strong className="block text-text-primary">{employee.full_name}</strong><span className="mt-1 block text-text-secondary">{employee.position || "Position not recorded"} · {employee.workplace || "Workplace not recorded"}</span></div> : null}
        {missing.length ? <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><strong className="block">Preview values still needed</strong><p className="mt-1">These draft-only values are shown as “Not provided” and must be supplied when creating a real employee contract.</p><ul className="mt-2 space-y-1 break-words font-mono text-xs">{missing.map((token) => <li key={token}>{`{{${token}}}`}</li>)}</ul></div> : <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">All variables used by this template have a preview value.</div>}
      </aside>
      <section className="min-h-0 bg-slate-200 p-4 md:p-6"><div className="mx-auto h-full max-w-[760px] overflow-auto rounded-lg bg-white shadow-sm"><iframe title="Draft contract PDF preview" className="min-h-[760px] w-full border-0" src={preview?.url} /></div></section>
    </div>
  </Modal>;
}

function VariablePicker({ clauseIndex, query, onQueryChange, onInsert, onClose }) {
  const normalized = query.trim().toLowerCase();
  return <div className="mt-3 rounded-xl border border-border bg-slate-50 p-3"><div className="flex items-center justify-between gap-3"><strong className="text-sm text-text-primary">Insert Variable</strong><button className="icon-btn h-7 w-7" type="button" aria-label="Close variable picker" onClick={onClose}><X size={15} /></button></div><div className="relative mt-2"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={14} /><input className="control h-9 pl-8 text-sm" autoFocus placeholder="Search approved variables" value={query} onChange={(event) => onQueryChange(event.target.value)} /></div><div className="mt-3 max-h-52 space-y-3 overflow-y-auto">{variableGroups.map((group) => { const variables = group.variables.filter((token) => !normalized || token.toLowerCase().includes(normalized)); return variables.length ? <div key={group.label}><div className="mb-1.5 text-xs font-bold text-text-muted">{group.label}</div><div className="flex flex-wrap gap-1.5">{variables.map((token) => <button className="rounded-md border border-border bg-white px-2 py-1 font-mono text-xs text-text-primary hover:border-emerald-300 hover:bg-emerald-50" key={token} type="button" onClick={() => onInsert(clauseIndex, token)}>{token}</button>)}</div></div> : null; })}</div></div>;
}

export default function LegalEntityContractTemplatesModal({ legalEntity, onClose, ui }) {
  const [templates, setTemplates] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedId, setSelectedId] = useState("new");
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [draft, setDraft] = useState(() => blank(legalEntity.id));
  const [expandedClause, setExpandedClause] = useState(0);
  const [pickerClause, setPickerClause] = useState(null);
  const [variableQuery, setVariableQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewEmployeeId, setPreviewEmployeeId] = useState("");
  const textareas = useRef({});
  const selected = useMemo(() => templates.find((template) => template.id === selectedId), [templates, selectedId]);
  const valid = Boolean(draft.title?.trim() && draft.sections?.every((section) => section.heading?.trim() && section.body?.trim()));

  async function load() {
    try {
      const [nextTemplates, nextEmployees] = await Promise.all([employmentContractTemplateService.list(legalEntity.id), employmentContractTemplateService.previewEmployees(legalEntity.id)]);
      setTemplates(nextTemplates);
      setEmployees(nextEmployees);
      setPreviewEmployeeId((current) => current && nextEmployees.some((item) => item.id === current) ? current : nextEmployees[0]?.id || "");
    } catch (cause) { setError(cause.message || "Unable to load the contract workspace."); }
  }
  useEffect(() => { load(); }, [legalEntity.id]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview?.url]);

  function choose(template, versionId = null) {
    const version = template?.versions?.find((item) => item.id === versionId) || template?.current_published_version;
    setSelectedId(template?.id || "new");
    setSelectedVersionId(version?.id || null);
    setDraft(template ? { ...template, sections: version?.sections || [{ heading: "", body: "" }] } : blank(legalEntity.id));
    setExpandedClause(0);
    setPickerClause(null);
    setError("");
  }
  function patch(key, value) { setDraft((current) => ({ ...current, [key]: value })); }
  function patchSection(index, key, value) { setDraft((current) => ({ ...current, sections: current.sections.map((section, currentIndex) => currentIndex === index ? { ...section, [key]: value } : section) })); }
  function useEmploymentAgreementV1() { setSelectedId("new"); setSelectedVersionId(null); setDraft({ ...employmentAgreementV1, legal_entity_id: legalEntity.id, sections: employmentAgreementV1.sections.map((section) => ({ ...section })) }); setExpandedClause(0); setPickerClause(null); setError(""); }
  function insertVariable(index, token) { const textarea = textareas.current[index]; const body = draft.sections[index]?.body || ""; const start = textarea?.selectionStart ?? body.length; const end = textarea?.selectionEnd ?? body.length; patchSection(index, "body", `${body.slice(0, start)}${token}${body.slice(end)}`); setPickerClause(null); setVariableQuery(""); requestAnimationFrame(() => { textarea?.focus(); textarea?.setSelectionRange(start + token.length, start + token.length); }); }
  function removeClause(index) { patch("sections", draft.sections.filter((_, currentIndex) => currentIndex !== index)); setExpandedClause(Math.max(0, index - 1)); setPickerClause(null); }
  async function save(publish) { setBusy(true); setError(""); try { const result = await employmentContractTemplateService.save(draft.id, { ...draft, legal_entity_id: legalEntity.id }); if (publish) await employmentContractTemplateService.publish(result.template.id, result.draft_version.id); setDraft((current) => ({ ...current, id: result.template.id })); setSelectedId(result.template.id); setSelectedVersionId(result.draft_version.id); await load(); ui?.notify?.({ title: publish ? "Contract template published." : "Contract template draft saved." }); } catch (cause) { setError(cause.message || "Unable to save contract template."); } finally { setBusy(false); } }
  async function previewDraft() { if (!valid || !previewEmployeeId) return; setBusy(true); setError(""); try { const result = await employmentContractTemplateService.previewDraft({ legalEntityId: legalEntity.id, employeeId: previewEmployeeId, template: { ...draft, legal_entity_id: legalEntity.id } }); setPreview((current) => { if (current?.url) URL.revokeObjectURL(current.url); return { ...result, url: base64PdfUrl(result.preview_pdf_base64) }; }); } catch (cause) { setError(cause.message || "Unable to generate the draft contract preview."); } finally { setBusy(false); } }

  return <><Modal size="3xl" panelClassName="max-h-[92vh] max-w-[1360px]" bodyClassName="p-0" footerClassName="items-center justify-between" title={`${legalEntity.display_name || legalEntity.legal_company_name} · Contract Templates`} description="Draft clauses stay editable. Published versions are immutable and are the only versions available to create an employee contract." onClose={onClose} footer={<><span className="hidden text-sm text-text-secondary md:block">{selected ? `${selected.versions?.length || 0} version${(selected.versions?.length || 0) === 1 ? "" : "s"}` : "New template"}</span><div className="flex flex-wrap justify-end gap-2"><button className="btn-secondary" type="button" onClick={onClose}>Close</button><button className="btn-secondary" type="button" disabled={busy || !valid || !previewEmployeeId} onClick={previewDraft}><Eye size={15} /> Preview</button><button className="btn-secondary" type="button" disabled={busy || !valid} onClick={() => save(false)}>{busy ? "Saving..." : "Save Draft"}</button><button className="btn-primary" type="button" disabled={busy || !valid} onClick={() => save(true)}>{busy ? "Publishing..." : "Publish Version"}</button></div></>}>
    <div className="grid min-h-[640px] lg:grid-cols-[250px_minmax(0,1fr)]"><aside className="border-b border-border bg-slate-50/70 p-4 lg:border-b-0 lg:border-r"><div className="mb-3 grid gap-2"><button className="btn-secondary justify-center" type="button" onClick={() => choose(null)}><Plus size={15} /> New Template</button><button className="btn-secondary justify-center text-xs" type="button" onClick={useEmploymentAgreementV1}><Sparkles size={14} /> Use Employment Agreement V1</button></div><div className="mb-2 text-xs font-bold text-text-muted">TEMPLATES / VERSIONS</div><div className="space-y-1">{templates.map((template) => <div className={`rounded-xl ${template.id === selectedId ? "bg-emerald-50 text-emerald-950" : "hover:bg-white"}`} key={template.id}><button className="w-full px-3 py-2.5 text-left" onClick={() => choose(template)} type="button"><strong className="block text-sm">{template.title}</strong><span className="mt-1 block text-xs text-text-secondary">{template.contract_kind === "full_time" ? "Full-Time" : "Part-Time"}{template.is_default ? " · Default" : ""}{!template.is_active ? " · Inactive" : ""}</span></button>{template.id === selectedId && template.versions?.length ? <div className="border-t border-emerald-100 px-3 py-2">{template.versions.map((version) => <button className={`flex w-full items-center justify-between rounded px-1 py-1 text-xs ${version.id === selectedVersionId ? "bg-white font-semibold" : "hover:bg-white/70"}`} key={version.id} type="button" onClick={() => choose(template, version.id)}><span>v{version.version_number}</span><Badge tone={version.status === "published" ? "success" : "neutral"}>{version.status === "published" ? "Published" : "Draft"}</Badge></button>)}</div> : null}</div>)}</div>{!templates.length ? <p className="mt-4 text-sm text-text-secondary">Start with a new template or the approved Employment Agreement V1 structure.</p> : null}</aside><section className="min-h-0 overflow-y-auto p-5 md:p-6"><div className="mx-auto max-w-4xl space-y-5"><div className="flex items-center justify-between"><div><h3 className="type-title font-bold text-text-primary">Contract Editor</h3><p className="mt-1 text-sm text-text-secondary">Use plain-language clauses and approved merge variables only.</p></div><Badge tone={draft.id ? "info" : "neutral"}>{draft.id ? "Draft editing" : "New draft"}</Badge></div><div className="grid gap-4 md:grid-cols-2"><AdminFormField label="Template Title" required><input className="control" value={draft.title || ""} onChange={(event) => patch("title", event.target.value)} /></AdminFormField><AdminFormField label="Contract Type" required><select className="control" value={draft.contract_kind} onChange={(event) => patch("contract_kind", event.target.value)}><option value="full_time">Full-Time Employment Contract</option><option value="part_time">Part-Time Employment Contract</option></select></AdminFormField></div><div className="flex flex-wrap gap-5 border-y border-border py-3"><label className="flex items-center gap-2 text-sm font-semibold"><input checked={draft.is_active !== false} type="checkbox" onChange={(event) => patch("is_active", event.target.checked)} /> Active</label><label className="flex items-center gap-2 text-sm font-semibold"><input checked={Boolean(draft.is_default)} type="checkbox" onChange={(event) => patch("is_default", event.target.checked)} /> Default for this contract type</label></div><div><div className="mb-2 flex items-baseline justify-between"><h4 className="text-sm font-bold text-text-primary">Clauses</h4><span className="text-xs text-text-muted">{draft.sections.length} clause{draft.sections.length === 1 ? "" : "s"}</span></div><div className="divide-y divide-border rounded-xl border border-border">{draft.sections.map((section, index) => <article key={index}><button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50" type="button" onClick={() => { setExpandedClause(expandedClause === index ? -1 : index); setPickerClause(null); }}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-text-secondary">{index + 1}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-text-primary">{section.heading || "Untitled clause"}</strong><span className="mt-0.5 block truncate text-xs text-text-secondary">{summary(section.body)}</span></span>{expandedClause === index ? <ChevronDown size={16} className="text-text-muted" /> : <ChevronRight size={16} className="text-text-muted" />}</button>{expandedClause === index ? <div className="border-t border-border bg-slate-50/40 p-4"><div className="flex justify-end">{draft.sections.length > 1 ? <button className="text-xs font-semibold text-rose-700 hover:underline" type="button" onClick={() => removeClause(index)}>Remove clause</button> : null}</div><AdminFormField label="Heading" required><input className="control" value={section.heading} onChange={(event) => patchSection(index, "heading", event.target.value)} /></AdminFormField><div className="mt-3"><div className="mb-1.5 flex items-center justify-between"><label className="text-sm font-semibold text-text-primary">Clause Text <span className="text-rose-600">*</span></label><button className="text-xs font-semibold text-emerald-800 hover:underline" type="button" onClick={() => { setPickerClause(pickerClause === index ? null : index); setVariableQuery(""); }}>Insert Variable</button></div><textarea ref={(node) => { textareas.current[index] = node; }} className="control min-h-44 py-3 font-serif leading-6" value={section.body} onChange={(event) => patchSection(index, "body", event.target.value)} /></div>{pickerClause === index ? <VariablePicker clauseIndex={index} query={variableQuery} onQueryChange={setVariableQuery} onInsert={insertVariable} onClose={() => setPickerClause(null)} /> : null}</div> : null}</article>)}</div><button className="btn-secondary mt-3" type="button" onClick={() => { patch("sections", [...draft.sections, { heading: "", body: "" }]); setExpandedClause(draft.sections.length); }}>+ Add Clause</button></div>{error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700" role="alert">{error}</div> : null}</div></section></div>
  </Modal>{preview ? <TemplatePreviewModal preview={preview} employees={employees} selectedEmployeeId={previewEmployeeId} onSelectEmployee={setPreviewEmployeeId} onRefresh={previewDraft} loading={busy} onClose={() => setPreview(null)} /> : null}</>;
}
