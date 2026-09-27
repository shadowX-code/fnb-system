import { useEffect, useRef, useState } from 'react';
import { payrollService } from '../../../services/payrollService.js';
import AdminFormField from '../../../components/forms/AdminFormField.jsx';
import DatePickerField from '../../../components/forms/DatePickerField.jsx';
import SelectField from '../../../components/forms/SelectField.jsx';
import Badge from '../../../components/ui/Badge.jsx';

const money = value => value == null ? '—' : new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(Number(value));
const status = {unpaid:'Unpaid',partially_paid:'Partially Paid',paid:'Paid',recovery_required:'Overpaid · Recovery Required'};
export default function PayrollPayslipPayment({ runId, employeeId }) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pdf,setPdf]=useState(null),[editing,setEditing]=useState(false);
 const [form,setForm]=useState({kind:'payment',amount:'',date:new Date().toLocaleDateString('en-CA'),reference:'',remark:''});
 const request=useRef(null);
 async function load() { setError(''); try { setData(await payrollService.readPayment(runId,employeeId)); } catch(e){setError(e.message);} }
 useEffect(()=>{let active=true;setData(null);setPdf(null);setError('');payrollService.readPayment(runId,employeeId).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[runId,employeeId]);
 async function open() {setBusy(true);setError('');try{setPdf(await payrollService.openPayslip({runId,employeeId}));await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function save(event) {event.preventDefault();setBusy(true);setError('');if(!request.current)request.current=crypto.randomUUID();try{await payrollService.recordPayment({...form,runId,employeeId,requestId:request.current});request.current=null;setEditing(false);await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
 function update(key,value){setForm(old=>({...old,[key]:value}));request.current=null;}
 const settlement=data?.settlement;
 return <section className="border-t border-border pt-4"><div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-bold">Payslip & Payment</h4>
  <button type="button" className="btn-secondary" disabled={busy || !data?.payslip_available} onClick={open}>{busy?'Opening…':'View Payslip'}</button></div>
  {data && !data.payslip_available && <p className="mt-2 text-sm text-text-secondary">Frozen payslip identity is unavailable for this older revision. Payroll evidence remains retained.</p>}
  {pdf && <div className="mt-3"><a className="font-semibold text-primary" href={pdf.download_url} target="_blank" rel="noreferrer">Download Final Payslip</a><iframe title="Final Payslip" className="mt-3 h-[32rem] w-full rounded-lg border border-border" src={pdf.document_url} /><p className="text-xs text-text-secondary">Private link expires after one minute. View Payslip again to renew access.</p></div>}
  {error && <div role="alert" className="mt-3 text-sm text-rose-700">{error}<button type="button" className="ml-2 underline" onClick={load}>Refresh</button></div>}
  {!data && !error && <p role="status" className="mt-3 text-sm">Loading payment evidence…</p>}
  {settlement && <><p className="mt-3"><Badge tone={settlement.status==='paid'?'success':settlement.status==='recovery_required'?'warning':'neutral'}>{status[settlement.status]}</Badge></p>
   {!data.current && <p className="mt-2 text-sm text-text-secondary">Historical remuneration. Settlement below relates to the current authoritative result for this period.</p>}
   <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[['Amount Due',settlement.amount_due],['Paid',settlement.paid_amount],['Outstanding',settlement.outstanding_amount],['Overpaid',settlement.overpaid_amount]].map(([label,value])=><div key={label}><dt className="text-text-secondary">{label}</dt><dd className="font-semibold tabular-nums">{money(value)}</dd></div>)}</dl>
   {Number(settlement.entitlement_change)!==0 && <p className="mt-3 text-sm">Corrected entitlement change: {money(settlement.entitlement_change)} · Settlement difference: {money(settlement.settlement_difference)}</p>}
   <p className="mt-2 text-xs text-text-secondary">Record evidence of payment or recovery already made. FeedX does not transfer money.</p>
   {data.can_record && !editing && <button className="btn-secondary mt-3" type="button" onClick={()=>setEditing(true)}>Record Settlement</button>}
   {editing && data.can_record && <form onSubmit={save} className="mt-4 space-y-3">
    <SelectField label="Evidence Type" value={form.kind} onChange={value=>update('kind',value)} options={[{value:'payment',label:'Payment made'},{value:'recovery',label:'Overpayment recovered'}]} />
    <AdminFormField label="Amount" required><input className="input" inputMode="decimal" value={form.amount} onChange={e=>update('amount',e.target.value)} required /></AdminFormField>
    <DatePickerField label="Payment Date" value={form.date} onChange={value=>update('date',value)} required />
    <AdminFormField label="Reference (Optional)"><input className="input" maxLength={300} value={form.reference} onChange={e=>update('reference',e.target.value)} /></AdminFormField>
    <AdminFormField label="Remark (Optional)"><input className="input" maxLength={1000} value={form.remark} onChange={e=>update('remark',e.target.value)} /></AdminFormField>
    <div className="flex gap-2"><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setEditing(false)}>Cancel</button><button className="btn-primary" disabled={busy || !(Number(form.amount)>0)}>{busy?'Recording…':'Record Evidence'}</button></div>
   </form>}
   <details className="mt-4 text-sm"><summary className="cursor-pointer">Payment history · {settlement.entries.length}</summary><div className="mt-2 divide-y divide-border">{settlement.entries.map(entry=><div key={entry.id} className="flex justify-between gap-3 py-2"><span>{entry.payment_date} · {entry.kind}<small className="block text-text-secondary">{entry.reference || entry.remark}</small></span><strong className="tabular-nums">{money(entry.amount)}</strong></div>)}</div></details>
  </>}
 </section>;
}
