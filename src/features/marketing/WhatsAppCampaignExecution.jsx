import {useEffect,useRef,useState} from 'react';
import AdminSummaryGrid from '../../components/ui/AdminSummaryGrid.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import DatePickerField from '../../components/forms/DatePickerField.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import CampaignRecipientsTable from './CampaignRecipientsTable.jsx';
import WhatsAppMessagePreview from './WhatsAppMessagePreview.jsx';
import WhatsAppTemplateCatalog from './WhatsAppTemplateCatalog.jsx';
import {marketingService} from './marketingService.js';
import {outreachService} from './outreachService.js';
import {formatOperationalDateTime} from '../../lib/dateTime.js';

const labels={scheduled:'Scheduled',paused:'Paused',cancelled:'Cancelled',complete:'Complete',sending:'Sending',
 accepted:'Accepted by Meta',sent:'Sent',delivered:'Delivered',read:'Read',failed:'Failed',unknown:'Awaiting confirmation',suppressed:'Ineligible'};
const reasons={provider_outcome_unknown:'Awaiting a matching WhatsApp receipt.',
 recipient_ineligible:'Recipient is no longer eligible.',
 provider_token_invalid:'The WhatsApp connection needs attention.',
 provider_permission_required:'Check the WhatsApp connection and template approval.',
 provider_rate_limited:'WhatsApp limited the send rate.',
 provider_recipient_unavailable:'WhatsApp could not reach this recipient.',
 template_or_provider_unavailable:'Template or WhatsApp connection unavailable.'};
const deliveryStates=Object.fromEntries(Object.entries(labels).filter(([key])=>!['paused','complete'].includes(key)));

