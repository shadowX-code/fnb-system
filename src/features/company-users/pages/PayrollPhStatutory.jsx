import { useEffect, useRef, useState } from "react";
import Badge from "../../../components/ui/Badge.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { payrollService } from "../../../services/payrollService.js";
import PayrollPhProfile, { PayrollPhHistoricalWages, phSetupMessage } from "./PayrollPhProfile.jsx";

const issueText=issue=>({ph_occurrence_review_required:"Confirm the day’s work and holiday eligibility.",ph_eligibility_evidence_changed:"Employment, time, pay or holiday evidence changed. Review this day again.",ph_over_4000_contract_work_rule_required:"Work premium coverage requires a verified contract/category rule at this wage level.",ph_company_treatment_confirmation_required:"Confirm the separate company benefit.",ph_part_time_partial_day_requires_review:"Partial part-time holiday work requires a verified pricing rule.",ph_absence_or_substitution_requires_review:"Resolve the applicable absence or substitute holiday evidence."}[issue]||phSetupMessage(issue));
export default function PayrollPhStatutory({runId,employeeId,canManage,onChanged}) {
 const [rows,setRows]=useState(null),[draft,setDraft]=useState(null),[setup,setSetup]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const generation=useRef(0);
 const load=async()=>{const n=++generation.current;const result=await payrollService.readPhStatutory(runId,employeeId);if(n===generation.current){setRows(result);return result;}};
 useEffect(()=>{setRows(null);setDraft(null);setSetup("");setError("");load().catch(e=>setError(e.message));return()=>{generation.current++;};},[runId,employeeId]);
 const open=row=>{setError("");setDraft({row,decision:row.context.time?.status&&row.context.time.status!=="review_required"?"keep_approved":"",minutes:"",extra:"0",reference:"",reason:"",requestId:crypto.randomUUID()});};
 const patch=(key,value)=>setDraft(d=>({...d,[key]:value,requestId:crypto.randomUUID()}));
 const changed=async()=>{const result=await load();setDraft(d=>d?{...d,row:result?.find(r=>r.date===d.row.date)||d.row,requestId:crypto.randomUUID()}:d);await onChanged?.();};
 const save=async()=>{setBusy(true);setError("");try{await payrollService.confirmPhStatutory({run_id:runId,employee_id:employeeId,date:draft.row.date,context_fingerprint:draft.row.context_fingerprint,request_id:draft.requestId,decision:draft.decision,...(draft.decision==="adjust"?{approved_minutes:draft.minutes,extra_minutes:draft.extra}:{}),reference:draft.reference,reason:draft.reason});setDraft(null);await changed();}catch(e){setError(e.message);}finally{setBusy(false);}};
 if(rows?.length===0&&!error)return null;
 const profile=draft?.row.profile,time=draft?.row.context.time,source=draft?.row.context.source;
 const decisions=[{value:"",label:"Select day decision"},...(time?.status&&time.status!=="review_required"?[{value:"keep_approved",label:"Confirm approved payable time"}]:[]),...(Number(time?.scheduled_minutes)>0?[{value:"approve_roster",label:"Approve Roster Hours"}]:[]),...(time?[{value:"adjust",label:"Adjust Payable Time"}]:[]),{value:"paid_not_worked",label:"Paid Holiday / Did Not Work"},{value:"absence_review",label:"Absence / eligibility requires review"},{value:"substitution_review",label:"Substitute holiday requires review"}];
 return <section className="space-y-3 border-t border-border pt-4"><h4 className="font-bold">Public Holiday Entitlement</h4><p className="text-xs text-text-secondary">Review each holiday’s work and eligibility. Verified PH Pay Profiles and historical wages are reused.</p>
  {rows===null&&!error&&<p role="status">Loading holiday entitlement…</p>}
  {rows?.map(row=><div className="space-y-2 border-b border-border pb-3" key={row.date}><div className="flex justify-between gap-2"><strong>{row.date} · Paid Holiday</strong><Badge tone={row.issues.length?"warning":"success"}>{row.issues.length?"Review Required":"Verified"}</Badge></div>
   {row.issues.length>0&&<p className="text-xs text-text-secondary">{[...new Set(row.issues.map(issueText))].join(" ")}</p>}
   {canManage&&<button type="button" className="btn-secondary" onClick={()=>open(row)}>{row.review?"Review / Correct Holiday":"Review Holiday"}</button>}
   {row.review&&<details className="text-xs"><summary>Audit evidence</summary>{(row.history||[row.review]).map(v=><p key={v.id}>{v.official_reference} · {v.reason} · {v.created_at}</p>)}<p>Original source and prior decisions are retained.</p></details>}
  </div>)}
  {error&&!draft&&<p role="alert">{error}</p>}
  {draft&&!setup&&<Modal title={`Review Paid Holiday · ${draft.row.date}`} description="Confirm this occurrence. Roster hours require an explicit decision and do not prove attendance." size="lg" onClose={()=>!busy&&setDraft(null)} footer={<><button className="btn-secondary" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button><button className="btn-primary" disabled={busy||profile?.status!=="verified"||!draft.decision||draft.reason.trim().length<3} onClick={save}>{busy?"Saving…":"Confirm Holiday Decision"}</button></>}>
   <div className="space-y-4"><div className="rounded-lg border border-border p-3 text-sm space-y-2"><p><strong>Published Paid Holiday</strong> · {draft.row.date}</p><p>PH Pay Profile: {profile?.profile_status==="verified"?"Verified":"Setup required"}</p>
    {profile?.profile_status==="verified"&&<button className="btn-secondary" onClick={()=>setSetup("profile")}>Manage PH Pay Profile</button>}
    {profile?.profile_status!=="verified"&&<button className="btn-secondary" onClick={()=>setSetup("profile")}>Setup PH Pay Profile</button>}
    {profile?.issues?.includes("ph_schedule_wages_required")&&profile?.profile_status==="verified"&&<button className="btn-secondary" onClick={()=>setSetup("profile")}>Confirm PH Wage Basis</button>}
    {profile?.wages?.status==="review_required"&&<button className="btn-secondary" onClick={()=>setSetup("wages")}>Historical wage evidence required</button>}
    {profile?.wages?.status==="verified"&&<p>Historical wages: {profile.wages.origin==="payroll"?"Derived from canonical Payroll":"Verified historical evidence"}</p>}
    <p>Roster: {time?.scheduled_minutes!=null?`${time.scheduled_minutes} scheduled minutes`:"No published working shift"}</p><p>Attendance: {time?.actual_minutes!=null?`${time.actual_minutes} recorded minutes`:"Incomplete or no recorded work"}</p><p>Payable time: {time?.status==="review_required"?"Review required":time?.approved_minutes!=null?`${time.approved_minutes} approved minutes${Number(time.approved_extra_minutes)>0?` + ${time.approved_extra_minutes} extra`:""}`:"No approved work"}</p><p>Leave: {source?.leave_type||"No leave recorded for this day"}</p>
    <p className="text-text-secondary">Check adjacent absence and any substitute holiday. Unresolved eligibility remains blocked.</p>
   </div><SelectField label="Holiday decision" value={draft.decision} options={decisions} onChange={v=>patch("decision",v)}/>
    {draft.decision==="adjust"&&<div className="grid gap-4 sm:grid-cols-2">{[["minutes","Normal payable minutes"],["extra","Additional payable minutes"]].map(([key,label])=><AdminFormField key={key} label={label} required><input className="control" aria-label={label} type="number" min="0" step="1" value={draft[key]} onChange={e=>patch(key,e.target.value)}/></AdminFormField>)}</div>}
    <AdminFormField label="Day-specific reference / notes"><input className="control" aria-label="Day-specific reference / notes" value={draft.reference} onChange={e=>patch("reference",e.target.value)}/></AdminFormField>
    <AdminFormField label="Decision / correction reason" required><input className="control" aria-label="Decision / correction reason" value={draft.reason} onChange={e=>patch("reason",e.target.value)}/></AdminFormField>
    {error&&<p role="alert">{error}</p>}
   </div>
  </Modal>}
  {setup==="profile"&&draft&&<PayrollPhProfile employeeId={employeeId} date={draft.row.date} onSaved={changed} onClose={()=>setSetup("")}/>}
  {setup==="wages"&&draft&&<PayrollPhHistoricalWages employeeId={employeeId} profile={profile} onSaved={changed} onClose={()=>setSetup("")}/>}
 </section>;
}
