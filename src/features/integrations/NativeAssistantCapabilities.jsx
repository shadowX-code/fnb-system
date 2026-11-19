import {coverageLabels} from './assistantCoverageReview.js';
import {businessWorkspaceLabels as workspaceLabels} from './businessModuleProjection.js';
import {useMemo,useState} from 'react';
import {ChevronRight} from 'lucide-react';
import Badge from '../../components/ui/Badge.jsx';
import AssistantCapabilityDetail from './AssistantCapabilityDetail.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import {capabilityInventory,filterCapabilityInventory,capabilityTableRows,capabilityStatuses} from './assistantCapabilityPresentation.js';

const tone=status=>status==='connected'?'success':status==='partial'?'warning':'neutral';
export default function NativeAssistantCapabilities({data,canEdit,busy,onFeature}){
 const [query,setQuery]=useState(''),[workspace,setWorkspace]=useState('all'),[domain,setDomain]=useState('all'),[status,setStatus]=useState('all'),[selected,setSelected]=useState(null),[collapsed,setCollapsed]=useState(()=>new Set(Object.keys(workspaceLabels).filter(key=>key!=='factory').map(key=>`workspace:${key}`)));
 const inventory=useMemo(()=>capabilityInventory(data.runtime.capabilities||[]),[data.runtime.capabilities]);
 const filtered=filterCapabilityInventory(inventory,{query,workspace,domain,status}),rows=capabilityTableRows(filtered,collapsed);
 const domains=[...new Map(inventory.filter(row=>workspace==='all'||row.workspace===workspace).map(row=>[row.domainKey,{value:row.domainKey,label:`${row.workspaceLabel} / ${row.domain}`}])).values()];
 const actionOwners=inventory.filter(row=>row.operations.some(o=>o.kind==='ACTION'&&o.module_id===row.id));
 const registered=inventory.flatMap(row=>row.operations.filter(operation=>operation.module_id===row.id));
 const enabledReads=registered.filter(o=>o.kind==='READ'&&o.connection_enabled===true).length;
 const actions=registered.filter(o=>o.kind==='ACTION');
 const readyActions=actions.filter(o=>o.connection_enabled===true&&o.ai_execution_enabled===true).length;
 const clear=()=>{setQuery('');setWorkspace('all');setDomain('all');setStatus('all');};
 const activeFilters=[...(query?[{key:'query',label:'Search',value:query,onRemove:()=>setQuery('')}]:[]),...(workspace!=='all'?[{key:'workspace',label:'Workspace',value:workspaceLabels[workspace],onRemove:()=>{setWorkspace('all');setDomain('all');}}]:[]),...(domain!=='all'?[{key:'domain',label:'Domain',value:domains.find(item=>item.value===domain)?.label,onRemove:()=>setDomain('all')}]:[]),...(status!=='all'?[{key:'status',label:'AI access',value:capabilityStatuses[status],onRemove:()=>setStatus('all')}]:[])];
 const columns=[
  {key:'label',header:'Module',render:row=><span className="block pl-6 font-medium max-sm:pl-0">{row.label}<small className="block text-xs font-normal text-text-secondary">{coverageLabels[row.coverage.classification]} READ coverage</small></span>},
  {key:'read',header:'READ',width:100,className:'max-[700px]:!w-auto',render:row=>{
   const total=row.operations.filter(operation=>operation.kind==='READ').length;
   if(!total)return <span aria-label="Not supported" className="text-text-secondary">—</span>;
   if(!row.sharedReadCount)return total;
   const direct=total-row.sharedReadCount;
   return <span className="text-xs">{direct>0&&`${direct} direct · `}{row.sharedReadCount} shared</span>;
  }},
  {key:'action',header:'ACTION',width:80,render:row=>row.operations.filter(operation=>operation.kind==='ACTION').length||<span aria-label="Not supported" className="text-text-secondary">—</span>},
  {key:'status',header:'AI access',width:190,className:'max-[700px]:!w-auto',render:row=><Badge tone={tone(row.status)} className="whitespace-normal">{row.statusLabel}</Badge>},
  {key:'manage',header:'Manage',width:95,render:row=><button className="btn-secondary min-h-10" type="button" aria-label={`Manage ${row.label}`} onClick={()=>setSelected(row.id)}>Manage</button>},
 ];
 const selectedRow=inventory.find(row=>row.id===selected);
 return <section className="space-y-3" aria-label="AI Capabilities">
  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
   <h3 className="text-sm font-semibold">AI access policies</h3>
   {Array.isArray(data.runtime.capabilities)&&<div className="flex flex-wrap items-center gap-x-3 text-xs">
    <p className="text-text-secondary" aria-label="Registered capability coverage">{enabledReads} enabled READ · {readyActions} of {actions.length} ACTION policies ready</p>
    {actionOwners.map(row=><button key={row.id} type="button" className="min-h-10 font-medium text-primary-ink underline underline-offset-4" onClick={()=>setSelected(row.id)}>{row.label} actions</button>)}
   </div>}
  </div>
  <AdminFilterToolbar compact denseFields presentation="inline" search={<AdminSearchField label="Search modules" value={query} onChange={setQuery} placeholder="Module, domain or capability"/>} filters={<><SelectField label="Workspace" value={workspace} onChange={value=>{setWorkspace(value);setDomain('all');}} options={[{value:'all',label:'All'},...Object.entries(workspaceLabels).map(([value,label])=>({value,label}))]}/><SelectField label="Domain" value={domain} onChange={setDomain} options={[{value:'all',label:'All'},...domains]}/><SelectField label="AI access" value={status} onChange={setStatus} options={[{value:'all',label:'All'},...Object.entries(capabilityStatuses).map(([value,label])=>({value,label}))]}/></>} activeFilters={activeFilters} onClear={clear}/>
  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary"><p role="status">{filtered.length} of {inventory.length} business modules · {new Set(inventory.map(row=>row.workspace)).size} ownership groups · {new Set(inventory.map(row=>row.domainKey)).size} domains</p><div className="flex gap-3"><button type="button" className="min-h-10 hover:text-primary-ink focus-visible:outline" onClick={()=>setCollapsed(new Set())}>Expand all</button><button type="button" className="min-h-10 hover:text-primary-ink focus-visible:outline" onClick={()=>setCollapsed(new Set(inventory.map(row=>`workspace:${row.workspace}`)))}>Collapse all</button></div></div>
  {!Array.isArray(data.runtime.capabilities)&&<p role="status" className="text-sm text-text-secondary">AI access policies are unavailable. Refresh before changing access.</p>}
  {!filtered.length?<p className="py-6 text-sm text-text-secondary">No modules match these filters.</p>:<DataTable columns={columns} rows={rows} getRowKey={row=>row.id} density="compact" minWidth={600} mobileLayout="compact" getRowClassName={()=>'bg-surface'} renderGroupRow={row=>row.group?{level:row.group,content:<button type="button" aria-expanded={!collapsed.has(row.id)} onClick={()=>setCollapsed(previous=>{const next=new Set(previous);next.has(row.id)?next.delete(row.id):next.add(row.id);return next;})}><ChevronRight size={15} aria-hidden="true" className={collapsed.has(row.id)?'':'rotate-90'}/>{row.label}<small>{row.count} modules</small></button>}:null}/>}
  {selectedRow&&<AssistantCapabilityDetail key={selectedRow.id} row={selectedRow} onSelect={setSelected} data={data} canEdit={canEdit} busy={busy} onFeature={onFeature} onClose={()=>setSelected(null)}/>}
 </section>;
}
