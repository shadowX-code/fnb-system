import { useEffect, useRef, useState } from "react";
import Badge from "../../../components/ui/Badge.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { payrollService } from "../../../services/payrollService.js";

const coverage = [{value:"",label:"Select verified category"},{value:"full_time",label:"Employment Act · Full-time"},{value:"part_time",label:"Part-Time Regulations · Verified regular part-time"}];
const categories = [{value:"",label:"Select verified coverage"},{value:"general",label:"General employee · wage threshold applies"},{value:"manual",label:"First Schedule · Manual labour"},{value:"vehicle",label:"First Schedule · Vehicle operation / maintenance"},{value:"manual_supervisor",label:"First Schedule · Supervises manual labour"},{value:"vessel",label:"First Schedule · Qualifying vessel worker"}];
const eligibility = [{value:"",label:"Review eligibility"},{value:"eligible",label:"Eligible · absence and substitution checked"},{value:"unresolved",label:"Not yet verified"},{value:"substitution_required",label:"Substitute holiday requires review"},{value:"forfeited",label:"Potential forfeiture requires review"}];
const overlap = [{value:"",label:"Review company benefit contract"},{value:"not_applicable",label:"Company benefit does not apply to this day"},{value:"inclusive_top_up",label:"Benefit includes statutory work premium · pay excess only"},{value:"additional_to_statutory",label:"Contract grants a benefit additional to statutory pay"}];
export default function PayrollPhStatutory({runId,employeeId,canManage,onChanged}) {
 const [rows,setRows]=useState(null),[draft,setDraft]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const generation=useRef(0);
 const load=async()=>{const n=++generation.current; const result=await payrollService.readPhStatutory(runId,employeeId); if(n===generation.current)setRows(result);};
 useEffect(()=>{setRows(null);setDraft(null);setError("");load().catch(e=>setError(e.message));return()=>{generation.current++;};},[runId,employeeId]);
 const open=row=>setDraft({row,evidence:{...row.review?.evidence},reference:"",reason:"",requestId:crypto.randomUUID()});
 const patch=(key,value)=>setDraft(d=>({...d,evidence:{...d.evidence,[key]:value},requestId:crypto.randomUUID()}));
 const number=(key,label)=> <AdminFormField label={label} required><input className="control" aria-label={label} type="number" min="0" step={key.includes("wages")?"0.01":"1"} value={draft.evidence[key]??""} onChange={e=>patch(key,e.target.value)}/></AdminFormField>;
 const save=async()=>{setBusy(true);setError("");try{await payrollService.confirmPhStatutory({run_id:runId,employee_id:employeeId,date:draft.row.date,context_fingerprint:draft.row.context_fingerprint,request_id:draft.requestId,evidence:{...draft.evidence,...(!monthly?{preceding_period_start:prevStart,preceding_period_end:prevEnd}:{})},reference:draft.reference,reason:draft.reason});setDraft(null);await load();await onChanged?.();}catch(e){setError(e.message);}finally{setBusy(false);}};
 if(rows?.length===0&&!error)return null;
 const monthly=draft?.row.context.compensation.pay_basis==="monthly";
 const month=draft?.row.date.slice(0,7);
 const prevStart=month?new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-2,1)).toISOString().slice(0,10):"";
 const prevEnd=month?new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1,0)).toISOString().slice(0,10):"";
 return <section className="space-y-3 border-t border-border pt-4"><h4 className="font-bold">Public Holiday Entitlement</h4>
  <p className="text-xs text-text-secondary">Published paid holidays use verified coverage, contractual hours and wage evidence. Company benefits remain separate.</p>
  {rows===null&&!error&&<p role="status">Loading holiday entitlement…</p>}
  {rows?.map(row=><div className="space-y-2 border-b border-border pb-3" key={row.date}><div className="flex justify-between gap-2"><strong>{row.date} · Paid Holiday</strong><Badge tone={row.issues.length?"warning":"success"}>{row.issues.length?"Review Required":"Verified"}</Badge></div>
   {row.issues.length>0&&<p className="text-xs text-text-secondary">{row.issues.map(issue=>({ph_eligibility_review_required:"Verify employee coverage, wage basis and holiday eligibility.",ph_eligibility_evidence_changed:"Employment, time, pay or holiday evidence changed. Review again.",ph_over_4000_contract_work_rule_required:"Work premium coverage requires a verified contract/category rule at this wage level.",ph_company_treatment_confirmation_required:"Confirm the separate company benefit, then review its overlap with statutory pay.",ph_part_time_partial_day_requires_review:"Partial part-time holiday work needs an explicitly verified pricing rule."}[issue]||"Review the holiday evidence and statutory inputs.")).join(" ")}</p>}
   {canManage&&<button type="button" className="btn-secondary" onClick={()=>open(row)}>{row.review?"Review / Correct PH Evidence":"Verify PH Entitlement"}</button>}
   {row.review&&<details className="text-xs"><summary>Audit evidence</summary><div>{(row.history||[row.review]).map(v=><p key={v.id}>{v.official_reference} · {v.reason} · {v.created_at}</p>)}</div><p>Prior evidence is retained when corrected.</p></details>}
  </div>)}
  {error&&!draft&&<p role="alert" className="text-rose-700">{error}</p>}
  {draft&&<Modal title={`Verify PH Entitlement · ${draft.row.date}`} description="Confirm evidence for this paid holiday. This does not change Attendance, Roster or employment history." size="lg" onClose={()=>!busy&&setDraft(null)} footer={<><button className="btn-secondary" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button><button className="btn-primary" disabled={busy||draft.reference.trim().length<8||draft.reason.trim().length<3} onClick={save}>{busy?"Confirming…":"Confirm PH Evidence"}</button></>}>
   <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><SelectField label="Statutory employment category" value={draft.evidence.coverage||""} options={coverage} onChange={v=>patch("coverage",v)}/><SelectField label="First Schedule coverage" value={draft.evidence.schedule_category||""} options={categories} onChange={v=>patch("schedule_category",v)}/>
   {number("schedule_monthly_wages","Monthly wages for First Schedule threshold (RM)")}{number("normal_minutes","Contractual normal daily minutes")}
   <SelectField label="Paid holiday eligibility" value={draft.evidence.holiday_eligibility||""} options={eligibility} onChange={v=>patch("holiday_eligibility",v)}/>
   {monthly?number("monthly_ordinary_wages","Monthly ordinary wages (RM)"):<><p className="text-xs text-text-secondary sm:col-span-2">Preceding wage period: {prevStart} – {prevEnd}. Exclude rest-day/PH work and approved incentive payments from both statutory wages and worked-day evidence.</p>{number("preceding_qualifying_wages","Preceding qualifying wages (RM)")}{number("preceding_worked_days","Preceding qualifying worked days")}</>}
   {draft.evidence.coverage==="part_time"&&<>{number("comparable_full_time_minutes","Comparable full-time daily minutes")}{number("part_time_weekly_minutes","Contractual part-time weekly minutes")}{number("comparable_weekly_minutes","Comparable full-time weekly minutes")}<label className="text-sm"><input type="checkbox" checked={draft.evidence.regular_contract_not_home_or_casual===true} onChange={e=>patch("regular_contract_not_home_or_casual",e.target.checked)}/> Regular contractual part-time category verified; not excluded casual/home work</label></>}
   {draft.row.context.company_policy&&Number(draft.row.context.time?.approved_minutes||0)+Number(draft.row.context.time?.approved_extra_minutes||0)>0&&<SelectField label="Company benefit interaction" value={draft.evidence.company_overlap||""} options={overlap} onChange={v=>patch("company_overlap",v)}/>}
   </div><p className="text-xs text-text-secondary">Confirm the applicable published/substituted day and adjacent absence/leave evidence. Unknown exclusions, forfeiture or substitution remain Review Required. Job title, roster hours and pay basis alone do not prove statutory category.</p>
   <AdminFormField label="Official / contract / wage evidence reference" required><input className="control" aria-label="Official / contract / wage evidence reference" value={draft.reference} onChange={e=>setDraft(d=>({...d,reference:e.target.value,requestId:crypto.randomUUID()}))}/></AdminFormField>
   <AdminFormField label="Review / correction reason" required><input className="control" aria-label="Review / correction reason" value={draft.reason} onChange={e=>setDraft(d=>({...d,reason:e.target.value,requestId:crypto.randomUUID()}))}/></AdminFormField>
   {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}</div>
  </Modal>}
 </section>;
}
