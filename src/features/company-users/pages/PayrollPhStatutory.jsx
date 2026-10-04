import { useEffect, useRef, useState } from "react";
import Badge from "../../../components/ui/Badge.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { payrollService } from "../../../services/payrollService.js";
import PayrollPhProfile, { PayrollPhHistoricalWages } from "./PayrollPhProfile.jsx";

const money=value=>value==null?"—":new Intl.NumberFormat("en-MY",{style:"currency",currency:"MYR"}).format(Number(value));
const names=row=>(row.context.paid_holiday?.holidays||[]).map(item=>item.holiday?.name).filter(Boolean).join(" / ");
const warning="This is an explicit Payroll pay treatment, not confirmation of statutory compliance. Statutory entitlement may still be due. The comparison and missing evidence remain in audit history.";
const intent=d=>({run_id:d.runId,employee_id:d.employeeId,date:d.row.date,decision:d.decision,treatment:d.treatment,...(d.decision==="adjust"?{approved_minutes:d.minutes,extra_minutes:d.extra}:{}),...(d.treatment==="custom"?{amount:d.amount,...(d.otAmount!==""?{ot_amount:d.otAmount}:{})}:{}),...(d.overlap?{company_overlap:d.overlap}: {})});
export default function PayrollPhStatutory({runId,employeeId,canManage,onChanged}) {
 const [rows,setRows]=useState(null),[draft,setDraft]=useState(null),[setup,setSetup]=useState(""),[quote,setQuote]=useState(null),[quoteError,setQuoteError]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const generation=useRef(0);
 const load=async()=>{const n=++generation.current;const result=await payrollService.readPhStatutory(runId,employeeId);if(n===generation.current){setRows(result);return result;}};
 useEffect(()=>{setRows(null);setDraft(null);setSetup("");setError("");load().catch(e=>setError(e.message));return()=>{generation.current++;};},[runId,employeeId]);
 const payload=draft?intent(draft):null,key=JSON.stringify(payload);
 useEffect(()=>{if(!payload){setQuote(null);return;}let active=true;setQuote(null);setQuoteError("");payrollService.previewPhTreatment(payload).then(r=>{if(active)setQuote(r);}).catch(e=>{if(active)setQuoteError(e.message);});return()=>{active=false;};},[key]);
 const open=row=>{const prior=row.review?.evidence?.intent||{};setError("");setDraft({runId,employeeId,row,decision:row.context.time?.id&&row.context.time.status!=="review_required"?"keep_approved":"",treatment:prior.treatment||"",minutes:String(row.context.time?.approved_minutes??""),extra:String(row.context.time?.approved_extra_minutes??0),amount:prior.amount??"",otAmount:prior.ot_amount??"",overlap:prior.company_overlap||row.profile?.evidence?.company_overlap||"",reference:"",reason:"",ack:false,requestId:crypto.randomUUID()});};
 const patch=(key,value)=>setDraft(d=>({...d,[key]:value,ack:false,requestId:crypto.randomUUID()}));
 const changed=async()=>{const result=await load();setDraft(d=>d?{...d,row:result?.find(r=>r.date===d.row.date)||d.row,requestId:crypto.randomUUID()}:d);await onChanged?.();};
 const save=async()=>{setBusy(true);setError("");try{await payrollService.confirmPhStatutory({...intent(draft),context_fingerprint:quote.context_fingerprint,quote_fingerprint:quote.quote_fingerprint,request_id:draft.requestId,acknowledge_warning:draft.ack,reference:draft.reference,reason:draft.reason});setDraft(null);await changed();}catch(e){setError(e.message);}finally{setBusy(false);}};
 if(rows?.length===0&&!error)return null;
 const profile=draft?.row.profile,time=draft?.row.context.time,source=draft?.row.context.source;
 const extra=Number(quote?.context?.time?.approved_extra_minutes||0);
 const worked=Number(quote?.context?.time?.approved_minutes||0)+extra;
 const overrides=draft&&['custom','none'].includes(draft.treatment);
 const decisions=[{value:"",label:"Select day decision"},...(time?.id&&time.status!=="review_required"?[{value:"keep_approved",label:"Confirm approved payable time"}]:[]),...(Number(time?.scheduled_minutes)>0?[{value:"approve_roster",label:"Approve Roster Hours"}]:[]),...(time?.id?[{value:"adjust",label:"Adjust Payable Time"}]:[]),{value:"paid_not_worked",label:"Paid Holiday / Did Not Work"}];
 const canSave=quote&&!quoteError&&draft?.decision&&draft?.treatment&&draft.reason.trim().length>=3&&(!overrides||draft.ack)&&!(quote.issues||[]).some(x=>x!=="ph_pay_treatment_required");
 return <section className="space-y-3 border-t border-border pt-4"><h4 className="font-bold">Public Holiday Pay</h4><p className="text-xs text-text-secondary">Review the day and confirm its PH pay treatment.</p>
  {rows===null&&!error&&<p role="status">Loading holiday pay…</p>}
  {rows?.map(row=><div className="space-y-2 border-b border-border pb-3" key={row.date}><div className="flex justify-between gap-2"><strong>{row.date} · {names(row)||"Paid Holiday"}</strong><Badge tone={row.issues.length?"warning":"success"}>{row.issues.length?"Review Required":row.review?.evidence?.workflow==="pay_treatment_v1"?"Confirmed":"Verified"}</Badge></div>
   {row.issues.length>0&&<p className="text-xs text-text-secondary">Confirm the day’s payable time and PH pay treatment.</p>}
   {row.warnings?.length>0&&<p className="text-xs text-text-secondary">Compliance warning retained · explicit Payroll treatment</p>}
   {canManage&&<button type="button" className="btn-secondary" onClick={()=>open(row)}>{row.review?.id?"Correct PH Treatment":"Review Holiday"}</button>}
   {row.review?.id&&<details className="text-xs"><summary>Audit evidence</summary>{(row.history||[row.review]).map(v=><div key={v.id}><p>{v.evidence?.intent?.treatment||"Statutory review"} · {v.reason} · {v.created_at}</p><p>{v.official_reference}</p>{v.evidence?.warnings?.length>0&&<p>{warning}</p>}</div>)}<p>Original evidence and all prior decisions are retained.</p></details>}
  </div>)}
  {error&&!draft&&<p role="alert">{error}</p>}
  {draft&&!setup&&<Modal title={`PH Pay Treatment · ${draft.row.date}`} description="Confirm the day’s payable time and Public Holiday Allowance." size="lg" onClose={()=>!busy&&setDraft(null)} footer={<><button className="btn-secondary" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button><button className="btn-primary" disabled={busy||!canSave} onClick={save}>{busy?"Saving…":"Confirm PH Treatment"}</button></>}>
   <div className="space-y-4"><div className="rounded-lg border border-border p-3 text-sm space-y-1"><p><strong>Published Paid Holiday</strong> · {draft.row.date} · {names(draft.row)}</p><p>Pay: {draft.row.context.compensation?.pay_basis} · {money(draft.row.context.compensation?.hourly_rate??draft.row.context.compensation?.basic_salary)}</p>
    <p>Roster: {time?.scheduled_minutes!=null?`${time.scheduled_minutes} scheduled minutes`:"No published working shift"}</p><p>Attendance: {time?.actual_minutes!=null?`${time.actual_minutes} recorded minutes`:"Incomplete or no recorded work"}</p><p>Approved payable time: {time?.status==="review_required"?"Review required":time?.approved_minutes!=null?`${time.approved_minutes} minutes + ${time.approved_extra_minutes||0} PH OT minutes`:"No approved work"}</p><p>Leave: {source?.leave_type||"No leave recorded for this day"}</p>
   </div><SelectField label="Day decision" value={draft.decision} options={decisions} onChange={v=>patch("decision",v)}/>
   {draft.decision==="adjust"&&<div className="grid gap-4 sm:grid-cols-2">{[["minutes","Normal payable minutes"],["extra","PH OT payable minutes"]].map(([field,label])=><AdminFormField key={field} label={label} required><input className="control" aria-label={label} type="number" min="0" step="1" value={draft[field]} onChange={e=>patch(field,e.target.value)}/></AdminFormField>)}</div>}
   <SelectField label="PH Pay Treatment" value={draft.treatment} options={[{value:"",label:"Select PH pay treatment"},{value:"statutory",label:"Apply Statutory PH Pay"},{value:"custom",label:"Custom PH Allowance"},{value:"none",label:"No Additional PH Pay"}]} onChange={v=>patch("treatment",v)}/>
   {quote&& (quote.statutory_available?<p className="text-sm">Calculated Public Holiday Allowance: <strong>{money(quote.statutory_amount)}</strong>{draft.row.context.compensation?.pay_basis==="monthly"&&" · ordinary holiday pay remains in Basic Salary"}</p>:<p className="text-sm">Statutory amount cannot be determined automatically.</p>)}
   {draft.treatment==="custom"&&<><AdminFormField label="Public Holiday Allowance (RM)" required><input className="control" aria-label="Public Holiday Allowance (RM)" type="number" min="0" step="0.01" value={draft.amount} onChange={e=>patch("amount",e.target.value)}/></AdminFormField>{extra>0&&<AdminFormField label="PH overtime allowance (RM)" required><input className="control" aria-label="PH overtime allowance (RM)" type="number" min="0" step="0.01" value={draft.otAmount} onChange={e=>patch("otAmount",e.target.value)}/></AdminFormField>}</>}
   {draft.row.context.company_policy&&worked>0&&<SelectField label="Separate company PH benefit" value={draft.overlap} options={[{value:"",label:"Select benefit relationship"},{value:"not_applicable",label:"Company benefit does not apply"},{value:"inclusive_top_up",label:"Includes PH work pay · add excess only"},{value:"additional_to_statutory",label:"Separate additional company benefit"}]} onChange={v=>patch("overlap",v)}/>}
   {overrides&&<div role="note" className="rounded-lg border border-warning p-3 text-sm"><p>{warning}</p><label><input type="checkbox" checked={draft.ack} onChange={e=>setDraft(d=>({...d,ack:e.target.checked,requestId:crypto.randomUUID()}))}/> I acknowledge this compliance warning.</label></div>}
   <AdminFormField label="Decision / correction reason" required><input className="control" aria-label="Decision / correction reason" value={draft.reason} onChange={e=>patch("reason",e.target.value)}/></AdminFormField>
   <details className="text-sm"><summary>Advanced compliance evidence</summary><p>Reusable statutory evidence is optional for explicit Payroll overrides.</p><button className="btn-secondary" onClick={()=>setSetup("profile")}>PH Pay Profile</button>{profile?.wages?.status==="review_required"&&<button className="btn-secondary" onClick={()=>setSetup("wages")}>Historical wage evidence</button>}<AdminFormField label="Reference / notes"><input className="control" aria-label="Reference / notes" value={draft.reference} onChange={e=>patch("reference",e.target.value)}/></AdminFormField></details>
   {quote===null&&!quoteError&&<p role="status">Checking PH pay treatment…</p>}{quoteError&&<p role="alert">{quoteError}</p>}{quote?.issues?.includes("ph_company_treatment_confirmation_required")&&<p role="alert">Confirm the separate company benefit through Working on a Paid Holiday.</p>}{draft.treatment==="statutory"&&quote&&!quote.statutory_available&&<p role="alert">Choose an explicit custom allowance or zero additional pay, or verify statutory evidence under Advanced.</p>}{error&&<p role="alert">{error}</p>}
   </div>
  </Modal>}
  {setup==="profile"&&draft&&<PayrollPhProfile employeeId={employeeId} date={draft.row.date} onSaved={changed} onClose={()=>setSetup("")}/>}
  {setup==="wages"&&draft&&<PayrollPhHistoricalWages employeeId={employeeId} profile={profile} onSaved={changed} onClose={()=>setSetup("")}/>}
 </section>;
}
