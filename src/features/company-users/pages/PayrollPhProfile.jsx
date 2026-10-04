import { useEffect, useRef, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import { payrollService } from "../../../services/payrollService.js";

const categories = [{value:"",label:"Select verified coverage"},{value:"general",label:"General employee · wage threshold applies"},{value:"manual",label:"First Schedule · Manual labour"},{value:"vehicle",label:"First Schedule · Vehicle operation / maintenance"},{value:"manual_supervisor",label:"First Schedule · Supervises manual labour"},{value:"vessel",label:"First Schedule · Qualifying vessel worker"}];
const overlap = [{value:"",label:"Select verified contract treatment"},{value:"not_applicable",label:"Company benefit does not apply"},{value:"inclusive_top_up",label:"Company benefit includes statutory work pay · excess only"},{value:"additional_to_statutory",label:"Contract grants an additional benefit"}];
export const phSetupMessage = issue => ({ph_pay_profile_required:"PH Pay Profile confirmation required.",ph_employment_or_pay_evidence_required:"Dated employment and pay setup are required.",ph_historical_wage_evidence_required:"Historical wage evidence required.",ph_schedule_wages_required:"Confirm the statutory wage basis for this pay version."}[issue] || "Review the applicable PH evidence.");

export default function PayrollPhProfile({employeeId,date,onClose,onSaved}) {
 const [effective,setEffective]=useState(date),[read,setRead]=useState(null),[evidence,setEvidence]=useState({}),[reference,setReference]=useState(""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const generation=useRef(0),request=useRef(crypto.randomUUID());
 useEffect(()=>{const n=++generation.current;setRead(null);setError("");payrollService.readPhProfile(employeeId,effective).then(r=>{if(n===generation.current){setRead(r);setEvidence(r.evidence||{});request.current=crypto.randomUUID();}}).catch(e=>{if(n===generation.current)setError(e.message);});return()=>{generation.current++;};},[employeeId,effective]);
 const patch=(key,value)=>{setEvidence(e=>({...e,[key]:value}));request.current=crypto.randomUUID();};
 const number=(key,label)=>read?.basis?.derived?.[key] != null ? <p className="text-sm">{label}: <strong>{read.basis.derived[key]}</strong><small className="block text-text-secondary">Verified contract</small></p> : <AdminFormField label={label} required><input className="control" aria-label={label} type="number" min="1" step={key.includes("wages")?"0.01":"1"} value={evidence[key]??""} onChange={e=>patch(key,e.target.value)}/></AdminFormField>;
 const save=async()=>{setBusy(true);setError("");try{await payrollService.savePhProfile({employee_id:employeeId,effective_from:effective,basis_fingerprint:read.basis_fingerprint,evidence,reference,reason,request_id:request.current});await onSaved?.();onClose();}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <Modal title="PH Pay Profile" description="Confirm reusable statutory coverage. It applies from this date until the employment, contract or coverage changes." size="lg" onClose={()=>!busy&&onClose()} footer={<><button className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy||!read?.basis||reference.trim().length<8||reason.trim().length<3} onClick={save}>{busy?"Saving…":"Confirm PH Pay Profile"}</button></>}>
  <div className="space-y-4"><DatePickerField label="Effective From" value={effective} onChange={setEffective}/>
   {!read&&!error&&<p role="status">Loading dated employment and contract evidence…</p>}
   {read?.basis&&<><div className="rounded-lg bg-surface-muted p-3 text-sm">{read.basis.employment_type==="part_time"?"Part-time":"Full-time"} · {read.basis.pay_basis} pay{read.basis.contract_id&&" · completed contract"}</div><div className="grid gap-4 sm:grid-cols-2">
    {read.basis.derived?.coverage ? <p className="text-sm">Employment category: <strong>Full-time</strong><small className="block text-text-secondary">Dated employment evidence</small></p> : <SelectField label="Statutory employment category" value={evidence.coverage||""} options={[{value:"",label:"Select verified category"},{value:"full_time",label:"Full-time"},{value:"part_time",label:"Verified regular part-time"}]} onChange={v=>patch("coverage",v)}/>}
    <SelectField label="First Schedule coverage" value={evidence.schedule_category||""} options={categories} onChange={v=>patch("schedule_category",v)}/>
    {number("normal_minutes","Contractual normal daily minutes")}{number("normal_weekly_minutes","Contractual normal weekly minutes")}
    {evidence.coverage==="part_time"&&<>{number("comparable_full_time_minutes","Comparable full-time daily minutes")}{number("comparable_weekly_minutes","Comparable full-time weekly minutes")}<label className="text-sm sm:col-span-2"><input type="checkbox" checked={evidence.regular_contract_not_home_or_casual===true} onChange={e=>patch("regular_contract_not_home_or_casual",e.target.checked)}/> Verified regular contract; not excluded casual or home work</label></>}
    {read.compensation?.pay_basis==="hourly"||read.issues?.includes("ph_schedule_wages_required") ? <>{number("schedule_monthly_wages","Statutory monthly wage basis (RM)")}{read.compensation?.pay_basis==="monthly"&&number("monthly_ordinary_wages","Monthly ordinary wages (RM)")}</> : <p className="text-sm sm:col-span-2">Wage basis resolves from canonical compensation.</p>}
    {read.basis.company_policy_id&&<SelectField label="Company PH benefit contract" value={evidence.company_overlap||""} options={overlap} onChange={v=>patch("company_overlap",v)}/>}
   </div></>}
   {read&&!read.basis&&<p>{read.issues?.map(phSetupMessage).join(" ")}</p>}
   <AdminFormField label="Evidence / contract reference" required><input className="control" aria-label="Evidence / contract reference" value={reference} onChange={e=>{setReference(e.target.value);request.current=crypto.randomUUID();}}/></AdminFormField>
   <AdminFormField label="Confirmation / correction reason" required><input className="control" aria-label="Confirmation / correction reason" value={reason} onChange={e=>{setReason(e.target.value);request.current=crypto.randomUUID();}}/></AdminFormField>
   {read?.history?.length>0&&<details className="text-sm"><summary>PH Profile history</summary>{read.history.map(v=><p key={v.id}>{v.effective_from} · {v.reference} · {v.reason}</p>)}</details>}
   {error&&<p role="alert">{error}</p>}
  </div>
 </Modal>;
}

export function PayrollPhHistoricalWages({employeeId,profile,onClose,onSaved}) {
 const [wages,setWages]=useState(""),[days,setDays]=useState(""),[reference,setReference]=useState(""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const request=useRef(crypto.randomUUID()),w=profile.wages;
 const change=(setter,value)=>{setter(value);request.current=crypto.randomUUID();};
 const save=async()=>{setBusy(true);setError("");try{await payrollService.savePhHistoricalWages({employee_id:employeeId,legal_entity_id:profile.basis.legal_entity_id,period_start:w.period_start,source_fingerprint:w.source_fingerprint,qualifying_wages:wages,worked_days:days,reference,reason,request_id:request.current});await onSaved?.();onClose();}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <Modal title="Historical wage evidence required" description={`Canonical Payroll evidence is insufficient for ${w.period_start} – ${w.period_end}. Confirm one reusable wage-period record.`} onClose={()=>!busy&&onClose()} footer={<><button className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy||!wages||!days||reference.trim().length<8||reason.trim().length<3} onClick={save}>Confirm Historical Wages</button></>}>
  <div className="space-y-4"><p className="text-sm">Use qualifying actual wages and worked days. Exclude rest-day / PH work and approved incentive payments. This confirmation does not change the original Payroll records.</p>
   {[["Qualifying wages (RM)",wages,setWages,"0.01"],["Qualifying worked days",days,setDays,"1"],["Historical wage reference",reference,setReference,null],["Historical confirmation / correction reason",reason,setReason,null]].map(([label,value,set,step])=><AdminFormField key={label} label={label} required><input className="control" aria-label={label} type={step?"number":"text"} min={step?"1":undefined} step={step||undefined} value={value} onChange={e=>change(set,e.target.value)}/></AdminFormField>)}
   {error&&<p role="alert">{error}</p>}
  </div>
 </Modal>;
}
