import {useState} from 'react';
import {getPermissionDefinitions} from '../../../config/modules.ts';
import Drawer from '../../components/ui/Drawer.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {coverageLabels} from './assistantCoverageReview.js';
import {reconcileBusinessModules,businessWorkspaceLabels} from './businessModuleProjection.js';

const permissionLabels=new Map(getPermissionDefinitions().map(p=>[p.code,p.description]));
const modules=reconcileBusinessModules().business;
const moduleLabels=new Map(modules.map(m=>[m.id,m.label]));
const ownerLabels=new Map(modules.map(m=>[m.id,`${businessWorkspaceLabels[m.workspace]} / ${m.label}`]));
const sectionClass='space-y-3';
function AccessState({enabled}){
 return <Badge tone={enabled===true?'success':'neutral'}>{enabled===true?'Enabled':enabled===false?'Disabled':'Unavailable'}</Badge>;
}
export default function AssistantCapabilityDetail({row,data,canEdit,busy,onFeature,onClose,onSelect}){
 const [feedback,setFeedback]=useState(''),[failed,setFailed]=useState(false),[saving,setSaving]=useState(false);
 const reads=row.operations.filter(o=>o.kind==='READ'&&o.module_id===row.id);
 const actions=row.operations.filter(o=>o.kind==='ACTION');
 const related=[...new Map([...row.operations,...(row.coverageReads||[])].filter(o=>o.kind==='READ'&&o.module_id!==row.id).map(o=>[o.id,o])).values()];
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
 return <Drawer title={row.label} eyebrow={`${row.workspaceLabel} / ${row.domain}`} description={<Badge tone="neutral">{coverage} coverage</Badge>} width="md" onClose={onClose}>
  <div className="space-y-6">
   {feedback&&<p role={failed?'alert':'status'} className={failed?'text-sm text-red-700':'text-sm text-primary'}>{feedback}</p>}
   <section aria-label="AI Read Access" className={sectionClass}>
    <h3 className="text-sm font-semibold text-text-primary">AI Read Access</h3>
    <p className="text-xs text-text-secondary">AI access never grants user permissions. Existing permissions and data scope apply to every request.</p>
    {reads.length?<div className="divide-y divide-border">{reads.map(o=><article key={o.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
     <div className="flex items-start justify-between gap-3"><h4 className="text-sm font-semibold">{o.label}</h4><AccessState enabled={o.connection_enabled}/></div>
     <p className="text-sm text-text-secondary">{o.scope}</p>
     <div className="flex flex-wrap items-center justify-between gap-3">{permission(o)}{control(o)}</div>
    </article>)}</div>:<p className="text-sm text-text-secondary">{related.length?'No separate READ access control here. Related Data below is managed by its owning module.':row.coverage?.classification==='not_applicable'?'This module does not need an independent business READ.':'AI reading is not yet available for this module.'}</p>}
   </section>
   <section aria-label="Coverage" className={sectionClass}>
    <h3 className="text-sm font-semibold text-text-primary">Coverage</h3>
    <dl className="space-y-3 text-sm">
     <div><dt className="font-medium">Available information</dt><dd className="mt-1 text-text-secondary">{row.coverage?.available||'Only the implemented reads listed above.'}</dd></div>
     {row.coverage?.missing&&<div><dt className="font-medium">Not covered</dt><dd className="mt-1 text-text-secondary">{row.coverage.missing}</dd></div>}
    </dl>
    <p className="text-xs text-text-secondary">Coverage describes supported information, even when AI access is disabled. Reads retain their period, version and scope; bounded results are not complete totals.</p>
    {!!row.sources?.length&&<details className="text-xs text-text-secondary"><summary className="cursor-pointer py-2 font-medium">Source ownership & limitations</summary><div className="space-y-3 pt-2">{row.sources.map(s=><div key={s.name}><p className="font-medium">{s.name} · {s.owner}</p><p>{s.access}</p><p>{s.version}</p></div>)}<p className="pt-2">Unlisted documents are not available through this policy.</p></div></details>}
   </section>
   {!!related.length&&<section aria-label="Related Data" className={sectionClass}>
    <h3 className="text-sm font-semibold text-text-primary">Related Data</h3>
    <p className="text-xs text-text-secondary">Independently managed reads, not prerequisites for this module.</p>
    <div className="divide-y divide-border">{related.map(o=><article key={o.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
     <div className="flex items-start justify-between gap-3"><h4 className="text-sm font-semibold">{o.label}</h4><AccessState enabled={o.connection_enabled}/></div>
     <p className="text-sm text-text-secondary">{o.scope}</p>{permission(o)}
     <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-text-secondary">Owner: {ownerLabels.get(o.module_id)||'Ownership unavailable'}</p>{onSelect&&moduleLabels.has(o.module_id)&&<button type="button" className="min-h-10 text-xs font-medium text-primary underline underline-offset-4" onClick={()=>onSelect(o.module_id)}>Manage {moduleLabels.get(o.module_id)} access</button>}</div>
    </article>)}</div>
   </section>}
   {!!actions.length&&<section aria-label="AI Actions" className={sectionClass}>
    <h3 className="text-sm font-semibold text-text-primary">AI Actions</h3>
    <p className="text-xs text-text-secondary">Requires AI access, separate execution authorization, existing user permissions and confirmation of a current preview.</p>
    <div className="divide-y divide-border">{actions.map(o=><article key={o.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
     <h4 className="text-sm font-semibold">{o.label}</h4><p className="text-sm text-text-secondary">{o.scope}</p>{permission(o)}
     <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-xs">AI access <AccessState enabled={o.connection_enabled}/></span>{control(o)}</div>
     <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-xs">Execution authorization <AccessState enabled={o.ai_execution_enabled}/></span><button type="button" className="btn-secondary min-h-10" disabled={!canEdit||busy||saving||typeof o.ai_execution_enabled!=='boolean'} onClick={()=>void act('action_policy',{operation:o.id,enabled:!o.ai_execution_enabled,expected_revision:data.config.revision})}>{o.ai_execution_enabled?'Disable':'Enable'} AI action authorization</button></div>
    </article>)}</div>
   </section>}
  </div>
 </Drawer>;
}
