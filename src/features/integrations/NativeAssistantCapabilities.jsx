import {useState} from 'react';
import {ChevronRight} from 'lucide-react';
import {moduleRegistry,getPermissionDefinitions} from '../../../config/modules.ts';
import Badge from '../../components/ui/Badge.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import {capabilityResources,filterCapabilityResources,capabilityStatuses,capabilityResourceTypes} from './assistantCapabilityPresentation.js';

const permissionLabels=new Map(getPermissionDefinitions().map(permission=>[permission.code,permission.description]));
const tone=status=>status==='connected'?'success':['denied','partial'].includes(status)?'warning':'neutral';

function ResourceDetail({resource,data,canEdit,busy,onFeature}){
 return <section id={`resource-${resource.id}`} aria-label={`${resource.label} details`} className="space-y-3 bg-background-secondary px-3 py-4 sm:px-4">
  <p className="text-xs text-text-secondary">Owning {resource.modules.length===1?'module':'modules'}: {resource.modules.map(module=>module.label).join(' · ')}</p>
  {resource.operations.map(operation=><div key={operation.id} className="space-y-3">
   <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-text-secondary">{operation.kind}</span><h4 className="text-sm font-medium">{operation.label}</h4><Badge tone={tone(operation.availability)}>{capabilityStatuses[operation.availability]||'Not connected'}</Badge></div>
   <dl className="grid gap-3 text-xs sm:grid-cols-2">
    <div><dt className="font-medium">Scope</dt><dd className="mt-1 text-text-secondary">{operation.scope||'Scope not supplied.'}</dd></div>
    <div><dt className="font-medium">Human authorization</dt><dd className="mt-1 text-text-secondary">{permissionLabels.get(operation.permission)||operation.permission||'Requirement not supplied.'} {operation.availability==='connected'?'Current user verified by server.':operation.availability==='denied'?'Current user is not authorized.':'Not evaluated while unavailable.'}</dd></div>
    {operation.kind==='ACTION'&&<div><dt className="font-medium">AI authorization &amp; confirmation</dt><dd className="mt-1 text-text-secondary">No executable ACTION policy is supplied by the current Native Assistant contract.</dd></div>}
   </dl>
   {operation.id==='read_factory_finished_goods'&&operation.kind==='READ'&&<div className="space-y-2 border-t border-border pt-3">
    <h4 className="text-xs font-semibold">Configuration</h4>
    <div className="flex flex-wrap items-center gap-3"><label className="inline-flex min-h-10 items-center gap-2 text-sm"><input className="admin-checkbox" type="checkbox" checked={!!data.config.factory_reads_enabled} disabled={!canEdit||busy} onChange={event=>void onFeature('features',{expected_revision:data.config.revision,factory_reads_enabled:event.target.checked})}/> Enable Finished Goods reader</label><button type="button" className="btn-secondary" disabled={!canEdit||busy} onClick={()=>void onFeature('tool_test')}>Test Finished Goods read</button></div>
    <p className="text-xs text-text-secondary">Enablement grants no module access. The test independently checks your existing human permission.</p>
   </div>}
  </div>)}
  {resource.sources.map(source=><dl key={source.name} className="grid gap-3 text-xs sm:grid-cols-2">
   <div className="sm:col-span-2"><dt className="font-medium">Missing integration</dt><dd className="mt-1 text-text-secondary">{source.readiness} A source-specific, authorized retrieval contract is required. No callable READ or ACTION is registered for this source.</dd></div>
   <div><dt className="font-medium">Human authorization</dt><dd className="mt-1 text-text-secondary">{source.access}</dd></div>
   <div><dt className="font-medium">Version &amp; freshness</dt><dd className="mt-1 text-text-secondary">{source.version} Current document freshness is not checked here.</dd></div>
  </dl>)}
 </section>;
}

