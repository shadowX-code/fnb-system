import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronRight, Plus, Wallet } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { hasPermission } from "../../../utils/accessControl.js";
import { payrollService } from "../../../services/payrollService.js";
import PayrollTimeExceptionsTab from "./PayrollTimeExceptionsTab.jsx";
import PayrollRunCalculationPanel from "./PayrollRunCalculationPanel.jsx";
import PayrollPayRulesPanel from "./PayrollPayRulesPanel.jsx";

const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const currentMonth = () => today().slice(0, 7);
const money = (value, currency = "MYR") => new Intl.NumberFormat("en-MY", {
  style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(value || 0));
const effective = (versions, date = today()) =>
  [...(versions || [])].filter((item) => item.effective_from <= date)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] || null;
const label = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const entityName = (entities, id) => entities.find((item) => item.id === id)?.display_name
  || entities.find((item) => item.id === id)?.name || "Legal Entity";

function Select({ value, onChange, options, disabled = false }) {
  return <select className="control" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
}

function StatutoryChecks({ value, onChange }) {
  return <fieldset className="rounded-xl border border-border p-3">
    <legend className="px-1 text-sm font-bold text-text-primary">Statutory applicability</legend>
    <p className="mb-3 text-xs text-text-secondary">Eligibility only. This does not calculate contributions. Review each item independently of pay basis.</p>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {["epf", "socso", "eis", "pcb"].map((key) => <label key={key} className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={value[key] === true} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} />
        {key.toUpperCase()}
      </label>)}
    </div>
  </fieldset>;
}

