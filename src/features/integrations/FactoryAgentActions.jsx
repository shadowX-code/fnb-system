import hrManifest from '../../../config/hrAgentActions.json';
import {useCallback,useEffect,useRef,useState} from 'react';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/feedback/ConfirmDialog.jsx';
import {formatOperationalMoment} from '../../lib/dateTime.js';
import {externalAgentService} from '../../services/externalAgentService.js';
import {actionLabels,executionPolicyLabels} from '../../components/permissions/capabilityActions.js';
import factoryManifest from '../../../config/factoryAgentActions.json';
import restaurantManifest from '../../../config/restaurantAgentActions.json';
const actionManifest=[...factoryManifest,...restaurantManifest,...hrManifest];
import {agentBusinessModule} from './agentBusinessModule.js';

const activeStates = new Set(['pending_approval','awaiting_execution','needs_resolution']);
const labels = {pending_approval:'Pending Human Approval',awaiting_execution:'Awaiting Agent Execution',needs_resolution:'Needs Resolution',legacy_pending:'Legacy Pending Request',completed:'Completed',expired:'Expired',rejected:'Rejected'};
export default function FactoryAgentActions({identityId,canManage,history=false,onViewActivity}) {
 const [rows,setRows]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState(null),[reference,setReference]=useState(''),[confirm,setConfirm]=useState(false),[copied,setCopied]=useState(null);
 const generation=useRef(0), flight=useRef(null);
 async function copyRetry(row){try{await navigator.clipboard.writeText(JSON.stringify({request_id:row.request_id,action:row.action,target_id:row.target_id,expected_version:row.expected_version,input:row.input},null,2));setCopied(row.request_id);}catch{setError('Copy failed. Use the exact request details for the Agent continuation.');}}
 const refresh=useCallback(async()=>{
  if(flight.current) return flight.current;
  const current=generation.current;
  setBusy(true);
  const request=externalAgentService.actionRequests(identityId).then(data=>{
   if(current===generation.current){setRows(data);setError('');setSelected(previous=>data.find(row=>row.request_id===previous?.request_id&&row.queue_state==='pending_approval'&&row.can_confirm)||null);}
  }).catch(cause=>{if(current===generation.current)setError(cause.message);}).finally(()=>{if(current===generation.current){flight.current=null;setBusy(false);}});
  flight.current=request;
  return request;
 },[identityId]);
 useEffect(()=>{
  generation.current++;flight.current=null;setRows(null);setError('');setSelected(null);setReference('');setConfirm(false);refresh();
  const update=()=>{if(document.visibilityState==='visible')refresh();};
  const timer=history?null:setInterval(update,30000);
  if(!history){document.addEventListener('visibilitychange',update);window.addEventListener('focus',update);}
  return()=>{generation.current++;if(timer)clearInterval(timer);document.removeEventListener('visibilitychange',update);window.removeEventListener('focus',update);};
 },[refresh,history]);
 async function save(){if(!selected)return;const current=generation.current;setBusy(true);setError('');setConfirm(false);try{await externalAgentService.confirmAction(identityId,selected.request_id,reference.trim());if(current!==generation.current)return;setSelected(null);setReference('');await refresh();}catch(cause){if(current===generation.current)setError(cause.message);}finally{if(current===generation.current)setBusy(false);}}
 const visible=rows?.filter(row=>history?!activeStates.has(row.queue_state):activeStates.has(row.queue_state));
 const unsupported=rows?.some(row=>!labels[row.queue_state]);
 return <section aria-label={history?'Request history':'Action Requests'} className="space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="external-agent-heading">{history?'Request history':'Action Requests'}</h3><div className="flex gap-2">{onViewActivity&&<button className="btn-secondary" type="button" onClick={onViewActivity}>View Activity</button>}<button className="btn-secondary" type="button" disabled={busy} onClick={refresh}>Check requests</button></div></div>
  <p className="text-sm text-text-secondary">{history?'Saved request evidence, including legacy intents and the latest 50 completed receipts. Separate request IDs are retained; no operations are combined.':'Only approvals, execution continuations and unresolved requests appear here. Ordinary autonomous operations and denied attempts are recorded in Activity.'}</p>
  {error&&<p role="alert" className="external-agent-notice">{error}</p>}
  {unsupported&&<p role="alert">Some request states are unavailable. Check requests before acting.</p>}
  {rows===null&&error?<p>Requests unavailable. Use Check requests to retry.</p>:rows===null?<p role="status">Loading action requests…</p>:!visible.length?<p className="text-sm text-text-secondary">{unsupported?'Check requests to recover the current queue.':history?'No historical requests. Denied attempts remain in the Activity log.':'No action required. Legacy requests and operation history are available in Activity.'}</p>:<ul className="divide-y divide-border">{visible.map(row=>{
   const state=row.queue_state, route=agentBusinessModule(actionManifest.find(action=>action.key===row.action)?.module)?.route;
   return <li key={row.request_id} className="py-3 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.label} · {actionLabels[row.action.split('.').at(-1)]}</strong><Badge tone={state==='completed'?'success':state==='pending_approval'||state==='needs_resolution'?'warning':'neutral'}>{labels[state]||'Status unavailable'}</Badge></div>
    <p className="text-xs text-text-secondary">{executionPolicyLabels[row.execution_policy]} · Requested {formatOperationalMoment(row.requested_at)}{row.confirmed_at&&<> · Approved {formatOperationalMoment(row.confirmed_at)}</>}{row.receipt?.completed_at&&<> · Completed {formatOperationalMoment(row.receipt.completed_at)}</>}</p>
    {row.resolution_reason&&<p className="text-sm">{row.resolution_reason}</p>}
    {row.next_action&&<p className="text-sm text-text-secondary">{row.next_action}</p>}
    {state==='needs_resolution'&&row.input!==undefined&&route&&<a className="text-sm underline" href={route}>Review business record</a>}
    {row.input===undefined?<p className="text-xs text-text-secondary">Corresponding business authority and outlet access are required to inspect this request.</p>:<details><summary>Review exact request</summary><dl className="external-agent-facts"><div><dt>Target</dt><dd>{row.target_id||'New record'}</dd></div><div><dt>Request</dt><dd>{row.request_id}</dd></div></dl><pre className="overflow-auto text-xs whitespace-pre-wrap break-words">{JSON.stringify(row.input,null,2)}</pre>{row.evidence_reference&&<p className="text-sm">Evidence: {row.evidence_reference}</p>}{route&&<a className="text-sm underline" href={route}>Open canonical business records</a>}
     {!history&&state==='awaiting_execution'&&row.can_continue&&row.expected_version!==undefined&&<button className="btn-secondary mt-2" type="button" onClick={()=>copyRetry(row)}>{copied===row.request_id?'Continuation copied':'Copy Agent continuation'}</button>}
    </details>}
    {!history&&state==='pending_approval'&&canManage&&row.can_confirm&&<button className="btn-secondary" type="button" disabled={busy} onClick={()=>{setSelected(row);setReference('');}}>Review evidence approval</button>}
    {!history&&selected?.request_id===row.request_id&&<div className="space-y-2"><label className="block text-sm font-semibold">Existing evidence reference<input className="control mt-1 w-full" maxLength={1000} value={reference} disabled={busy} onChange={event=>setReference(event.target.value)}/></label><p className="text-xs text-text-secondary">Approve only genuine work or measurements you have verified. Approval authorizes an Agent retry; it does not execute the action.</p><button className="btn-primary" type="button" disabled={busy||!reference.trim()} onClick={()=>setConfirm(true)}>Approve evidence</button></div>}
   </li>;
  })}</ul>}
  <ConfirmDialog request={confirm&&selected?{title:'Approve this exact business action?',message:'You are authorizing the listed request against existing physical or approved business evidence. The Agent must execute it while its source version and approval remain valid.',confirmLabel:'Approve evidence'}:null} onCancel={()=>setConfirm(false)} onConfirm={save}/>
 </section>;
}
