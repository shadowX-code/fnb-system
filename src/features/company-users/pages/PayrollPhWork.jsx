import { useEffect, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { payrollService } from "../../../services/payrollService.js";

export function PayrollPhPolicy({ entities, canManage, onChanged, selectedCompany = "all", onCompanyChanged }) {
  const [entityId,setEntityId]=useState(selectedCompany),[versions,setVersions]=useState(null),[draft,setDraft]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [statutory,setStatutory]=useState(null),[statutoryError,setStatutoryError]=useState("");
  const activeEntities=entities.filter(e=>e.is_active!==false);
  const defaults=[{value:"statutory",label:"Statutory PH Pay"},{value:"additional_pay",label:"Company PH Allowance"},{value:"no_default",label:"No default — decide during Payroll"}];
  const policyLabel=value=>defaults.find(t=>t.value===value)?.label||(value==='replacement_leave'?'Replacement Leave · retained Leave policy':'No default — decide during Payroll');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const load=async id=>id==='all'?Promise.all(activeEntities.map(async entity=>({entity,rows:await payrollService.readPhPolicy(entity.id)}))):payrollService.readPhPolicy(id);
  useEffect(()=>{setEntityId(selectedCompany);},[selectedCompany]);
  useEffect(()=>{let active=true;setVersions(null);setDraft(null);setError('');load(entityId).then(v=>{if(active)setVersions(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[entityId]);
  useEffect(()=>{let active=true;setStatutory(null);setStatutoryError('');
    const id=entityId==='all'?activeEntities[0]?.id:entityId;
    if(id)payrollService.readCompanyPhStatutory(id).then(result=>{if(active)setStatutory(result);}).catch(e=>{if(active)setStatutoryError(e.message);});
    return()=>{active=false;};},[entityId,entities]);
  const histories=entityId==='all'?(versions||[]):[{entity:activeEntities.find(e=>e.id===entityId),rows:versions||[]}];
  const current=histories.map(h=>h.rows.find(v=>v.effective_from<=today));
  const uniform=current.length>0&&current.every(v=>v&&v.treatment===current[0]?.treatment&&v.effective_from===current[0]?.effective_from);
  const save=async()=>{setBusy(true);setError('');try{if(entityId==='all')await payrollService.saveDefaultPhPolicy(draft);else await payrollService.savePhPolicy({entityId,...draft});setVersions(await load(entityId));setDraft(null);await onChanged?.();}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <Card className="space-y-3 p-4"><h3 className="font-bold">Default PH Pay Treatment</h3><p className="text-sm text-text-secondary">Preselect the treatment for Payroll review. Each holiday still requires confirmation.</p>
    <SelectField label="Company" value={entityId} onChange={onCompanyChanged || setEntityId} options={[...(!onCompanyChanged ? [{value:'all',label:'All applicable companies'}] : []),...activeEntities.map(e=>({value:e.id,label:e.display_name||e.name}))]}/>
    {versions===null&&!error?<p role="status">Loading policy…</p>:<p className="text-sm"><strong>{uniform?policyLabel(current[0].treatment==='replacement_leave'?'no_default':current[0].treatment):current.some(Boolean)?'Company-specific defaults':'No default — decide during Payroll'}</strong>{uniform&&` · Effective ${current[0].effective_from}`}</p>}
    {(uniform&&current[0].treatment==='additional_pay'||draft?.treatment==='additional_pay')&&<dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="font-semibold">Monthly</dt><dd>+1 ordinary day · Basic Salary ÷ 26</dd></div><div><dt className="font-semibold">Hourly</dt><dd>Approved PH Hours × Hourly Rate</dd></div></dl>}
    <section className="space-y-1 rounded-lg bg-surface-muted p-3 text-xs" aria-label="Company PH Allowance statutory treatment"><h4 className="font-semibold">Statutory Treatment · Company PH Allowance</h4>
      {statutory?<><dl className="flex flex-wrap gap-x-4 gap-y-1">{statutory.treatments.map(item=><div key={item.scheme}><dt className="inline font-semibold">{({epf:'EPF',socso:'SOCSO',lindung:'LINDUNG 24 Jam',eis:'EIS',pcb:'PCB / MTD'})[item.scheme]}: </dt><dd className="inline">{item.treatment==='included'?(item.scheme==='pcb'?'Taxable · manual confirmation':'Included'):'Not configured'}</dd></div>)}</dl><p className="text-text-secondary">Genuine overtime is classified separately. Employee statutory applicability determines whether contributions apply.</p></>:<p role={statutoryError?'alert':'status'}>{statutoryError||'Loading statutory treatment…'}</p>}
    </section>
    <details className="text-sm"><summary className="cursor-pointer text-primary">View history</summary>{histories.map(h=><div key={h.entity?.id}><p className="mt-2 font-semibold">{h.entity?.display_name||h.entity?.name}</p>{h.rows.map(v=><p key={v.id}>{v.effective_from} · {policyLabel(v.treatment)}{v.remark&&` · ${v.remark}`}</p>)}</div>)}<p className="mt-2 text-text-secondary">Replacement Leave grants and consumption remain in Leave history; they are not PH cash treatments.</p></details>
    {canManage&&versions&&!draft&&<button className="btn-secondary" onClick={()=>setDraft({date:'',treatment:uniform&&current[0].treatment!=='replacement_leave'?current[0].treatment:'no_default',remark:''})}>Change Default PH Pay Treatment</button>}
    {draft&&<section className="space-y-3 border-t border-border pt-3"><SelectField label="Default PH Pay Treatment" ariaLabel="Default PH Pay Treatment" value={draft.treatment} options={defaults} onChange={treatment=>setDraft(d=>({...d,treatment}))}/><DatePickerField label="Effective From" value={draft.date} onChange={date=>setDraft(d=>({...d,date}))}/><AdminFormField label="Remark (Optional)"><input className="control" value={draft.remark} onChange={e=>setDraft(d=>({...d,remark:e.target.value}))}/></AdminFormField><div className="flex gap-2"><button className="btn-secondary" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button><button className="btn-primary" disabled={busy||!draft.date} onClick={save}>{busy?'Saving…':'Save Default PH Pay Treatment'}</button></div></section>}
    {error&&<p role="alert">{error}</p>}
  </Card>;
}
