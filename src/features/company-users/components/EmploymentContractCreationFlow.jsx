import { useMemo, useState } from "react";
import { ArrowLeft, FileText, Send } from "lucide-react";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import { employmentDocumentService } from "../../../services/employmentDocumentService.js";

const malaysiaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function defaultsFor(employee) {
  return {
    employee_context: {
      position: employee?.position || "",
      workplace: employee?.workplace || "",
      employment_type: employee?.employment_type || "",
      commencement_date: employee?.joined_date || malaysiaToday(),
    },
    currency: "MYR",
    basic_salary: "",
    salary_payment_period: "monthly",
    allowances: [],
    probation_months: "0",
    working_days_per_week: "5",
    working_days_description: "",
    normal_hours_per_day: "8",
    normal_hours_description: "",
    rest_days: [],
    notice_period_value: "1",
    notice_period_unit: "months",
    probation_notice_period_value: "30",
    probation_notice_period_unit: "days",
    confirmed_notice_period_value: "45",
    confirmed_notice_period_unit: "days",
    employer_signatory_name: "",
    employer_signatory_designation: "",
    additional_terms: "",
    effective_date: malaysiaToday(),
    contract_date: malaysiaToday(),
  };
}

function normalizedTerms(terms) {
  return {
    ...terms,
    basic_salary: Number(terms.basic_salary),
    probation_months: Number(terms.probation_months),
    working_days_per_week: Number(terms.working_days_per_week),
    normal_hours_per_day: Number(terms.normal_hours_per_day),
    notice_period_value: Number(terms.notice_period_value),
    probation_notice_period_value: terms.probation_notice_period_value ? Number(terms.probation_notice_period_value) : undefined,
    confirmed_notice_period_value: terms.confirmed_notice_period_value ? Number(terms.confirmed_notice_period_value) : undefined,
    allowances: terms.allowances.map((allowance) => ({ ...allowance, amount: Number(allowance.amount) })),
  };
}