export default function NativeAssistantCapabilities({data,canEdit,busy,onFeature}){
 const [query,setQuery]=useState(''),[domain,setDomain]=useState('all'),[type,setType]=useState('all'),[status,setStatus]=useState('all'),[selected,setSelected]=useState(null);
 const capabilities=data.runtime.capabilities||[],resources=capabilityResources(capabilities);
 const rows=filterCapabilityResources(resources,{query,domain,type,status});
 const domains=[...new Map(resources.map(resource=>[resource.domain,resource.domainLabel]))].map(([value,label])=>({value,label}));
 const connected=resources.flatMap(resource=>resource.operations).filter(operation=>operation.availability==='connected');
 const unknown=capabilities.some(operation=>!moduleRegistry.some(module=>module.id===operation.module_id));
 const clear=()=>{setQuery('');setDomain('all');setType('all');setStatus('all');};
 const activeFilters=[...(query?[{key:'query',label:'Search',value:query,onRemove:()=>setQuery('')}]:[]),...(domain!=='all'?[{key:'domain',label:'Domain',value:domains.find(item=>item.value===domain)?.label,onRemove:()=>setDomain('all')}]:[]),...(type!=='all'?[{key:'type',label:'Resource type',value:capabilityResourceTypes[type],onRemove:()=>setType('all')}]:[]),...(status!=='all'?[{key:'status',label:'Connection',value:capabilityStatuses[status],onRemove:()=>setStatus('all')}]:[])];
 return <section className="space-y-3" aria-label="AI Capabilities">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Module resources</h3><p className="text-xs text-text-secondary" aria-label="Registered capability coverage"><strong className="text-text-primary">{connected.filter(operation=>operation.kind==='READ').length}</strong> connected READ · <strong className="text-text-primary">{connected.filter(operation=>operation.kind==='ACTION').length}</strong> available ACTION</p></div>
  <AdminFilterToolbar compact denseFields presentation="inline" search={<AdminSearchField label="Search resources" value={query} onChange={setQuery} placeholder="Resource, module or operation"/>} filters={<>
   <SelectField label="Domain" value={domain} onChange={setDomain} options={[{value:'all',label:'All'},...domains]}/>
   <SelectField label="Resource type" value={type} onChange={setType} options={[{value:'all',label:'All'},...Object.entries(capabilityResourceTypes).map(([value,label])=>({value,label}))]}/>
   <SelectField label="Connection" value={status} onChange={setStatus} options={[{value:'all',label:'All'},...Object.entries(capabilityStatuses).map(([value,label])=>({value,label}))]}/>
  </>} activeFilters={activeFilters} onClear={clear}/>
  {!Array.isArray(data.runtime.capabilities)&&<p role="status" className="text-sm text-text-secondary">Registered capabilities are unavailable. Refresh configuration before testing; source metadata is shown below.</p>}
  {unknown&&<p role="status" className="text-sm text-text-secondary">Some operations have unresolved module ownership and are omitted. Refresh configuration.</p>}
  <p role="status" className="text-xs text-text-secondary">{rows.length} of {resources.length} resources · Counts above cover all registered resources.</p>
  {!rows.length?<p className="py-6 text-sm text-text-secondary">{resources.length?'No resources match these filters. Clear filters to show all resources.':'No registered resources or source metadata are available.'}</p>:<div className="space-y-3">
   {domains.map(owner=>{
    const children=rows.filter(resource=>resource.domain===owner.value);if(!children.length)return null;
    const count=children.filter(resource=>resource.operations.some(operation=>operation.availability==='connected')).length;
    return <details key={owner.value} open className="group rounded-lg border border-border" aria-label={`${owner.label} domain`}>
     <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden"><ChevronRight size={16} aria-hidden="true" className="shrink-0 text-text-secondary transition-transform group-open:rotate-90 motion-reduce:transition-none"/><h3 className="min-w-0 flex-1 text-sm font-semibold">{owner.label}</h3><span className="text-xs text-text-secondary">{children.length} {children.length===1?'resource':'resources'}{count?` · ${count} connected`:''}</span></summary>
     <ul className="divide-y divide-border border-t border-border">
      {children.map(resource=><li key={resource.id}>
       <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_160px_120px_80px]">
        <h4 className="min-w-0 text-sm font-medium max-sm:col-span-2">{resource.label}</h4>
        <span className="text-xs text-text-secondary">{capabilityResourceTypes[resource.type]}</span>
        <span className="justify-self-end sm:justify-self-start"><Badge tone={tone(resource.status)}>{capabilityStatuses[resource.status]}</Badge></span>
        <button type="button" className="btn-secondary min-h-10 justify-self-start sm:justify-self-end" aria-label={`${selected===resource.id?'Hide':'View'} ${resource.label} details`} aria-expanded={selected===resource.id} aria-controls={`resource-${resource.id}`} onClick={()=>setSelected(selected===resource.id?null:resource.id)}>{selected===resource.id?'Close':'Details'}</button>
       </div>
       {selected===resource.id&&<ResourceDetail resource={resource} data={data} canEdit={canEdit} busy={busy} onFeature={onFeature}/>}
      </li>)}
     </ul>
    </details>;
   })}
  </div>}
 </section>;
}
