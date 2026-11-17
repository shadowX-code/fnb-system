import {useState} from 'react';
import {getPermissionDefinitions} from '../../../config/modules.ts';
import Drawer from '../../components/ui/Drawer.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {capabilityStatuses} from './assistantCapabilityPresentation.js';
const permissionLabels=new Map(getPermissionDefinitions().map(p=>[p.code,p.description]));
export default function AssistantCapabilityDetail({row,data,canEdit,busy,onFeature,onClose}){
 const [feedback,setFeedback]=useState(''),[failed,setFailed]=useState(false);
 async function act(action,values){setFeedback('');setFailed(false);const r=await onFeature(action,values);if(r?.error){setFailed(true);setFeedback(r.error);}else if(r)setFeedback('AI access policy saved.');}
 return <Drawer title={row.label} eyebrow={`${row.workspaceLabel} / ${row.domain}`} width="md" onClose={onClose}><div className="space-y-5">
  <div className="flex flex-wrap items-center gap-2"><Badge tone={row.status==='connected'?'success':row.status==='partial'?'warning':'neutral'}>{capabilityStatuses[row.status]}</Badge><span className="text-xs text-text-secondary">Existing user permissions and data scope always apply.</span></div>
  {feedback&&<p role={failed?'alert':'status'} className={failed?'text-sm text-red-700':'text-sm text-primary'}>{feedback}</p>}
  {['READ',...(row.operations.some(o=>o.kind==='ACTION')?['ACTION']:[])].map(kind=><section key={kind} aria-label={`${kind} capabilities`} className="space-y-3"><h3 className="text-xs font-semibold tracking-wide text-primary">{kind==='READ'?'Allow AI to read':'Allow AI actions'}</h3>{row.operations.filter(o=>o.kind===kind).length?row.operations.filter(o=>o.kind===kind).map(o=><article key={o.id} className="space-y-3 border-b border-border pb-4">
   <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">{o.label}</h4><Badge tone={o.connection_enabled&&(kind!=='ACTION'||o.ai_execution_enabled)?'success':'neutral'}>{o.connection_enabled&&(kind!=='ACTION'||o.ai_execution_enabled)?'Enabled':'Disabled'}</Badge></div>
   {o.module_id!==row.id&&<p className="text-xs text-text-secondary">Shared information · this access policy also applies wherever this same operation appears. Only the information below is included.</p>}
   <dl className="space-y-2 text-sm"><div><dt className="font-medium">Accessible information</dt><dd className="text-text-secondary">{o.scope}</dd></div><div><dt className="font-medium">Required user permissions</dt><dd className="text-text-secondary">{permissionLabels.get(o.permission)||o.permission}</dd><dd className="mt-1 text-xs text-text-secondary">{o.availability==='denied'?'Your account cannot use this operation. Enabling AI access does not change that.':o.availability==='connected'?'Your account has access; permissions are checked on every request.':'User permissions and scope are checked on every request.'}</dd></div></dl>
   <button type="button" className="btn-secondary min-h-10" disabled={!canEdit||busy} onClick={()=>void act('capability_connection',{operation:o.id,enabled:!o.connection_enabled,expected_revision:data.config.revision})}>{o.connection_enabled?'Disable AI Access':'Enable AI Access'}</button>
   {kind==='ACTION'&&<div className="space-y-2"><p className="text-xs text-text-secondary">AI action authorization is {o.ai_execution_enabled?'enabled':'disabled'}. Actions require both AI access and this separate authorization, your existing permissions, and confirmation of a current preview.</p><button type="button" className="btn-secondary min-h-10" disabled={!canEdit||busy} onClick={()=>void act('action_policy',{operation:o.id,enabled:!o.ai_execution_enabled,expected_revision:data.config.revision})}>{o.ai_execution_enabled?'Disable AI action authorization':'Enable AI action authorization'}</button></div>}

  </article>):<p className="text-sm text-text-secondary">{kind==='READ'?'AI reading is not supported for this module yet. Its information cannot be accessed through the Assistant.':'AI actions are not supported for this module. The Assistant cannot make changes here.'}</p>}</section>)}
  {row.sources.map(s=><div key={s.name} className="space-y-1 text-xs text-text-secondary"><p className="font-medium">{s.name} · {s.owner}</p><p>{s.access}</p><p>{s.version}</p><p>Only the information explicitly listed above is available to the Assistant. Other documents are not accessible through this policy.</p></div>)}
 </div></Drawer>;
}
