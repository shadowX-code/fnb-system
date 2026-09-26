import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus, Check, Minus, TriangleAlert, Clock } from "lucide-react";
import InfoTooltip from "../../../components/ui/InfoTooltip.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import AdminFilterToolbar from "../../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../../components/forms/AdminSearchField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import AdminSegmentedControl from "../../../components/forms/AdminSegmentedControl.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import MonthPickerField from "../../../components/forms/MonthPickerField.jsx";
import ToggleField from "../../../components/forms/ToggleField.jsx";
import Drawer from "../../../components/ui/Drawer.jsx";
import AdminUnderlineTabs from "../../../components/navigation/AdminUnderlineTabs.jsx";
import { hasPermission } from "../../../utils/accessControl.js";
import { payrollService } from "../../../services/payrollService.js";
import PayrollRunCalculationPanel from "./PayrollRunCalculationPanel.jsx";
import PayrollRunEmployeesPanel from "./PayrollRunEmployeesPanel.jsx";
import PayrollFinalizedRecord from "./PayrollFinalizedRecord.jsx";
import { payComponentIsConfigured, payrollIssueLabel } from "./payrollRunPresentation.js";
import PayrollPayRulesPanel from "./PayrollPayRulesPanel.jsx";
import PayrollAnnualHolidays from "./PayrollAnnualHolidays.jsx";
import { PayrollPhPolicy } from "./PayrollPhWork.jsx";
import PayrollEmployeeComponents, { ComponentSummary, componentTimeline } from "./PayrollEmployeeComponents.jsx";
import PayrollStatutorySetup, { statutorySchemeLabel, statutorySetupHelp, statutoryCategories } from "./PayrollStatutorySetup.jsx";
import { MALAYSIA_STATES, malaysiaStateName } from "../../../constants/malaysiaStates.js";

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
const treatmentOptions = [{ value: "included", label: "Included" }, { value: "excluded", label: "Excluded" }];
function WageTreatment({ scheme, value, onChange }) {
  return <AdminFormField as="div" label={`${scheme.toUpperCase()} wage base`}><AdminSegmentedControl className="w-fit" label={`${scheme.toUpperCase()} wage base`} value={value} onChange={onChange} options={treatmentOptions} />{!["included", "excluded"].includes(value) && <p className="text-xs text-amber-700">Choose Included or Excluded.</p>}</AdminFormField>;
}

function StatutoryChecks({ value, onChange, review, loading }) {
  return <fieldset className="rounded-xl border border-border p-3">
    <legend className="px-1 text-sm font-bold text-text-primary">Statutory applicability</legend>
    <p className="mb-3 text-xs text-text-secondary">Choose which schemes apply to this employee. PCB / MTD is confirmed for each Payroll Run.</p>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {["epf", "socso", "eis", "pcb"].map((key) => <div key={key}><SelectField label={key.toUpperCase()} ariaLabel={key.toUpperCase()}
        value={value[key]==null?'':String(value[key])} onChange={(v)=>onChange({...value,[key]:v===''?null:v==='true'})}
        options={[{value:'',label:'Choose applicability'},{value:'true',label:'Applicable'},{value:'false',label:'Not Applicable'}]} />
        {value[key] === false && <p className="mt-2 text-xs text-text-secondary">Not Applicable · resolved</p>}
        {value[key] === true && (key === "pcb" ? <p className="mt-2 text-xs text-text-secondary">Confirm the amount in each Payroll Run.</p>
          : loading ? <p className="mt-2 text-xs text-text-secondary">Checking Employee evidence…</p>
          : review?.schemes?.[key]?.recommendation ? <p className="mt-2 text-xs text-teal-700">{statutoryCategories[key].find(c=>c.value===review.schemes[key].recommendation)?.label} · Recommended</p>
          : review && <div className="mt-2 text-xs text-amber-700"><p className="font-semibold">Additional information required</p><p>{statutorySetupHelp(review.schemes?.[key]?.issue, review.evidence)}</p></div>)}
      </div>)}
    </div>
  </fieldset>;
}