function TermsForm({ terms, patch, requiresAgreementTerms }) {
  const context = terms.employee_context;
  const patchContext = (key, value) => patch("employee_context", { ...context, [key]: value });
  const patchAllowance = (index, key, value) => patch("allowances", terms.allowances.map((allowance, allowanceIndex) => allowanceIndex === index ? { ...allowance, [key]: value } : allowance));
  return <div className="grid gap-4 md:grid-cols-2">
    <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950"><strong>Contract-only terms</strong><p className="mt-0.5 text-xs">These confirmed values are snapshotted into this contract. They do not update Employee, Payroll or Roster records.</p></div>
    <AdminFormField label="Position" required><input className="control" value={context.position} onChange={(event) => patchContext("position", event.target.value)} /></AdminFormField>
    <AdminFormField label="Workplace" required><input className="control" value={context.workplace} onChange={(event) => patchContext("workplace", event.target.value)} /></AdminFormField>
    <AdminFormField label="Employment Type" required><input className="control" value={context.employment_type} onChange={(event) => patchContext("employment_type", event.target.value)} /></AdminFormField>
    <DatePickerField label="Commencement Date" required value={context.commencement_date} onChange={(value) => patchContext("commencement_date", value)} />
    <AdminFormField label="Basic Salary (MYR)" required><input className="control" inputMode="decimal" min="0" type="number" value={terms.basic_salary} onChange={(event) => patch("basic_salary", event.target.value)} /></AdminFormField>
    <AdminFormField label="Salary Payment Period" required><select className="control" value={terms.salary_payment_period} onChange={(event) => patch("salary_payment_period", event.target.value)}><option value="monthly">Monthly</option><option value="daily">Daily</option><option value="hourly">Hourly</option></select></AdminFormField>
    <AdminFormField label="Probation" required><select className="control" value={terms.probation_months} onChange={(event) => patch("probation_months", event.target.value)}><option value="0">No probation</option>{[1, 2, 3, 6, 12, 24].map((month) => <option key={month} value={month}>{month} month{month > 1 ? "s" : ""}</option>)}</select></AdminFormField>
    <DatePickerField label="Contract Date" required={requiresAgreementTerms} value={terms.contract_date || terms.effective_date} onChange={(value) => patch("contract_date", value)} />
    <AdminFormField label="Working Days per Week" required><input className="control" min="1" max="7" type="number" value={terms.working_days_per_week} onChange={(event) => patch("working_days_per_week", event.target.value)} /></AdminFormField>
    <AdminFormField label="Normal Working Hours per Day" required><input className="control" min="0.25" max="24" step="0.25" type="number" value={terms.normal_hours_per_day} onChange={(event) => patch("normal_hours_per_day", event.target.value)} /></AdminFormField>
    <AdminFormField label="Rest Day(s)" required helper="Separate days with commas."><input className="control" value={terms.rest_days.join(", ")} onChange={(event) => patch("rest_days", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} /></AdminFormField>
    <div className="grid grid-cols-2 gap-2"><AdminFormField label="Probation Notice" required={requiresAgreementTerms}><input className="control" min="1" max="120" type="number" value={terms.probation_notice_period_value || ""} onChange={(event) => patch("probation_notice_period_value", event.target.value)} /></AdminFormField><AdminFormField label="Unit" required><select className="control" value={terms.probation_notice_period_unit || "days"} onChange={(event) => patch("probation_notice_period_unit", event.target.value)}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></AdminFormField></div>
    <div className="grid grid-cols-2 gap-2"><AdminFormField label="Confirmed Notice" required={requiresAgreementTerms}><input className="control" min="1" max="120" type="number" value={terms.confirmed_notice_period_value || ""} onChange={(event) => patch("confirmed_notice_period_value", event.target.value)} /></AdminFormField><AdminFormField label="Unit" required><select className="control" value={terms.confirmed_notice_period_unit || "days"} onChange={(event) => patch("confirmed_notice_period_unit", event.target.value)}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></AdminFormField></div>
    <AdminFormField label="Working Days Description" helper="Optional" className="md:col-span-2"><textarea className="control min-h-20 py-3" value={terms.working_days_description} onChange={(event) => patch("working_days_description", event.target.value)} /></AdminFormField>
    <AdminFormField label="Normal Working Hours Description" helper="Optional" className="md:col-span-2"><textarea className="control min-h-20 py-3" value={terms.normal_hours_description} onChange={(event) => patch("normal_hours_description", event.target.value)} /></AdminFormField>
    <section className="md:col-span-2 rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-3"><div><strong className="text-sm">Allowances</strong><p className="text-xs text-text-muted">Optional contract terms. Maximum 12 entries.</p></div><button className="btn-secondary px-3 py-2 text-xs" disabled={terms.allowances.length >= 12} type="button" onClick={() => patch("allowances", [...terms.allowances, { name: "", amount: "" }])}>+ Add allowance</button></div>{terms.allowances.map((allowance, index) => <div className="mt-2 grid grid-cols-[1fr_130px_auto] gap-2" key={index}><input aria-label={`Allowance ${index + 1} name`} className="control" placeholder="Allowance name" value={allowance.name} onChange={(event) => patchAllowance(index, "name", event.target.value)} /><input aria-label={`Allowance ${index + 1} amount`} className="control" inputMode="decimal" min="0" placeholder="MYR" type="number" value={allowance.amount} onChange={(event) => patchAllowance(index, "amount", event.target.value)} /><button className="text-xs font-semibold text-rose-700" type="button" onClick={() => patch("allowances", terms.allowances.filter((_, allowanceIndex) => allowanceIndex !== index))}>Remove</button></div>)}</section>
    <AdminFormField label="Additional Terms" helper="Optional · Contract-only text" className="md:col-span-2"><textarea className="control min-h-28 py-3" maxLength={4000} value={terms.additional_terms} onChange={(event) => patch("additional_terms", event.target.value)} /></AdminFormField>
    <AdminFormField label="Employer Signatory Name" required={requiresAgreementTerms}><input className="control" value={terms.employer_signatory_name || ""} onChange={(event) => patch("employer_signatory_name", event.target.value)} /></AdminFormField>
    <AdminFormField label="Employer Signatory Designation" required={requiresAgreementTerms}><input className="control" value={terms.employer_signatory_designation || ""} onChange={(event) => patch("employer_signatory_designation", event.target.value)} /></AdminFormField>
  </div>;
}

export default function EmploymentContractCreationFlow({ legalEntity, employees, templates, initialTemplateId, ui, onBack, onSent }) {
  const publishedTemplates = useMemo(() => templates.filter((template) => template.is_active && template.current_published_version), [templates]);
  const [step, setStep] = useState(0);
  const [employeeId, setEmployeeId] = useState("");
  const [templateVersionId, setTemplateVersionId] = useState(() => publishedTemplates.find((template) => template.id === initialTemplateId)?.current_published_version?.id || publishedTemplates.find((template) => template.is_default)?.current_published_version?.id || publishedTemplates[0]?.current_published_version?.id || "");
  const [terms, setTerms] = useState(() => defaultsFor(null));
  const [title, setTitle] = useState("Employment Contract");
  const [documentId, setDocumentId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const employee = employees.find((item) => item.id === employeeId) || null;
  const template = publishedTemplates.find((item) => item.current_published_version?.id === templateVersionId) || null;
  const isEmploymentAgreementV1 = template?.title === "Employment Agreement V1";
  const termsComplete = Boolean(employee && templateVersionId && title.trim() && terms.employee_context.position.trim() && terms.employee_context.workplace.trim() && terms.employee_context.employment_type.trim() && terms.employee_context.commencement_date && terms.effective_date && terms.basic_salary !== "" && terms.rest_days.length && terms.allowances.every((allowance) => allowance.name.trim() && allowance.amount !== "") && (!isEmploymentAgreementV1 || (terms.contract_date && terms.probation_notice_period_value && terms.confirmed_notice_period_value && terms.employer_signatory_name.trim() && terms.employer_signatory_designation.trim())));

  function selectEmployee(nextId) {
    const nextEmployee = employees.find((item) => item.id === nextId) || null;
    setEmployeeId(nextId);
    setTerms(defaultsFor(nextEmployee));
    setPreview(null);
    setDocumentId(null);
  }
  function patch(key, value) { setTerms((current) => ({ ...current, [key]: value })); setPreview(null); }
  function selectTemplate(nextId) {
    const next = publishedTemplates.find((item) => item.current_published_version?.id === nextId);
    setTemplateVersionId(nextId);
    if (next?.title === "Employment Agreement V1") setTerms((current) => ({ ...current, probation_months: "6", working_days_per_week: "6", working_days_description: "according to the roster", normal_hours_description: "subject to applicable statutory requirements" }));
    setPreview(null);
    setDocumentId(null);
  }
  async function saveDraft() {
    const saved = await employmentDocumentService.saveTemplateDraft({ documentId, employeeId: employee.id, title, effectiveDate: terms.effective_date, templateVersionId, terms: normalizedTerms(terms), requestId: crypto.randomUUID() });
    setDocumentId(saved.id);
    return saved;
  }
  async function generatePreview() {
    setBusy(true); setError("");
    try {
      const saved = await saveDraft();
      const result = await employmentDocumentService.previewTemplateContract(saved.id);
      setPreview(result);
      setStep(2);
    } catch (cause) { setError(cause.message || "Unable to generate the exact contract preview."); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!documentId) return;
    setBusy(true); setError("");
    try {
      await employmentDocumentService.send(documentId);
      ui?.notify?.({ title: "Employment contract sent." });
      await onSent?.(documentId);
    } catch (cause) { setError(cause.message || "Unable to send employment contract."); }
    finally { setBusy(false); }
  }
  const steps = ["Employee", "Terms", "Preview & Send"];
  return <section className="rounded-xl border border-border bg-white">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-4 md:p-5"><div><div className="flex items-center gap-2"><h2 className="text-lg font-bold text-text-primary">Create Employee Contract</h2><Badge tone="neutral">Draft until sent</Badge></div><p className="mt-1 text-sm text-text-secondary">Select an employee, confirm contract-only terms, then send the exact canonical A4 PDF through Employment Documents.</p></div><button className="btn-secondary" type="button" disabled={busy} onClick={onBack}><ArrowLeft size={16} /> Template Authoring</button></header>
    <div className="border-b border-border bg-slate-50 px-4 py-3 md:px-5"><ol className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">{steps.map((label, index) => <li className={index === step ? "text-emerald-800" : "text-text-muted"} key={label}>{index + 1}. {label}</li>)}</ol></div>
    <div className="p-4 md:p-5">
      {!legalEntity.is_active ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">This Legal Entity is inactive and cannot issue a new Employment Contract.</div> : null}
      {step === 0 ? <div className="max-w-2xl space-y-4"><div className="rounded-xl border border-border bg-slate-50 p-3 text-sm"><strong>Legal Employer</strong><p className="mt-1">{legalEntity.display_name || legalEntity.legal_company_name}{legalEntity.company_registration_no ? ` · ${legalEntity.company_registration_no}` : ""}</p></div><AdminFormField label="Employee" required helper="Only active employees assigned to this Legal Entity are available."><select className="control" value={employeeId} onChange={(event) => selectEmployee(event.target.value)}><option value="">Select employee</option>{employees.map((item) => <option key={item.id} value={item.id}>{item.full_name}{item.employee_code ? ` · ${item.employee_code}` : ""}</option>)}</select></AdminFormField><AdminFormField label="Published Template" required><select className="control" value={templateVersionId} onChange={(event) => selectTemplate(event.target.value)}><option value="">Select published template</option>{publishedTemplates.map((item) => <option key={item.current_published_version.id} value={item.current_published_version.id}>{item.title} · {item.contract_kind === "full_time" ? "Full-Time" : "Part-Time"}{item.is_default ? " · Default" : ""}</option>)}</select></AdminFormField>{!employees.length ? <p className="rounded-xl border border-dashed border-border p-3 text-sm text-text-muted">No active employees are assigned to this Legal Entity.</p> : null}{!publishedTemplates.length ? <p className="rounded-xl border border-dashed border-border p-3 text-sm text-text-muted">No published template is available. Create and publish one in Template Authoring first.</p> : null}</div> : null}
      {step === 1 ? <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm"><span><strong>{employee.full_name}</strong>{employee.employee_code ? ` · ${employee.employee_code}` : ""}</span><span className="text-text-secondary">{template.title} · v{template.current_published_version.version_number}</span></div><div className="grid gap-4 md:grid-cols-2"><AdminFormField label="Document Title" required><input className="control" value={title} onChange={(event) => { setTitle(event.target.value); setPreview(null); }} /></AdminFormField><DatePickerField label="Effective Date" required value={terms.effective_date} onChange={(value) => patch("effective_date", value)} /></div><TermsForm terms={terms} patch={patch} requiresAgreementTerms={isEmploymentAgreementV1} /></div> : null}
      {step === 2 ? <div className="space-y-4"><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"><strong>Exact A4 contract preview</strong><p className="mt-1">This server-generated PDF and SHA-256 will be pinned unchanged when sent. Changing terms or the template requires a new preview.</p></div>{preview?.document_url ? <iframe className="h-[720px] w-full rounded-xl border border-border" title="Employment contract preview" src={preview.document_url} /> : null}{preview?.document_sha256 ? <p className="break-all text-xs text-text-muted">SHA-256 {preview.document_sha256}</p> : null}</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700" role="alert">{error}</div> : null}
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3 md:px-5"><button className="btn-secondary" disabled={busy} type="button" onClick={step === 0 ? onBack : () => setStep((current) => current - 1)}>{step === 0 ? "Cancel" : "Back"}</button><div>{step === 0 ? <button className="btn-primary" disabled={!legalEntity.is_active || !employeeId || !templateVersionId || busy} type="button" onClick={() => setStep(1)}>Continue to Terms</button> : null}{step === 1 ? <button className="btn-primary" disabled={!termsComplete || busy} type="button" onClick={generatePreview}>{busy ? "Generating..." : <><FileText size={16} /> Generate Exact Preview</>}</button> : null}{step === 2 ? <button className="btn-primary" disabled={busy || !preview?.document_url} type="button" onClick={send}>{busy ? "Sending..." : <><Send size={16} /> Send to Employee</>}</button> : null}</div></footer>
  </section>;
}
