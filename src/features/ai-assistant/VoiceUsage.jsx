import {useEffect,useState,useRef} from 'react';
import {assistantCall} from './nativeAssistantService.js';
export default function VoiceUsage({onSaved}={}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[enabled,setEnabled]=useState(false),[daily,setDaily]=useState(''),[seconds,setSeconds]=useState(180),[concurrency,setConcurrency]=useState(4);
 const epoch=useRef(0);
 async function load(){const n=++epoch.current;try{const r=await assistantCall('voice_usage');if(!r?.policy||!Array.isArray(r.sessions))throw new Error('Voice policy is unavailable.');if(n===epoch.current){setData(r);setEnabled(r.policy.enabled);setDaily(r.policy.per_user_daily_sessions??'');setSeconds(r.policy.max_seconds);setConcurrency(r.policy.max_concurrent_sessions);}}catch(e){if(n===epoch.current)setError(e.message);}}
 useEffect(()=>{void load();return()=>{epoch.current++;};},[]);
 async function save(e){e.preventDefault();setBusy(true);setError('');try{await assistantCall('voice_policy_save',{revision:data.policy.revision,enabled,maximum_seconds:seconds,concurrency,daily_sessions:daily===''?null:Number(daily)});await load();await onSaved?.();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="assistant-usage"><h3>Voice usage · Staging</h3>
 {error&&<p role="alert">{error}</p>}{!data?<p role="status">{error?'Voice policy unavailable.':'Loading voice policy…'}</p>:<>
 <p>{data.policy.enabled?'Development voice enabled':'Voice disabled'} · Text remains available.</p>
 <p>No fixed evaluation allowance or individual approval is required by default. Provider billing and rate limits still apply. Production remains disabled.</p>
 <p>One active session per user · {data.policy.max_concurrent_sessions} environment slots · {data.policy.max_seconds}s maximum. Expired and revoked calls are closed by the server cleanup worker.</p>
 {data.can_edit&&<form onSubmit={save}>
 <label className="assistant-memory-toggle"><input type="checkbox" className="admin-checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Enable Staging voice</label>
 <label>Maximum session (seconds)<input className="control" type="number" min="30" max="180" required value={seconds} onChange={e=>setSeconds(e.target.valueAsNumber)}/></label>
 <label>Concurrent environment sessions<input className="control" type="number" min="1" max="8" required value={concurrency} onChange={e=>setConcurrency(e.target.valueAsNumber)}/></label>
 <label>Optional daily sessions per user<input className="control" type="number" min="0" max="100" placeholder="No daily limit" value={daily} onChange={e=>setDaily(e.target.value)}/></label>
 <button className="btn-secondary" disabled={busy}>Save limits</button></form>}
 <details><summary>Session accounting · {data.sessions.length} recent records</summary><p>New session duration uses server connection and termination timestamps. Token totals are available provider observations reported by the browser, not finalized charges. Missing costs remain unavailable.</p><ul>{data.sessions.map(s=><li key={s.request_id}>{new Date(s.created_at).toLocaleString()} · {s.provider} · {s.state||'Historical evaluation'} · {s.observed_duration_seconds??'Unknown'}s · {s.reason||'No end reason'}{s.observed_usage?.input_audio_tokens!=null&&<> · Audio tokens {s.observed_usage.input_audio_tokens} in / {s.observed_usage.output_audio_tokens} out</>} · Cost unavailable</li>)}</ul></details>
 </>}
 </section>;
}
