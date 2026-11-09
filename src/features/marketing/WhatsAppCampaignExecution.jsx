import {useEffect,useRef,useState} from 'react';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import WhatsAppTemplateCatalog from './WhatsAppTemplateCatalog.jsx';
import {marketingService} from './marketingService.js';
import {outreachService} from './outreachService.js';
import {formatOperationalDateTime} from '../../lib/dateTime.js';

const labels={scheduled:'Scheduled',paused:'Paused',cancelled:'Cancelled',complete:'Complete',sending:'Sending',
 accepted:'Provider accepted',sent:'Sent',delivered:'Delivered',read:'Read',failed:'Failed',unknown:'Unknown outcome',suppressed:'Suppressed'};
const reasons={provider_outcome_unknown:'Awaiting a matching provider receipt. Do not resend.',
 recipient_ineligible:'Recipient consent, identity, opt-out or test allowlist no longer permits delivery.',
 provider_token_invalid:'Reconnect the test WhatsApp credential.',
 provider_permission_required:'Check Meta permissions and template approval.',
 provider_rate_limited:'Meta rate-limited the attempt.',
 provider_recipient_unavailable:'Meta rejected the recipient.',
 template_or_provider_unavailable:'Check the current Meta template, credential and provider availability.'};
export default function WhatsAppCampaignExecution({organizationId,brandId,campaign,canSchedule,canExecute}){
 const [run,setRun]=useState(undefined),[page,setPage]=useState(1),[date,setDate]=useState(''),[time,setTime]=useState('');
 const [size,setSize]=useState(25),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const pending=useRef(null),connection=useRef(null);
 const canReschedule=canSchedule&&['scheduled','paused'].includes(run?.state)&&run.total>0&&run.counts.scheduled===run.total;
 useEffect(()=>{
  let active=true;
  const read=()=>outreachService.whatsappExecution(organizationId,brandId,campaign.id,page)
   .then(data=>{if(active)setRun(data);}).catch(error=>{if(active)setError(error.message);});
  read();
  const timer=setInterval(read,30000);
  return()=>{active=false;clearInterval(timer);};
 },[organizationId,brandId,campaign.id,page,refresh]);
 function request(action,body){
  const fingerprint=JSON.stringify([action,body]);
  if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,id:crypto.randomUUID()};
  return pending.current.id;
 }
 async function loadTemplates(){
  const result=await marketingService.whatsappConnections(organizationId,brandId);
  const active=result.connections?.find(item=>item.onboarding_mode==='cloud_api'&&
   (item.state==='connected'||item.reason==='awaiting_test_inbound'));
  if(!active)throw new Error('Verify the current Staging WhatsApp test connection before scheduling.');
  connection.current=active;
  return marketingService.whatsappTemplates({organizationId,brandId,connectionId:active.id,generation:active.credential_generation});
 }
 async function schedule(template){
  if(!date||!time||!size){setError('Choose a proposed date, time and batch size.');return false;}
  const body={organizationId,brandId,campaignId:campaign.id,revision:campaign.revision,
   connectionId:connection.current.id,generation:connection.current.credential_generation,
   scheduledAt:`${date}T${time}:00+08:00`,batchSize:Number(size),template};
  setError('');
  try{
   await marketingService.scheduleWhatsAppCampaign({...body,requestId:request('schedule',body)});
   pending.current=null;setRefresh(n=>n+1);return true;
  }catch(error){setError(error.message);return false;}
 }
 async function control(action){
  if(busy)return;
  setBusy(true);setError('');
  const body={revision:campaign.revision,run_id:run.id};
  if(action==='reschedule'){
   body.previous_schedule=run.scheduled_at;
   body.scheduled_at=`${date}T${time}:00+08:00`;
  }
  try{
   await outreachService.whatsappExecutionCommand(organizationId,brandId,campaign.id,request(action,body),action,body);
   pending.current=null;setRefresh(n=>n+1);
  }catch(error){setError(error.message);}
  finally{setBusy(false);}
 }
 return <details className="outreach-evidence">
  <summary>WhatsApp Cloud API execution</summary>
  <p>Scheduling saves the approved recipient batches. Real bulk dispatch requires a separate Staging permit.</p>
  {error&&<p role="alert">{error}</p>}
  {run===undefined&&<p role="status">Checking campaign execution…</p>}
  {run===null&&canSchedule&&campaign.status==='ready'&&<>
   <div className="flex flex-wrap items-end gap-2">
    <label>Schedule date (MYT)<input className="control block" type="date" value={date} onChange={event=>setDate(event.target.value)}/></label>
    <label>Schedule time (MYT)<input className="control block" type="time" value={time} onChange={event=>setTime(event.target.value)}/></label>
    <label>Recipients per batch<input className="control block" type="number" min="1" max="100" value={size} onChange={event=>setSize(event.target.value)}/></label>
   </div>
   <WhatsAppTemplateCatalog purpose="campaign" submitLabel="Save approved schedule" loadTemplates={loadTemplates} onSend={schedule}/>
  </>}
  {run===null&&(!canSchedule||campaign.status!=='ready')&&<p>No Cloud API schedule. Scheduling requires the current approved queue and Campaign execution and approval access.</p>}
  {run&&<>
   <p>{labels[run.state]} · {formatOperationalDateTime(run.scheduled_at)} MYT · {run.batch_size} recipients per batch</p>
   <p role="status">{Object.entries(run.counts).map(([state,count])=>`${labels[state]||state} ${count}`).join(' · ')}</p>
   {canExecute&&['scheduled','paused'].includes(run.state)&&<div className="flex flex-wrap gap-2">
    <button className="btn-secondary" disabled={busy} onClick={()=>control(run.state==='paused'?'resume':'pause')}>{run.state==='paused'?'Resume schedule':'Pause schedule'}</button>
    <button className="btn-secondary" disabled={busy} onClick={()=>control('cancel')}>Cancel remaining recipients</button>
   </div>}
   {canReschedule&&<div className="flex flex-wrap items-end gap-2">
    <label>New schedule date (MYT)<input className="control block" type="date" value={date} onChange={event=>setDate(event.target.value)}/></label>
    <label>New schedule time (MYT)<input className="control block" type="time" value={time} onChange={event=>setTime(event.target.value)}/></label>
    <button className="btn-secondary" disabled={busy||!date||!time} onClick={()=>control('reschedule')}>Reschedule existing run</button>
   </div>}
   <ul className="mt-2 space-y-2" aria-label="Campaign recipient execution">
    {run.rows.map(row=><li key={row.id} className="break-words border-b border-border-default pb-2">
     <strong>{row.display_name}</strong> · Batch {row.batch} · {labels[row.state]||row.state}
     <p>{formatOperationalDateTime(row.due_at)} MYT</p>
     {row.reason&&<p>{reasons[row.reason]||'Provider reported a delivery failure.'}</p>}
     {row.provider_message_id&&<details><summary>Provider receipt</summary><code>{row.provider_message_id}</code></details>}
     {row.reply_conversation_id&&<a href={`/marketing/whatsapp-chat?marketing_org=${organizationId}&marketing_brand=${brandId}&conversation_id=${row.reply_conversation_id}`}>Open attributed reply</a>}
    </li>)}
   </ul>
   <AdminPagination page={page} pageSize={20} total={run.total} onPageChange={setPage}/>
  </>}
 </details>;
}
