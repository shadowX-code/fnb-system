import {useState} from 'react';
import {outreachService} from './outreachService.js';

export default function WhatsAppCampaignRehearsal({organizationId,brandId,campaign}){
 const [date,setDate]=useState(''),[time,setTime]=useState(''),[batchSize,setBatchSize]=useState(25);
 const [busy,setBusy]=useState(false),[result,setResult]=useState(null),[error,setError]=useState('');
 const clear=()=>{setResult(null);setError('');};
 async function run(event){
  event.preventDefault();
  if(busy)return;
  setBusy(true);clear();
  try{
   setResult(await outreachService.whatsappRehearsal(organizationId,brandId,campaign,
    `${date}T${time}:00+08:00`,Number(batchSize)));
  }catch(error){setError(error.message);}
  finally{setBusy(false);}
 }
 return <details className="outreach-evidence">
  <summary>Rehearse Cloud API batches</summary>
  <p>Check the current approved queue and recipient consent against a proposed schedule. This rehearsal does not schedule or dispatch messages.</p>
  <form className="flex flex-wrap items-end gap-2" onSubmit={run}>
   <label>Proposed date (MYT)<input required className="control block" type="date" value={date} disabled={busy} onChange={event=>{setDate(event.target.value);clear();}}/></label>
   <label>Proposed time (MYT)<input required className="control block" type="time" value={time} disabled={busy} onChange={event=>{setTime(event.target.value);clear();}}/></label>
   <label>Recipients per batch<input required className="control block" type="number" min="1" max="100" value={batchSize} disabled={busy} onChange={event=>{setBatchSize(event.target.value);clear();}}/></label>
   <button className="btn-secondary" disabled={busy||!date||!time||!batchSize}>{busy?'Checking…':'Rehearse batches'}</button>
  </form>
  {result&&<p role="status">{result.eligible} eligible of {result.queued} queued · {result.excluded} excluded · {result.batches} batches · Dispatch disabled</p>}
  {error&&<p role="alert">{error}</p>}
 </details>;
}
