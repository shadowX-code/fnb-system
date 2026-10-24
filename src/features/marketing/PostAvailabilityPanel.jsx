import {useEffect,useRef,useState} from 'react';
import {AlertTriangle,CheckCircle2,EyeOff} from 'lucide-react';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/feedback/ConfirmDialog.jsx';
import {marketingService} from './marketingService.js';
import {liveAvailabilityInfo} from './postAvailability.js';
import {contentTimestamp} from './contentManagement.js';

export default function PostAvailabilityPanel({channel,canManage=false,onChanged}){
 const [record,setRecord]=useState(channel.availability),[confirm,setConfirm]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(null),sending=useRef(false),identity=`${channel.connection_id}:${channel.provider_post_id}`,active=useRef(identity);active.current=identity;
 useEffect(()=>{active.current=identity;return()=>{active.current=null;};},[identity]);
 useEffect(()=>{setRecord(channel.availability);setError('');setConfirm(null);pending.current=null;},[identity,channel.availability]);
 if(!channel.provider_post_id)return null;
 const info=liveAvailabilityInfo(record),manual=record?.manual_confirmation,hasManual=manual&&manual.state!=='cleared';
 const Icon=['deleted','manually_removed'].includes(record?.state)?EyeOff:info.tone==='success'?CheckCircle2:AlertTriangle;
 async function save(){
  if(sending.current)return;
  sending.current=true;setBusy(true);setError('');const expected=identity;
  try{
   const result=await marketingService.publicationAvailability(pending.current.id,channel.connection_id,channel.provider_post_id,record?.manual_revision||0,pending.current.command);
   if(active.current!==expected)return;
   setRecord(result);setConfirm(null);pending.current=null;onChanged?.(result);
  }catch(e){if(active.current===expected){setError(e.message);setConfirm(null);}}finally{sending.current=false;if(active.current===expected)setBusy(false);}
 }
 function ask(command){pending.current=pending.current?.command===command?pending.current:{id:crypto.randomUUID(),command};setConfirm(command);}
 return <section className={`cm-live-panel cm-live-${info.tone}`} aria-label="Current Meta availability">
  <div className="cm-live-heading"><Icon size={18} aria-hidden="true"/><Badge tone={info.tone}>{info.label}</Badge></div>
  <p>{info.help}</p>
  {manual?<p className="cm-live-provenance">Staff confirmation: {manual.actor_name||'Authorized staff'} · {contentTimestamp(manual.at)}{manual.state==='cleared'?' · Cleared':manual.state==='conflict'?' · Conflicting provider evidence':''}</p>:null}
  {record?.checked_at?<p className="cm-live-provenance">Provider evidence: {contentTimestamp(record.checked_at)}{record.source==='signed_page_feed_remove'?' · Signed removal event':''}</p>:null}
  {error?<p role="alert">{error}</p>:null}
  {canManage&&channel.connection_id?<div className="cm-live-actions">
   {!hasManual&&record?.state!=='deleted'?<button type="button" className="btn-secondary" disabled={busy} onClick={()=>ask('mark_removed')}>Mark as Removed</button>:null}
   {hasManual?<button type="button" className="btn-secondary" disabled={busy} onClick={()=>ask('clear_manual')}>Clear manual confirmation</button>:null}
   {busy?<span role="status">Saving confirmation…</span>:null}
  </div>:null}
  <ConfirmDialog request={confirm?{title:confirm==='mark_removed'?'Confirm removal in Meta?':'Clear staff removal confirmation?',message:confirm==='mark_removed'?'Confirm that you manually deleted this channel’s post in Meta. FeedX records your name and time; it does not delete anything in Meta or change the publication receipt. Fully confirmed removed posts are hidden from Calendar by default.':'This clears only staff confirmation. Provider evidence, publication receipts and historical Insights remain unchanged.',confirmLabel:confirm==='mark_removed'?'Mark as Removed':'Clear confirmation'}:null} onCancel={()=>{if(!busy)setConfirm(null)}} onConfirm={save}/>
 </section>;
}