function FoundationForm({ mode, profile, data, onClose, onSaved }) {
  const current = effective(profile?.compensation);
  const currentStatutory = effective(profile?.statutory);
  const [draft, setDraft] = useState(() => ({
    employeeId: "",
    profileId: profile?.id,
    payBasis: current?.pay_basis || "monthly",
    rate: current?.basic_salary || current?.hourly_rate || "",
    currency: current?.currency || "MYR",
    effectiveFrom: today(),
    reason: "",
    epf: currentStatutory?.epf_applicable ?? null,
    socso: currentStatutory?.socso_applicable ?? null,
    eis: currentStatutory?.eis_applicable ?? null,
    pcb: currentStatutory?.pcb_applicable ?? null,
    componentId: data.components?.find((item) => ["allowance", "deduction"].includes(item.component_type))?.id || "",
    amount: "",
    active: true,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const patch = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
  const isProfile = mode === "create" || mode === "compensation";
  const title = {
    create: "Create Payroll Profile",
    compensation: "Adjust Compensation",
    statutory: "Review Statutory Applicability",
    recurring: "Adjust Recurring Component",
  }[mode];

  async function save() {
    setBusy(true);
    setError("");
    try {
      const input = { ...draft, rate: Number(draft.rate), amount: Number(draft.amount) };
      if (mode === "create") await payrollService.createProfile(input);
      if (mode === "compensation") await payrollService.adjustCompensation(input);
      if (mode === "statutory") await payrollService.adjustStatutory(input);
      if (mode === "recurring") await payrollService.adjustRecurring(input);
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause.message || "Unable to save Payroll change.");
    } finally {
      setBusy(false);
    }
  }
  const candidates = (data.employees || []).filter((employee) =>
    !(data.profiles || []).some((item) => item.employee_id === employee.id));
  const allowed = draft.reason.trim() && draft.effectiveFrom && (
    mode === "create" ? draft.employeeId && Number(draft.rate) > 0
      : mode === "compensation" ? Number(draft.rate) > 0
        : mode === "recurring" ? draft.componentId && (!draft.active || Number(draft.amount) > 0)
          : true);

  return <Modal title={title} description="Effective-dated, audited Payroll authority. Existing versions are retained."
    onClose={onClose} size="lg"
    footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={!allowed || busy} onClick={save}>{busy ? "Saving..." : "Save"}</button></>}>
    <div className="space-y-4">
      {mode === "create" && <AdminFormField label="Employee" required>
        <Select value={draft.employeeId} onChange={(value) => patch("employeeId", value)}
          options={[{ value: "", label: "Select employee with Legal Employer" },
            ...candidates.map((item) => ({ value: item.id, label: `${item.name} · ${entityName(data.legal_entities || [], item.legal_entity_id)}` }))]} />
      </AdminFormField>}
      {isProfile && <div className="grid gap-4 sm:grid-cols-2">
        <AdminFormField label="Pay Basis" required><Select value={draft.payBasis} onChange={(value) => setDraft((previous) => ({
          ...previous, payBasis: value, rate: previous.payBasis === value ? previous.rate : "",
        }))}
          options={[{ value: "monthly", label: "Monthly" }, { value: "hourly", label: "Hourly" }]} /></AdminFormField>
        <AdminFormField label={draft.payBasis === "monthly" ? "Basic Salary (MYR)" : "Hourly Rate (MYR)"} required>
          <input className="control" type="number" min="0.01" step={draft.payBasis === "monthly" ? "0.01" : "0.0001"}
            value={draft.rate} onChange={(event) => patch("rate", event.target.value)} />
        </AdminFormField>
      </div>}
      {mode === "create" || mode === "statutory" ? <StatutoryChecks value={draft} onChange={setDraft} /> : null}
      {mode === "recurring" && <div className="grid gap-4 sm:grid-cols-2">
        <AdminFormField label="Pay Component" required><Select value={draft.componentId} onChange={(value) => patch("componentId", value)}
          options={(data.components || []).filter((item) => item.is_active && ["allowance", "deduction"].includes(item.component_type))
            .map((item) => ({ value: item.id, label: `${item.name} · ${label(item.component_type)}` }))} /></AdminFormField>
        <AdminFormField label="Recurring Amount (MYR)" required><input className="control" type="number" min="0" step="0.01"
          value={draft.amount} disabled={!draft.active} onChange={(event) => patch("amount", event.target.value)} /></AdminFormField>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={draft.active}
          onChange={(event) => { patch("active", event.target.checked); if (!event.target.checked) patch("amount", "0"); }} />
          Active from effective date</label>
      </div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminFormField label="Effective From" required><input className="control" type="date" value={draft.effectiveFrom}
          onChange={(event) => patch("effectiveFrom", event.target.value)} /></AdminFormField>
        <AdminFormField label="Reason / provenance" required><input className="control" value={draft.reason}
          onChange={(event) => patch("reason", event.target.value)} placeholder="Reviewed compensation change" /></AdminFormField>
      </div>
      {mode === "compensation" && <p className="text-xs text-text-secondary">The new version applies from this date. It does not update an Employment Contract or rewrite earlier versions.</p>}
      {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    </div>
  </Modal>;
}

function ProfilesTab({ data, canManage, reload }) {
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState("");
  const selected = data.profiles?.find((profile) => profile.id === selectedId);
  const entities = data.legal_entities || [];
  const columns = [
    { key: "employee", header: "Employee", render: (row) => <div><strong>{row.employee_name}</strong><div className="text-xs text-text-muted">{row.employee_code || row.workplace || "—"}</div></div> },
    { key: "employer", header: "Legal Employer", render: (row) => entityName(entities, effective(row.compensation)?.legal_entity_id) },
    { key: "basis", header: "Pay Basis", render: (row) => label(effective(row.compensation)?.pay_basis || "Not effective") },
    { key: "rate", header: "Current Rate", align: "right", render: (row) => { const c = effective(row.compensation); return c ? <strong>{money(c.basic_salary || c.hourly_rate, c.currency)}{c.pay_basis === "hourly" ? " / hour" : ""}</strong> : "—"; } },
    { key: "open", header: "", align: "right", render: () => <ChevronRight size={16} /> },
  ];
  const versions = selected?.compensation || [];
  const current = effective(versions);
  const upcoming = versions.filter((item) => item.effective_from > today()).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const statutory = effective(selected?.statutory);
  const currentComponents = (selected?.recurring || []).filter((item) =>
    item.id === effective((selected?.recurring || []).filter((other) => other.component_id === item.component_id))?.id && item.is_active);

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><p className="text-sm text-text-secondary">Pay basis and compensation are separate from Employment Type and immutable contract terms.</p>
      {canManage && <button className="btn-primary" type="button" onClick={() => setForm("create")}><Plus size={16} /> Create Profile</button>}</div>
    <Card>{data.profiles?.length ? <DataTable columns={columns} rows={data.profiles} getRowKey={(row) => row.id}
      density="compact" onRowClick={(row) => setSelectedId(row.id)} /> : <div className="p-8 text-center text-sm text-text-secondary">No Payroll Profiles yet. An employee needs a Legal Employer before inclusion.</div>}</Card>
    {selected && <Card className="p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-lg font-bold text-text-primary">{selected.employee_name}</h3>
          <p className="text-sm text-text-secondary">{entityName(entities, current?.legal_entity_id)} · {selected.workplace || "Workplace not set"}</p></div>
        <button className="btn-secondary" type="button" onClick={() => setSelectedId("")}>Close detail</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-border p-4"><h4 className="font-bold">Current Compensation</h4>
          <p className="mt-2 text-xl font-bold">{current ? money(current.basic_salary || current.hourly_rate, current.currency) : "Not effective yet"}</p>
          <p className="text-sm text-text-secondary">{current ? `${label(current.pay_basis)} · from ${current.effective_from}` : "—"}</p></section>
        <section className="rounded-xl border border-border p-4"><h4 className="font-bold">Upcoming Compensation</h4>
          <p className="mt-2 text-xl font-bold">{upcoming[0] ? money(upcoming[0].basic_salary || upcoming[0].hourly_rate, upcoming[0].currency) : "None scheduled"}</p>
          <p className="text-sm text-text-secondary">{upcoming[0]?.effective_from || "—"}</p></section>
        <section className="rounded-xl border border-border p-4"><h4 className="font-bold">Statutory Applicability</h4>
          <div className="mt-2 flex flex-wrap gap-2">{["epf", "socso", "eis", "pcb"].map((key) =>
            <Badge key={key} tone={statutory?.[`${key}_applicable`] === true ? "success" : "neutral"}>
              {key.toUpperCase()}: {statutory?.[`${key}_applicable`] == null ? "Unreviewed" : statutory[`${key}_applicable`] ? "Yes" : "No"}
            </Badge>)}</div></section>
      </div>
      {canManage && <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" type="button" onClick={() => setForm("compensation")}>Adjust Compensation</button>
        <button className="btn-secondary" type="button" onClick={() => setForm("statutory")}>Review Applicability</button>
        <button className="btn-secondary" type="button" onClick={() => setForm("recurring")}>Adjust Recurring Component</button>
      </div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <section><h4 className="mb-2 font-bold">Compensation History</h4>
          <div className="divide-y divide-border rounded-xl border border-border">{versions.map((item) =>
            <div key={item.id} className="flex justify-between gap-3 px-3 py-2 text-sm"><span>{item.effective_from} · {label(item.pay_basis)}<small className="block text-text-muted">{item.reason}</small></span>
              <strong>{money(item.basic_salary || item.hourly_rate, item.currency)}{item.pay_basis === "hourly" ? " / hour" : ""}</strong></div>)}</div></section>
        <section><h4 className="mb-2 font-bold">Recurring Components</h4>
          <div className="divide-y divide-border rounded-xl border border-border">{currentComponents.length ? currentComponents.map((item) =>
            <div key={item.id} className="flex justify-between gap-3 px-3 py-2 text-sm"><span>{data.components?.find((component) => component.id === item.component_id)?.name || "Component"}<small className="block text-text-muted">From {item.effective_from}</small></span><strong>{money(item.amount)}</strong></div>) : <p className="p-3 text-sm text-text-secondary">No active recurring components.</p>}</div></section>
      </div>
    </Card>}
    {form && <FoundationForm mode={form} profile={selected} data={data} onClose={() => setForm("")} onSaved={reload} />}
  </div>;
}

function RunsTab({ data, canManage, canFinalize, reload }) {
  const [entityId, setEntityId] = useState(data.legal_entities?.[0]?.id || "");
  const [month, setMonth] = useState(currentMonth());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingTransition, setPendingTransition] = useState(null);
  const [transitionReason, setTransitionReason] = useState("");
  const [readiness, setReadiness] = useState({});
  const [selectedRunId, setSelectedRunId] = useState("");
  const periods = (data.periods || []).filter((item) => !entityId || item.legal_entity_id === entityId);
  useEffect(() => {
    const runs = periods.flatMap((period) => period.runs || []).filter((run) => ["draft", "review_required", "ready"].includes(run.status));
    let active = true;
    Promise.all(runs.map(async (run) => [run.id, {
      time: await payrollService.runTimeReadiness(run.id),
      calculation: run.foundation_only ? null : await payrollService.calculationReadiness(run.id),
      statutory: run.foundation_only ? null : await payrollService.statutoryReadiness(run.id),
    }]))
      .then((results) => { if (active) setReadiness(Object.fromEntries(results)); })
      .catch(() => { if (active) setReadiness({}); });
    return () => { active = false; };
  }, [data.periods, entityId]);
  const create = async (supersedesRunId = null, period = null) => {
    setBusy(true); setError("");
    try {
      const start = period?.period_start || `${month}-01`;
      const end = period?.period_end || new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
      await payrollService.createRun({ legalEntityId: period?.legal_entity_id || entityId,
        periodStart: start, periodEnd: end, reason, supersedesRunId });
      await reload(); setReason("");
    } catch (cause) { setError(cause.message || "Unable to create run."); }
    finally { setBusy(false); }
  };
  const transition = async () => {
    if (!pendingTransition || !transitionReason.trim()) return;
    setBusy(true); setError("");
    try {
      await payrollService.transitionRun(pendingTransition.runId, pendingTransition.status, transitionReason.trim());
      await reload();
      setPendingTransition(null);
      setTransitionReason("");
    }
    catch (cause) { setError(cause.message || "Unable to transition run."); }
    finally { setBusy(false); }
  };
  const requestTransition = (runId, status) => {
    setError("");
    setTransitionReason("");
    setPendingTransition({ runId, status });
  };
  return <div className="space-y-4">
    <div className="rounded-xl border border-border bg-surface-muted p-4 text-sm text-text-secondary">
      <strong className="text-text-primary">Payroll calculation.</strong> Effective compensation and approved time feed statutory review. EPF/SOCSO/EIS use reviewed schedules; applicable PCB / MTD requires an Admin-confirmed amount for each employee and Run. Missing evidence blocks Ready and Finalize. Payslips and payments are not available.
    </div>
    {canManage && <Card className="p-4"><div className="grid gap-3 sm:grid-cols-4">
      <AdminFormField label="Legal Entity"><Select value={entityId} onChange={setEntityId} options={(data.legal_entities || []).map((item) => ({ value: item.id, label: item.display_name || item.name }))} /></AdminFormField>
      <AdminFormField label="Pay Period"><input className="control" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></AdminFormField>
      <AdminFormField label="Reason"><input className="control" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Payroll period review" /></AdminFormField>
      <div className="flex items-end"><button className="btn-primary w-full" type="button" disabled={busy || !entityId || !month || !reason.trim()} onClick={() => create()}><Plus size={15} /> Create Draft</button></div>
    </div></Card>}
    {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    <div className="space-y-3">{periods.length ? periods.map((period) => <Card key={period.id} className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">{entityName(data.legal_entities || [], period.legal_entity_id)} · {period.period_start.slice(0, 7)}</h3>
        <p className="text-xs text-text-secondary">{period.period_start} – {period.period_end} · Current final revision {period.runs?.find((run) => run.id === period.current_finalized_run_id)?.revision || "—"}</p></div>
        {canManage && period.current_finalized_run_id && !period.runs?.some((run) => ["draft", "review_required", "ready"].includes(run.status)) &&
          <button className="btn-secondary" type="button" disabled={busy || !reason.trim()} onClick={() => create(period.current_finalized_run_id, period)}>Create Correction Draft</button>}
      </div>
      <div className="mt-3 divide-y divide-border">{(period.runs || []).map((run) => <div key={run.id} className="py-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>Revision {run.revision} {run.supersedes_run_id ? "· Correction" : ""} <Badge tone={run.status === "finalized" ? "success" : "neutral"}>{label(run.status)}</Badge>
          {readiness[run.id]?.time && <small className="block text-text-secondary">Hourly time: {readiness[run.id].time.ready ? "Ready" : `${readiness[run.id].time.unresolved} unresolved · ${readiness[run.id].time.unreconciled} unreconciled · ${readiness[run.id].time.stale} stale${readiness[run.id].time.period_in_progress ? " · period in progress" : ""}`}</small>}
          {readiness[run.id]?.calculation && <small className="block text-text-secondary">Calculation: {readiness[run.id].calculation.ready ? "Ready" : `${readiness[run.id].calculation.review_required} review · ${readiness[run.id].calculation.uncalculated} uncalculated · ${readiness[run.id].calculation.stale} stale`}</small>}
          {readiness[run.id]?.statutory && <small className="block text-text-secondary">Statutory: {readiness[run.id].statutory.ready ? "Ready" : `${readiness[run.id].statutory.review_required} review · ${readiness[run.id].statutory.uncalculated} uncalculated · ${readiness[run.id].statutory.stale} stale`}</small>}</span>
        <div className="flex flex-wrap gap-2">{canManage && run.status === "draft" && <button className="btn-secondary" type="button" disabled={busy} onClick={() => requestTransition(run.id, "review_required")}>Send to Review</button>}
          {canManage && run.status === "review_required" && <button className="btn-secondary" type="button" disabled={busy || !readiness[run.id]?.time?.ready || !readiness[run.id]?.calculation?.ready || !readiness[run.id]?.statutory?.ready} onClick={() => requestTransition(run.id, "ready")}>Mark Ready</button>}
          {canManage && run.status === "ready" && <button className="btn-secondary" type="button" disabled={busy} onClick={() => requestTransition(run.id, "review_required")}>Return to Review</button>}
          {canFinalize && run.status === "ready" && <button className="btn-primary" type="button"
            disabled={busy || !readiness[run.id]?.time?.ready || (!run.foundation_only && (!readiness[run.id]?.calculation?.ready || !readiness[run.id]?.statutory?.ready))}
            onClick={() => requestTransition(run.id, "finalized")}>Finalize Payroll</button>}
          {!run.foundation_only && <button className="btn-secondary" type="button" onClick={() => setSelectedRunId((id) => id === run.id ? "" : run.id)}>{selectedRunId === run.id ? "Hide Calculation" : "View Calculation"}</button>}</div>
        </div>
        {selectedRunId === run.id && <PayrollRunCalculationPanel run={run} components={data.components || []} canManage={canManage} onChanged={reload} />}
      </div>)}</div>
    </Card>) : <Card className="p-8 text-center text-sm text-text-secondary">No Payroll Runs for this Legal Entity.</Card>}</div>
    {pendingTransition && <Modal title={`${label(pendingTransition.status)} Payroll Run`}
      description="Record the reason for this audited lifecycle change. Ready and Finalize require complete payable-time, calculation and statutory evidence; no payment occurs."
      onClose={() => !busy && setPendingTransition(null)}
      footer={<><button className="btn-secondary" type="button" disabled={busy} onClick={() => setPendingTransition(null)}>Cancel</button>
        <button className="btn-primary" type="button" disabled={busy || !transitionReason.trim()} onClick={transition}>{busy ? "Saving..." : "Confirm"}</button></>}>
      <AdminFormField label="Reason" required><input className="control" value={transitionReason}
        onChange={(event) => setTransitionReason(event.target.value)} placeholder="Reason for this run transition" /></AdminFormField>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">{error}</p>}
    </Modal>}
  </div>;
}

function SettingsTab({ data, canManage, reload }) {
  const [mode, setMode] = useState("components");
  const [draft, setDraft] = useState({ code: "", name: "", type: "allowance", epf: "undetermined", socso: "undetermined", eis: "undetermined", pcb: "undetermined",
    legalEntityId: data.legal_entities?.[0]?.id || "", date: today(), scope: "national", stateCode: "", sourceNote: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const patch = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
  const save = async () => {
    setBusy(true); setError("");
    try {
      if (mode === "components") await payrollService.createComponent(draft);
      else await payrollService.addHoliday(draft);
      await reload();
      setDraft((previous) => ({ ...previous, code: "", name: "", sourceNote: "", reason: "" }));
    } catch (cause) { setError(cause.message || "Unable to save setting."); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4">
    <div className="flex gap-2"><button className={mode === "components" ? "btn-primary" : "btn-secondary"} type="button" onClick={() => setMode("components")}>Pay Components</button>
      <button className={mode === "holidays" ? "btn-primary" : "btn-secondary"} type="button" onClick={() => setMode("holidays")}>Public Holidays</button>
      <button className={mode === "rules" ? "btn-primary" : "btn-secondary"} type="button" onClick={() => setMode("rules")}>Pay Rules</button></div>
    {mode === "rules" ? <PayrollPayRulesPanel canManage={canManage} /> : mode === "components" ? <Card className="p-4 space-y-4">
      <div><h3 className="font-bold">Component definitions</h3><p className="text-sm text-text-secondary">Wage treatment is deliberately explicit and undetermined until reviewed. No statutory amount is calculated here.</p></div>
      <div className="divide-y divide-border">{(data.components || []).map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
        <span><strong>{item.name}</strong> · {item.code}</span><span>{label(item.component_type)} · EPF {item.epf_treatment} / SOCSO {item.socso_treatment} / EIS {item.eis_treatment} / PCB {item.pcb_treatment}</span></div>)}</div>
      {canManage && <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
        <AdminFormField label="Code"><input className="control" value={draft.code} onChange={(event) => patch("code", event.target.value)} placeholder="meal_allowance" /></AdminFormField>
        <AdminFormField label="Name"><input className="control" value={draft.name} onChange={(event) => patch("name", event.target.value)} /></AdminFormField>
        <AdminFormField label="Type"><Select value={draft.type} onChange={(value) => patch("type", value)} options={["earning","allowance","deduction","reimbursement"].map((value) => ({ value, label: label(value) }))} /></AdminFormField>
        {["epf","socso","eis","pcb"].map((key) => <AdminFormField key={key} label={`${key.toUpperCase()} wage treatment`}>
          <Select value={draft[key]} onChange={(value) => patch(key, value)} options={["undetermined","included","excluded"].map((value) => ({ value, label: label(value) }))} />
        </AdminFormField>)}
        <AdminFormField label="Reason"><input className="control" value={draft.reason} onChange={(event) => patch("reason", event.target.value)} /></AdminFormField>
        <div className="flex items-end"><button className="btn-primary w-full" type="button" disabled={busy || !draft.code || !draft.name || !draft.reason} onClick={save}>Add Component</button></div>
      </div>}</Card> : <Card className="p-4 space-y-4">
      <div><h3 className="font-bold">Public Holiday Calendar</h3><p className="text-sm text-text-secondary">Calendar evidence only; this phase does not calculate holiday pay.</p></div>
      <div className="divide-y divide-border">{(data.holidays || []).map((item) => <div key={item.id} className="flex justify-between gap-3 py-2 text-sm">
        <span><strong>{item.name}</strong> · {item.holiday_date}</span><span>{label(item.scope)} {item.state_code || ""}</span></div>)}</div>
      {canManage && <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
        <AdminFormField label="Legal Entity"><Select value={draft.legalEntityId} onChange={(value) => patch("legalEntityId", value)} options={(data.legal_entities || []).map((item) => ({ value: item.id, label: item.display_name || item.name }))} /></AdminFormField>
        <AdminFormField label="Date"><input className="control" type="date" value={draft.date} onChange={(event) => patch("date", event.target.value)} /></AdminFormField>
        <AdminFormField label="Holiday Name"><input className="control" value={draft.name} onChange={(event) => patch("name", event.target.value)} /></AdminFormField>
        <AdminFormField label="Scope"><Select value={draft.scope} onChange={(value) => patch("scope", value)} options={[{value:"national",label:"National"},{value:"state",label:"State"}]} /></AdminFormField>
        {draft.scope === "state" && <AdminFormField label="State Code"><input className="control" value={draft.stateCode} onChange={(event) => patch("stateCode", event.target.value)} placeholder="MY-10" /></AdminFormField>}
        <AdminFormField label="Source"><input className="control" value={draft.sourceNote} onChange={(event) => patch("sourceNote", event.target.value)} placeholder="Gazette / approved calendar" /></AdminFormField>
        <div className="flex items-end"><button className="btn-primary" type="button" disabled={busy || !draft.legalEntityId || !draft.name || !draft.sourceNote} onClick={save}><CalendarDays size={15} /> Add Holiday</button></div>
      </div>}</Card>}
    {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
  </div>;
}

export default function PayrollPage({ auth }) {
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canView = hasPermission(auth, "payroll.view");
  const canManage = hasPermission(auth, "payroll.manage");
  const canFinalize = hasPermission(auth, "payroll.finalize");
  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await payrollService.read()); }
    catch (cause) { setError(cause.message || "Unable to load Payroll."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (canView) reload(); else setLoading(false); }, [canView, reload]);
  const counts = useMemo(() => ({ profiles: data?.profiles?.length || 0,
    monthly: (data?.profiles || []).filter((profile) => effective(profile.compensation)?.pay_basis === "monthly").length,
    hourly: (data?.profiles || []).filter((profile) => effective(profile.compensation)?.pay_basis === "hourly").length,
    openRuns: (data?.periods || []).flatMap((period) => period.runs || []).filter((run) => ["draft","review_required","ready"].includes(run.status)).length,
  }), [data]);
  return <div className="space-y-4">
    <PageHeader section="People" title="Payroll" description="Manage compensation, payable time and statutory payroll review." />
    {!canView ? <Card className="p-8 text-center text-sm text-text-secondary">Payroll permission is required. Employee access alone does not reveal compensation.</Card>
      : loading && !data ? <Card className="p-8 text-center text-sm text-text-secondary">Loading Payroll...</Card>
        : error ? <Card className="p-8 text-sm font-semibold text-rose-700" role="alert">{error}<button className="btn-secondary ml-3" type="button" onClick={reload}>Retry</button></Card>
          : <><nav aria-label="Payroll sections" className="flex flex-wrap gap-2">
            {[["overview","Overview"],["profiles","Profiles"],["time","Time Exceptions"],["runs","Runs"],["settings","Settings"]].map(([key,title]) =>
              <button key={key} type="button" className={tab === key ? "btn-primary" : "btn-secondary"} onClick={() => setTab(key)}>{title}</button>)}
          </nav>
          {tab === "overview" && <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
              ["Payroll Profiles", counts.profiles],["Monthly Basis", counts.monthly],["Hourly Basis", counts.hourly],["Open Runs", counts.openRuns],
            ].map(([title,value]) => <Card key={title} className="p-4"><p className="text-sm text-text-secondary">{title}</p><p className="mt-1 text-2xl font-bold">{value}</p></Card>)}</div>
            <Card className="p-5"><div className="flex items-start gap-3"><Wallet size={20} className="text-teal-700" /><div><h2 className="font-bold">Payroll calculation</h2><p className="mt-1 text-sm text-text-secondary">Effective-dated compensation and approved payable time produce explainable RM lines. Statutory results remain Review Required until employee categories and official schedules are verified. No payslip or payment is created.</p></div></div></Card>
          </div>}
          {tab === "profiles" && <ProfilesTab data={data} canManage={canManage} reload={reload} />}
          {tab === "time" && <PayrollTimeExceptionsTab data={data} canManage={canManage} />}
          {tab === "runs" && <RunsTab data={data} canManage={canManage} canFinalize={canFinalize} reload={reload} />}
          {tab === "settings" && <SettingsTab data={data} canManage={canManage} reload={reload} />}
        </>}
  </div>;
}