export default function WhatsAppCampaignExecution({organizationId,brandId,brandName,campaign,queuedTotal,queuedRecipients,queuePage,onQueuePageChange,connection,
 canSchedule,canExecute,renderHeader,renderInfo}){
 const [run,setRun]=useState(undefined),[page,setPage]=useState(1),[date,setDate]=useState(''),[time,setTime]=useState('');
 const [size,setSize]=useState(25),[readError,setReadError]=useState(''),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[dialog,setDialog]=useState(null);
 const pending=useRef(null);
 const ready=campaign.status==='ready';
 const scheduled=ready&&['scheduled','paused'].includes(run?.state);
 const canReschedule=canSchedule&&connection&&scheduled&&run.total>0&&run.counts.scheduled===run.total;
 useEffect(()=>{
  let active=true;
  const read=()=>outreachService.whatsappExecution(organizationId,brandId,campaign.id,page)
   .then(data=>{if(active){setRun(data);setReadError('');}}).catch(error=>{if(active)setReadError(error.message);});
  read();
  const timer=setInterval(read,30000);
  return()=>{active=false;clearInterval(timer);};
 },[organizationId,brandId,campaign.id,page,refresh]);
 function request(action,body){
  const fingerprint=JSON.stringify([action,body]);
  if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,id:crypto.randomUUID()};
  return pending.current.id;
 }
 function open(action){
  setError('');setDate('');setTime('');setDialog(action);
 }
 function changed(){
  pending.current=null;setDialog(null);setRefresh(value=>value+1);
 }
 async function schedule(template){
  if(!connection||!date||!time||!Number.isInteger(Number(size))||size<1||size>100){
   setError('Choose a schedule date, time and batch size from 1 to 100.');
   return false;
  }
  const body={organizationId,brandId,campaignId:campaign.id,revision:campaign.revision,
   connectionId:connection.id,generation:connection.generation,scheduledAt:`${date}T${time}:00+08:00`,batchSize:Number(size),
   dispatchConfirmed:true,template};
  setBusy(true);setError('');
  try{
   await marketingService.scheduleWhatsAppCampaign({...body,requestId:request('schedule',body)});
   changed();return true;
  }catch(failure){setError(failure.message);return false;}
  finally{setBusy(false);}
 }
 async function control(action){
  if(busy||!run)return;
  setBusy(true);setError('');
  const body={revision:campaign.revision,run_id:run.id};
  if(action==='reschedule'){
   body.dispatch_confirmed=true;
   body.previous_schedule=run.scheduled_at;
   body.scheduled_at=`${date}T${time}:00+08:00`;
  }
  try{
   await outreachService.whatsappExecutionCommand(organizationId,brandId,campaign.id,request(action,body),action,body);
   changed();
  }catch(failure){setError(failure.message);}
  finally{setBusy(false);}
 }
 const showingQueue=run===null&&ready;
 const rows=showingQueue?queuedRecipients.map(row=>({...row,state:row.eligible?'queued':'suppressed'})):run?.rows||[];
 const counts=run?.counts||{};
 const sent=(counts.sent||0)+(counts.delivered||0)+(counts.read||0);
 const delivered=(counts.delivered||0)+(counts.read||0);
 const summaryState=readError?'unavailable':run===undefined?'loading':'ready';
 const snapshot=run?.template_preview;
 const preview=Array.isArray(snapshot)&&snapshot.every(part=>part&&
  (part.text===undefined||typeof part.text==='string')&&
  (part.format===undefined||typeof part.format==='string')&&
  (part.buttons===undefined||Array.isArray(part.buttons)&&part.buttons.every(button=>typeof button?.text==='string')))
  ?snapshot:[];
 const actions=<>
  {ready&&run===null&&queuedTotal>0&&canSchedule&&connection&&<button className="btn-primary" onClick={()=>open('schedule')}>Schedule</button>}
  {canExecute&&scheduled&&run.state==='scheduled'&&run.dispatch_confirmed!==false&&<button className="btn-primary" disabled={busy} onClick={()=>control('pause')}>Pause</button>}
  {canExecute&&scheduled&&run.state==='paused'&&run.dispatch_confirmed!==false&&connection&&<button className="btn-primary" disabled={busy} onClick={()=>control('resume')}>Resume</button>}
  {canReschedule&&<button className={run.dispatch_confirmed===false?'btn-primary':'btn-secondary'} onClick={()=>open('reschedule')}>Reschedule</button>}
  {canExecute&&scheduled&&<button className="btn-secondary" onClick={()=>open('cancel')}>Cancel remaining</button>}
 </>;
 const scheduleFields=<div className="outreach-form-grid">
  <DatePickerField label="Schedule date (MYT)" value={date} onChange={setDate} disabled={busy}/>
  <AdminFormField label="Schedule time (MYT)"><input className="control" type="time" value={time} onChange={event=>setTime(event.target.value)} disabled={busy}/></AdminFormField>
  {dialog==='schedule'&&<AdminFormField label="Recipients per batch"><input className="control" type="number" min="1" max="100" value={size} onChange={event=>setSize(event.target.value)} disabled={busy}/></AdminFormField>}
 </div>;
 return <>
  {renderHeader(labels[run?.state||campaign.delivery_status],actions)}
  {readError&&<p role="alert" className="text-danger">{readError}</p>}
  {error&&!dialog&&<p role="alert" className="text-danger">{error}</p>}
  {ready&&(!run||run.state==='paused')&&!connection&&run!==undefined&&
   <p className="text-sm text-text-secondary">Verify the Brand’s WhatsApp connection before scheduling or resuming sends.</p>}
  {scheduled&&run.dispatch_confirmed===false&&<p className="text-sm text-text-secondary">Choose a new schedule to confirm sending for this saved run.</p>}
  <AdminSummaryGrid variant="compact" ariaLabel="WhatsApp delivery summary" items={[
   {key:'recipients',label:'Recipients',value:run?.total??queuedTotal,state:summaryState},
   {key:'sent',label:'Sent',value:sent,state:summaryState},
   {key:'delivered',label:'Delivered',value:delivered,state:summaryState},
   {key:'read',label:'Read',value:counts.read||0,state:summaryState},
   {key:'attention',label:'Needs attention',value:(counts.failed||0)+(counts.unknown||0)+(counts.suppressed||0),state:summaryState},
  ]}/>
  <div className="outreach-campaign-layout">
   <section className="card p-4 space-y-3 min-w-0" aria-label="Campaign message preview">
    <h2 className="text-base font-semibold">Message preview</h2>
    <WhatsAppMessagePreview brandName={brandName} components={preview}
     emptyBody={run?'The original template preview is unavailable for this run.':'Choose an approved WhatsApp template when scheduling.'}/>
   </section>
   {renderInfo(run?.sender||connection?.name||'No authorized Brand connection',run?.scheduled_at&&formatOperationalDateTime(run.scheduled_at)+' MYT')}
  </div>
  <CampaignRecipientsTable rows={rows} statuses={showingQueue?{queued:'Queued',suppressed:'Ineligible'}:deliveryStates}
   total={showingQueue?queuedTotal:run?.total||0} page={showingQueue?queuePage:page} pageSize={showingQueue?50:20}
   onPageChange={showingQueue?onQueuePageChange:setPage} loading={run===undefined&&!readError}
   emptyMessage={readError?'Delivery details are unavailable.':showingQueue?'No recipients are queued for this campaign.':'Recipients will appear once the campaign queue is prepared.'} columns={[
    {key:'display_name',header:'Recipient',render:row=>row.display_name||'Unavailable'},
    {key:'state',header:'Delivery',render:row=><Badge tone={['sent','delivered','read'].includes(row.state)?'success':['failed','unknown','suppressed'].includes(row.state)?'warning':'neutral'}>{row.state==='queued'?'Queued':labels[row.state]||'Unavailable'}</Badge>},
    {key:'due_at',header:'Scheduled (MYT)',render:row=>row.due_at?formatOperationalDateTime(row.due_at):'—'},
    {key:'result',header:'Result',render:row=><>{row.reason?(reasons[row.reason]||'Check delivery status.'):null}{row.reply_conversation_id&&<a className="btn-secondary" href={`/marketing/whatsapp-chat?marketing_org=${organizationId}&marketing_brand=${brandId}&conversation_id=${row.reply_conversation_id}`}>Open reply</a>}{!row.reason&&!row.reply_conversation_id?'—':null}</>},
   ]}/>
  {dialog&&<Modal title={dialog==='cancel'?'Cancel remaining recipients':dialog==='reschedule'?'Reschedule campaign':'Schedule campaign'}
   size={dialog==='schedule'?'lg':'sm'} onClose={()=>{if(!busy)setDialog(null);}}
   footer={dialog!=='schedule'&&<button className="btn-primary" disabled={busy||(dialog==='reschedule'&&(!date||!time))} onClick={()=>control(dialog)}>
    {dialog==='cancel'?'Cancel remaining recipients':'Confirm new schedule'}
   </button>}>
   {error&&<p role="alert" className="text-danger">{error}</p>}
   {dialog==='cancel'?<p>Cancel sends that have not started. Existing delivery history remains available.</p>:scheduleFields}
   {dialog==='schedule'&&connection&&<WhatsAppTemplateCatalog purpose="campaign" brandName={brandName} submitLabel="Confirm and schedule"
    loadTemplates={()=>marketingService.whatsappTemplates({organizationId,brandId,connectionId:connection.id,generation:connection.generation})} onSend={schedule}/>}
  </Modal>}
 </>;
}
