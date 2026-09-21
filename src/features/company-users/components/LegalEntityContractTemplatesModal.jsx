import { useEffect, useMemo, useState } from "react";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { employmentContractTemplateService } from "../../../services/employmentDocumentService.js";
import { employmentAgreementV1 } from "../constants/employmentAgreementV1.js";

const allowedVariables = ["{{legal_entity.legal_company_name}}", "{{legal_entity.company_registration_no}}", "{{legal_entity.registered_address}}", "{{employee.full_name}}", "{{employee.employee_code}}", "{{employee.ic_no}}", "{{employee.residential_address}}", "{{contract.title}}", "{{contract.contract_date}}", "{{contract.position}}", "{{contract.workplace}}", "{{contract.employment_type}}", "{{contract.commencement_date}}", "{{contract.effective_date}}", "{{contract.basic_salary}}", "{{contract.salary_payment_period}}", "{{contract.probation}}", "{{contract.working_days}}", "{{contract.normal_working_hours}}", "{{contract.rest_days}}", "{{contract.notice_period}}", "{{contract.probation_notice_period}}", "{{contract.confirmed_notice_period}}", "{{contract.additional_terms}}", "{{allowances_table}}", "{{annual_leave_table}}", "{{sick_hospitalisation_leave_table}}", "{{signature_block}}"];
const blank = (legalEntityId) => ({ legal_entity_id: legalEntityId, title: "", contract_kind: "full_time", language_code: "en", is_active: true, is_default: false, sections: [{ heading: "", body: "" }] });

export default function LegalEntityContractTemplatesModal({ legalEntity, onClose, ui }) {
  const [templates, setTemplates] = useState([]);
  const [selectedId, setSelectedId] = useState("new");
  const selected = useMemo(() => templates.find((template) => template.id === selectedId), [templates, selectedId]);
  const [draft, setDraft] = useState(() => blank(legalEntity.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() { try { setTemplates(await employmentContractTemplateService.list(legalEntity.id)); } catch (cause) { setError(cause.message || "Unable to load contract templates."); } }
  useEffect(() => { load(); }, [legalEntity.id]);
  function choose(template) {
    setSelectedId(template?.id || "new");
    setDraft(template ? { ...template, sections: template.current_published_version?.sections || [{ heading: "", body: "" }] } : blank(legalEntity.id));
    setError("");
  }
  function useEmploymentAgreementV1() {
    setSelectedId("new");
    setDraft({ ...employmentAgreementV1, legal_entity_id: legalEntity.id, sections: employmentAgreementV1.sections.map((section) => ({ ...section })) });
    setError("");
  }
  function patch(key, value) { setDraft((current) => ({ ...current, [key]: value })); }
  function patchSection(index, key, value) { setDraft((current) => ({ ...current, sections: current.sections.map((section, currentIndex) => currentIndex === index ? { ...section, [key]: value } : section) })); }
  async function save(publish) {
    setBusy(true); setError("");
    try {
      const result = await employmentContractTemplateService.save(draft.id, { ...draft, legal_entity_id: legalEntity.id });
      if (publish) await employmentContractTemplateService.publish(result.template.id, result.draft_version.id);
      await load();
      setSelectedId(result.template.id);
      ui?.notify?.({ title: publish ? "Contract template published." : "Contract template draft saved." });
    } catch (cause) { setError(cause.message || "Unable to save contract template."); }
    finally { setBusy(false); }
  }
  const valid = draft.title?.trim() && draft.sections?.every((section) => section.heading?.trim() && section.body?.trim());
  return <Modal size="xl" title={`${legalEntity.display_name || legalEntity.legal_company_name} · Employment Contract Templates`} description="Published versions are immutable. Templates use only approved merge variables and are rendered server-side into the Employment Documents lifecycle." onClose={onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Close</button><button className="btn-secondary" type="button" disabled={busy || !valid} onClick={() => save(false)}>{busy ? "Saving..." : "Save Draft Version"}</button><button className="btn-primary" type="button" disabled={busy || !valid} onClick={() => save(true)}>{busy ? "Publishing..." : "Publish Version"}</button></>}>
    <div className="grid min-h-[520px] gap-5 md:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="border-b border-border pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-4"><button className="btn-secondary mb-2 w-full justify-center" type="button" onClick={() => choose(null)}>+ New Template</button><button className="btn-secondary mb-3 w-full justify-center text-xs" type="button" onClick={useEmploymentAgreementV1}>Use Employment Agreement V1</button><div className="space-y-1.5">{templates.map((template) => <button className={`w-full rounded-xl px-3 py-2.5 text-left ${template.id === selectedId ? "bg-emerald-50 text-emerald-950" : "hover:bg-slate-50"}`} key={template.id} onClick={() => choose(template)} type="button"><strong className="block text-sm">{template.title}</strong><small className="mt-0.5 block text-text-muted">{template.contract_kind === "full_time" ? "Full-Time" : "Part-Time"}{template.is_default ? " · Default" : ""}{!template.is_active ? " · Inactive" : ""}</small></button>)}</div></aside>
      <section className="space-y-4 overflow-y-auto pr-1">
        <div className="grid gap-4 md:grid-cols-2"><AdminFormField label="Template Title" required><input className="control" value={draft.title || ""} onChange={(event) => patch("title", event.target.value)} /></AdminFormField><AdminFormField label="Contract Type" required><select className="control" value={draft.contract_kind} onChange={(event) => patch("contract_kind", event.target.value)}><option value="full_time">Full-Time Employment Contract</option><option value="part_time">Part-Time Employment Contract</option></select></AdminFormField></div>
        <div className="flex flex-wrap gap-4"><label className="flex items-center gap-2 text-sm font-semibold"><input checked={draft.is_active !== false} type="checkbox" onChange={(event) => patch("is_active", event.target.checked)} /> Active</label><label className="flex items-center gap-2 text-sm font-semibold"><input checked={Boolean(draft.is_default)} type="checkbox" onChange={(event) => patch("is_default", event.target.checked)} /> Default for this contract type</label></div>
        <div className="rounded-xl border border-border bg-slate-50 p-3 text-xs leading-5 text-text-secondary"><strong className="text-text-primary">Approved merge variables</strong><div className="mt-1.5 flex flex-wrap gap-1.5">{allowedVariables.map((variable) => <code className="rounded bg-white px-1.5 py-0.5" key={variable}>{variable}</code>)}</div><p className="mt-2">Clause bodies are plain text only. No HTML, custom expressions, conditions or loops are supported.</p></div>
        <div className="space-y-3">{draft.sections.map((section, index) => <div className="rounded-xl border border-border p-3" key={index}><div className="mb-2 flex items-center justify-between"><strong className="text-sm">Clause {index + 1}</strong>{draft.sections.length > 1 ? <button className="text-xs font-semibold text-rose-700" type="button" onClick={() => patch("sections", draft.sections.filter((_, currentIndex) => currentIndex !== index))}>Remove</button> : null}</div><AdminFormField label="Heading" required><input className="control" value={section.heading} onChange={(event) => patchSection(index, "heading", event.target.value)} /></AdminFormField><AdminFormField label="Clause Text" required className="mt-3"><textarea className="control min-h-36 py-3" value={section.body} onChange={(event) => patchSection(index, "body", event.target.value)} /></AdminFormField></div>)}</div>
        <button className="btn-secondary" type="button" onClick={() => patch("sections", [...draft.sections, { heading: "", body: "" }])}>+ Add Clause</button>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700" role="alert">{error}</div> : null}
      </section>
    </div>
  </Modal>;
}
