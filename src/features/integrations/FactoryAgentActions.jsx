import {useCallback,useEffect,useRef,useState} from 'react';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/feedback/ConfirmDialog.jsx';
import {formatOperationalMoment} from '../../lib/dateTime.js';
import {externalAgentService} from '../../services/externalAgentService.js';
import {actionLabels,executionPolicyLabels} from '../../components/permissions/capabilityActions.js';
import actionManifest from '../../../config/factoryAgentActions.json';
import {getModuleById} from '../../../config/modules.ts';

// Mirrors the existing authority's 30-minute confirmation validity; never changes saved status.
export function requestState(row, now = Date.now()) {
 if (row.status === 'confirmed' && row.confirmed_at && now - Date.parse(row.confirmed_at) > 30 * 60 * 1000) return 'expired';
 return row.status;
}
const requestLabels = {awaiting_confirmation:'Pending confirmation',confirmed:'Confirmed · awaiting execution',completed:'Completed',rejected:'Rejected',expired:'Confirmation expired'};
export default function FactoryAgentActions({identityId,canManage}) {
 const [rows,setRows]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState(null),[reference,setReference]=useState(''),[confirm,setConfirm]=useState(false),[now,setNow]=useState(Date.now()),[copied,setCopied]=useState(null);
 const generation=useRef(0), flight=useRef(null);
 async function copyRetry(row){try{await navigator.clipboard.writeText(JSON.stringify({request_id:row.request_id,action:row.action,target_id:row.target_id,expected_version:row.expected_version,input:row.input},null,2));setCopied(row.request_id);}catch{setError('Copy failed. Use the exact request details for the Agent retry.');}}
 const refresh=useCallback(async()=>{
  if(flight.current) return flight.current;
  const current=generation.current;
  setBusy(true);
  const request=externalAgentService.actionRequests(identityId).then(data=>{
   if(current===generation.current){setRows(data);setError('');setNow(Date.now());setSelected(previous=>previous&&data.some(row=>row.request_id===previous.request_id&&row.status==='awaiting_confirmation')?previous:null);}
  }).catch(cause=>{if(current===generation.current)setError(cause.message);}).finally(()=>{if(current===generation.current){flight.current=null;setBusy(false);}});
  flight.current=request;
  return request;
 },[identityId]);
 useEffect(()=>{
  generation.current++;flight.current=null;setRows(null);setError('');setSelected(null);setReference('');setConfirm(false);refresh();
  const update=()=>{if(document.visibilityState==='visible')refresh();};
  const timer=setInterval(update,30000);
  document.addEventListener('visibilitychange',update);window.addEventListener('focus',update);
  return()=>{generation.current++;clearInterval(timer);document.removeEventListener('visibilitychange',update);window.removeEventListener('focus',update);};
 },[refresh]);
 async function save(){if(!selected)return;const current=generation.current;setBusy(true);setError('');setConfirm(false);try{await externalAgentService.confirmAction(identityId,selected.request_id,reference.trim());if(current!==generation.current)return;setSelected(null);setReference('');await refresh();}catch(cause){if(current===generation.current)setError(cause.message);}finally{if(current===generation.current)setBusy(false);}}
 return <section aria-label="Action Requests" className="space-y-3">
  <div className="flex items-center justify-between gap-3"><h3 className="external-agent-heading">Action Requests</h3><button className="btn-secondary" type="button" disabled={busy} onClick={refresh}>Check requests</button></div>
  <p className="text-sm text-text-secondary">Human confirmation authorizes the Agent to retry this exact request; it does not execute the action. Requests update automatically while this tab is visible.</p>
  {error&&<p role="alert" className="external-agent-notice">{error}</p>}
  <p className="text-xs text-text-secondary">Rejected attempts are recorded in Activity; they do not create a completed request.</p>
  {rows===null&&error?<p>Requests unavailable. Use Check requests to retry.</p>:rows===null?<p role="status">Loading action requests…</p>:!rows.length?<p className="text-sm text-text-secondary">No pending action requests. Completed and autonomous actions remain in Activity and the audit trail.</p>:<ul className="divide-y divide-border">{rows.map(row=><li key={row.request_id} className="py-3 space-y-2">
   <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.label} · {actionLabels[row.action.split('.').at(-1)]}</strong><Badge tone={row.status==='completed'?'success':requestState(row,now)==='expired'||row.status==='awaiting_confirmation'?'warning':row.status==='rejected'?'danger':'neutral'}>{requestLabels[requestState(row,now)]||'Unknown request state'}</Badge></div>
   <p className="text-sm text-text-secondary">{executionPolicyLabels[row.execution_policy]}{(row.lifecycle_requirement || row.execution_reason)&&<> · {row.lifecycle_requirement || row.execution_reason}</>}</p>
   <p className="text-xs text-text-secondary">Requested {formatOperationalMoment(row.requested_at)}{row.confirmed_at&&<> · Confirmed {formatOperationalMoment(row.confirmed_at)}</>}{row.receipt?.completed_at&&<> · Completed {formatOperationalMoment(row.receipt.completed_at)}</>}</p>
   {requestState(row,now)==='expired'&&<p className="text-sm text-text-secondary">The confirmation window has ended. Ask the Agent to submit a new intent for review.</p>}
   {row.input===undefined?<p className="text-xs text-text-secondary">Corresponding Factory authority is required to inspect this request.</p>:<details><summary>Review exact request</summary><dl className="external-agent-facts"><div><dt>Target</dt><dd>{row.target_id||'New record'}</dd></div><div><dt>Request</dt><dd>{row.request_id}</dd></div></dl><pre className="overflow-auto text-xs whitespace-pre-wrap break-words">{JSON.stringify(row.input,null,2)}</pre>{row.evidence_reference&&<p className="text-sm">Evidence: {row.evidence_reference}</p>}<a className="text-sm underline" href={getModuleById(actionManifest.find(action=>action.key===row.action)?.module)?.route}>Open canonical Factory records</a></details>}
   {row.status==='confirmed'&&requestState(row,now)!=='expired'&&row.input!==undefined&&row.expected_version!==undefined&&<div className="space-y-2"><p className="text-sm">Awaiting Agent Execution. Send the exact retry command to the Agent; current access, evidence and approval validity are rechecked when it runs.</p><button className="btn-secondary" type="button" onClick={()=>copyRetry(row)}>{copied===row.request_id?'Retry command copied':'Copy Agent retry command'}</button></div>}
   {row.status==='awaiting_confirmation'&&canManage&&<button className="btn-secondary" type="button" disabled={busy||!row.can_confirm} onClick={()=>{setSelected(row);setReference('');}}>Review evidence confirmation</button>}
   {selected?.request_id===row.request_id&&<div className="space-y-2"><label className="block text-sm font-semibold">Existing evidence reference<input className="control mt-1 w-full" maxLength={1000} value={reference} disabled={busy} onChange={event=>setReference(event.target.value)}/></label><p className="text-xs text-text-secondary">Confirm only work or measurements you have verified. Do not use this to create inspection evidence.</p><button className="btn-primary" type="button" disabled={busy||!reference.trim()} onClick={()=>setConfirm(true)}>Confirm evidence</button></div>}
  </li>)}</ul>}
  <ConfirmDialog request={confirm&&selected?{title:'Confirm this exact Factory action?',message:'You are confirming the listed request against existing physical or approved business evidence. The Agent can execute only this intent while its source version remains unchanged.',confirmLabel:'Confirm evidence'}:null} onCancel={()=>setConfirm(false)} onConfirm={save}/>
 </section>;
}
