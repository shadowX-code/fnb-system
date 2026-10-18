import {useEffect,useRef,useState} from 'react';
import {Plus,MoreHorizontal} from 'lucide-react';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ActionMenu from '../../components/ui/ActionMenu.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import BrandEditor from './BrandEditor.jsx';
import {brandService} from '../../services/brandService.js';
const all={value:'',label:'All'};
export default function BrandsPage(){
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[drawer,setDrawer]=useState(null),[menu,setMenu]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState('true'),[outlet,setOutlet]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(20),[notice,setNotice]=useState('');
 useEffect(()=>{let live=true;setLoading(true);setError('');brandService.read().then(r=>{if(live)setData(r)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[refresh]);
 useEffect(()=>{setPage(1)},[search,status,outlet]);
 const outletName=id=>data?.outlets.find(o=>o.id===id)?.name||'Outlet outside your access';
 const rows=(data?.brands||[]).filter(b=>(!status||String(b.is_active)===status)&&(!outlet||b.outlet_ids.includes(outlet))&&(!search||b.name.toLowerCase().includes(search.toLowerCase()))),safePage=Math.min(page,Math.max(1,Math.ceil(rows.length/size)));
 const open=(record,mode='edit')=>{setMenu('');setDrawer({record,mode})};
 const columns=[{key:'name',header:'Brand Name',render:b=><strong>{b.name}</strong>},{key:'status',header:'Status',render:b=><Badge tone={b.is_active?'success':'neutral'}>{b.is_active?'Active':'Inactive'}</Badge>},{key:'outlets',header:'Linked Outlets',render:b=><span>{b.outlet_ids.length?b.outlet_ids.map(outletName).join(', '):'No linked outlets'}</span>},{key:'actions',header:'Actions',align:'right',render:b=><ActionMenu open={menu===b.id} onOpenChange={v=>setMenu(v?b.id:'')} ariaLabel={`Actions for ${b.name}`} trigger={({toggle,ariaLabel})=><button className="icon-btn" aria-label={ariaLabel} onClick={toggle}><MoreHorizontal size={16}/></button>}><button role="menuitem" onClick={()=>open(b)}>Edit & Map Outlets</button><button role="menuitem" onClick={()=>open(b,'status')}>{b.is_active?'Deactivate':'Activate'}</button><button role="menuitem" onClick={()=>open(b,'history')}>View Change History</button></ActionMenu>}];
 return <WorkspacePage section="System" title="Brands" description="Manage shared brands and their Restaurant outlets." density="compact" actions={<button className="btn-primary" disabled={!data?.can_create} onClick={()=>open(null)}><Plus size={16}/>Add Brand</button>}>
 {notice?<p role="status" className="text-sm text-success">{notice}</p>:null}
 <AdminFilterToolbar compact search={<AdminSearchField label="Search" value={search} onChange={setSearch} placeholder="Search brands…"/>} filters={<><SelectField label="Status" value={status} onChange={setStatus} options={[all,{value:'true',label:'Active'},{value:'false',label:'Inactive'}]}/><SelectField label="Outlet" value={outlet} onChange={setOutlet} options={[all,...(data?.outlets||[]).map(o=>({value:o.id,label:o.name}))]} searchable="auto"/></>} onClear={()=>{setSearch('');setStatus('');setOutlet('')}}/>
 <AsyncDataSurface loading={loading} error={error} onRetry={()=>setRefresh(r=>r+1)} hasData={Boolean(data)}>{rows.length?<><div className="card overflow-hidden"><DataTable columns={columns} rows={rows.slice((safePage-1)*size,safePage*size)} density="compact" minWidth={720} getRowKey={r=>r.id} onRowClick={r=>open(r)} getRowProps={r=>({tabIndex:0,role:'button','aria-label':`View ${r.name}`,onKeyDown:e=>{if(e.target===e.currentTarget&&['Enter',' '].includes(e.key)){e.preventDefault();open(r)}}})}/></div><AdminPagination page={safePage} pageSize={size} total={rows.length} onPageChange={setPage} onPageSizeChange={v=>{setSize(v);setPage(1)}} noun="brands"/></>:<div className="card p-5 text-sm text-text-secondary">{data?.brands.length?'No brands match your filters.':'Add your first Brand. Linking an Outlet is optional.'}</div>}</AsyncDataSurface>
 {drawer&&data?<BrandDrawer key={`${drawer.record?.id||'new'}:${drawer.mode}`} {...drawer} data={data}  outletName={outletName} onClose={()=>setDrawer(null)} onSaved={()=>{setDrawer(null);setRefresh(r=>r+1);setNotice('Brand saved.')}}/>:null}
 </WorkspacePage>;
}
function BrandDrawer(props){return props.mode==='edit'?<BrandEditor {...props}/>:<BrandStatusHistory {...props}/>;}
function BrandStatusHistory({record,mode,data,outletName,onClose,onSaved}){
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const request=useRef(null);
 const history=data.events.filter(e=>e.brand_id===record?.id);
 async function save(){if(busy)return;setBusy(true);setError('');const payload={id:record.id,expected_revision:record.revision,is_active:!record.is_active,confirmed};if(!request.current)request.current=crypto.randomUUID();try{await brandService.command('set_brand_status','',{...payload,request_id:request.current});onSaved()}catch(e){setError(e.message)}finally{setBusy(false)}}
 const footer=<><button className="btn-secondary" disabled={busy} onClick={onClose}>Close</button>{mode==='status'?<button className="btn-primary" disabled={busy||!confirmed} onClick={save}>{busy?'Saving…':record.is_active?'Deactivate Brand':'Activate Brand'}</button>:null}</>;
 return <Drawer open title={mode==='status'?`${record.is_active?'Deactivate':'Activate'} ${record.name}`:mode==='history'?`${record.name} · Change History`:record?'Edit Brand':'Add Brand'} width="lg" onClose={()=>{if(!busy)onClose()}} footer={footer}>
 {error?<p role="alert" className="text-sm text-danger mb-3">{error}</p>:null}
 {mode==='history'?<div className="space-y-4">{history.length?history.map(e=><section key={e.id} className="rounded-lg border border-border p-3 text-sm space-y-2"><strong>{e.action==='platform_set_brand_status'?'Status changed':'Brand saved'}</strong><p className="text-text-secondary">{e.actor} · {new Date(e.created_at).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'})}</p>{e.details?.after?<><p>{e.details.after.name} · {e.details.after.is_active?'Active':'Inactive'}</p><p>Outlets: {(e.details.after.outlet_ids||[]).map(outletName).join(', ')||'None'}</p>{e.details.before?<p>Previously: {e.details.before.name} · {e.details.before.is_active?'Active':'Inactive'} · {(e.details.before.outlet_ids||[]).map(outletName).join(', ')||'No outlets'}</p>:null}</>:<p className="text-text-secondary">Earlier event retained; detailed changes were not recorded.</p>}</section>):<p className="text-sm text-text-secondary">No change history recorded.</p>}</div>:mode==='status'?<div className="space-y-4 text-sm"><p>{record.is_active?'New operational work will require reactivation. Existing scheduled work will not be cancelled.':'The Brand becomes available for new operational work.'}</p><p>Historical Marketing, CRM and Creator records, memberships and Meta/Drive connections remain intact.</p><dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-muted p-3"><dt>Scheduled posts</dt><dd>{record.impact.scheduled_posts}</dd><dt>Open collaborations</dt><dd>{record.impact.open_collaborations}</dd><dt>Meta connections</dt><dd>{record.impact.connections}</dd><dt>Linked outlets</dt><dd>{record.outlet_ids.length}</dd></dl><label className="flex gap-2 items-start"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I understand this Brand status change and its impact.</label></div>:null}
 </Drawer>;
}
