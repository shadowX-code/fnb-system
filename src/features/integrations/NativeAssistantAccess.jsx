import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import {assistantKnowledgeSources} from './assistantKnowledgeSources.js';

export default function NativeAssistantAccess({data,canEdit,busy,onFeature}){
 const enabled=!!data.config.factory_reads_enabled;
 const tool={name:'Factory Finished Goods',owner:'Factory',type:'Business tool',scope:'Read only',status:!enabled?'Disabled':data.runtime.tools?'Connected':'Access denied',
  access:!enabled?'Not evaluated while disabled':data.runtime.tools?'Current Admin permissions verified by server':'Your current Admin role cannot use this read',
  readiness:'Factory shared catalogue; no Company / Outlet attribution. Each read rechecks permissions and returns source, scope and time.'};
 const rows=[tool,...assistantKnowledgeSources.map(source=>({...source,type:'Managed knowledge',scope:'Registry only',status:'Not connected'}))].sort((a,b)=>['Factory','Crew Learning','People / Legal Entities','Marketing'].indexOf(a.owner)-['Factory','Crew Learning','People / Legal Entities','Marketing'].indexOf(b.owner));
 const columns=[
  {key:'owner',header:'Domain / owner',render:row=><span className="text-sm font-semibold">{row.owner}</span>},
  {key:'name',header:'Resource',render:row=><div className="space-y-1"><p className="text-sm font-medium">{row.name}</p><p className="text-xs text-text-secondary">{row.type} · {row.scope}</p></div>},
  {key:'status',header:'Availability',render:row=><Badge tone={row.status==='Connected'?'success':row.status==='Access denied'?'warning':'neutral'}>{row.status}</Badge>},
  {key:'access',header:'Authorization & readiness',render:row=><div className="max-w-lg space-y-2 text-xs"><p>{row.access}</p><p className="text-text-secondary">{row.readiness}</p>{row.version&&<details><summary className="cursor-pointer text-text-secondary">Version &amp; freshness</summary><p className="mt-2 text-text-secondary">{row.version} Current document freshness has not been checked here. Source-specific authorized retrieval is required before connection.</p></details>}</div>},
 ];
 return <section className="space-y-4" aria-label="Access and knowledge">
  <p className="text-sm text-text-secondary">Domain authorities retain ownership. Connected tools use existing Admin permissions; knowledge entries describe sources, not access grants.</p>
  <DataTable rows={rows} columns={columns} getRowKey={row=>row.name} density="compact" mobileLayout="stack" minWidth={760}/>
  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><label className="inline-flex items-center gap-2 text-sm"><input className="admin-checkbox" type="checkbox" checked={enabled} disabled={!canEdit||busy} onChange={e=>void onFeature('features',{expected_revision:data.config.revision,factory_reads_enabled:e.target.checked})}/> Enable Finished Goods reader</label><button type="button" className="btn-secondary" disabled={!canEdit||busy} onClick={()=>void onFeature('tool_test')}>Test Finished Goods read</button></div>
  <p className="text-xs text-text-secondary">This switch enables only the registered read tool; it grants no module access. The test checks current human permissions independently of Assistant enablement.</p>
  <div className="flex flex-wrap items-center gap-2 text-xs"><Badge>Unsupported</Badge><span className="text-text-secondary">Business writes and other module tools are not registered in Native Assistant.</span></div>
  <details className="text-xs text-text-secondary"><summary className="cursor-pointer">Business data, knowledge and personal memory</summary><dl className="mt-3 space-y-2"><div><dt className="font-semibold">Live Business Data</dt><dd>Authorized, current tool reads. Historical inventory is not current stock.</dd></div><div><dt className="font-semibold">Managed Knowledge</dt><dd>Canonical SOPs, QC, policy and document sources stay with their domain owners. Registry entries do not load or duplicate documents.</dd></div><div><dt className="font-semibold">Personal Memory</dt><dd>Private, explicitly saved user preferences; not shared knowledge or business records.</dd></div></dl></details>
 </section>;
}
