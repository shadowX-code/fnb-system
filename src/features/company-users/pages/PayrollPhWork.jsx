import { useEffect, useRef, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { payrollService } from "../../../services/payrollService.js";

const treatments = [{ value: "additional_pay", label: "Additional Pay" }, { value: "replacement_leave", label: "Replacement Leave" }];
const label = (value) => treatments.find(item => item.value === value)?.label || "Policy required";
const money = (value) => value == null ? "—" : new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(value);
const clock = value => value ? new Date(value).toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const range = (start, end) => `${clock(start)} – ${clock(end)}`;

export function PayrollPhPolicy({ entities, canManage, onChanged, selectedCompany = "all" }) {
  const [entityId,setEntityId]=useState(selectedCompany),[versions,setVersions]=useState(null),[draft,setDraft]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const activeEntities=entities.filter(e=>e.is_active!==false);
  const defaults=[{value:"statutory",label:"Statutory PH Pay"},{value:"additional_pay",label:"Company PH Allowance"},{value:"no_default",label:"No default — decide during Payroll"}];
  const policyLabel=value=>defaults.find(t=>t.value===value)?.label||(value==='replacement_leave'?'Replacement Leave · retained Leave policy':'No default — decide during Payroll');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const load=async id=>id==='all'?Promise.all(activeEntities.map(async entity=>({entity,rows:await payrollService.readPhPolicy(entity.id)}))):payrollService.readPhPolicy(id);
  useEffect(()=>{setEntityId(selectedCompany);},[selectedCompany]);
  useEffect(()=>{let active=true;setVersions(null);setDraft(null);setError('');load(entityId).then(v=>{if(active)setVersions(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[entityId]);
  const histories=entityId==='all'?(versions||[]):[{entity:activeEntities.find(e=>e.id===entityId),rows:versions||[]}];
  const current=histories.map(h=>h.rows.find(v=>v.effective_from<=today));
  const uniform=current.length>0&&current.every(v=>v&&v.treatment===current[0]?.treatment&&v.effective_from===current[0]?.effective_from);
  const save=async()=>{setBusy(true);setError('');try{if(entityId==='all')await payrollService.saveDefaultPhPolicy(draft);else await payrollService.savePhPolicy({entityId,...draft});setVersions(await load(entityId));setDraft(null);await onChanged?.();}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <Card className="space-y-3 p-4"><h3 className="font-bold">Default PH Pay Treatment</h3><p className="text-sm text-text-secondary">Preselect the treatment for Payroll review. Each holiday still requires confirmation.</p>
    <SelectField label="Company" value={entityId} onChange={setEntityId} options={[{value:'all',label:'All applicable companies'},...activeEntities.map(e=>({value:e.id,label:e.display_name||e.name}))]}/>
    {versions===null&&!error?<p role="status">Loading policy…</p>:<p className="text-sm"><strong>{uniform?policyLabel(current[0].treatment):current.some(Boolean)?'Company-specific defaults':'No default — decide during Payroll'}</strong>{uniform&&` · Effective ${current[0].effective_from}`}</p>}
    {(uniform&&current[0].treatment==='additional_pay'||draft?.treatment==='additional_pay')&&<dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="font-semibold">Monthly</dt><dd>+1 ordinary day · Basic Salary ÷ 26</dd></div><div><dt className="font-semibold">Hourly</dt><dd>Approved PH Hours × Hourly Rate</dd></div></dl>}
    <details className="text-sm"><summary className="cursor-pointer text-primary">View history</summary>{histories.map(h=><div key={h.entity?.id}><p className="mt-2 font-semibold">{h.entity?.display_name||h.entity?.name}</p>{h.rows.map(v=><p key={v.id}>{v.effective_from} · {policyLabel(v.treatment)}{v.remark&&` · ${v.remark}`}</p>)}</div>)}<p className="mt-2 text-text-secondary">Replacement Leave grants and consumption remain in Leave history; they are not PH cash treatments.</p></details>
    {canManage&&versions&&!draft&&<button className="btn-secondary" onClick={()=>setDraft({date:'',treatment:uniform&&current[0].treatment!=='replacement_leave'?current[0].treatment:'no_default',remark:''})}>Change Default PH Pay Treatment</button>}
    {draft&&<section className="space-y-3 border-t border-border pt-3"><SelectField label="Default PH Pay Treatment" ariaLabel="Default PH Pay Treatment" value={draft.treatment} options={defaults} onChange={treatment=>setDraft(d=>({...d,treatment}))}/><DatePickerField label="Effective From" value={draft.date} onChange={date=>setDraft(d=>({...d,date}))}/><AdminFormField label="Remark (Optional)"><input className="control" value={draft.remark} onChange={e=>setDraft(d=>({...d,remark:e.target.value}))}/></AdminFormField><div className="flex gap-2"><button className="btn-secondary" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button><button className="btn-primary" disabled={busy||!draft.date} onClick={save}>{busy?'Saving…':'Save Default PH Pay Treatment'}</button></div></section>}
    {error&&<p role="alert">{error}</p>}
  </Card>;
}

export default function PayrollPhWork({ runId, employeeId, canManage, onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const generation = useRef(0);
  const load = async () => {
    const request = ++generation.current;
    const result = await payrollService.readPhWork(runId, employeeId);
    if (request === generation.current) setRows(result);
  };
  useEffect(() => { setRows(null); setEditing(null); setError(""); load().catch(e => setError(e.message)); return () => { generation.current++; }; }, [runId, employeeId]);
  const confirm = async (row, treatment, remark = "") => {
    setBusy(true); setError("");
    // A failed transport keeps the exact request for safe retry. Changed intent
    // creates a new identity; server owns amount, actor, evidence and recalculation.
    const intent = `${row.work_date}:${row.source_fingerprint}:${treatment}:${remark}`;
    const requestId = editing?.intent === intent ? editing.requestId : crypto.randomUUID();
    setEditing({ date: row.work_date, treatment, remark, intent, requestId });
    try { await payrollService.confirmPhWork({ runId, employeeId, workDate: row.work_date, treatment, remark, fingerprint: row.source_fingerprint, requestId });
      setEditing(null); await load(); await onChanged?.(); }
    catch (cause) { setError(cause.message); await load(); }
    finally { setBusy(false); }
  };
  if (rows?.length === 0 && !error) return null;
  return <section className="space-y-3 border-t border-border pt-4"><h4 className="font-bold">Public Holiday Work</h4>
    <p className="text-xs text-text-secondary">Company benefit only. Statutory PH pay is calculated separately from verified entitlement evidence.</p>
    {rows === null && !error && <p role="status">Loading PH work…</p>}
    {rows?.map(row => { const decision = row.decision; const treatment = decision?.treatment || row.recommended_treatment;
      const unresolved = !!row.issue; const edit = editing?.date === row.work_date;
      return <div key={row.work_date} className="space-y-2 border-b border-border pb-3"><div className="flex justify-between gap-3"><strong>{row.work_date} · {(row.source?.paid_holiday_policy?.holidays || []).map(h => h.holiday?.name).filter(Boolean).join(" / ") || "Company Paid Holiday"}</strong>
        <Badge tone={unresolved ? "warning" : "success"}>{unresolved ? "Review Required" : "Confirmed"}</Badge></div>
        <dl className="grid gap-2 text-xs sm:grid-cols-3"><div><dt className="text-text-secondary">Published Roster</dt><dd>{range(row.source?.scheduled_start_at, row.source?.scheduled_end_at)}</dd></div>
          <div><dt className="text-text-secondary">Clock In–Out</dt><dd>{range(row.source?.clock_in_at, row.source?.clock_out_at)}</dd></div>
          <div><dt className="text-text-secondary">Approved Payable Time</dt><dd>{(Number(row.time?.approved_minutes || 0) / 60).toFixed(2)} h</dd></div></dl>
        <p><strong>{label(treatment)}</strong> · {treatment === "replacement_leave" ? row.grant_id && !unresolved ? "1 day granted" : "1 day · expires 31 December" : money(row.additional_amount)}
          {!decision?.id && row.recommended_treatment && <small className="ml-2 text-text-secondary">Recommended</small>}</p>
        {treatment === "additional_pay" && <p className="text-xs text-text-secondary">{row.formula} · {row.compensation?.pay_basis === "monthly" ? `${money(row.compensation.basic_salary)} / 26` : `${money(row.compensation?.hourly_rate)} × ${(Number(row.time?.approved_minutes) / 60).toFixed(2)} h`}</p>}
        {row.issue && <p className="text-xs text-amber-800">{row.issue === "ph_treatment_confirmation_required" ? "Confirm the company treatment." : row.issue === "ph_treatment_evidence_changed" ? "Source evidence changed. Review and confirm again." : row.issue === "ph_company_policy_required" ? "Set a date-effective company policy in Public Holidays Settings." : "Supported approved PH hours and company policy are required."}</p>}
        {canManage && row.policy?.id && row.issue !== "public_holiday_ot_unsupported" && <div className="space-y-2">
          {!edit ? <div className="flex flex-wrap gap-3"><button type="button" className="btn-primary" disabled={busy} onClick={() => confirm(row, row.recommended_treatment)}>Use Recommended Treatment</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditing({ date: row.work_date, treatment, remark: "" })}>Change Treatment</button></div>
            : <><SelectField label="Company Treatment" value={editing.treatment} onChange={value => setEditing(old => ({ ...old, treatment: value, intent: null }))} options={treatments} />
              <AdminFormField label="Remark (Optional)"><input className="control" value={editing.remark} onChange={e => setEditing(old => ({ ...old, remark: e.target.value, intent: null }))} /></AdminFormField>
              <div className="flex gap-2"><button className="btn-secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="btn-primary" type="button" disabled={busy} onClick={() => confirm(row, editing.treatment, editing.remark)}>{busy ? "Confirming…" : "Confirm Treatment"}</button></div></>}
        </div>}
      </div>;
    })}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
  </section>;
}
