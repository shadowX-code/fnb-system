import {useEffect,useState,useRef} from 'react';
import {assistantCall} from './nativeAssistantService.js';
export default function VoiceUsage(){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reason,setReason]=useState(''),[cents,setCents]=useState(1),[budget,setBudget]=useState(0),[daily,setDaily]=useState(0);
 const epoch=useRef(0);
 async function load(){const n=++epoch.current;try{const r=await assistantCall('voice_usage');if(!r?.policy||!Array.isArray(r.adjustments)||!Array.isArray(r.sessions))throw new Error('Voice policy is unavailable. Refresh to try again.');if(n===epoch.current){setData(r);setBudget(r.policy.monthly_budget_cents);setDaily(r.policy.per_user_daily_sessions);}}catch(e){if(n===epoch.current)setError(e.message);}}
 useEffect(()=>{void load();return()=>{epoch.current++;};},[]);
 async function run(action,payload){setBusy(true);setError('');try{await assistantCall(action,payload);await load();setReason('');}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="assistant-usage"><h3>Voice usage · Staging</h3>
 {error&&<p role="alert">{error}</p>}{!data?<p role="status">{error?'Voice policy unavailable.':'Loading voice policy…'}</p>:<>
 <p>Approval required · {data.remaining} calls available. Text conversations remain available.</p>
 <p>Monthly budget: US${(data.policy.monthly_budget_cents/100).toFixed(2)} · Approved ceiling: US${(data.policy.approved_ceiling_cents/100).toFixed(2)} · Maximum session: {data.policy.max_seconds}s.</p>
 <p>{data.reset_condition} Production is not activated. Browser timers do not impose a provider spending cap.</p>
 {data.can_edit&&<form onSubmit={e=>{e.preventDefault();void run('voice_policy_save',{revision:data.policy.revision,budget_cents:budget,daily_sessions:daily});}}>
 <label>Monthly budget (US cents)<input className="control" type="number" min="0" max={data.policy.approved_ceiling_cents} required value={budget} onChange={e=>setBudget(e.target.valueAsNumber)}/></label>
 <label>Per-user daily sessions<input className="control" type="number" min="0" max="100" required value={daily} onChange={e=>setDaily(e.target.valueAsNumber)}/></label>
 <button className="btn-secondary" disabled={busy}>Save limits</button></form>}
 <form onSubmit={e=>{e.preventDefault();void run('voice_allowance_request',{cents,reason});}}>
 <label>Requested allowance (US cents)<input className="control" type="number" min="1" max="10000" required value={cents} onChange={e=>setCents(e.target.valueAsNumber)}/></label>
 <label>Reason<input className="control" required minLength={4} maxLength={160} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <button className="btn-secondary" disabled={busy}>Request approval</button></form>
 <ul>{data.adjustments.map(a=><li key={a.id}>{a.reason} · US${(a.requested_cents/100).toFixed(2)} · {a.state}
 {data.can_edit&&a.state==='pending'&&<span><button className="btn-secondary" disabled={busy||!data.policy.enabled||!data.policy.enforcement_verified||a.requested_cents>data.policy.monthly_budget_cents} onClick={()=>run('voice_allowance_review',{id:a.id,decision:'approved'})}>Approve</button><button className="btn-secondary" disabled={busy} onClick={()=>run('voice_allowance_review',{id:a.id,decision:'denied'})}>Deny</button></span>}</li>)}</ul>
 <details><summary>Session accounting · {data.sessions.length} recent records</summary><p>Duration is observed reservation time, not verified audio duration. Missing provider usage and estimated cost remain unavailable; these are not finalized charges.</p><ul>{data.sessions.map(s=><li key={s.request_id}>{new Date(s.created_at).toLocaleString()} · {s.provider} · {s.observed_duration_seconds??'Unknown'}s · {s.sdk_connected_at?'Connection observed':'No connection recorded'} · Cost unavailable</li>)}</ul></details>
 </>}
 </section>;
}