export function FoundationForm({ mode, profile, initialEmployeeId = "", data, onClose, onSaved }) {
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
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const { employeeId, effectiveFrom, epf, socso, eis, pcb } = draft;
  useEffect(() => {
    if (mode !== "create") return;
    let active = true;
    setSetup(null); setSetupError("");
    if (!employeeId || !effectiveFrom) { setSetupLoading(false); return; }
    setSetupLoading(true);
    payrollService.readInitialSetup(employeeId, effectiveFrom, { epf, socso, eis, pcb })
      .then(result => { if (active) setSetup(result); })
      .catch(cause => { if (active) setSetupError(cause.message || "Unable to check statutory setup."); })
      .finally(() => { if (active) setSetupLoading(false); });
    return () => { active = false; };
  }, [mode, employeeId, effectiveFrom, epf, socso, eis, pcb, refresh]);
  const patch = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
  const isProfile = mode === "create" || mode === "compensation";
  const title = {
    create: "Set Up Employee",
    compensation: "Adjust Compensation",
  }[mode];

  async function save() {
    setBusy(true);
    setError("");
    try {
      const input = { ...draft, rate: Number(draft.rate) };
      if (mode === "create") await payrollService.confirmInitialSetup({
        ...input, applicability: { epf, socso, eis, pcb }, fingerprint: setup.fingerprint,
      });
      if (mode === "compensation") await payrollService.adjustCompensation(input);
      await onSaved(mode === "create" ? draft.employeeId : undefined);
      onClose();
    } catch (cause) {
      setError(cause.message || "Unable to save Payroll change.");
      if (mode === "create") setSetup(null);
    } finally {
      setBusy(false);
    }
  }
  const candidates = (data.employees || []).filter((employee) =>
    !(data.profiles || []).some((item) => item.employee_id === employee.id));
  const allowed = draft.effectiveFrom && (
    mode === "create" ? draft.employeeId && Number(draft.rate) > 0 && setup && !setupLoading && [epf,socso,eis,pcb].every(v=>v != null)
      : mode === "compensation" ? Number(draft.rate) > 0
        : true) && (mode === "create" || draft.reason.trim());

  return <Modal title={title} description="Changes apply from the selected date. Previous pay records remain available in history."
    onClose={onClose} size="lg"
    footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={!allowed || busy} onClick={save}>{busy ? "Saving..." : mode === "create" ? "Confirm Employee Setup" : "Save"}</button></>}>
    <div className="space-y-4">
      {mode === "create" && <AdminFormField label="Employee" required>
        <SelectField value={draft.employeeId} onChange={(value) => patch("employeeId", value)} searchable
          options={[{ value: "", label: "Select employee with Legal Employer" },
            ...candidates.map((item) => ({ value: item.id, label: `${item.name} · ${entityName(data.legal_entities || [], item.legal_entity_id)}` }))]} />
      </AdminFormField>}
      {isProfile && <div className="grid gap-4 sm:grid-cols-2">
        <AdminFormField label="Pay Basis" required><SelectField value={draft.payBasis} onChange={(value) => setDraft((previous) => ({
          ...previous, payBasis: value, rate: previous.payBasis === value ? previous.rate : "",
        }))}
          options={[{ value: "monthly", label: "Monthly" }, { value: "hourly", label: "Hourly" }]} /></AdminFormField>
        <AdminFormField label={draft.payBasis === "monthly" ? "Basic Salary (MYR)" : "Hourly Rate (MYR)"} required>
          <input className="control" type="number" min="0.01" step={draft.payBasis === "monthly" ? "0.01" : "0.0001"}
            value={draft.rate} onChange={(event) => patch("rate", event.target.value)} />
        </AdminFormField>
      </div>}
      {mode === "create" ? <><StatutoryChecks value={draft} onChange={setDraft} review={setup} loading={setupLoading} />
        <p className="text-xs text-text-secondary">Save confirms the recommended categories with canonical Employee evidence, Admin and time. Unresolved schemes remain Setup Required; pay setup can still be saved.</p>
        {(setupError || (error && !setup)) && <div role="alert"><p>{setupError || error}</p><button type="button" className="btn-secondary" onClick={()=>{setError("");setRefresh(v=>v+1);}}>Refresh Setup</button></div>}
      </> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <DatePickerField label="Effective From" required value={draft.effectiveFrom} onChange={(value) => patch("effectiveFrom", value)} />
        {mode !== "create" && <AdminFormField label="Reason / provenance" required><input className="control" value={draft.reason}
          onChange={(event) => patch("reason", event.target.value)} placeholder="Reviewed compensation change" /></AdminFormField>
        }
      </div>
      {mode === "compensation" && <p className="text-xs text-text-secondary">The new version applies from this date. It does not update an Employment Contract or rewrite earlier versions.</p>}
      {error && mode !== "create" && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    </div>
  </Modal>;
}

const registryDate = value => value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value.slice(0,10)}T12:00:00`)) : "—";
export function lastPayChange(versions, date) {
  const history = [...(versions || [])].filter(v => v.effective_from <= date).sort((a,b) => a.effective_from.localeCompare(b.effective_from));
  return history.filter((v,i) => !i || ["pay_basis", "basic_salary", "hourly_rate", "currency"].some(key => v[key] !== history[i-1][key])).at(-1)?.effective_from;
}
function RegistryScheme({ scheme, state }) {
  const scheduled = state?.state === "scheduled";
  const resolved = state?.state === "confirmed";
  const notApplicable = state?.state === "not_applicable" || (!scheduled && state?.applicable === false);
  const Icon = scheduled ? Clock : notApplicable ? Minus : resolved ? Check : TriangleAlert;
  const description = `${scheme.toUpperCase()} — ${statutorySchemeLabel(scheme, state)}${scheduled ? ` · Scheduled · Effective ${registryDate(state.effective_from)}` : ""}`;
  return <InfoTooltip label={description}><Icon size={16} aria-hidden="true" className={scheduled ? "text-primary" : notApplicable ? "text-text-secondary" : resolved ? "text-emerald-700" : "text-amber-700"} /></InfoTooltip>;
}

export function ProfilesTab({ data, canManage, reload }) {
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState("");
  const [setupEmployeeId, setSetupEmployeeId] = useState("");
  const [entityFilter, setEntityFilter] = useState(data.legal_entities?.[0]?.id || "");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const selected = data.profiles?.find((profile) => profile.employee_id === selectedId);
  const selectedEmployee = data.employees?.find((employee) => employee.id === selectedId);
  const entities = data.legal_entities || [];
  const rows = (data.employees || []).map((employee) => ({ ...employee,
    profile: (data.profiles || []).find((profile) => profile.employee_id === employee.id) || null }));
  const setupState = (row) => {
    if (!row.profile || !effective(row.profile.compensation)) return "Setup Required";
    return row.profile.statutory_setup?.status === "Complete" ? "Ready" : row.profile.statutory_setup?.status || "Setup Required";
  };
  const visibleRows = rows.filter((row) => row.legal_entity_id === entityFilter
    && (statusFilter === "all" || setupState(row) === statusFilter)
    && (!search.trim() || `${row.name} ${row.employee_code || ""}`.toLowerCase().includes(search.trim().toLowerCase())));
  const columns = [
    { key: "employee", header: "Employee", render: (row) => <div className="min-w-28 max-w-48"><strong>{row.name}</strong><div className="text-xs text-text-secondary">{[row.employee_code, row.workplace].filter(Boolean).join(" · ") || "—"}</div></div> },
    { key: "joined", header: "Joined", className: "hidden 2xl:table-cell whitespace-nowrap", headerClassName: "hidden 2xl:table-cell", render: row => registryDate(row.joined_date) },
    { key: "basis", header: "Pay Basis", className: "hidden lg:table-cell", headerClassName: "hidden lg:table-cell", render: (row) => effective(row.profile?.compensation) ? label(effective(row.profile.compensation).pay_basis) : "Not set" },
    { key: "rate", header: "Current Pay", align: "right", render: (row) => { const c = effective(row.profile?.compensation); return c ? <strong className="tabular-nums">{money(c.basic_salary || c.hourly_rate, c.currency)}{c.pay_basis === "hourly" ? " / hour" : ""}</strong> : "—"; } },
    ...["epf", "socso", "eis", "pcb"].map(scheme => ({ key: scheme, header: scheme.toUpperCase(), className: "hidden xl:table-cell text-center", headerClassName: "hidden xl:table-cell text-center",
      render: row => <RegistryScheme scheme={scheme} state={row.profile?.statutory_setup?.display_schemes?.[scheme]} /> })),
    { key: "components", header: "Components", className: "hidden xl:table-cell", headerClassName: "hidden xl:table-cell", render: row => {
      const active = [...new Set((row.profile?.recurring || []).map(v => v.component_id))].map(id => ({
        value: componentTimeline(row.profile.recurring.filter(v => v.component_id === id), today()).current,
        definition: data.components?.find(c => c.id === id),
      })).filter(c => c.value?.is_active);
      const deductions = active.filter(c => c.definition?.component_type === "deduction").length;
      const earnings = active.length - deductions;
      return active.length ? <InfoTooltip label={active.map(c => `${c.definition?.name || "Component"}: ${c.definition?.component_type === "deduction" ? "−" : "+"}${money(c.value.amount)}`).join("\n")}>
        <span className="whitespace-nowrap tabular-nums">{deductions ? `+${earnings} / −${deductions}` : `${active.length} active`}</span>
      </InfoTooltip> : <span className="text-text-secondary">None</span>;
    } },
    { key: "pay_change", header: "Last Pay Change", className: "hidden 2xl:table-cell whitespace-nowrap", headerClassName: "hidden 2xl:table-cell", render: row => registryDate(lastPayChange(row.profile?.compensation, today())) },
    { key: "status", header: "Status", render: (row) => <Badge tone={setupState(row) === "Ready" ? "success" : "warning"}>{setupState(row)}</Badge> },
    { key: "open", header: "Action", align: "right", render: (row) => <button className="text-primary" type="button" aria-label={`View ${row.name} payroll setup`} onClick={() => setSelectedId(row.id)}><ChevronRight size={16} /></button> },
  ];
  const versions = selected?.compensation || [];
  const current = effective(versions);
  const upcoming = versions.filter((item) => item.effective_from > today()).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const statutory = selected?.statutory_setup;

  return <div className="space-y-4">
    <AdminFilterToolbar ariaLabel="Payroll employee filters"
      outlet={<SelectField label="Legal Entity" value={entityFilter} onChange={(value) => { setEntityFilter(value); setSelectedId(""); }} options={entities.map((item) => ({ value: item.id, label: item.display_name || item.name }))} />}
      search={<AdminSearchField label="Search" value={search} onChange={setSearch} placeholder="Employee name or code" />}
      filters={<SelectField label="Status" value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "All" }, ...["Ready", "Scheduled Change", "Confirmation Required", "Setup Required"].map((value) => ({ value, label: value }))]} />}
      primaryActions={canManage && rows.some((row) => !row.profile) ? <button className="btn-primary" type="button" onClick={() => { setSetupEmployeeId(""); setForm("create"); }}><Plus size={16} /> Set Up Employee</button> : null} />
    <Card>{visibleRows.length ? <DataTable columns={columns} rows={visibleRows} getRowKey={(row) => row.id}
      density="compact" tableClassName="!min-w-0" onRowClick={(row) => setSelectedId(row.id)} /> : <div className="p-8 text-center text-sm text-text-secondary">No employees match these filters.</div>}</Card>
    <Drawer open={Boolean(selectedEmployee) && !form} title={selectedEmployee?.name} eyebrow="Payroll employee" description={`${entityName(entities, selectedEmployee?.legal_entity_id)} · ${selectedEmployee?.workplace || "Workplace not set"}`} onClose={() => setSelectedId("")}
      footer={canManage && selectedEmployee ? <div className="flex flex-wrap justify-end gap-2">{selected ? <><button className="btn-secondary" type="button" onClick={() => setForm("compensation")}>Edit Pay</button><button className="btn-secondary" type="button" onClick={() => setForm("statutory")}>Manage Statutory Setup</button><button className="btn-primary" type="button" onClick={() => setForm("recurring")}>Manage Components</button></> : <button className="btn-primary" type="button" onClick={() => { setSetupEmployeeId(selectedEmployee.id); setForm("create"); }}>Set Up Employee</button>}</div> : null}>
      {selectedEmployee && <div className="space-y-5">
      <Badge tone={selected ? setupState({ profile: selected }) === "Ready" ? "success" : "warning" : "warning"}>{setupState({ profile: selected })}</Badge>
      {!selected && <p className="text-sm text-text-secondary">Pay has not been set up for this employee. Open Set Up Employee to create the first effective-dated profile.</p>}
      {selected && <>
      <div className="grid gap-5 border-y border-border py-4 lg:grid-cols-2">
        <section><h4 className="font-bold">Employment & Pay</h4>
          <p className="mt-2 text-xl font-bold tabular-nums">{current ? money(current.basic_salary || current.hourly_rate, current.currency) : "Not effective yet"}</p>
          <p className="text-sm text-text-secondary">{current ? `${label(current.pay_basis)}${current.pay_basis === "hourly" ? " / hour" : ""} · from ${current.effective_from}` : "—"}</p>
          <p className="mt-2 text-xs text-text-secondary">Joined {registryDate(selectedEmployee.joined_date)} · Last Pay Change {registryDate(lastPayChange(versions, today()))}</p>
          {upcoming[0] && <p className="mt-2 text-sm text-text-secondary">Next change: {money(upcoming[0].basic_salary || upcoming[0].hourly_rate)} from {upcoming[0].effective_from}</p>}</section>
        <section><h4 className="font-bold">Statutory</h4>
          <div className="mt-2 flex flex-wrap gap-2">{["epf", "socso", "eis", "pcb"].map((key) =>
            <Badge key={key} tone={["setup_required","confirmation_required"].includes(statutory?.display_schemes?.[key]?.state) ? "warning" : "neutral"}>
              {key.toUpperCase()} — {statutorySchemeLabel(key,statutory?.display_schemes?.[key])}
              {statutory?.display_schemes?.[key]?.state === "scheduled" && <> · Effective {statutory.display_schemes[key].effective_from} · Scheduled</>}
            </Badge>)}</div>
          <p className="mt-2 text-xs text-text-secondary">{statutory?.status || "Setup Required"}</p>
          {["epf","socso","eis"].filter(key=>statutory?.display_schemes?.[key]?.state === "setup_required").map(key=>
            <p key={key} className="mt-2 text-xs text-amber-700">{key.toUpperCase()} · {statutorySetupHelp(statutory.display_schemes[key].issue,statutory.evidence)}</p>)}
        </section>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section><h4 className="mb-2 font-bold">History</h4>
          <div className="divide-y divide-border rounded-xl border border-border">{versions.map((item) =>
            <div key={item.id} className="flex justify-between gap-3 px-3 py-2 text-sm"><span>{item.effective_from} · {label(item.pay_basis)}<small className="block text-text-muted">{item.reason}</small></span>
              <strong>{money(item.basic_salary || item.hourly_rate, item.currency)}{item.pay_basis === "hourly" ? " / hour" : ""}</strong></div>)}</div></section>
        <section><h4 className="mb-2 font-bold">Recurring allowances & deductions</h4>
          <ComponentSummary profile={selected} components={data.components || []} date={today()} /></section>
      </div>
      </>}
      </div>}
    </Drawer>
    {form === "statutory" ? <PayrollStatutorySetup profile={selected} onSaved={reload} onClose={() => setForm("")} />
      : form === "recurring" ? <PayrollEmployeeComponents profile={selected} components={data.components || []} date={today()} onSaved={reload} onClose={() => setForm("")} />
      : form && <FoundationForm mode={form} profile={selected} initialEmployeeId={setupEmployeeId} data={data} onClose={() => setForm("")} onSaved={async employeeId=>{await reload();if(employeeId)setSelectedId(employeeId);}} />}
  </div>;
}

const runSteps = ["Prepare Payroll", "Review Payroll", "Finalize"];

function RunsTab({ data, canManage, canFinalize, reload, entityId, setEntityId, month, setMonth, step, setStep, openRunId, setOpenRunId, readiness }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingTransition, setPendingTransition] = useState(null);
  const [transitionReason, setTransitionReason] = useState("");
  const [totals, setTotals] = useState(null);
  const [focusEmployeeId, setFocusEmployeeId] = useState("");
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [statusFilter, setStatusFilter] = useState("all");
  useEffect(() => {
    if (!entityId) return;
    let active = true;
    setHistory(null); setHistoryError("");
    payrollService.readRunHistory(entityId).then((rows) => { if (active) setHistory(rows); })
      .catch((cause) => { if (active) setHistoryError(cause.message || "Unable to read Payroll history."); });
    return () => { active = false; };
  }, [entityId, data]);
  const period = (data.periods || []).find((item) => item.legal_entity_id === entityId && item.period_start?.slice(0, 7) === month);
  const runs = [...(period?.runs || [])].sort((a, b) => Number(b.revision) - Number(a.revision));
  const run = runs.find((item) => item.id === openRunId);
  useEffect(() => {
    if (!run?.id || step !== 2 || ["finalized", "paid"].includes(run.status)) { setTotals(null); return; }
    let active = true;
    setTotals(null);
    Promise.all([payrollService.readStatutory(run.id), payrollService.readPreparation(run.id)]).then(([result, preparation]) => { if (active) setTotals({ ...result, preparation }); })
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
  const employeeCount = history?.find((item) => item.run_id === run?.id)?.employee_count;
  const blockers = [
    state?.time && !state.time.ready && timeBlocker(state.time),
    state?.calculation && !state.calculation.ready && `${state.calculation.review_required || 0} calculations need review · ${state.calculation.uncalculated || 0} not calculated`,
    state?.statutory && !state.statutory.ready && `${state.statutory.review_required || 0} statutory results need review · ${state.statutory.uncalculated || 0} not calculated`,
  ].filter(Boolean);
  const statutoryRows = totals?.results || [];
  const total = (key) => statutoryRows.length && statutoryRows.every((item) => item[key] != null && !item.is_stale && item.status === "ready") ? money(statutoryRows.reduce((sum, item) => sum + Number(item[key]), 0)) : "Pending review";
  const allReady = Boolean(state?.time?.ready && (run.foundation_only || (state?.calculation?.ready && state?.statutory?.ready)));
  const approverName = run?.finalized_by_name || (data.employees || []).find((item) => item.id === run?.finalized_by_employee_id)?.name || "Authorized approver";
  const yearOptions = [...new Set([String(new Date().getFullYear()), ...(history || []).map((item) => item.period_start?.slice(0, 4)).filter(Boolean)])]
    .sort((a, b) => Number(b) - Number(a)).map((value) => ({ value, label: value }));
  const historyRows = (history || []).filter((item) => item.period_start?.startsWith(year)
    && (statusFilter === "all" || item.status === statusFilter));
  if (!openRunId) return <div className="space-y-4">
    <AdminFilterToolbar ariaLabel="Payroll Run history filters"
      outlet={<SelectField label="Legal Entity" value={entityId} onChange={(value) => { setOpenRunId(""); setEntityId(value); }} options={(data.legal_entities || []).map((item) => ({ value: item.id, label: item.display_name || item.name }))} />}
      filters={<><SelectField label="Year" value={year} onChange={setYear} options={yearOptions} />
        <SelectField label="Status" value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "All" }, ...["draft", "review_required", "ready", "finalized", "paid"].map((value) => ({ value, label: label(value) }))]} /></>}
      primaryActions={canManage ? <button className="btn-primary" type="button" onClick={() => setOpenRunId("new")}><Plus size={16} /> Start Payroll</button> : null} />
    {historyError && <p role="alert" className="text-sm text-rose-700">{historyError}</p>}
    <Card>{!history && !historyError ? <p className="p-6 text-sm text-text-secondary">Loading Payroll history…</p>
      : historyRows.length ? <DataTable density="compact" rows={historyRows} getRowKey={(row) => row.run_id} columns={[
        { key: "period", header: "Period", render: (row) => <strong>{row.period_start.slice(0, 7)}</strong> },
        { key: "employees", header: "Employees", align: "right", render: (row) => row.employee_count || "—" },
        { key: "gross", header: "Gross", align: "right", render: (row) => <span className="tabular-nums">{row.gross == null ? "—" : money(row.gross)}</span> },
        { key: "net", header: "Net Pay", align: "right", render: (row) => <span className="tabular-nums">{row.net_pay == null ? "—" : money(row.net_pay)}</span> },
        { key: "revision", header: "Revision", render: (row) => <span>v{row.revision}{row.status === "finalized" && !row.current ? <small className="block text-text-secondary">Superseded</small> : row.current ? <small className="block text-primary">Current</small> : null}</span> },
        { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "finalized" ? "success" : "warning"}>{label(row.status)}</Badge> },
        { key: "finalized", header: "Finalized Date", render: (row) => row.finalized_at?.slice(0, 10) || "—" },
        { key: "action", header: "Action", render: (row) => <button type="button" className="font-semibold text-primary" onClick={() => { setMonth(row.period_start.slice(0, 7)); setOpenRunId(row.run_id); setStep(row.status === "finalized" ? 2 : 0); }}>{row.status === "finalized" ? "View" : "Continue"}</button> },
      ]} /> : <p className="p-6 text-sm text-text-secondary">No Payroll Runs match these filters.</p>}</Card>
  </div>;
  return <div className="space-y-4">
    <button type="button" className="text-sm font-semibold text-primary" onClick={() => setOpenRunId("")}>← Payroll Run history</button>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">{entityName(data.legal_entities || [], entityId)} · {month}</h2>
      <p className="text-sm text-text-secondary">{run ? `Revision ${run.revision}${run.supersedes_run_id ? " · Correction" : ""} · ${label(run.status)}` : "No Payroll Run started for this period"}</p></div>
      {runs.length > 1 && <SelectField ariaLabel="Payroll revision" value={run?.id || ""} onChange={(value) => { setOpenRunId(value); setStep(runs.find((item) => item.id === value)?.status === "finalized" ? 2 : 0); }} options={runs.map((item) => ({ value: item.id, label: `Revision ${item.revision} · ${label(item.status)}` }))} />}</div>
    {!run && canManage && <Card className="grid gap-4 p-5 sm:grid-cols-2"><MonthPickerField label="Pay Period" value={month} onChange={setMonth} />
      <SelectField label="Legal Entity" value={entityId} onChange={setEntityId} options={(data.legal_entities || []).map((item) => ({ value: item.id, label: item.display_name || item.name }))} />
      {runs.length ? <div className="sm:col-span-2"><p className="text-sm text-text-secondary">This period already has a Payroll Run. Continue its current revision instead of creating a duplicate.</p>
        <button className="btn-primary mt-3" type="button" onClick={() => { setOpenRunId(runs.find((item) => ["draft", "review_required", "ready"].includes(item.status))?.id || runs[0].id); setStep(0); }}>Open existing run</button></div>
        : <><AdminFormField label="Start reason" required><input className="control" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Monthly payroll preparation" /></AdminFormField>
          <div className="flex items-end"><button className="btn-primary" type="button" disabled={busy || !reason.trim() || !entityId} onClick={() => create()}><Plus size={15} /> Start Payroll</button></div></>}</Card>}
    {run?.status === "finalized" && canManage && !runs.some((item) => ["draft", "review_required", "ready"].includes(item.status)) && <Card className="flex flex-wrap items-end gap-3 p-4"><AdminFormField label="Correction reason" required><input className="control" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Historical entitlement correction" /></AdminFormField>
      <button className="btn-secondary" type="button" disabled={busy || !reason.trim()} onClick={() => create(period.current_finalized_run_id || run.id)}>Create Correction Draft</button></Card>}
    {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    {state?.error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Readiness could not be checked. Reload before changing Run status.</p>}
    {run && ["finalized", "paid"].includes(run.status) && <PayrollFinalizedRecord run={run} />}
    {run && !["finalized", "paid"].includes(run.status) && <><nav aria-label="Payroll Run stages" className="grid gap-1 rounded-xl border border-border bg-surface p-1 sm:grid-cols-3">{runSteps.map((name, index) => <button key={name} type="button" onClick={() => setStep(index)}
      className={`rounded-lg px-3 py-2 text-left text-sm font-semibold ${step === index ? "bg-primary text-white" : "text-text-secondary hover:bg-surface-muted"}`}><span className="mr-2 text-xs opacity-70">{index + 1}.</span>{name}</button>)}</nav>
      {step === 0 && <><Card className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm"><div><strong>System preflight · {employeeCount ?? "—"} employees</strong><p className="mt-1 text-text-secondary">{run.supersedes_run_id ? "Correction revision retains the prior final result." : "Time and setup are checked before Payroll can become Ready."}</p>{blockers.length > 0 && <p className="mt-1 text-amber-800">{blockers.join(" · ")}</p>}</div>
        {canManage && run.status === "draft" && <button className="btn-secondary" type="button" disabled={busy} onClick={() => requestTransition(run.id, "review_required")}>Send to Review</button>}</Card>
        <PayrollRunEmployeesPanel run={run} data={data} entityId={entityId} month={month} canManage={canManage && mutable} onChanged={reload} focusEmployeeId={focusEmployeeId} />
        <div className="flex justify-end"><button className="btn-primary" type="button" onClick={() => setStep(1)}>Review Payroll <ChevronRight size={16} /></button></div></>}
      {step === 1 && <PayrollRunCalculationPanel run={run} components={data.components || []} canManage={canManage && mutable} onChanged={reload} stage="review" onReviewEmployee={(id) => { setFocusEmployeeId(id); setStep(0); }} />}
      {step === 2 && <Card className="space-y-4 p-5"><div><h3 className="text-lg font-bold">Finalize Payroll</h3><p className="text-sm text-text-secondary">Review current revision totals and required evidence before the irreversible finalization step.</p></div>
        {totals?.error ? <p role="alert" className="text-sm text-rose-700">Unable to load final totals. Retry this step before finalizing.</p> : !totals ? <p className="text-sm text-text-secondary">Loading final evidence…</p> : <div className="grid gap-3 sm:grid-cols-5"><div><p className="text-xs text-text-secondary">Employees</p><strong>{employeeCount ?? statutoryRows.length}</strong></div><div><p className="text-xs text-text-secondary">Gross Payroll</p><strong>{total("gross_earnings")}</strong></div><div><p className="text-xs text-text-secondary">Employee Deductions</p><strong>{statutoryRows.length && statutoryRows.every((row) => row.status === "ready" && !row.is_stale) ? money(statutoryRows.reduce((sum, row) => sum + Number(row.non_statutory_deductions || 0) + (row.lines || []).reduce((subtotal, line) => subtotal + Number(line.employee_amount || 0), 0), 0)) : "Pending review"}</strong></div><div><p className="text-xs text-text-secondary">Employer Contributions</p><strong>{total("employer_statutory_cost")}</strong></div><div><p className="text-xs text-text-secondary">Net Payroll</p><strong className="tabular-nums">{total("net_pay")}</strong></div></div>}
        {run.status === "finalized" ? <div className="rounded-xl bg-surface-muted p-4 text-sm"><Badge tone="success">Finalized</Badge><p className="mt-2">Revision {run.revision} is immutable. Corrections require a new revision; this evidence is retained.</p><p className="text-text-secondary">{run.finalized_at ? `Finalized ${new Date(run.finalized_at).toLocaleString()}` : "Finalized evidence retained"} · {approverName}</p></div> : <>
          <p className="text-sm text-text-secondary">Time: {state?.time?.ready ? "Ready" : "Review required"} · Calculation: {state?.calculation?.ready ? "Ready" : "Review required"} · Statutory: {state?.statutory?.ready ? "Ready" : "Review required"}</p>
          {!allReady && <div className="divide-y divide-border">{blockers.map((blocker) => <div key={blocker} className="flex items-center justify-between gap-3 py-2 text-sm"><span>{blocker}</span><button type="button" className="font-semibold text-primary" onClick={() => setStep(0)}>Resolve in Prepare Payroll →</button></div>)}</div>}
          {!allReady && <div className="divide-y divide-border">{(totals?.preparation?.results || []).map((member) => {
            const result = statutoryRows.find((item) => item.employee_id === member.employee_id);
            const issues = [...new Set([...(member.projection?.issues || []), ...(result?.issues || [])])];
            if (!issues.length && result?.status === "ready" && !result?.is_stale) return null;
            return <div key={member.employee_id} className="flex items-center justify-between gap-3 py-3 text-sm"><div><strong>{member.projection?.employee_name || "Employee"}</strong><p className="text-text-secondary">{issues.length ? issues.map(payrollIssueLabel).join(" · ") : "Refresh payroll to complete this employee's result."}</p></div><button type="button" className="shrink-0 font-semibold text-primary" onClick={() => { setFocusEmployeeId(member.employee_id); setStep(0); }}>Resolve →</button></div>;
          })}</div>}
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
  const [history, setHistory] = useState(null);
  useEffect(() => {
    if (!entityId) return;
    let active = true;
    setHistory(null);
    payrollService.readRunHistory(entityId).then((rows) => { if (active) setHistory(rows); }).catch(() => { if (active) setHistory([]); });
    return () => { active = false; };
  }, [entityId, data]);
  const finalized = run?.status === "finalized";
  const employees = (data.employees || []).filter((item) => item.legal_entity_id === entityId);
  const withoutProfile = employees.filter((item) => !(data.profiles || []).some((profile) => profile.employee_id === item.id));
  const attention = finalized ? [] : [
    withoutProfile.length > 0 && { label: `${withoutProfile.length} employee${withoutProfile.length === 1 ? " needs" : "s need"} pay setup`, action: "Set up employees", open: onOpenEmployees },
    readiness?.error && { label: "Run readiness could not be checked", action: "Open run", open: () => onOpenRun(0) },
    readiness?.time && !readiness.time.ready && { label: timeBlocker(readiness.time), action: "Review employees", open: () => onOpenRun(0) },
    readiness?.calculation && !readiness.calculation.ready && { label: `${readiness.calculation.review_required || 0} results need review · ${readiness.calculation.uncalculated || 0} not calculated`, action: "Review payroll", open: () => onOpenRun(1) },
    readiness?.statutory && !readiness.statutory.ready && { label: `${readiness.statutory.review_required || 0} statutory results need review · ${readiness.statutory.uncalculated || 0} not calculated`, action: "Review payroll", open: () => onOpenRun(1) },
  ].filter(Boolean);
  const recent = (history || []).slice(0, 5);
  const current = (history || []).find((item) => item.run_id === run?.id);
  const trend = (history || []).filter((item) => item.current && item.total_employer_cost != null).slice(0, 4).reverse();
  return <div className="space-y-4">
    <Card className="p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-wide text-text-secondary">{month === currentMonth() ? "Current payroll period" : "Selected pay period"}</p><h2 className="mt-1 text-2xl font-bold">{entityName(data.legal_entities || [], entityId)} <span className="text-text-secondary">· {month}</span></h2>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm"><Badge tone={run?.status === "finalized" ? "success" : run ? "warning" : "neutral"}>{run ? label(run.status) : "Not started"}</Badge><span>{employees.length} employees</span><span>{attention.length} area{attention.length === 1 ? "" : "s"} needing attention</span></div></div>
      <button className="btn-primary" type="button" disabled={!canManage && !run} onClick={() => onOpenRun(finalized ? 2 : 0)}>{finalized ? "View Finalized Payroll" : run ? "Continue Payroll" : "Start Payroll"} <ChevronRight size={16} /></button></div>
      <div className="mt-5 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-4"><div><span className="text-text-secondary">Readiness</span><strong className="block">{finalized ? "Finalized" : attention.length ? "Need Attention" : run ? "Ready to review" : "Not started"}</strong></div>
        <div><span className="text-text-secondary">Gross</span><strong className="block tabular-nums">{current?.gross == null ? "—" : money(current.gross)}</strong></div>
        <div><span className="text-text-secondary">Net Pay</span><strong className="block tabular-nums">{current?.net_pay == null ? "—" : money(current.net_pay)}</strong></div>
        <div><span className="text-text-secondary">Employer statutory cost</span><strong className="block tabular-nums">{current?.employer_statutory_cost == null ? "—" : money(current.employer_statutory_cost)}</strong></div></div>
    </Card>
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]"><Card className="p-5"><h3 className="text-base font-bold">Needs Attention</h3><p className="mt-1 text-sm text-text-secondary">Open the exact step or employee setup to resolve a blocker.</p>
      <div className="mt-4 divide-y divide-border">{attention.length ? attention.map((item) => <div key={item.label} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span>{item.label}</span><button className="font-semibold text-primary" type="button" onClick={item.open}>{item.action} →</button></div>) : <p className="py-4 text-sm text-text-secondary">{finalized ? "Payroll finalized. The current revision is read-only; any correction creates a new revision." : run ? "No known blockers for this period. Review the run before finalization." : "Start a run to assess payable time, calculations and statutory readiness."}</p>}</div></Card>
      <Card className="p-5"><h3 className="text-base font-bold">Recent Payroll Runs</h3><div className="mt-3 divide-y divide-border">{recent.length ? recent.map((item) => <button key={item.run_id} className="flex w-full items-center justify-between gap-2 py-3 text-left text-sm" type="button" onClick={() => onOpenRun(item.status === "finalized" ? 2 : 0, { legal_entity_id: entityId, period_start: item.period_start }, item.run_id)}><span><strong>{item.period_start.slice(0, 7)} · Revision {item.revision}</strong><small className="block text-text-secondary">{item.current ? "Current" : item.status === "finalized" ? "Superseded" : "In progress"}{item.net_pay != null ? ` · ${money(item.net_pay)} net` : ""}</small></span><Badge tone={item.status === "finalized" ? "success" : "neutral"}>{label(item.status)}</Badge></button>) : <p className="py-4 text-sm text-text-secondary">No previous runs for this Legal Entity.</p>}</div></Card></div>
    {trend.length > 1 && <Card className="p-5"><h3 className="font-bold">Recent Employer Cost</h3><div className="mt-3 grid gap-3 sm:grid-cols-4">{trend.map((item) => <div key={item.run_id} className="border-l-2 border-primary/30 pl-3"><small className="text-text-secondary">{item.period_start.slice(0, 7)}</small><strong className="block tabular-nums">{money(item.total_employer_cost)}</strong></div>)}</div></Card>}
  </div>;
}

function SettingsTab({ data, canManage, reload }) {
  const [schedules, setSchedules] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const canManageComponents = canManage && data.settings_authority?.components === true;
  const canManageHolidays = canManage && data.settings_authority?.holidays === true;
  const [mode, setMode] = useState("rules");
  const [adding, setAdding] = useState(false);
  const [editingHolidayId, setEditingHolidayId] = useState("");
  const [selectedComponentId, setSelectedComponentId] = useState("");
  const [editingComponent, setEditingComponent] = useState(false);
  const [componentEditDraft, setComponentEditDraft] = useState(null);
  const [componentHistory, setComponentHistory] = useState(null);
  const [selectedHolidayId, setSelectedHolidayId] = useState("");
  const [holidayApplicability, setHolidayApplicability] = useState(null);
  const [holidayHistory, setHolidayHistory] = useState(null);
  const [draft, setDraft] = useState({ code: "", name: "", type: "allowance", epf: "undetermined", socso: "undetermined", eis: "undetermined", pcb: "undetermined",
    date: today(), scope: "national", stateCode: "", outletId: "", sourceNote: "", reason: "", active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!selectedComponentId) { setComponentHistory(null); return; }
    let active = true;
    setComponentHistory(null);
    payrollService.readComponentHistory(selectedComponentId)
      .then((history) => { if (active) setComponentHistory(history); })
      .catch(() => { if (active) setComponentHistory({ error: true }); });
    return () => { active = false; };
  }, [selectedComponentId]);
  useEffect(() => {
    if (!selectedHolidayId) { setHolidayApplicability(null); setHolidayHistory(null); return; }
    let active = true;
    setHolidayApplicability(null); setHolidayHistory(null);
    Promise.all([payrollService.readHolidayApplicability(selectedHolidayId), payrollService.readHolidayHistory(selectedHolidayId)])
      .then(([applicability, history]) => { if (active) { setHolidayApplicability(applicability); setHolidayHistory(history); } })
      .catch(() => { if (active) { setHolidayApplicability({ error: true }); setHolidayHistory({ error: true }); } });
    return () => { active = false; };
  }, [selectedHolidayId]);
  const patch = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
  const save = async () => {
    setBusy(true); setError("");
    try {
      if (mode === "components") {
        const code = draft.code.trim() || draft.name.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "");
        await payrollService.createComponent({ ...draft, code: code || `component_${crypto.randomUUID().replaceAll("-", "")}` });
      }
      else if (editingHolidayId) await payrollService.updateHoliday({ ...draft, id: editingHolidayId });
      else await payrollService.addHoliday(draft);
      await reload();
      setDraft((previous) => ({ ...previous, code: "", name: "", sourceNote: "", reason: "" }));
      setAdding(false); setEditingHolidayId("");
      if (mode === "holidays") setSelectedHolidayId("");
    } catch (cause) { setError(cause.message || "Unable to save setting."); }
    finally { setBusy(false); }
  };
  const selectedHoliday = (data.holidays || []).find((item) => item.id === selectedHolidayId);
  const beginHolidayEdit = (item) => {
    setDraft((previous) => ({ ...previous, date: item.holiday_date, name: item.name, scope: item.scope,
      stateCode: item.state_code || "", outletId: item.outlet_id || "", sourceNote: item.source_note,
      active: item.is_active, reason: "" }));
    setEditingHolidayId(item.id); setAdding(true); setError("");
  };
  const components = data.components || [];
  const selectedComponent = components.find((item) => item.id === selectedComponentId);
  const beginComponentEdit = () => {
    if (!selectedComponent) return;
    setComponentEditDraft({ id: selectedComponent.id, name: selectedComponent.name,
      epf: selectedComponent.epf_treatment, socso: selectedComponent.socso_treatment,
      eis: selectedComponent.eis_treatment, pcb: selectedComponent.pcb_treatment,
      active: selectedComponent.is_active, sourceNote: "", reason: "" });
    setError(""); setEditingComponent(true);
  };
  const saveComponentEdit = async () => {
    setBusy(true); setError("");
    try {
      await payrollService.updateComponent(componentEditDraft);
      await reload();
      setEditingComponent(false);
      setComponentHistory(await payrollService.readComponentHistory(componentEditDraft.id));
    } catch (cause) { setError(cause.message || "Unable to update Pay Component."); }
    finally { setBusy(false); }
  };
  const undetermined = (item) => !payComponentIsConfigured(item);
  return <div className="space-y-4">
    <AdminUnderlineTabs value={mode} onChange={(value) => { setMode(value); setAdding(false); setError(""); }}
      tabs={[["rules", "Statutory & Pay Rules"], ["holidays", "Public Holidays"], ["components", "Pay Components"]].map(([value, text]) => ({ value, label: text }))} ariaLabel="Payroll settings" />
    {mode === "rules" ? <div className="space-y-4"><Card className="p-5"><h3 className="text-lg font-bold">Statutory & Pay Rules</h3><p className="mt-1 text-sm text-text-secondary">Current calculation methods. Each run retains the applicable versions and source evidence.</p>
      <div className="mt-4 divide-y divide-border">{[["EPF", "Automatic", "Automatic calculation · employee category required"], ["SOCSO", "Automatic", "Automatic calculation · employee category required"], ["EIS", "Automatic", "Automatic calculation · employee category required"], ["PCB / MTD", "Manual confirmation", "Confirmed by an authorized Admin per employee and pay period"]].map(([name, method, note]) =>
        <div key={name} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><strong>{name}</strong><small className="block text-text-secondary">{note}</small></div><Badge tone={method === "Automatic" ? "success" : "warning"}>{method}</Badge></div>)}</div></Card>
      <button className="font-semibold text-primary" onClick={async()=>{ setScheduleOpen(true);setScheduleError("");try {setSchedules(await payrollService.readStatutorySchedules());}catch(e){setScheduleError(e.message);} }}>View Calculation Basis / Schedule</button>
      <PayrollPayRulesPanel canManage={canManage} /></div>
      : mode === "components" ? <Card className="overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4"><div><h3 className="text-lg font-bold">Allowances & Deductions</h3><p className="text-sm text-text-secondary">Statutory wage treatment must be explicit before a run is ready.</p></div>
        {canManageComponents && <button className="btn-primary" type="button" onClick={() => { setEditingHolidayId(""); setAdding(true); }}><Plus size={16} /> Add Component</button>}</div>
        {components.length ? <DataTable density="compact" columns={[
          { key: "name", header: "Component", render: (item) => <strong>{item.name}</strong> },
          { key: "type", header: "Type", render: (item) => label(item.component_type) },
          ...["epf", "socso", "eis", "pcb"].map((scheme) => ({ key: scheme, header: scheme.toUpperCase(), render: (item) => {
            const value = item[`${scheme}_treatment`]; const Icon = value === "included" ? Check : value === "excluded" ? Minus : TriangleAlert;
            return <InfoTooltip label={`${scheme.toUpperCase()} wage base: ${value === "included" ? "Included" : value === "excluded" ? "Excluded" : "Setup required"}`}><Icon size={16} aria-hidden="true" className={value === "included" ? "text-emerald-700" : value === "excluded" ? "text-text-secondary" : "text-amber-700"} /></InfoTooltip>;
          } })),
          { key: "status", header: "Status", render: (item) => <Badge tone={item.is_active ? "success" : "neutral"}>{item.is_active ? "Active" : "Inactive"}</Badge> },
          { key: "actions", header: "Actions", render: (item) => <button className="font-semibold text-primary" type="button" onClick={() => setSelectedComponentId(item.id)}>View</button> },
        ]} rows={components} getRowKey={(item) => item.id} onRowClick={(item) => { setSelectedComponentId(item.id); setEditingComponent(false); }} /> : <p className="p-6 text-sm text-text-secondary">No pay components configured.</p>}</Card>
      : <div className="space-y-4"><PayrollAnnualHolidays data={data} canManage={canManageHolidays}
        onAddHoliday={() => { setEditingHolidayId(""); setAdding(true); }} onViewHoliday={setSelectedHolidayId} />
        <PayrollPhPolicy entities={data.legal_entities || []} canManage={canManageHolidays} onChanged={reload} /></div>}
    {adding && <Modal title={mode === "components" ? "Add Pay Component" : editingHolidayId ? "Edit Public Holiday" : "Add Public Holiday"} size="lg" onClose={() => !busy && setAdding(false)} footer={<><button className="btn-secondary" type="button" disabled={busy} onClick={() => setAdding(false)}>Cancel</button><button className="btn-primary" type="button" disabled={busy || !draft.name || (mode === "components" ? ["epf", "socso", "eis", "pcb"].some((key) => draft[key] === "undetermined") : !draft.sourceNote || (editingHolidayId && !draft.reason) || (draft.scope === "state" && !draft.stateCode) || (draft.scope === "outlet" && !draft.outletId))} onClick={save}>{busy ? "Saving…" : mode === "components" ? "Add Component" : editingHolidayId ? "Save Changes" : "Add Holiday"}</button></>}>
      {mode === "components" ? <div className="grid gap-3 sm:grid-cols-2">
        <h3 className="sm:col-span-2 text-sm font-bold">Basic Information</h3>
        <AdminFormField label="Name"><input className="control" value={draft.name} onChange={(event) => patch("name", event.target.value)} /></AdminFormField>
        <SelectField label="Type" value={draft.type} onChange={(value) => patch("type", value)} options={["earning", "allowance", "deduction", "reimbursement"].map((value) => ({ value, label: label(value) }))} />
        <div className="sm:col-span-2"><h3 className="text-sm font-bold">Statutory Wage Treatment</h3><p className="text-xs text-text-secondary">Included means this component forms part of the scheme's wage base, not that the employee participates. Resolve all four treatments before use.</p></div>
        {["epf", "socso", "eis", "pcb"].map((key) => <WageTreatment key={key} scheme={key} value={draft[key]} onChange={(value) => patch(key, value)} />)}
        <ToggleField label="Available for use" checked={draft.active} onChange={(value) => patch("active", value)} />
        <AdminFormField label="Remark (Optional)"><input className="control" value={draft.reason} onChange={(event) => patch("reason", event.target.value)} /></AdminFormField>
        </div>
        : <div className="grid gap-3 sm:grid-cols-2">
          <DatePickerField label="Date" required value={draft.date} onChange={(value) => patch("date", value)} />
          <AdminFormField label="Holiday Name"><input className="control" value={draft.name} onChange={(event) => patch("name", event.target.value)} /></AdminFormField>
          <SelectField label="Scope" value={draft.scope} onChange={(value) => patch("scope", value)} options={[{ value: "national", label: "National" }, { value: "state", label: "State" }, { value: "outlet", label: "Outlet override" }]} />
          {draft.scope === "state" && <SelectField label="State" value={draft.stateCode} onChange={(value) => patch("stateCode", value)} options={[{ value: "", label: "Select state" }, ...MALAYSIA_STATES.map(([value, name]) => ({ value, label: name }))]} />}
          {draft.scope === "outlet" && <SelectField label="Outlet" value={draft.outletId} onChange={(value) => patch("outletId", value)} options={[{ value: "", label: "Select outlet" }, ...(data.outlets || []).map((outlet) => ({ value: outlet.id, label: outlet.name }))]} />}
          <AdminFormField label="Source"><input className="control" value={draft.sourceNote} onChange={(event) => patch("sourceNote", event.target.value)} placeholder="Gazette / approved calendar" /></AdminFormField>
          <div className="sm:col-span-2 rounded-xl bg-surface-muted p-3 text-sm text-text-secondary">Applies to {draft.scope === "national" ? "Malaysia workplaces" : draft.scope === "state" ? malaysiaStateName(draft.stateCode) || "the selected state" : data.outlets?.find((outlet) => outlet.id === draft.outletId)?.name || "the selected outlet"}. Payroll resolves each employee's workplace on the holiday date.</div>
          {editingHolidayId && <><ToggleField label="Active" checked={draft.active} onChange={(checked) => patch("active", checked)} />
            <AdminFormField label="Edit reason" required><input className="control" value={draft.reason} onChange={(event) => patch("reason", event.target.value)} /></AdminFormField></>}</div>}
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    </Modal>}
    {selectedHoliday && !adding && <Modal title={selectedHoliday.name} description={`${selectedHoliday.holiday_date} · Public Holiday`} onClose={() => setSelectedHolidayId("")}
      footer={<><button className="btn-secondary" type="button" onClick={() => setSelectedHolidayId("")}>Close</button>{canManageHolidays && holidayHistory?.editable && <button className="btn-primary" type="button" onClick={() => beginHolidayEdit(selectedHoliday)}>Edit Holiday</button>}</>}>
      {selectedHoliday && <div className="space-y-5 text-sm"><section><h3 className="font-bold">Applicability</h3><p className="mt-1 text-text-secondary">{selectedHoliday.scope === "national" ? "National · Malaysia" : selectedHoliday.scope === "state" ? `State · ${malaysiaStateName(selectedHoliday.state_code)}` : "Outlet override"}</p>
        {selectedHoliday.legal_entity_id && <p className="mt-2 text-amber-700">Historical Legal Entity override: {entityName(data.legal_entities || [], selectedHoliday.legal_entity_id)}</p>}
        <p className="mt-2 font-semibold">Affected outlets in your access</p><p className="text-text-secondary">{holidayApplicability?.error ? "Unable to load applicability." : holidayApplicability ? holidayApplicability.outlets?.map((outlet) => outlet.name).join(", ") || "None resolved; confirm Outlet state where applicable." : "Resolving…"}</p>
        <p className="mt-2 font-semibold">Linked Legal Entities</p><p className="text-text-secondary">{holidayApplicability?.error ? "Unable to load applicability." : holidayApplicability ? holidayApplicability.legal_entities?.map((entity) => entity.name).join(", ") || "No current employee workplace link in your access." : "Resolving…"}</p>
        <p className="mt-2 text-xs text-text-muted">Current workplace links are indicative; each Payroll shift uses its pinned date-effective evidence.</p></section>
        <section><h3 className="font-bold">Evidence & History</h3><p className="mt-1 text-text-secondary">{selectedHoliday.source_note}</p><p className="mt-2 text-xs text-text-muted">Created {selectedHoliday.created_at?.slice(0, 10)} · {selectedHoliday.is_active ? "Active" : "Inactive"}</p>
          {holidayHistory?.events?.map((event) => <p key={event.id} className="border-t border-border py-2 text-text-secondary">{label(event.event_type)} · {event.occurred_at?.slice(0, 16).replace("T", " ")} · {event.actor_name}{event.reason ? ` · ${event.reason}` : ""}</p>)}
          {holidayHistory?.editable === false && <p className="mt-2 text-text-muted">Historical or consumed holiday evidence is read-only.</p>}</section></div>}
    </Modal>}
    {!adding && error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    {selectedComponent && !editingComponent && <Modal title={selectedComponent.name} description={`${label(selectedComponent.component_type)} · ${selectedComponent.is_active ? "Active" : "Inactive"}`}
      onClose={() => { setSelectedComponentId(""); setEditingComponent(false); }}
      footer={<><button className="btn-secondary" type="button" onClick={() => setSelectedComponentId("")}>Close</button>{canManageComponents && <button className="btn-primary" type="button" onClick={beginComponentEdit}>{undetermined(selectedComponent) ? "Complete Setup" : "Edit Component"}</button>}</>}>
      {selectedComponent && <div className="space-y-5 text-sm">
        <section><h3 className="font-bold">Statutory Treatment</h3><div className="mt-2 divide-y divide-border rounded-xl border border-border">{["epf", "socso", "eis", "pcb"].map((scheme) => <div key={scheme} className="flex justify-between px-3 py-2"><span>{scheme.toUpperCase()}</span><Badge tone={selectedComponent[`${scheme}_treatment`] === "undetermined" ? "warning" : "neutral"}>{selectedComponent[`${scheme}_treatment`] === "undetermined" ? "Not configured" : label(selectedComponent[`${scheme}_treatment`])}</Badge></div>)}</div></section>
        <details><summary className="cursor-pointer text-text-secondary">History</summary><p className="mt-1 text-text-secondary">Created {selectedComponent.created_at?.slice(0, 10) || "—"}.</p>
          {Array.isArray(componentHistory) ? <div className="mt-2 divide-y divide-border">{componentHistory.map((event, index) => <div key={`${event.occurred_at}-${index}`} className="py-2"><strong>{label(event.event_type)}</strong><span className="ml-2 text-text-muted">{event.occurred_at?.slice(0, 16).replace("T", " ")} · {event.actor_name}</span><p className="text-text-secondary">{event.reason || event.details?.source || "—"}</p></div>)}</div> : <p className="mt-2 text-text-secondary">{componentHistory?.error ? "History could not be loaded." : "Loading history…"}</p>}</details>
      </div>}
    </Modal>}
    {editingComponent && componentEditDraft && <Modal title={`Edit ${selectedComponent?.name || "Pay Component"}`} description="Changes are audited. A component used by finalized Payroll cannot change its name or wage treatment; create a successor component instead." size="lg" onClose={() => !busy && setEditingComponent(false)}
      footer={<><button className="btn-secondary" type="button" disabled={busy} onClick={() => setEditingComponent(false)}>Cancel</button><button className="btn-primary" type="button" disabled={busy || !componentEditDraft.name.trim() || ["epf", "socso", "eis", "pcb"].some((key) => componentEditDraft[key] === "undetermined")} onClick={saveComponentEdit}>{busy ? "Saving…" : "Save Changes"}</button></>}>
      <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><AdminFormField label="Name" required><input className="control" value={componentEditDraft.name} onChange={(event) => setComponentEditDraft((current) => ({ ...current, name: event.target.value }))} /></AdminFormField><AdminFormField label="Type"><p className="control flex items-center bg-surface-muted text-text-secondary">{label(selectedComponent?.component_type)}</p></AdminFormField></div>
        <div><h3 className="mb-1 text-sm font-bold">Statutory Wage Treatment</h3><p className="mb-3 text-xs text-text-secondary">Included means this component forms part of the scheme's wage base, not that the employee participates. Resolve all four treatments before use.</p><div className="grid gap-3 sm:grid-cols-2">{["epf", "socso", "eis", "pcb"].map((scheme) => <WageTreatment key={scheme} scheme={scheme} value={componentEditDraft[scheme]} onChange={(value) => setComponentEditDraft((current) => ({ ...current, [scheme]: value }))} />)}</div></div>
        <ToggleField label="Available for use" checked={componentEditDraft.active} onChange={(checked) => setComponentEditDraft((current) => ({ ...current, active: checked }))} />
        <p className="text-xs text-text-secondary">Unavailable components cannot be newly assigned. Historical Payroll evidence is retained.</p>
        <AdminFormField label="Remark (Optional)"><input className="control" value={componentEditDraft.reason} onChange={(event) => setComponentEditDraft((current) => ({ ...current, reason: event.target.value }))} /></AdminFormField>
        {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
      </div>
    </Modal>}
    {scheduleOpen && <Modal title="Calculation Basis / Schedule" size="xl" onClose={()=>setScheduleOpen(false)} footer={<button className="btn-secondary" onClick={()=>setScheduleOpen(false)}>Close</button>}>
      <p className="mb-4 text-sm text-text-secondary">Canonical schedule versions active today. Historical Runs retain the version actually used.</p>
      {scheduleError ? <p role="alert">{scheduleError}</p> : schedules === null ? <p>Loading schedules…</p> : <div className="divide-y divide-border">{schedules.filter(s=>s.effective_from<=today() && (!s.effective_to || s.effective_to>=today())).map(s=><section key={s.id} className="py-3 text-sm"><h3 className="font-bold">{s.scheme.toUpperCase()} · {label(s.category)}</h3><p>{s.source_version} · effective {s.effective_from}</p><a className="text-primary underline" href={s.source_url} target="_blank" rel="noreferrer">Official schedule source</a></section>)}</div>}
    </Modal>}
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
    setOpenRunId(runId || activeRun?.id || "new"); setRunStep(step); setTab("runs");
  };
  return <div className="space-y-4">
    <PageHeader section="People" title="Payroll Control Center" description="Prepare, review and finalize each pay period with clear evidence and resolution steps." />
    {!canView ? <Card className="p-8 text-center text-sm text-text-secondary">Payroll permission is required. Employee access alone does not reveal compensation.</Card>
      : loading && !data ? <Card className="p-8 text-center text-sm text-text-secondary">Loading Payroll...</Card>
        : error ? <Card className="p-8 text-sm font-semibold text-rose-700" role="alert">{error}<button className="btn-secondary ml-3" type="button" onClick={reload}>Retry</button></Card>
          : <><nav aria-label="Payroll sections" className="flex flex-wrap gap-2">
            {[["overview","Overview"],["employees","Employees"],["runs","Payroll Runs"],["settings","Settings"]].map(([key,title]) =>
              <button key={key} type="button" className={tab === key ? "btn-primary" : "btn-secondary"} onClick={() => { if (key === "runs") setOpenRunId(""); setTab(key); }}>{title}</button>)}
          </nav>
          {tab === "overview" && <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:max-w-2xl"><SelectField label="Legal Entity" value={entityId} onChange={(value) => { setEntityId(value); setOpenRunId(""); }} options={(data.legal_entities || []).map((item) => ({ value: item.id, label: item.display_name || item.name }))} />
            <MonthPickerField label="Pay Period" value={month} onChange={(value) => { setMonth(value); setOpenRunId(""); }} /></Card>}
          {tab === "overview" && <Overview data={data} canManage={canManage} entityId={entityId} month={month} run={activeRun} readiness={readiness?.runId === activeRun?.id ? readiness : null} onOpenRun={openRun} onOpenEmployees={() => setTab("employees")} />}
          {tab === "employees" && <ProfilesTab data={data} canManage={canManage} reload={reload} />}
          {tab === "runs" && <RunsTab data={data} canManage={canManage} canFinalize={canFinalize} reload={reload} entityId={entityId} setEntityId={setEntityId} month={month} setMonth={setMonth} step={runStep} setStep={setRunStep} openRunId={openRunId} setOpenRunId={setOpenRunId} readiness={readiness} />}
          {tab === "settings" && <SettingsTab data={data} canManage={canManage} reload={reload} />}
        </>}
  </div>;
}
