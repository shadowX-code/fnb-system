import {useState} from 'react';
import {getPermissionDefinitions} from '../../../config/modules.ts';
import Drawer from '../../components/ui/Drawer.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {coverageLabels} from './assistantCoverageReview.js';
import {capabilityOwnerLabel} from './assistantCapabilityPresentation.js';

const permissionLabels=new Map(getPermissionDefinitions().map(p=>[p.code,p.description]));
const sectionClass='space-y-3';
function AccessState({enabled}){
 return <Badge tone={enabled===true?'success':'neutral'}>{enabled===true?'Enabled':enabled===false?'Disabled':'Unavailable'}</Badge>;
}
export default function AssistantCapabilityDetail({row,data,canEdit,busy,onFeature,onClose,onSelect}){
 const [feedback,setFeedback]=useState(''),[failed,setFailed]=useState(false),[saving,setSaving]=useState(false);
 const reads=row.operations.filter(o=>o.kind==='READ'&&o.module_id===row.id);
 const grouped=reads.filter(o=>o.policy_group===row.id);
 const groupEnabled=grouped.length>0&&grouped.every(o=>o.connection_enabled);
 const groupMixed=grouped.some(o=>o.connection_enabled)&&!groupEnabled;
 const actions=row.operations.filter(o=>o.kind==='ACTION'&&o.module_id===row.id);
 const shared=row.operations.filter(o=>o.kind==='READ'&&o.module_id!==row.id);
 const sharedIds=new Set(shared.map(o=>o.id));
 const related=(row.coverageReads||[]).filter(o=>o.module_id!==row.id&&!sharedIds.has(o.id));
 const showCoverage=row.coverage?.available||row.coverage?.missing;
 const coverage=coverageLabels[row.coverage?.classification]||'Not integrated';
 async function act(action,values){
  if(saving)return;
  setSaving(true);setFeedback('');setFailed(false);
  try{const r=await onFeature(action,values);if(r?.error){setFailed(true);setFeedback(r.error);}else if(r)setFeedback('AI access policy saved.');}
  catch{setFailed(true);setFeedback('Could not save AI access. Refresh and try again.');}
  finally{setSaving(false);}
 }
 function control(o){return <button type="button" className="btn-secondary min-h-10 shrink-0" disabled={!canEdit||busy||saving||typeof o.connection_enabled!=='boolean'} aria-label={`${o.connection_enabled?'Disable':'Enable'} AI Access: ${o.label}`} onClick={()=>void act('capability_connection',{operation:o.id,enabled:!o.connection_enabled,expected_revision:data.config.revision})}>{o.connection_enabled?'Disable':'Enable'} AI Access</button>;}
 function permission(o){return <p className="text-xs text-text-secondary">Requires {(permissionLabels.get(o.permission)||'the existing source permission').replace(/[.!]+$/, '')}.{o.availability==='denied'&&' Your account cannot use this operation.'}</p>;}
 function linkedReads(title,operations,ownerPrefix){
  if(!operations.length)return null;
  return <section aria-label={title} className={sectionClass}>
   <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
   <div className="divide-y divide-border">{operations.map(o=>{
    const owner=capabilityOwnerLabel(o.module_id);
    return <article key={o.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
     <h4 className="text-sm font-semibold">{o.label}</h4>
     <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
      <AccessState enabled={o.connection_enabled}/><span>{ownerPrefix}</span>
      {onSelect&&owner?<button type="button" className="min-h-10 font-medium text-primary-ink underline underline-offset-4" aria-label={`Manage ${owner} access`} onClick={()=>onSelect(o.module_id)}>{owner}</button>:<span>{owner||'Owner unavailable'}</span>}
     </div>
     <p className="text-sm text-text-secondary">{o.scope}</p>{permission(o)}
    </article>;
   })}</div>
  </section>;
 }
 return <Drawer title={row.label} eyebrow={`${row.workspaceLabel} / ${row.domain}`} description={<Badge tone="neutral">{coverage} coverage</Badge>} width="md" onClose={onClose}>
  <div className="space-y-6">
   {feedback&&<p role={failed?'alert':'status'} className={failed?'text-sm text-red-700':'text-sm text-primary-ink'}>{feedback}</p>}
   {!!reads.length&&<section aria-label="AI Read Access" className={sectionClass}>
    <h3 className="text-sm font-semibold text-text-primary">AI Read Access</h3>
    <p className="text-xs text-text-secondary">Existing permissions and data scope apply to every request.</p>
    {grouped.length>1&&<div className="flex flex-wrap items-center justify-between gap-3 py-2"><div><p className="text-sm font-medium">Ordinary module reads · {groupMixed?'Mixed access':groupEnabled?'Enabled':'Disabled'}</p><p className="text-xs text-text-secondary">Applies only to the {grouped.length} listed reads. Separate and future capabilities are not included.</p></div><button type="button" className="btn-secondary min-h-10" disabled={!canEdit||busy||saving||grouped.some(o=>typeof o.connection_enabled!=='boolean')} onClick={()=>void act('capability_connection',{operation:`module:${row.id}`,enabled:!groupEnabled,expected_revision:data.config.revision})}>{groupEnabled?'Disable':'Enable'} ordinary reads</button></div>}
    <div className="divide-y divide-border">{reads.map(o=><article key={o.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
     <div className="flex items-start justify-between gap-3"><h4 className="text-sm font-semibold">{o.label}</h4><AccessState enabled={o.connection_enabled}/></div>
     <p className="text-sm text-text-secondary">{o.scope}</p>
     <div className="flex flex-wrap items-center justify-between gap-3">{permission(o)}{control(o)}</div>
    </article>)}</div>
   </section>}
   {linkedReads('Shared READ access',shared,'via')}
   {!!showCoverage&&<section aria-label="Coverage" className={sectionClass}>
    <h3 className="text-sm font-semibold text-text-primary">Coverage</h3>
    <dl className="space-y-3 text-sm">
     {row.coverage?.available&&<div><dt className="font-medium">Available information</dt><dd className="mt-1 text-text-secondary">{row.coverage.available}</dd></div>}
     {row.coverage?.missing&&<div><dt className="font-medium">Not covered</dt><dd className="mt-1 text-text-secondary">{row.coverage.missing}</dd></div>}
    </dl>
   </section>}
   {!!row.sources?.length&&<section aria-label="Knowledge sources" className={sectionClass}>
    <h3 className="text-sm font-semibold text-text-primary">Knowledge sources</h3>
    <div className="divide-y divide-border">{row.sources.map(source=><article key={source.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
     <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-medium">{source.authority}</h4><Badge tone={source.availability==='live_source'?'success':'neutral'}>{source.availability==='live_source'?'Available to query':source.availability==='disabled'?'AI Access disabled':source.availability==='denied'?'Source permission required':'Availability unknown'}</Badge></div>
     <p className="text-xs text-text-secondary">{source.owner} · {source.publication}</p>
     <p className="text-xs text-text-secondary">{source.type==='system_guidance'?'Version follows the deployed Assistant guide.':'Publication and access are checked at the source on each query. Coverage depends on the selected scope.'}</p>
    </article>)}</div>
   </section>}
   {linkedReads('Related Data',related,'policy at')}
   {!!actions.length&&<section aria-label="AI Actions" className={sectionClass}>
    <h3 className="text-sm font-semibold text-text-primary">AI Actions</h3>
    <p className="text-xs text-text-secondary">Execution requires both policies, the user’s existing permission and confirmation of a current preview.</p>
    <div className="divide-y divide-border">{actions.map(o=><article key={o.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
     <h4 className="text-sm font-semibold">{o.label}</h4><p className="text-sm text-text-secondary">{o.scope}</p>{permission(o)}
     <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-xs">AI access <AccessState enabled={o.connection_enabled}/></span>{control(o)}</div>
     <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-xs">Execution authorization <AccessState enabled={o.ai_execution_enabled}/></span><button type="button" className="btn-secondary min-h-10" aria-label={`${o.ai_execution_enabled?'Disable':'Enable'} execution authorization: ${o.label}`} disabled={!canEdit||busy||saving||typeof o.ai_execution_enabled!=='boolean'} onClick={()=>void act('action_policy',{operation:o.id,enabled:!o.ai_execution_enabled,expected_revision:data.config.revision})}>{o.ai_execution_enabled?'Disable':'Enable'} execution</button></div>
    </article>)}</div>
   </section>}
  </div>
 </Drawer>;
}
