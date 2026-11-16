import {ChevronRight} from 'lucide-react';
import {moduleRegistry,moduleWorkspace,workspaceLabels,getPermissionDefinitions} from '../../../config/modules.ts';
import Badge from '../../components/ui/Badge.jsx';
import {assistantKnowledgeSources} from './assistantKnowledgeSources.js';

const statuses={connected:'Connected',disabled:'Disabled',denied:'Access denied'};
const permissionLabels=new Map(getPermissionDefinitions().map(permission=>[permission.code,permission.description]));

export default function NativeAssistantCapabilities({data,canEdit,busy,onFeature}){
 const capabilities=data.runtime.capabilities||[];
 // Presentation joins existing contracts and source metadata to the canonical modules.
 // A source entry is never converted into an operation or an access grant.
 const modules=moduleRegistry.map(module=>({module,
  operations:capabilities.filter(operation=>operation.module_id===module.id),
  sources:assistantKnowledgeSources.filter(source=>source.module_ids.includes(module.id)),
 })).filter(row=>row.operations.length||row.sources.length)
  .sort((a,b)=>Number(b.operations.length>0)-Number(a.operations.length>0)||moduleWorkspace(a.module).localeCompare(moduleWorkspace(b.module))||a.module.label.localeCompare(b.module.label));
 const registeredModuleCount=modules.filter(row=>row.operations.length).length;
 const registered=modules.flatMap(row=>row.operations);
 const unknown=capabilities.some(operation=>!moduleRegistry.some(module=>module.id===operation.module_id));
 return <section className="space-y-3" aria-label="AI Capabilities">
  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
   <p><strong>{registeredModuleCount}</strong> {registeredModuleCount===1?'module':'modules'} with registered operations <span className="text-text-secondary">· {registered.filter(operation=>operation.kind==='READ').length} READ · {registered.filter(operation=>operation.kind==='ACTION').length} ACTION</span></p>
   <p className="text-xs text-text-secondary">Source-only modules await authorized retrieval.</p>
  </div>
  {!capabilities.length&&<p role="status" className="text-sm text-text-secondary">No registered operations were returned by the server. Refresh configuration before testing.</p>}
  {unknown&&<p role="status" className="text-sm text-text-secondary">Some operations have unresolved module ownership. Refresh configuration; no controls are available for them.</p>}
  <div className="divide-y divide-border border-y border-border">
   {modules.map(({module,operations,sources})=>{
    const reads=operations.filter(operation=>operation.kind==='READ'),actions=operations.filter(operation=>operation.kind==='ACTION');
    const availability=operations.some(operation=>operation.availability==='connected')?'connected':operations.some(operation=>operation.availability==='denied')?'denied':operations.length&&operations.every(operation=>operation.availability==='disabled')?'disabled':'unavailable';
    return <details key={module.id} open={operations.length>0} className="group" aria-label={`${module.label} capabilities`}>
     <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-text-secondary transition-transform group-open:rotate-90 motion-reduce:transition-none"/>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{module.label}</span><span className="block text-xs text-text-secondary">{workspaceLabels[moduleWorkspace(module)]}{module.section!==workspaceLabels[moduleWorkspace(module)]&&` · ${module.section}`} </span></span>
      <span className="order-last basis-full pl-7 text-xs tabular-nums text-text-secondary sm:order-none sm:basis-auto sm:pl-0">{reads.length} READ · {actions.length} ACTION</span>
      <Badge tone={availability==='connected'?'success':availability==='denied'?'warning':'neutral'}>{statuses[availability]||'Not connected'}</Badge>
     </summary>
     <div className="space-y-4 pb-4 pl-0 sm:pl-7">
      <div className="grid gap-4 md:grid-cols-2">
       {['READ','ACTION'].map(kind=><section key={kind} aria-label={`${module.label} ${kind}`} className="min-w-0 space-y-2">
        <h3 className="text-xs font-semibold text-text-secondary">{kind} operations</h3>
        {operations.filter(operation=>operation.kind===kind).map(operation=><div key={operation.id} className="space-y-3">
         <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-medium">{operation.label}</h4><Badge tone={operation.availability==='connected'?'success':operation.availability==='denied'?'warning':'neutral'}>{statuses[operation.availability]||'Not connected'}</Badge></div>
         <dl className="space-y-2 text-xs">
          <div><dt className="font-medium">Human authorization</dt><dd className="mt-1 text-text-secondary">{permissionLabels.get(operation.permission)||operation.permission||'Requirement not supplied.'} {operation.availability==='connected'?'Current user verified by server.':operation.availability==='denied'?'Current user is not authorized.':'Not evaluated while unavailable.'}</dd></div>
          <div><dt className="font-medium">Scope</dt><dd className="mt-1 text-text-secondary">{operation.scope||'Scope not supplied.'}</dd></div>
          {kind==='ACTION'&&<div><dt className="font-medium">AI authorization &amp; confirmation</dt><dd className="mt-1 text-text-secondary">No executable ACTION policy is supplied by the current Native Assistant contract.</dd></div>}
         </dl>
         {operation.id==='read_factory_finished_goods'&&kind==='READ'&&<div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center gap-3"><label className="inline-flex min-h-10 items-center gap-2 text-sm"><input className="admin-checkbox" type="checkbox" checked={!!data.config.factory_reads_enabled} disabled={!canEdit||busy} onChange={event=>void onFeature('features',{expected_revision:data.config.revision,factory_reads_enabled:event.target.checked})}/> Enable Finished Goods reader</label><button type="button" className="btn-secondary" disabled={!canEdit||busy} onClick={()=>void onFeature('tool_test')}>Test Finished Goods read</button></div>
          <p className="text-xs text-text-secondary">Enablement grants no module access. The test independently checks your existing human permission.</p>
         </div>}
        </div>)}
        {!operations.some(operation=>operation.kind===kind)&&<p className="text-sm text-text-secondary">{kind==='READ'?'No READ operation registered.':'No ACTION operation registered.'}</p>}
       </section>)}
      </div>
      {sources.length>0&&<div className="space-y-2 text-xs"><h3 className="font-semibold">Source readiness</h3>{sources.map(source=><div key={source.name} className="max-w-3xl space-y-1 text-text-secondary"><p>{source.readiness} No Assistant READ is registered for this source.</p><p><span className="font-medium text-text-primary">Authorization: </span>{source.access}</p><p><span className="font-medium text-text-primary">Version &amp; freshness: </span>{source.version} Current document freshness is not checked here.</p></div>)}</div>}
     </div>
    </details>;
   })}
  </div>
 </section>;
}
