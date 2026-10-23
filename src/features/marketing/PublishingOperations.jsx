import {useState} from 'react';
import Badge from '../../components/ui/Badge.jsx';
import DateTimePickerField from '../../components/forms/DateTimePickerField.jsx';
import {contentStatusLabel} from './contentManagement.js';
import {localInput,scheduleInstant} from './marketingCalendar.js';
const labels={reschedule_channel:'Reschedule',cancel_channel:'Cancel channel',recover_channel:'Prepare recovery'};
export default function PublishingOperations({content,can,command,busy=false}){
 const [intent,setIntent]=useState(null),[local,setLocal]=useState(''),[error,setError]=useState('');
 const channels=(content.channels||[]).filter(c=>c.job_id);
 if(!channels.length)return null;
 return <section className="cm-publishing-operations" aria-label="Channel executions"><h3>Channel executions</h3>
 {channels.map(channel=><div className="cm-execution" key={channel.job_id}><div className="cm-execution-heading"><strong>{contentStatusLabel(channel.channel)}</strong><Badge tone={channel.job_state==='succeeded'?'success':channel.job_state==='failed'||channel.job_state==='reconciling'?'danger':'neutral'}>{contentStatusLabel(channel.status)}</Badge></div>
 <p className="cm-muted">{channel.job_state==='succeeded'?'Verified publication · successful result is preserved':channel.job_state==='blocked'?'Execution approval required':channel.job_state==='retry'?'Waiting for the next bounded attempt':channel.job_state==='leased'?'Publishing in progress':channel.operations?.recovery_reason||'Publishing schedule saved'}</p>
 {channel.error_code?<p className="cm-muted">{channel.error_code.replaceAll('_',' ')}</p>:null}
 {channel.scheduled_at?<time className="cm-muted">{new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(channel.scheduled_at))} · Asia/Kuala_Lumpur</time>:null}
 <div className="cm-actions">{[['reschedule_channel','can_reschedule','marketing_content.publish'],['cancel_channel','can_cancel','marketing_content.cancel'],['recover_channel','can_recover','marketing_content.publish']].filter(([action,key,permission])=>channel.operations?.[key]&&can(permission)&&(action!=='recover_channel'||can('marketing_content.execute'))).map(([action])=><button type="button" className="btn-secondary" key={action} disabled={busy} onClick={()=>{setError('');setLocal(channel.scheduled_at?localInput(new Date(channel.scheduled_at),'Asia/Kuala_Lumpur'):'');setIntent({channel,action})}}>{labels[action]}</button>)}</div>
 </div>)}
 {intent?<div className="cm-operation-confirm" role="region" aria-label={`${labels[intent.action]} ${contentStatusLabel(intent.channel.channel)}`}><strong>{labels[intent.action]} · {contentStatusLabel(intent.channel.channel)}</strong><p className="text-sm">{intent.action==='cancel_channel'?'Cancel only this uncompleted channel. Published posts and original media are retained.':intent.action==='recover_channel'?'Retain this revision and its preparation evidence. Resolve the reported issue first. Recovery stays blocked until you approve external execution again.':'Save a new time for this channel. Its current execution approval is cleared; the approved content revision and other channel results stay unchanged.'}</p>
 {intent.action==='reschedule_channel'?<DateTimePickerField label="New publishing time" timezone="Asia/Kuala_Lumpur" value={local} onChange={setLocal}/>:null}
 {error?<p role="alert">{error}</p>:null}<div className="cm-actions"><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setIntent(null)}>Back</button><button type="button" className="btn-primary" disabled={busy} onClick={()=>{try{const payload={job_id:intent.channel.job_id,expected_updated_at:intent.channel.job_updated_at,confirm:true,...(intent.action==='reschedule_channel'?{scheduled_at:scheduleInstant(local,'Asia/Kuala_Lumpur'),timezone:'Asia/Kuala_Lumpur'}:{})};command(intent.action,content,payload)}catch(e){setError(e.message)}}}>{busy?'Saving…':`Confirm ${labels[intent.action].toLowerCase()}`}</button></div></div>:null}
 </section>;
}
