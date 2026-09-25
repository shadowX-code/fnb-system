import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Plus } from "lucide-react";
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
const timeBlocker = (time) => time?.period_in_progress && !time.unresolved && !time.unreconciled && !time.stale
  ? "Pay period is still in progress"
  : `${time?.unresolved || 0} time exceptions · ${time?.unreconciled || 0} unreconciled${time?.stale ? ` · ${time.stale} stale` : ""}${time?.period_in_progress ? " · period in progress" : ""}`;
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
    <p className="mb-3 text-xs text-text-secondary">Choose which schemes apply to this employee. PCB / MTD is confirmed for each Payroll Run.</p>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {["epf", "socso", "eis", "pcb"].map((key) => <label key={key} className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={value[key] === true} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} />
        {key.toUpperCase()}
      </label>)}
    </div>
  </fieldset>;
}

function FoundationForm({ mode, profile, initialEmployeeId = "", data, onClose, onSaved }) {
  const current = effective(profile?.compensation);
  const currentStatutory = effective(profile?.statutory);
  const [draft, setDraft] = useState(() => ({
    employeeId: initialEmployeeId,
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
    create: "Set Up Employee",
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

  return <Modal title={title} description="Changes apply from the selected date. Previous pay records remain available in history."
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

function StatutoryCategoryForm({ profile, onClose }) {
  const [versions, setVersions] = useState(null);
  const [draft, setDraft] = useState({ effectiveFrom: today(), epfCategory: "", socsoCategory: "",
    eisCategory: "", sourceNote: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    payrollService.readStatutoryInput(profile.id).then((result) => {
      if (!active) return;
      const rows = result.versions || [];
      setVersions(rows);
      if (rows[0]) setDraft((value) => ({ ...value,
        epfCategory: rows[0].epf_category || "", socsoCategory: rows[0].socso_category || "",
        eisCategory: rows[0].eis_category || "" }));
    }).catch((cause) => { if (active) setError(cause.message || "Unable to read statutory categories."); });
    return () => { active = false; };
  }, [profile.id]);
  const patch = (key, value) => setDraft((old) => ({ ...old, [key]: value }));
  const save = async () => {
    setBusy(true); setError("");
    try {
      await payrollService.reviewStatutoryInput({ ...draft, profileId: profile.id });
      onClose();
    } catch (cause) { setError(cause.message || "Unable to review statutory categories."); }
    finally { setBusy(false); }
  };
  const allowed = versions && draft.effectiveFrom && (!versions[0] || draft.effectiveFrom > versions[0].effective_from)
    && draft.sourceNote.trim().length >= 8 && draft.reason.trim().length >= 3;
  return <Modal title={`Review Statutory Categories · ${profile.employee_name}`}
    description="Select only verified categories. Unsupported or missing employee evidence remains Review Required. PCB / MTD is confirmed per Run."
    size="lg" onClose={onClose} footer={<><button className="btn-secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="btn-primary" type="button" disabled={!allowed || busy} onClick={save}>{busy ? "Saving…" : "Save Review"}</button></>}>
    <div className="space-y-4">
      {versions === null && !error && <p className="text-sm text-text-secondary">Loading reviewed categories…</p>}
      {versions?.[0] && <p className="text-sm text-text-secondary">Latest review: {versions[0].effective_from}. New evidence must have a later effective date.</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <AdminFormField label="EPF category"><Select value={draft.epfCategory} onChange={(value) => patch("epfCategory", value)} options={[
          { value: "", label: "Unreviewed" }, { value: "malaysian_under_60", label: "Malaysian · under 60" },
          { value: "malaysian_60_to_74", label: "Malaysian · 60–74" },
        ]} /></AdminFormField>
        <AdminFormField label="SOCSO category"><Select value={draft.socsoCategory} onChange={(value) => patch("socsoCategory", value)} options={[
          { value: "", label: "Unreviewed" }, { value: "first_category_base", label: "Act 4 · First Category" },
          { value: "second_category_base", label: "Act 4 · Second Category" },
        ]} /></AdminFormField>
        <AdminFormField label="EIS category"><Select value={draft.eisCategory} onChange={(value) => patch("eisCategory", value)} options={[
          { value: "", label: "Unreviewed" }, { value: "standard", label: "Standard" },
        ]} /></AdminFormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminFormField label="Effective From" required><input className="control" type="date" value={draft.effectiveFrom}
          onChange={(event) => patch("effectiveFrom", event.target.value)} /></AdminFormField>
        <AdminFormField label="Official/source reference" required><input className="control" value={draft.sourceNote}
          onChange={(event) => patch("sourceNote", event.target.value)} /></AdminFormField>
      </div>
      <AdminFormField label="Review reason" required><input className="control" value={draft.reason}
        onChange={(event) => patch("reason", event.target.value)} /></AdminFormField>
      {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    </div>
  </Modal>;
}

function ProfilesTab({ data, canManage, reload }) {
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState("");
  const [setupEmployeeId, setSetupEmployeeId] = useState("");
  const selected = data.profiles?.find((profile) => profile.employee_id === selectedId);
  const entities = data.legal_entities || [];
  const rows = (data.employees || []).map((employee) => ({ ...employee,
    profile: (data.profiles || []).find((profile) => profile.employee_id === employee.id) || null }));
  const setupState = (row) => {
    if (!row.profile || !effective(row.profile.compensation)) return "Setup Required";
    const statutory = effective(row.profile.statutory);
    return ["epf", "socso", "eis", "pcb"].some((key) => statutory?.[`${key}_applicable`] == null)
      ? "Review Required" : "Ready";
  };
  const columns = [
    { key: "employee", header: "Employee", render: (row) => <div><strong>{row.name}</strong><div className="text-xs text-text-secondary">{row.employee_code || row.workplace || "—"}</div></div> },
    { key: "employer", header: "Legal Employer", render: (row) => entityName(entities, row.legal_entity_id) },
    { key: "basis", header: "Pay Basis", render: (row) => effective(row.profile?.compensation) ? label(effective(row.profile.compensation).pay_basis) : "Not set" },
    { key: "rate", header: "Current Pay", align: "right", render: (row) => { const c = effective(row.profile?.compensation); return c ? <strong className="tabular-nums">{money(c.basic_salary || c.hourly_rate, c.currency)}{c.pay_basis === "hourly" ? " / hour" : ""}</strong> : "—"; } },
    { key: "statutory", header: "Statutory Readiness", render: (row) => <span className="text-sm">{row.profile ? (setupState(row) === "Ready" ? "Applicability reviewed" : "Review applicability") : "Not set"}</span> },
    { key: "status", header: "Status", render: (row) => <Badge tone={setupState(row) === "Ready" ? "success" : "warning"}>{setupState(row)}</Badge> },
    { key: "open", header: "", align: "right", render: (row) => canManage && !row.profile ? <button className="btn-secondary" type="button" onClick={() => { setSetupEmployeeId(row.id); setForm("create"); }}>Set Up Employee</button> : <button className="text-primary" type="button" aria-label={`View ${row.name} payroll setup`} onClick={() => setSelectedId(row.id)}><ChevronRight size={16} /></button> },
  ];
  const versions = selected?.compensation || [];
  const current = effective(versions);
  const upcoming = versions.filter((item) => item.effective_from > today()).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const statutory = effective(selected?.statutory);
  const currentComponents = (selected?.recurring || []).filter((item) =>
    item.id === effective((selected?.recurring || []).filter((other) => other.component_id === item.component_id))?.id && item.is_active);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-text-secondary">Set up pay separately from the Employee record. Changes take effect by date and retain history.</p>
      {canManage && rows.some((row) => !row.profile) && <button className="btn-primary" type="button" onClick={() => { setSetupEmployeeId(""); setForm("create"); }}><Plus size={16} /> Set Up Employee</button>}</div>
    <Card>{rows.length ? <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id}
      density="compact" onRowClick={(row) => {
        if (row.profile) setSelectedId(row.id);
        else if (canManage) { setSetupEmployeeId(row.id); setForm("create"); }
      }} /> : <div className="p-8 text-center text-sm text-text-secondary">No employees with a Legal Employer are in your Payroll scope.</div>}</Card>
    {selected && <Card className="p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-lg font-bold text-text-primary">{selected.employee_name}</h3>
          <p className="text-sm text-text-secondary">{entityName(entities, current?.legal_entity_id)} · {selected.workplace || "Workplace not set"}</p></div>
        <button className="btn-secondary" type="button" onClick={() => setSelectedId("")}>Close detail</button>
      </div>
      <div className="grid gap-5 border-y border-border py-4 lg:grid-cols-2">
        <section><h4 className="font-bold">Employment & Pay</h4>
          <p className="mt-2 text-xl font-bold tabular-nums">{current ? money(current.basic_salary || current.hourly_rate, current.currency) : "Not effective yet"}</p>
          <p className="text-sm text-text-secondary">{current ? `${label(current.pay_basis)}${current.pay_basis === "hourly" ? " / hour" : ""} · from ${current.effective_from}` : "—"}</p>
          {upcoming[0] && <p className="mt-2 text-sm text-text-secondary">Next change: {money(upcoming[0].basic_salary || upcoming[0].hourly_rate)} from {upcoming[0].effective_from}</p>}</section>
        <section><h4 className="font-bold">Statutory applicability</h4>
          <div className="mt-2 flex flex-wrap gap-2">{["epf", "socso", "eis", "pcb"].map((key) =>
            <Badge key={key} tone={statutory?.[`${key}_applicable`] === true ? "success" : "neutral"}>
              {key.toUpperCase()}: {statutory?.[`${key}_applicable`] == null ? "Unreviewed" : statutory[`${key}_applicable`] ? "Yes" : "No"}
            </Badge>)}</div></section>
      </div>
      {canManage && <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" type="button" onClick={() => setForm("compensation")}>Adjust Compensation</button>
        <button className="btn-secondary" type="button" onClick={() => setForm("statutory")}>Review Applicability</button>
        <button className="btn-secondary" type="button" onClick={() => setForm("categories")}>Review Statutory Categories</button>
        <button className="btn-secondary" type="button" onClick={() => setForm("recurring")}>Adjust Allowance / Deduction</button>
      </div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <section><h4 className="mb-2 font-bold">Compensation History</h4>
          <div className="divide-y divide-border rounded-xl border border-border">{versions.map((item) =>
            <div key={item.id} className="flex justify-between gap-3 px-3 py-2 text-sm"><span>{item.effective_from} · {label(item.pay_basis)}<small className="block text-text-muted">{item.reason}</small></span>
              <strong>{money(item.basic_salary || item.hourly_rate, item.currency)}{item.pay_basis === "hourly" ? " / hour" : ""}</strong></div>)}</div></section>
        <section><h4 className="mb-2 font-bold">Recurring allowances & deductions</h4>
          <div className="divide-y divide-border rounded-xl border border-border">{currentComponents.length ? currentComponents.map((item) =>
            <div key={item.id} className="flex justify-between gap-3 px-3 py-2 text-sm"><span>{data.components?.find((component) => component.id === item.component_id)?.name || "Component"}<small className="block text-text-muted">From {item.effective_from}</small></span><strong>{money(item.amount)}</strong></div>) : <p className="p-3 text-sm text-text-secondary">No active recurring components.</p>}</div></section>
      </div>
    </Card>}
    {form === "categories" ? <StatutoryCategoryForm profile={selected} onClose={() => setForm("")} />
      : form && <FoundationForm mode={form} profile={selected} initialEmployeeId={setupEmployeeId} data={data} onClose={() => setForm("")} onSaved={reload} />}
  </div>;
}

const runSteps = ["Prepare", "Review Time", "Calculate", "Review Payroll", "Finalize"];

function RunsTab({ data, canManage, canFinalize, reload, entityId, month, step, setStep, openRunId, setOpenRunId, readiness }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingTransition, setPendingTransition] = useState(null);
  const [transitionReason, setTransitionReason] = useState("");
  const [totals, setTotals] = useState(null);
  const period = (data.periods || []).find((item) => item.legal_entity_id === entityId && item.period_start?.slice(0, 7) === month);
  const runs = [...(period?.runs || [])].sort((a, b) => Number(b.revision) - Number(a.revision));
  const run = runs.find((item) => item.id === openRunId) || runs.find((item) => ["draft", "review_required", "ready"].includes(item.status)) || runs[0];
  useEffect(() => {
    if (!run?.id || step !== 4) { setTotals(null); return; }
    let active = true;
    setTotals(null);
    payrollService.readStatutory(run.id).then((result) => { if (active) setTotals(result); })
      .catch(() => { if (active) setTotals({ error: true }); });
    return () => { active = false; };
  }, [run?.id, step, data]);
  const create = async (supersedesRunId = null) => {
    setBusy(true); setError("");
    try {
      const start = period?.period_start || `${month}-01`;
      const end = period?.period_end || new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const result = await payrollService.createRun({ legalEntityId: entityId,
        periodStart: start, periodEnd: end, reason, supersedesRunId });
      await reload(); setReason(""); setOpenRunId(result?.id || ""); setStep(0);
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
  const state = readiness?.runId === run?.id ? readiness : null;
  const mutable = run && ["draft", "review_required", "ready"].includes(run.status);
  const employeeRows = (data.employees || []).filter((employee) => employee.legal_entity_id === entityId);
  const missingSetup = employeeRows.filter((employee) => !(data.profiles || []).some((profile) => profile.employee_id === employee.id));
  const blockers = [
    missingSetup.length && `${missingSetup.length} employee${missingSetup.length === 1 ? "" : "s"} need payroll setup`,
    state?.time && !state.time.ready && timeBlocker(state.time),
    state?.calculation && !state.calculation.ready && `${state.calculation.review_required || 0} calculations need review · ${state.calculation.uncalculated || 0} not calculated`,
    state?.statutory && !state.statutory.ready && `${state.statutory.review_required || 0} statutory results need review · ${state.statutory.uncalculated || 0} not calculated`,
  ].filter(Boolean);
  const statutoryRows = totals?.results || [];
  const total = (key) => statutoryRows.length && statutoryRows.every((item) => item[key] != null) ? money(statutoryRows.reduce((sum, item) => sum + Number(item[key]), 0)) : "—";
  const allReady = Boolean(state?.time?.ready && (run.foundation_only || (state?.calculation?.ready && state?.statutory?.ready)));
  const approverName = (data.employees || []).find((item) => item.id === run?.finalized_by_employee_id)?.name || "Authorized approver";
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">{entityName(data.legal_entities || [], entityId)} · {month}</h2>
      <p className="text-sm text-text-secondary">{run ? `Revision ${run.revision}${run.supersedes_run_id ? " · Correction" : ""} · ${label(run.status)}` : "No Payroll Run started for this period"}</p></div>
      {runs.length > 1 && <Select value={run?.id || ""} onChange={(value) => { setOpenRunId(value); setStep(0); }} options={runs.map((item) => ({ value: item.id, label: `Revision ${item.revision} · ${label(item.status)}` }))} />}</div>
    {!run && canManage && <Card className="flex flex-wrap items-end gap-3 p-4"><AdminFormField label="Start reason" required><input className="control" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Monthly payroll preparation" /></AdminFormField>
      <button className="btn-primary" type="button" disabled={busy || !reason.trim() || !entityId} onClick={() => create()}><Plus size={15} /> Start Payroll</button></Card>}
    {run?.status === "finalized" && canManage && !runs.some((item) => ["draft", "review_required", "ready"].includes(item.status)) && <Card className="flex flex-wrap items-end gap-3 p-4"><AdminFormField label="Correction reason" required><input className="control" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Historical entitlement correction" /></AdminFormField>
      <button className="btn-secondary" type="button" disabled={busy || !reason.trim()} onClick={() => create(period.current_finalized_run_id || run.id)}>Create Correction Draft</button></Card>}
    {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    {state?.error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Readiness could not be checked. Reload before changing Run status.</p>}
    {run && <><nav aria-label="Payroll Run steps" className="grid gap-1 rounded-xl border border-border bg-surface p-1 sm:grid-cols-5">{runSteps.map((name, index) => <button key={name} type="button" onClick={() => setStep(index)}
      className={`rounded-lg px-3 py-2 text-left text-sm font-semibold ${step === index ? "bg-primary text-white" : "text-text-secondary hover:bg-surface-muted"}`}><span className="mr-2 text-xs opacity-70">{index + 1}.</span>{name}</button>)}</nav>
      {step === 0 && <Card className="p-5 space-y-4"><div><h3 className="text-lg font-bold">Prepare this run</h3><p className="text-sm text-text-secondary">{employeeRows.length} employees linked to this Legal Employer · {run.supersedes_run_id ? "Correction revision retains the prior final result." : "Confirm setup and inclusion before review."}</p></div>
        {run.status === "finalized" ? <p className="text-sm text-text-secondary">This revision is final. Its employee, pay and statutory evidence is pinned for review.</p> : blockers.length ? <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><strong>Needs attention</strong>{blockers.map((item) => <p key={item}>{item}</p>)}</div> : <p className="text-sm text-text-secondary">No known preparation blockers. Continue through each evidence step.</p>}
        {missingSetup.length > 0 && <p className="text-sm text-text-secondary">Setup needed: {missingSetup.map((item) => item.name).join(", ")}</p>}
        <div className="flex flex-wrap gap-2">{canManage && run.status === "draft" && <button className="btn-secondary" type="button" disabled={busy} onClick={() => requestTransition(run.id, "review_required")}>Send to Review</button>}
          <button className="btn-primary" type="button" onClick={() => setStep(1)}>Review Time <ChevronRight size={16} /></button></div></Card>}
      {step === 1 && (run.status === "finalized" ? <Card className="p-5 text-sm text-text-secondary">Payable-time evidence is frozen in this finalized revision. Review the employee calculation details for the pinned evidence.</Card> :
        <PayrollTimeExceptionsTab data={data} canManage={canManage && mutable} legalEntityId={entityId} payMonth={month} onChanged={reload} />)}
      {step === 2 && <PayrollRunCalculationPanel run={run} components={data.components || []} canManage={canManage && mutable} onChanged={reload} stage="calculate" />}
      {step === 3 && <PayrollRunCalculationPanel run={run} components={data.components || []} canManage={canManage && mutable} onChanged={reload} stage="review" />}
      {step === 4 && <Card className="space-y-4 p-5"><div><h3 className="text-lg font-bold">Finalize Payroll</h3><p className="text-sm text-text-secondary">Review current revision totals and required evidence before the irreversible finalization step.</p></div>
        {totals?.error ? <p role="alert" className="text-sm text-rose-700">Unable to load final totals. Retry this step before finalizing.</p> : !totals ? <p className="text-sm text-text-secondary">Loading final evidence…</p> : <div className="grid gap-3 sm:grid-cols-3"><div><p className="text-xs text-text-secondary">Employees calculated</p><strong>{statutoryRows.length}</strong></div><div><p className="text-xs text-text-secondary">Net Pay</p><strong className="tabular-nums">{total("net_pay")}</strong></div><div><p className="text-xs text-text-secondary">Total Employer Cost</p><strong className="tabular-nums">{total("total_employer_cost")}</strong></div></div>}
        {run.status === "finalized" ? <div className="rounded-xl bg-surface-muted p-4 text-sm"><Badge tone="success">Finalized</Badge><p className="mt-2">Revision {run.revision} is immutable. Corrections require a new revision; this evidence is retained.</p><p className="text-text-secondary">{run.finalized_at ? `Finalized ${new Date(run.finalized_at).toLocaleString()}` : "Finalized evidence retained"} · {approverName}</p></div> : <>
          <p className="text-sm text-text-secondary">Time: {state?.time?.ready ? "Ready" : "Review required"} · Calculation: {state?.calculation?.ready ? "Ready" : "Review required"} · Statutory: {state?.statutory?.ready ? "Ready" : "Review required"}</p>
          <div className="flex flex-wrap gap-2">{canManage && run.status === "review_required" && <button className="btn-secondary" type="button" disabled={busy || !allReady} onClick={() => requestTransition(run.id, "ready")}>Mark Ready</button>}
            {canManage && run.status === "ready" && <button className="btn-secondary" type="button" disabled={busy} onClick={() => requestTransition(run.id, "review_required")}>Return to Review</button>}
            {canFinalize && run.status === "ready" && <button className="btn-primary" type="button" disabled={busy || !allReady || !totals || totals.error} onClick={() => requestTransition(run.id, "finalized")}>Finalize Payroll</button>}</div></>}
        <p className="text-xs text-text-muted">Finalization snapshots compensation, payable time, rule versions, statutory evidence and approvals. No payslip or payment is created.</p></Card>}
    </>}
    {pendingTransition && <Modal title={`${label(pendingTransition.status)} Payroll Run`}
      description="Record why this run is changing status. Ready and Finalize require complete time, pay and statutory evidence; no payment occurs."
      onClose={() => !busy && setPendingTransition(null)}
      footer={<><button className="btn-secondary" type="button" disabled={busy} onClick={() => setPendingTransition(null)}>Cancel</button>
        <button className="btn-primary" type="button" disabled={busy || !transitionReason.trim()} onClick={transition}>{busy ? "Saving..." : "Confirm"}</button></>}>
      <AdminFormField label="Reason" required><input className="control" value={transitionReason}
        onChange={(event) => setTransitionReason(event.target.value)} placeholder="Reason for this run transition" /></AdminFormField>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">{error}</p>}
    </Modal>}
  </div>;
}

function Overview({ data, canManage, entityId, month, run, readiness, onOpenRun, onOpenEmployees }) {
  const finalized = run?.status === "finalized";
  const employees = (data.employees || []).filter((item) => item.legal_entity_id === entityId);
  const withoutProfile = employees.filter((item) => !(data.profiles || []).some((profile) => profile.employee_id === item.id));
  const attention = finalized ? [] : [
    withoutProfile.length > 0 && { label: `${withoutProfile.length} employee${withoutProfile.length === 1 ? " needs" : "s need"} pay setup`, action: "Set up employees", open: onOpenEmployees },
    readiness?.error && { label: "Run readiness could not be checked", action: "Open run", open: () => onOpenRun(0) },
    readiness?.time && !readiness.time.ready && { label: timeBlocker(readiness.time), action: "Review time", open: () => onOpenRun(1) },
    readiness?.calculation && !readiness.calculation.ready && { label: `${readiness.calculation.review_required || 0} results need review · ${readiness.calculation.uncalculated || 0} not calculated`, action: "Calculate", open: () => onOpenRun(2) },
    readiness?.statutory && !readiness.statutory.ready && { label: `${readiness.statutory.review_required || 0} statutory results need review · ${readiness.statutory.uncalculated || 0} not calculated`, action: "Review payroll", open: () => onOpenRun(3) },
  ].filter(Boolean);
  const recent = (data.periods || []).flatMap((period) => (period.runs || []).map((item) => ({ ...item, period })))
    .filter((item) => item.period.legal_entity_id === entityId)
    .sort((a, b) => b.period.period_start.localeCompare(a.period.period_start) || Number(b.revision) - Number(a.revision)).slice(0, 5);
  const completedSteps = [Boolean(run), finalized || Boolean(readiness?.time?.ready), finalized || Boolean(readiness?.calculation?.ready), finalized || Boolean(readiness?.statutory?.ready), finalized];
  return <div className="space-y-4">
    <Card className="p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-wide text-text-secondary">{month === currentMonth() ? "Current payroll period" : "Selected pay period"}</p><h2 className="mt-1 text-2xl font-bold">{entityName(data.legal_entities || [], entityId)} <span className="text-text-secondary">· {month}</span></h2>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm"><Badge tone={run?.status === "finalized" ? "success" : run ? "warning" : "neutral"}>{run ? label(run.status) : "Not started"}</Badge><span>{employees.length} employees</span><span>{attention.length} area{attention.length === 1 ? "" : "s"} needing attention</span></div></div>
      <button className="btn-primary" type="button" disabled={!canManage && !run} onClick={() => onOpenRun(finalized ? 4 : 0)}>{finalized ? "View Finalized Payroll" : run ? "Continue Payroll" : "Start Payroll"} <ChevronRight size={16} /></button></div>
      <div className="mt-6 grid gap-2 border-t border-border pt-4 sm:grid-cols-5">{runSteps.map((name, index) => <button key={name} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold ${completedSteps[index] ? "bg-primary/10 text-primary" : "bg-surface-muted text-text-secondary hover:text-primary"}`} type="button" onClick={() => onOpenRun(index)}>{completedSteps[index] ? <Check size={14} aria-hidden="true" /> : <span className="text-xs">{index + 1}.</span>}{name}</button>)}</div>
    </Card>
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]"><Card className="p-5"><h3 className="text-base font-bold">Needs Attention</h3><p className="mt-1 text-sm text-text-secondary">Open the exact step or employee setup to resolve a blocker.</p>
      <div className="mt-4 divide-y divide-border">{attention.length ? attention.map((item) => <div key={item.label} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span>{item.label}</span><button className="font-semibold text-primary" type="button" onClick={item.open}>{item.action} →</button></div>) : <p className="py-4 text-sm text-text-secondary">{finalized ? "Payroll finalized. The current revision is read-only; any correction creates a new revision." : run ? "No known blockers for this period. Review the run before finalization." : "Start a run to assess payable time, calculations and statutory readiness."}</p>}</div></Card>
      <Card className="p-5"><h3 className="text-base font-bold">Recent Payroll Runs</h3><div className="mt-3 divide-y divide-border">{recent.length ? recent.map((item) => <button key={item.id} className="flex w-full items-center justify-between gap-2 py-3 text-left text-sm" type="button" onClick={() => onOpenRun(item.status === "finalized" ? 4 : 0, item.period, item.id)}><span><strong>{item.period.period_start.slice(0, 7)} · Revision {item.revision}</strong><small className="block text-text-secondary">{item.supersedes_run_id ? "Correction" : "Monthly run"}</small></span><Badge tone={item.status === "finalized" ? "success" : "neutral"}>{label(item.status)}</Badge></button>) : <p className="py-4 text-sm text-text-secondary">No previous runs for this Legal Entity.</p>}</div></Card></div>
  </div>;
}

function SettingsTab({ data, canManage, reload }) {
  const [mode, setMode] = useState("rules");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [holidayEntityId, setHolidayEntityId] = useState(data.legal_entities?.[0]?.id || "");
  const [holidayYear, setHolidayYear] = useState(today().slice(0, 4));
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
      setAdding(false);
    } catch (cause) { setError(cause.message || "Unable to save setting."); }
    finally { setBusy(false); }
  };
  const holidays = (data.holidays || []).filter((item) => item.legal_entity_id === holidayEntityId && item.holiday_date?.startsWith(holidayYear))
    .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
  const components = data.components || [];
  const undetermined = (item) => ["epf", "socso", "eis", "pcb"].some((key) => item[`${key}_treatment`] === "undetermined");
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">{[["rules", "Statutory & Pay Rules"], ["holidays", "Public Holidays"], ["components", "Pay Components"]].map(([key, name]) =>
      <button key={key} className={mode === key ? "btn-primary" : "btn-secondary"} type="button" onClick={() => { setMode(key); setAdding(false); setError(""); }}>{name}</button>)}</div>
    {mode === "rules" ? <div className="space-y-4"><Card className="p-5"><h3 className="text-lg font-bold">Statutory & Pay Rules</h3><p className="mt-1 text-sm text-text-secondary">Current calculation methods. Each run retains the applicable versions and source evidence.</p>
      <div className="mt-4 divide-y divide-border">{[["EPF", "Automatic", "KWSP reviewed schedule"], ["SOCSO", "Automatic", "PERKESO reviewed schedule"], ["EIS", "Automatic", "PERKESO reviewed schedule"], ["PCB / MTD", "Manual confirmation", "Confirmed by an authorized Admin per employee and pay period"]].map(([name, method, note]) =>
        <div key={name} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><strong>{name}</strong><small className="block text-text-secondary">{note}</small></div><Badge tone={method === "Automatic" ? "success" : "warning"}>{method}</Badge></div>)}</div></Card>
      <div className="rounded-xl border border-border bg-surface p-4"><button className="w-full text-left font-semibold" type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}>Advanced / Version History <span className="font-normal text-text-secondary">· technical rules and publishing</span></button>{advancedOpen && <div className="mt-4"><PayrollPayRulesPanel canManage={canManage} /></div>}</div></div>
      : mode === "components" ? <Card className="overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4"><div><h3 className="text-lg font-bold">Allowances & Deductions</h3><p className="text-sm text-text-secondary">Statutory wage treatment must be explicit before a run is ready.</p></div>
        {canManage && <button className="btn-primary" type="button" onClick={() => setAdding(true)}><Plus size={16} /> Add Component</button>}</div>
        <div className="divide-y divide-border">{components.length ? components.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"><div><strong>{item.name}</strong><small className="block text-text-secondary">{item.code} · {label(item.component_type)}</small></div><div className="flex flex-wrap items-center gap-2">{undetermined(item) && <Badge tone="warning">Treatment undetermined</Badge>}<Badge tone={item.is_active ? "success" : "neutral"}>{item.is_active ? "Active" : "Inactive"}</Badge></div></div>) : <p className="p-6 text-sm text-text-secondary">No pay components configured.</p>}</div></Card>
      : <Card className="overflow-hidden"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-4"><div><h3 className="text-lg font-bold">Public Holidays</h3><p className="text-sm text-text-secondary">Managed calendar evidence by Legal Entity and year.</p></div>{canManage && <button className="btn-primary" type="button" onClick={() => { patch("legalEntityId", holidayEntityId); setAdding(true); }}><Plus size={16} /> Add Holiday</button>}</div>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2"><AdminFormField label="Legal Entity"><Select value={holidayEntityId} onChange={setHolidayEntityId} options={(data.legal_entities || []).map((item) => ({ value: item.id, label: item.display_name || item.name }))} /></AdminFormField><AdminFormField label="Year"><input className="control" type="number" min="2000" max="2100" value={holidayYear} onChange={(event) => setHolidayYear(event.target.value)} /></AdminFormField></div>
        <div className="divide-y divide-border">{holidays.length ? holidays.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm"><span><strong>{item.name}</strong><small className="block text-text-secondary">{label(item.scope)} {item.state_code || ""}</small></span><time className="tabular-nums">{item.holiday_date}</time></div>) : <p className="p-6 text-sm text-text-secondary">No holidays in this calendar.</p>}</div></Card>}
    {adding && <Modal title={mode === "components" ? "Add Pay Component" : "Add Public Holiday"} size="lg" onClose={() => !busy && setAdding(false)} footer={<><button className="btn-secondary" type="button" disabled={busy} onClick={() => setAdding(false)}>Cancel</button><button className="btn-primary" type="button" disabled={busy || !draft.name || (mode === "components" ? !draft.code || !draft.reason : !draft.legalEntityId || !draft.sourceNote)} onClick={save}>{busy ? "Saving…" : mode === "components" ? "Add Component" : "Add Holiday"}</button></>}>
      {mode === "components" ? <div className="grid gap-3 sm:grid-cols-2">
        <AdminFormField label="Code"><input className="control" value={draft.code} onChange={(event) => patch("code", event.target.value)} placeholder="meal_allowance" /></AdminFormField>
        <AdminFormField label="Name"><input className="control" value={draft.name} onChange={(event) => patch("name", event.target.value)} /></AdminFormField>
        <AdminFormField label="Type"><Select value={draft.type} onChange={(value) => patch("type", value)} options={["earning", "allowance", "deduction", "reimbursement"].map((value) => ({ value, label: label(value) }))} /></AdminFormField>
        {["epf", "socso", "eis", "pcb"].map((key) => <AdminFormField key={key} label={`${key.toUpperCase()} wage treatment`}><Select value={draft[key]} onChange={(value) => patch(key, value)} options={["undetermined", "included", "excluded"].map((value) => ({ value, label: label(value) }))} /></AdminFormField>)}
        <AdminFormField label="Reason"><input className="control" value={draft.reason} onChange={(event) => patch("reason", event.target.value)} /></AdminFormField></div>
        : <div className="grid gap-3 sm:grid-cols-2"><AdminFormField label="Legal Entity"><Select value={draft.legalEntityId} onChange={(value) => patch("legalEntityId", value)} options={(data.legal_entities || []).map((item) => ({ value: item.id, label: item.display_name || item.name }))} /></AdminFormField>
          <AdminFormField label="Date"><input className="control" type="date" value={draft.date} onChange={(event) => patch("date", event.target.value)} /></AdminFormField>
          <AdminFormField label="Holiday Name"><input className="control" value={draft.name} onChange={(event) => patch("name", event.target.value)} /></AdminFormField>
          <AdminFormField label="Scope"><Select value={draft.scope} onChange={(value) => patch("scope", value)} options={[{ value: "national", label: "National" }, { value: "state", label: "State" }]} /></AdminFormField>
          {draft.scope === "state" && <AdminFormField label="State Code"><input className="control" value={draft.stateCode} onChange={(event) => patch("stateCode", event.target.value)} placeholder="MY-10" /></AdminFormField>}
          <AdminFormField label="Source"><input className="control" value={draft.sourceNote} onChange={(event) => patch("sourceNote", event.target.value)} placeholder="Gazette / approved calendar" /></AdminFormField></div>}
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    </Modal>}
    {!adding && error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
  </div>;
}

export default function PayrollPage({ auth }) {
  const [tab, setTab] = useState("overview");
  const [entityId, setEntityId] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [runStep, setRunStep] = useState(0);
  const [openRunId, setOpenRunId] = useState("");
  const [readiness, setReadiness] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canView = hasPermission(auth, "payroll.view");
  const canManage = hasPermission(auth, "payroll.manage");
  const canFinalize = hasPermission(auth, "payroll.finalize");
  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { const result = await payrollService.read(); setData(result); setEntityId((value) => value || result.legal_entities?.[0]?.id || ""); }
    catch (cause) { setError(cause.message || "Unable to load Payroll."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (canView) reload(); else setLoading(false); }, [canView, reload]);
  const period = useMemo(() => (data?.periods || []).find((item) => item.legal_entity_id === entityId && item.period_start?.slice(0, 7) === month), [data, entityId, month]);
  const activeRun = useMemo(() => (period?.runs || []).find((item) => item.id === openRunId)
    || (period?.runs || []).find((item) => ["draft", "review_required", "ready"].includes(item.status))
    || [...(period?.runs || [])].sort((a, b) => Number(b.revision) - Number(a.revision))[0], [period, openRunId]);
  useEffect(() => {
    if (!activeRun?.id) { setReadiness(null); return; }
    let active = true;
    setReadiness(null);
    Promise.all([payrollService.runTimeReadiness(activeRun.id),
      activeRun.foundation_only ? Promise.resolve(null) : payrollService.calculationReadiness(activeRun.id),
      activeRun.foundation_only ? Promise.resolve(null) : payrollService.statutoryReadiness(activeRun.id)])
      .then(([time, calculation, statutory]) => { if (active) setReadiness({ runId: activeRun.id, time, calculation, statutory }); })
      .catch(() => { if (active) setReadiness({ runId: activeRun.id, error: true }); });
    return () => { active = false; };
  }, [activeRun?.id, activeRun?.foundation_only, data]);
  const openRun = (step = 0, targetPeriod, runId) => {
    if (targetPeriod) { setEntityId(targetPeriod.legal_entity_id); setMonth(targetPeriod.period_start.slice(0, 7)); }
    setOpenRunId(runId || ""); setRunStep(step); setTab("runs");
  };
  return <div className="space-y-4">
    <PageHeader section="People" title="Payroll Control Center" description="Prepare, review and finalize each pay period with clear evidence and resolution steps." />
    {!canView ? <Card className="p-8 text-center text-sm text-text-secondary">Payroll permission is required. Employee access alone does not reveal compensation.</Card>
      : loading && !data ? <Card className="p-8 text-center text-sm text-text-secondary">Loading Payroll...</Card>
        : error ? <Card className="p-8 text-sm font-semibold text-rose-700" role="alert">{error}<button className="btn-secondary ml-3" type="button" onClick={reload}>Retry</button></Card>
          : <><nav aria-label="Payroll sections" className="flex flex-wrap gap-2">
            {[["overview","Overview"],["employees","Employees"],["runs","Payroll Runs"],["settings","Settings"]].map(([key,title]) =>
              <button key={key} type="button" className={tab === key ? "btn-primary" : "btn-secondary"} onClick={() => setTab(key)}>{title}</button>)}
          </nav>
          {(tab === "overview" || tab === "runs") && <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:max-w-2xl"><AdminFormField label="Legal Entity"><Select value={entityId} onChange={(value) => { setEntityId(value); setOpenRunId(""); }} options={(data.legal_entities || []).map((item) => ({ value: item.id, label: item.display_name || item.name }))} /></AdminFormField>
            <AdminFormField label="Pay Period"><input className="control" type="month" value={month} onChange={(event) => { setMonth(event.target.value); setOpenRunId(""); }} /></AdminFormField></Card>}
          {tab === "overview" && <Overview data={data} canManage={canManage} entityId={entityId} month={month} run={activeRun} readiness={readiness?.runId === activeRun?.id ? readiness : null} onOpenRun={openRun} onOpenEmployees={() => setTab("employees")} />}
          {tab === "employees" && <ProfilesTab data={data} canManage={canManage} reload={reload} />}
          {tab === "runs" && <RunsTab data={data} canManage={canManage} canFinalize={canFinalize} reload={reload} entityId={entityId} month={month} step={runStep} setStep={setRunStep} openRunId={openRunId} setOpenRunId={setOpenRunId} readiness={readiness} />}
          {tab === "settings" && <SettingsTab data={data} canManage={canManage} reload={reload} />}
        </>}
  </div>;
}
