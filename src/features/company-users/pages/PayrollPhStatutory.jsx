import { useEffect, useRef, useState } from "react";
import Badge from "../../../components/ui/Badge.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { payrollService } from "../../../services/payrollService.js";

const money=value=>value==null?"—":new Intl.NumberFormat("en-MY",{style:"currency",currency:"MYR"}).format(Number(value));
const hours=value=>value==null?"—":`${(Number(value)/60).toFixed(2)}h`;
const names=row=>(row.context.paid_holiday?.holidays||[]).map(item=>item.holiday?.name).filter(Boolean).join(" / ");
const warning="Statutory entitlement may still be due. This treatment does not confirm statutory compliance; warnings remain in audit history.";
const intent=d=>({run_id:d.runId,employee_id:d.employeeId,date:d.row.date,treatment_model:"unified_v1",decision:d.decision,treatment:d.treatment,...(d.decision==="adjust"?{approved_minutes:d.minutes,extra_minutes:d.extra}:{}),...(d.treatment==="custom"?{amount:d.amount,...(d.otAmount!==""?{ot_amount:d.otAmount}:{})}:{}),});
export default function PayrollPhStatutory({runId,employeeId,canManage,onChanged}) {
 const [rows,setRows]=useState(null),[draft,setDraft]=useState(null),[quoteResponse,setQuote]=useState(null),[quoteError,setQuoteError]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const generation=useRef(0);
 const load=async()=>{const n=++generation.current;const result=await payrollService.readPhStatutory(runId,employeeId);if(n===generation.current){setRows(result);return result;}};
 useEffect(()=>{setRows(null);setDraft(null);setError("");load().catch(e=>setError(e.message));return()=>{generation.current++;};},[runId,employeeId]);
 const payload=draft?intent(draft):null,key=JSON.stringify(payload);
 const quote=quoteResponse?.key===key?quoteResponse.result:null;
 useEffect(()=>{if(!payload){setQuote(null);return;}let active=true;setQuoteError("");
  // Check availability before incomplete custom inputs can produce an amount.
  const intendedExtra=draft.decision==="adjust"?draft.extra:draft.decision==="paid_not_worked"?0:draft.row.context.time?.approved_extra_minutes;
  const incomplete=payload.treatment==="custom"&&(payload.amount===""||(Number(intendedExtra)>0&&(payload.ot_amount===undefined||payload.ot_amount==="")));
  const request=incomplete?{...payload,treatment:"",amount:undefined,ot_amount:undefined}:payload;
  payrollService.previewPhTreatment(request).then(r=>{if(active)setQuote({key,result:r});}).catch(e=>{if(active)setQuoteError(e.message);});return()=>{active=false;};},[key]);
 const open=row=>{const prior=row.review?.evidence?.intent||{};const approved=row.context.time?.id&&row.context.time.status!=="review_required";setError("");setDraft({runId,employeeId,row,editTime:!approved,decision:approved?"keep_approved":"",treatment:prior.treatment||row.preview?.default_treatment||"",minutes:String(row.context.time?.approved_minutes??""),extra:String(row.context.time?.approved_extra_minutes??0),amount:prior.amount??"",otAmount:prior.ot_amount??"",reason:"",requestId:crypto.randomUUID()});};
 const patch=(key,value)=>setDraft(d=>({...d,[key]:value,requestId:crypto.randomUUID()}));
 const changed=async()=>{const result=await load();setDraft(d=>d?{...d,row:result?.find(r=>r.date===d.row.date)||d.row,requestId:crypto.randomUUID()}:d);await onChanged?.();};
 const save=async()=>{setBusy(true);setError("");try{await payrollService.confirmPhStatutory({...intent(draft),context_fingerprint:quote.context_fingerprint,quote_fingerprint:quote.quote_fingerprint,request_id:draft.requestId,reason:draft.reason});setDraft(null);await changed();}catch(e){setError(e.message);}finally{setBusy(false);}};
 if(rows?.length===0&&!error)return null;
 const time=draft?.row.context.time,source=draft?.row.context.source;
 const extra=Number(quote?.context?.time?.approved_extra_minutes??(draft?.decision==="adjust"?draft.extra:draft?.decision==="paid_not_worked"?0:time?.approved_extra_minutes)??0);
 const overrides=draft&&['company','custom','none'].includes(draft.treatment);
 const preview=quote?.pay_preview;
 const decisions=[{value:"",label:"Select day decision"},...(time?.id&&time.status!=="review_required"?[{value:"keep_approved",label:"Keep confirmed payable time"}]:[]),...(Number(time?.scheduled_minutes)>0?[{value:"approve_roster",label:"Approve Roster Hours"}]:[]),...(time?.id?[{value:"adjust",label:"Adjust Payable Time"}]:[]),{value:"paid_not_worked",label:"Paid Holiday / Did Not Work"}];
 const reasonRequired=draft&&(draft.row.review?.id||["custom","none"].includes(draft.treatment)||draft.decision!=="keep_approved");
 const canSave=preview?.determinate&&!quoteError&&draft?.decision&&draft?.treatment&&(!reasonRequired||draft.reason.trim().length>=3)&&(draft.treatment!=="statutory"||quote.statutory_available)&&!(quote.issues||[]).some(x=>x!=="ph_pay_treatment_required");
 return <section className="space-y-3 border-t border-border pt-4"><h4 className="font-bold">Public Holiday Pay</h4><p className="text-xs text-text-secondary">Review the day and confirm its PH pay treatment.</p>
  {rows===null&&!error&&<p role="status">Loading holiday pay…</p>}
  {rows?.map(row=><div className="space-y-2 border-b border-border pb-3" key={row.date}><div className="flex justify-between gap-2"><strong>{row.date} · {names(row)||"Paid Holiday"}</strong><Badge tone={row.issues.length?"warning":"success"}>{row.issues.length?"Review Required":row.review?.evidence?.workflow==="pay_treatment_v1"?"Confirmed":"Verified"}</Badge></div>
   {row.issues.length>0&&<p className="text-xs text-text-secondary">Confirm the day’s payable time and PH pay treatment.</p>}
   {row.warnings?.length>0&&<p className="text-xs text-text-secondary">Compliance warning retained · explicit Payroll treatment</p>}
   {canManage&&<button type="button" className="btn-secondary" onClick={()=>open(row)}>{row.review?.id?"Correct PH Treatment":"Review Holiday"}</button>}
   {row.review?.id&&<details className="text-xs"><summary>Audit evidence</summary>{(row.history||[row.review]).map(v=><div key={v.id}><p>{v.evidence?.intent?.treatment||"Statutory review"} · {v.reason} · {v.created_at}</p><p>{v.official_reference}</p>{v.evidence?.warnings?.length>0&&<p>{warning}</p>}</div>)}<p>Original evidence and all prior decisions are retained.</p></details>}
  </div>)}
  {error&&!draft&&<p role="alert">{error}</p>}
  {draft&&<Modal title={`PH Pay Treatment · ${draft.row.date}`} description="Review the financial effect before confirming." size="lg" onClose={()=>!busy&&setDraft(null)} footer={<><button className="btn-secondary" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button><button className="btn-primary" disabled={busy||!canSave} onClick={save}>{busy?"Saving…":"Confirm PH Treatment"}</button></>}>
   <fieldset disabled={busy} className="space-y-4 min-w-0"><div className="text-sm space-y-2"><div className="flex flex-wrap items-center gap-2"><strong>{names(draft.row)||"Paid Holiday"} · {draft.row.date}</strong><Badge tone="success">Published PH</Badge></div>
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Pay rate",`${money(draft.row.context.compensation?.hourly_rate??draft.row.context.compensation?.basic_salary)} / ${draft.row.context.compensation?.pay_basis==="monthly"?"month":"hour"}`],["Roster hours",hours(time?.scheduled_minutes)],["Approved payable hours",hours(quote?.context?.time?.approved_minutes??time?.approved_minutes)],["PH OT hours",hours(quote?.context?.time?.approved_extra_minutes??time?.approved_extra_minutes??0)]].map(([label,value])=><div key={label}><dt className="text-text-secondary">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}</dl>
    {(time?.actual_minutes==null||source?.leave_type||time?.status==="review_required")&&<p className="text-text-secondary">Attendance: {time?.actual_minutes==null?"Incomplete or no recorded work":hours(time.actual_minutes)}{source?.leave_type&&` · Leave: ${source.leave_type}`}. Original evidence is retained.</p>}
   </div>
   {time?.id&&time.status!=="review_required"&&!draft.editTime?<div className="flex items-center justify-between gap-3 text-sm"><strong>Payable Time ✓ Confirmed · {hours(time.approved_minutes)}</strong><button type="button" className="btn-secondary" onClick={()=>setDraft(d=>({...d,editTime:true}))}>Edit Payable Time</button></div>:<SelectField label="Day decision" value={draft.decision} options={decisions} onChange={v=>patch("decision",v)}/>}
   {draft.decision==="adjust"&&<div className="grid gap-4 sm:grid-cols-2">{[["minutes","Normal payable minutes"],["extra","PH OT payable minutes"]].map(([field,label])=><AdminFormField key={field} label={label} required><input className="control" aria-label={label} type="number" min="0" step="1" value={draft[field]} onChange={e=>patch(field,e.target.value)}/></AdminFormField>)}</div>}
   <SelectField ariaLabel="PH Pay Treatment" label="PH Pay Treatment" value={draft.treatment} options={[{value:"",label:"Select PH pay treatment"},{value:"statutory",label:"Statutory PH Pay",disabled:!quote?.statutory_available},{value:"company",label:"Company PH Allowance",disabled:!quote?.company_available},{value:"custom",label:"Custom PH Allowance"},{value:"none",label:"No Additional PH Pay"}]} onChange={v=>patch("treatment",v)}/>
   {quote&&!quote.statutory_available&&<p role="note" className="text-sm text-text-secondary">Statutory PH Pay unavailable — required evidence is incomplete. Choose another treatment; statutory compliance remains unverified.</p>}
   {draft.treatment==="custom"&&<><AdminFormField label="Public Holiday Allowance (RM)" required><input className="control" aria-label="Public Holiday Allowance (RM)" type="number" min="0" step="0.01" value={draft.amount} onChange={e=>patch("amount",e.target.value)}/></AdminFormField>{extra>0&&<AdminFormField label="PH overtime allowance (RM)" required><input className="control" aria-label="PH overtime allowance (RM)" type="number" min="0" step="0.01" value={draft.otAmount} onChange={e=>patch("otAmount",e.target.value)}/></AdminFormField>}</>}
   {draft.treatment&&<section aria-label="Pay Preview" aria-live="polite" className="rounded-lg border border-border p-3 text-sm space-y-3"><h3 className="font-bold">Pay Preview</h3>{preview?.determinate?<><dl className="space-y-1">{[["Regular Pay",preview.monthly_basic_included?"Included in Basic Salary":money(preview.regular_pay)],["Public Holiday Allowance",money(preview.public_holiday_allowance)],...(extra>0||Number(preview.ph_ot)>0?[["PH OT",money(preview.ph_ot)]]:[])].map(([label,value])=><div className="flex justify-between gap-3" key={label}><dt>{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}<div className="flex justify-between gap-3 border-t border-border pt-2 font-bold"><dt>{preview.monthly_basic_included?"Total additional earnings for this day":"Total earnings for this day"}</dt><dd className="tabular-nums">{money(preview.total_day_additions)}</dd></div></dl><p className="font-bold">{Number(preview.payroll_change)<0?`This decision reduces Payroll by ${money(-Number(preview.payroll_change))}`:`This decision adds ${money(preview.payroll_change)} to Payroll`}</p>{draft.row.review?.id&&<p className="text-text-secondary">Replaces the previous day addition of {money(preview.previous_day_additions)}. Prior decisions remain in history.</p>}{preview.monthly_basic_included&&<p className="text-text-secondary">Basic Salary remains in the period total; it is not added again for this day.</p>}</>:<p role="status">{quote?"Complete the treatment and required payable-time decision to resolve the financial effect.":"Updating Pay Preview…"}</p>}</section>}
   {overrides&&<p role="note" className="text-sm text-text-secondary">{warning}</p>}
   {reasonRequired&&<AdminFormField label="Decision / correction reason" required><input className="control" aria-label="Decision / correction reason" value={draft.reason} onChange={e=>patch("reason",e.target.value)}/></AdminFormField>}
   {quote===null&&!quoteError&&!draft.treatment&&<p role="status">Checking PH pay treatment…</p>}{quoteError&&<p role="alert">{quoteError}</p>}{quote?.issues?.includes("ph_replacement_leave_resolution_required")&&<p role="alert">An existing Replacement Leave grant requires resolution through Leave before a cash treatment can be confirmed.</p>}{quote?.issues?.includes("ph_ot_statutory_evidence_required")&&<p role="alert">PH OT cannot be determined from current statutory evidence. Review the overtime treatment before confirmation.</p>}{error&&<p role="alert">{error}</p>}
   </fieldset>
  </Modal>}
 </section>;
}
