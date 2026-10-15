import {useState} from 'react';
import {Lock} from 'lucide-react';
import AdminFilterToolbar from '../../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../../components/forms/AdminSearchField.jsx';
import SelectField from '../../../components/forms/SelectField.jsx';
import DataTable from '../../../components/tables/DataTable.jsx';
import {getPermissionGroups,moduleRegistry,moduleWorkspace,workspaceLabels,permissionActionOrder,permissionActionLabels} from '../../../../config/modules.ts';
import './rolePermissionMatrix.css';

const registered=new Map(moduleRegistry.map(m=>[m.id,m]));
const modules=getPermissionGroups().flatMap(g=>g.modules.map(m=>({...m,section:g.label,workspace:moduleWorkspace(registered.get(m.key)),consumers:moduleRegistry.filter(r=>r.id!==m.key&&r.readPermission?.includes(`${m.key}.view`)).map(r=>r.label)})));
const workspaces=Object.keys(workspaceLabels).filter(w=>modules.some(m=>m.workspace===w));
export default function RolePermissionMatrix({permissions,onToggle,cellLocked=()=>false,readOnly=false,notice}){
 const [workspace,setWorkspace]=useState(()=>{const requested=new URLSearchParams(window.location.search).get('permission_workspace');return workspaces.includes(requested)?requested:''});
 const [moduleId,setModuleId]=useState(''),[search,setSearch]=useState('');
 const available=modules.filter(m=>!workspace||m.workspace===workspace),query=search.trim().toLowerCase();
 const visible=available.filter(m=>(!moduleId||m.key===moduleId)&&(!query||[m.label,m.key,m.section,...m.consumers,...Object.values(m.actions).map(a=>a.label)].join(' ').toLowerCase().includes(query)));
 const enabled=cell=>cell.codes.every(code=>permissions.has(code));
 return <section className="role-permission-matrix rounded-card border border-border bg-surface overflow-hidden" aria-label="Permission Matrix">
 <header className="p-4 border-b border-border"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-bold">Permission Matrix</h2><span className="text-xs text-text-secondary">{visible.length} modules · {readOnly?'Read-only':'Role actions'}</span></div>
 <AdminFilterToolbar compact search={<AdminSearchField label="Search" placeholder="Search modules or actions…" value={search} onChange={setSearch}/>} filters={<><SelectField label="Workspace" value={workspace} onChange={value=>{setWorkspace(value);setModuleId('')}} options={[{value:'',label:'All'},...workspaces.map(w=>({value:w,label:workspaceLabels[w]}))]}/><SelectField label="Module" value={moduleId} onChange={setModuleId} options={[{value:'',label:'All'},...available.map(m=>({value:m.key,label:workspace?m.label:`${m.label} · ${workspaceLabels[m.workspace]}`}))]} searchable="auto"/></>} onClear={()=>{setWorkspace('');setModuleId('');setSearch('')}}/>
 {notice?<div className="mt-3 text-sm text-text-secondary">{notice}</div>:null}</header>
 {workspaces.filter(w=>visible.some(m=>m.workspace===w)).map(w=>{
  const rows=visible.filter(m=>m.workspace===w),actions=permissionActionOrder.filter(a=>rows.some(m=>m.actions[a]));
  const columns=[{key:'module',header:'Module',width:230,sticky:true,render:m=><div className="permission-module"><small>{m.section}</small><strong>{m.label}</strong><span>{Object.values(m.actions).filter(enabled).length} active actions</span>{m.consumers.length?<small>Used by {m.consumers.join(' · ')}</small>:null}</div>},...actions.map(a=>({key:a,header:permissionActionLabels[a],render:m=>{
   const cell=m.actions[a];if(!cell)return <span className="permission-unavailable" aria-label="Not applicable">—</span>;
   const active=enabled(cell),locked=cellLocked(cell),label=`${m.label}: ${cell.label}`;
   return <div className="permission-cell">{readOnly?<span className={`permission-state ${active?'enabled':''}`} title={cell.label} aria-label={`${label} ${active?'Enabled':'Off'}`}>{active?'Enabled':'Off'}</span>:<button type="button" className={`permission-state ${active?'enabled':''}`} aria-label={label} aria-pressed={active} disabled={locked} title={locked?'You cannot modify permissions outside your own access.':cell.label} onClick={()=>onToggle?.(m,a,cell)}>{locked?<Lock size={12}/>:null}{active?'Enabled':'Off'}</button>}<small>{cell.label}</small></div>;
  }}))];
  return <section key={w} aria-label={`${workspaceLabels[w]} permissions`}><h3 className="permission-workspace-heading">{workspaceLabels[w]}</h3><DataTable columns={columns} rows={rows} getRowKey={m=>m.key} density="compact" mobileLayout="stack" minWidth={230+actions.length*100}/></section>;
 })}
 {!visible.length?<p className="p-6 text-sm text-text-secondary">No modules match these filters.</p>:null}
 </section>;
}
