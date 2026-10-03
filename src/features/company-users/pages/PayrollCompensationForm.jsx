import { useEffect, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import AdminSegmentedControl from "../../../components/forms/AdminSegmentedControl.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import MonthPickerField from "../../../components/forms/MonthPickerField.jsx";
import { payrollService } from "../../../services/payrollService.js";
import { statutorySetupHelp, statutoryCategories } from "./PayrollStatutorySetup.jsx";
import { effectivePay as effective } from "./payrollCompensationPresentation.js";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const currentMonth = () => today().slice(0,7);
const entityName = (entities,id) => entities.find(e=>e.id===id)?.display_name || entities.find(e=>e.id===id)?.name || "Historical Legal Employer";
function StatutoryChecks({ value, onChange, review, loading }) {
  return <div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {["epf", "socso", "eis", "pcb"].map((key) => <div key={key}><SelectField label={key.toUpperCase()} ariaLabel={key.toUpperCase()}
        value={value[key]==null?'':String(value[key])} onChange={(v)=>onChange({...value,[key]:v===''?null:v==='true'})}
        options={[{value:'',label:'Choose applicability'},{value:'true',label:'Applicable'},{value:'false',label:'Not Applicable'}]} />
        {value[key] === false && <p className="mt-2 text-xs text-text-secondary">Not Applicable</p>}
        {value[key] === true && (key === "pcb" ? <p className="mt-2 text-xs text-text-secondary">Confirm the amount in each Payroll Run.</p>
          : loading ? <p className="mt-2 text-xs text-text-secondary">Checking Employee evidence…</p>
          : review?.schemes?.[key]?.recommendation ? <p className="mt-2 text-xs text-teal-700">{statutoryCategories[key].find(c=>c.value===review.schemes[key].recommendation)?.label} · Recommended</p>
          : review && <div className="mt-2 text-xs text-amber-700"><p className="font-semibold">Additional information required</p><p>{statutorySetupHelp(review.schemes?.[key]?.issue, review.evidence)}</p></div>)}
      </div>)}
    </div>
  </div>;
}

export default function FoundationForm({ mode, profile, initialEmployeeId = "", initialEffectiveFrom = "", payrollMonth = "", data, onClose, onSaved }) {
  const current = effective(profile?.compensation, initialEffectiveFrom || today());
  const currentStatutory = effective(profile?.statutory);
  const [draft, setDraft] = useState(() => ({
    employeeId: initialEmployeeId || profile?.employee_id || "",
    profileId: profile?.id,
    payBasis: current?.pay_basis || "monthly",
    rate: current?.basic_salary || current?.hourly_rate || "",
    currency: current?.currency || "MYR",
    effectiveFrom: initialEffectiveFrom || (mode === "create" ? data.employees?.find(e => e.id === initialEmployeeId)?.joined_date || "" : today()),
    statutoryMonth: [currentMonth(), data.employees?.find(e => e.id === initialEmployeeId)?.joined_date?.slice(0, 7) || ""].sort().at(-1),
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
  const { employeeId, effectiveFrom, statutoryMonth, epf, socso, eis, pcb } = draft;
  const joinedDate = data.employees?.find(e => e.id === employeeId)?.joined_date;
  useEffect(() => {
    if (mode !== "create") return;
    let active = true;
    setSetup(null); setSetupError("");
    if (!employeeId || !effectiveFrom) { setSetupLoading(false); return; }
    setSetupLoading(true);
    payrollService.readInitialSetup(employeeId, effectiveFrom, { epf, socso, eis, pcb }, `${statutoryMonth}-01`)
      .then(result => { if (active) setSetup(result); })
      .catch(cause => { if (active) setSetupError(cause.message || "Unable to check statutory setup."); })
      .finally(() => { if (active) setSetupLoading(false); });
    return () => { active = false; };
  }, [mode, employeeId, effectiveFrom, statutoryMonth, epf, socso, eis, pcb, refresh]);
  const patch = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
  const isProfile = ["create", "compensation", "pay"].includes(mode);
  const title = {
    create: "Set Up Employee",
    compensation: "Edit Pay",
    pay: "Set Up Pay",
  }[mode];

  async function save() {
    setBusy(true);
    setError("");
    try {
      const input = { ...draft, rate: Number(draft.rate) };
      if (mode === "create") await payrollService.confirmInitialSetup({
        ...input, statutoryMonth: `${statutoryMonth}-01`, applicability: { epf, socso, eis, pcb }, fingerprint: setup.fingerprint,
      });
      if (mode === "compensation") await payrollService.adjustCompensation(input);
      if (mode === "pay") await payrollService.createProfile({ ...input, epf: null, socso: null, eis: null, pcb: null });
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
      : ["compensation", "pay"].includes(mode) ? Number(draft.rate) > 0
        : true) && (mode === "create" || draft.reason.trim());

  return <Modal title={title} description={mode === "create" ? "Set pay from a specific date and statutory setup from a payroll month." : "Changes apply from the selected date. Previous pay records remain available in history."}
    onClose={onClose} size="lg"
    footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={!allowed || busy} onClick={save}>{busy ? "Saving..." : mode === "create" ? "Confirm Employee Setup" : "Save"}</button></>}>
    <div className="space-y-4">
      {payrollMonth && <p className="text-sm text-text-secondary">Pay setup for {payrollMonth}. Confirm the actual pay effective date; later pay and employment records remain unchanged.</p>}
      <fieldset className="min-w-0 space-y-4">
      {mode === "create" && <legend className="mb-3 text-sm font-bold text-text-primary">Pay Setup</legend>}
      {mode === "create" && <AdminFormField label="Employee" required>
        <SelectField value={draft.employeeId} onChange={(value) => setDraft(previous => ({ ...previous,
          employeeId: value, effectiveFrom: candidates.find(e => e.id === value)?.joined_date || "",
          statutoryMonth: [currentMonth(), candidates.find(e => e.id === value)?.joined_date?.slice(0, 7) || ""].sort().at(-1) }))} searchable
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
      <div className="grid gap-4 sm:grid-cols-2">
        <DatePickerField label="Pay Effective From" required value={draft.effectiveFrom} onChange={(value) => patch("effectiveFrom", value)}
          helper={mode === "create" && joinedDate ? `Recommended: Joined Date · ${joinedDate}. Confirm when this salary/rate actually started.` : null} />
        {mode !== "create" && <AdminFormField label="Reason / provenance" required><input className="control" value={draft.reason}
          onChange={(event) => patch("reason", event.target.value)} placeholder="Reviewed compensation change" /></AdminFormField>
        }
      </div>
      {mode === "create" && joinedDate && draft.effectiveFrom > joinedDate && <p role="status" className="text-sm text-amber-700">Current pay starts after employment date. Earlier payroll periods may require previous pay history.</p>}
      </fieldset>
      {mode === "create" && <fieldset className="min-w-0 space-y-3 border-t border-border pt-4">
        <legend className="px-0 text-sm font-bold text-text-primary">Statutory Setup</legend>
        <div className="space-y-1"><MonthPickerField label="Statutory Effective Month" value={draft.statutoryMonth} onChange={value => patch("statutoryMonth", value)} />
          <p className="text-xs text-text-secondary">Applies to payroll for this month and later, until changed.</p></div>
        <StatutoryChecks value={draft} onChange={setDraft} review={setup} loading={setupLoading} />
        <p className="text-xs text-text-secondary">Confirm recommended categories with this setup. Unresolved schemes remain Setup Required. Applicable PCB / MTD amounts are confirmed in each Payroll Run.</p>
        {(setupError || (error && !setup)) && <div role="alert"><p>{setupError || error}</p><button type="button" className="btn-secondary" onClick={()=>{setError("");setRefresh(v=>v+1);}}>Refresh Setup</button></div>}
      </fieldset>}
      {mode !== "create" && <p className="text-xs text-text-secondary">The new version applies from this date. It does not update an Employment Contract or rewrite earlier versions.</p>}
      {error && mode !== "create" && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    </div>
  </Modal>;
}

