import {useEffect,useState} from 'react';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/feedback/ConfirmDialog.jsx';
import {formatOperationalMoment} from '../../lib/dateTime.js';
import {externalAgentService} from '../../services/externalAgentService.js';
import {actionLabels} from '../../components/permissions/capabilityActions.js';
import actionManifest from '../../../config/factoryAgentActions.json';
import {getModuleById} from '../../../config/modules.ts';

export default function FactoryAgentActions({identityId,canManage}) {
 const [rows,setRows]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState(null),[reference,setReference]=useState(''),[confirm,setConfirm]=useState(false);
 useEffect(()=>{let alive=true;setRows(null);setError('');setSelected(null);setReference('');externalAgentService.actionRequests(identityId).then(data=>{if(alive)setRows(data);}).catch(cause=>{if(alive)setError(cause.message);});return()=>{alive=false;};},[identityId]);
 async function refresh(){setBusy(true);setError('');try{setRows(await externalAgentService.actionRequests(identityId));}catch(cause){setError(cause.message);}finally{setBusy(false);}}
 async function save(){setBusy(true);setError('');setConfirm(false);try{await externalAgentService.confirmAction(identityId,selected.request_id,reference.trim());setSelected(null);setReference('');setRows(await externalAgentService.actionRequests(identityId));}catch(cause){setError(cause.message);}finally{setBusy(false);}}
 return <section aria-label="Factory action requests" className="space-y-3">
  <div className="flex items-center justify-between gap-3"><h3 className="external-agent-heading">Factory Actions</h3><button className="btn-secondary" type="button" disabled={busy} onClick={refresh}>Check requests</button></div>
  <p className="text-sm text-text-secondary">Physical-work actions require an authorized human to confirm the exact request against real evidence. Confirmation does not execute the action; the Agent must retry the same request.</p>
  {error&&<p role="alert" className="external-agent-notice">{error}</p>}
  {rows===null?<p role="status">Loading action requests…</p>:!rows.length?<p className="text-sm text-text-secondary">No action requests recorded.</p>:<ul className="divide-y divide-border">{rows.map(row=><li key={row.request_id} className="py-3 space-y-2">
   <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.label} · {actionLabels[row.action.split('.').at(-1)]}</strong><Badge tone={row.status==='completed'?'success':row.status==='awaiting_confirmation'?'warning':'neutral'}>{row.status==='awaiting_confirmation'?'Needs confirmation':row.status==='confirmed'?'Confirmed · awaiting execution':'Completed'}</Badge></div>
   <p className="text-xs text-text-secondary">Requested {formatOperationalMoment(row.requested_at)}</p>
   {row.input===undefined?<p className="text-xs text-text-secondary">Corresponding Factory authority is required to inspect this request.</p>:<details><summary>Review exact request</summary><dl className="external-agent-facts"><div><dt>Target</dt><dd>{row.target_id||'New record'}</dd></div><div><dt>Request</dt><dd>{row.request_id}</dd></div></dl><pre className="overflow-auto text-xs whitespace-pre-wrap break-words">{JSON.stringify(row.input,null,2)}</pre>{row.evidence_reference&&<p className="text-sm">Evidence: {row.evidence_reference}</p>}<a className="text-sm underline" href={getModuleById(actionManifest.find(action=>action.key===row.action)?.module)?.route}>Open canonical Factory records</a></details>}
   {row.status==='awaiting_confirmation'&&canManage&&<button className="btn-secondary" type="button" disabled={busy||!row.can_confirm} onClick={()=>{setSelected(row);setReference('');}}>Review evidence confirmation</button>}
   {selected?.request_id===row.request_id&&<div className="space-y-2"><label className="block text-sm font-semibold">Existing evidence reference<input className="control mt-1 w-full" maxLength={1000} value={reference} disabled={busy} onChange={event=>setReference(event.target.value)}/></label><p className="text-xs text-text-secondary">Confirm only work or measurements you have verified. Do not use this to create inspection evidence.</p><button className="btn-primary" type="button" disabled={busy||!reference.trim()} onClick={()=>setConfirm(true)}>Confirm evidence</button></div>}
  </li>)}</ul>}
  <ConfirmDialog request={confirm?{title:'Confirm this exact Factory action?',message:'You are confirming the listed request against existing physical or approved business evidence. The Agent can execute only this intent while its source version remains unchanged.',confirmLabel:'Confirm evidence'}:null} onCancel={()=>setConfirm(false)} onConfirm={save}/>
 </section>;
}
