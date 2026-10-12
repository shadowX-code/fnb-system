import { useEffect, useState } from 'react';
import { MoreHorizontal, Upload, Plus } from 'lucide-react';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import TagPicker from '../../components/forms/TagPicker.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import EmptyState from '../../components/feedback/EmptyState.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ActionMenu from '../../components/ui/ActionMenu.jsx';
import CustomerDetailDrawer from './CustomerDetailDrawer.jsx';
import { outreachService } from './outreachService.js';
const consentLabel=c=>c.suppressed?'Suppressed':c.eligible?'Opted in':c.consent?.decision==='withdrawn'?'Opted out':c.consent?.decision==='granted'?'Consent needs review':'Not opted in';
export default function MarketingCustomersView({org,brand,data,can,refresh,show,onImport}) {
 const [filters,setFilters]=useState({search:'',consent:'',tags:[],outlet:'',status:'',sort:''}),[query,setQuery]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(20),[result,setResult]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState('');
 useEffect(()=>{const id=setTimeout(()=>{setQuery(filters.search);setPage(1)},250);return()=>clearTimeout(id)},[filters.search]);
 useEffect(()=>{let live=true;setLoading(true);setError('');outreachService.customers(org,brand,{...filters,search:query},page,size).then(r=>{if(live)setResult(r)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[org,brand,query,filters.consent,JSON.stringify(filters.tags),filters.outlet,filters.status,filters.sort,page,size,refresh]);
 const change=(key,value)=>{setFilters(f=>({...f,[key]:value}));setPage(1)};
 const openConsent=c=>show('consent',{id:c.id,decision:'granted',occurred_at:new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)});
 const actions=c=><CustomerActions customer={c} can={can} show={show} openConsent={openConsent}/>;
 return <section className="outreach-customers">
  <div className="outreach-section-heading"><p>{result?`${result.total} ${result.total===1?'customer':'customers'}`:'Customers'}<small>Brand relationships and WhatsApp eligibility</small></p><div className="outreach-actions">{can('platform_customers.manage')?<><button className="btn-secondary" onClick={onImport}><Upload size={15}/> Import</button><button className="btn-primary" onClick={()=>show('customer',{language:'EN'})}><Plus size={15}/> Add customer</button></>:null}</div></div>
  <AdminFilterToolbar compact denseFields ariaLabel="Customer filters" search={<AdminSearchField ariaLabel="Search customers" placeholder="Name, phone or tag" value={filters.search} onChange={value=>change('search',value)}/>} filters={<>
   <SelectField label="WhatsApp consent" value={filters.consent} onChange={v=>change('consent',v)} options={[{value:'',label:'All'},{value:'eligible',label:'Opted in'},{value:'required',label:'Consent required'},{value:'suppressed',label:'Suppressed'}]}/>
   <TagPicker value={filters.tags} options={data.tags||[]} onChange={v=>change('tags',v)}/>
   <SelectField label="Outlet" value={filters.outlet} onChange={v=>change('outlet',v)} options={[{value:'',label:'All'},...(data.outlets||[]).map(o=>({value:o.id,label:o.name}))]}/>
  </>} moreFilters={<><SelectField label="Customer status" value={filters.status} onChange={v=>change('status',v)} options={[{value:'',label:'All'},{value:'active',label:'Active'},{value:'inactive',label:'Inactive'}]}/><SelectField label="Sort customers" value={filters.sort} onChange={v=>change('sort',v)} options={[{value:'',label:'Name A–Z'},{value:'name_desc',label:'Name Z–A'},{value:'activity',label:'Latest campaign activity'}]}/></>} activeFilters={Object.entries(filters).filter(([k,v])=>(Array.isArray(v)?v.length:v)&&k!=='search').map(([k,v])=>({key:k,label:k,value:Array.isArray(v)?v.join(', '):data.outlets?.find(o=>o.id===v)?.name||v,onRemove:()=>change(k,k==='tags'?[]:'')}))} onClear={()=>{setFilters({search:'',consent:'',tags:[],outlet:'',status:'',sort:''});setPage(1)}}/>
  <AsyncDataSurface loading={loading} error={error} hasData={!!result}>{result?.customers.length?<>
   <div className="outreach-desktop-table"><DataTable density="compact" minWidth={900} rows={result.customers} getRowKey={c=>c.id} columns={[
    {key:'name',header:'Customer',render:c=><div className="outreach-customer-name"><span aria-hidden="true" className="outreach-avatar">{c.display_name.slice(0,1)}</span><button className="outreach-name-button" onClick={()=>setSelected(c.id)}>{c.display_name}</button></div>},
    {key:'phone_e164',header:'Phone'},{key:'tags',header:'Tags',render:c=><div className="outreach-tags">{c.tags.length?c.tags.map(t=><Badge key={t}>{t}</Badge>):<span className="text-text-secondary">—</span>}</div>},
    {key:'brand_name',header:'Brand relationship'},{key:'outlet',header:'Outlet',render:c=>c.outlet_name||'Not assigned'},
    {key:'consent',header:'WhatsApp consent',render:c=><Badge tone={c.suppressed?'danger':c.eligible?'success':'default'}>{consentLabel(c)}</Badge>},
    {key:'activity',header:'Last activity',render:c=>c.last_activity?<><span>{new Date(c.last_activity).toLocaleDateString('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',year:'numeric'})}</span><small>Manual campaign handling</small></>:<span className="text-text-secondary">No campaign activity</span>},
    {key:'actions',header:'Actions',width:74,render:actions}
   ]}/></div>
   <div className="outreach-mobile-list">{result.customers.map(c=><article key={c.id}><div className="outreach-section-heading"><button className="outreach-name-button" onClick={()=>setSelected(c.id)}>{c.display_name}</button>{actions(c)}</div><p>{c.phone_e164}</p><small>{c.brand_name} · {c.outlet_name||'No outlet assigned'}</small><div className="outreach-actions"><Badge tone={c.suppressed?'danger':c.eligible?'success':'default'}>{consentLabel(c)}</Badge>{c.tags.map(t=><Badge key={t}>{t}</Badge>)}</div></article>)}</div>
   <AdminPagination total={result.total} page={page} pageSize={size} loading={loading} noun="customers" onPageChange={setPage} onPageSizeChange={v=>{setSize(v);setPage(1)}}/>
  </>:<EmptyState title={filters.search||Object.values(filters).some(v=>Array.isArray(v)?v.length:Boolean(v))?'No matching customers':'Build your brand audience'} description={filters.search||Object.values(filters).some(v=>Array.isArray(v)?v.length:Boolean(v))?'Adjust the filters to find customers.':'Add a customer or import a file. WhatsApp marketing consent is recorded separately.'}/>}</AsyncDataSurface>
 {selected?<CustomerDetailDrawer key={selected} org={org} brand={brand} customerId={selected} can={can} show={show} refresh={refresh} onClose={()=>setSelected('')}/>:null}
 </section>;
}

function CustomerActions({customer:c,can,show,openConsent}){const [open,setOpen]=useState(false); return <ActionMenu open={open} onOpenChange={setOpen} ariaLabel={`Actions for ${c.display_name}`} trigger={({toggle,ariaLabel})=><button className="btn-secondary outreach-icon-button" aria-label={ariaLabel} onClick={toggle}><MoreHorizontal size={17}/></button>}><div role="menu">{can('platform_customers.manage')?<button role="menuitem" onClick={()=>{setOpen(false);show('customer',{customer_id:c.id,name:c.display_name,phone:c.phone_e164,language:c.language,tags:c.tags,outlet_id:c.outlet_id||'',edit:true,revision:c.revision,snapshot:c.snapshot})}}>Edit customer</button>:null}{can('marketing_audience.manage')?<><button role="menuitem" onClick={()=>{setOpen(false);openConsent(c)}}>Record consent</button><button role="menuitem" onClick={()=>{setOpen(false);show(c.suppressed?'unsuppress':'suppress',{id:c.id,reason:'Customer opt-out'})}}>{c.suppressed?'Review suppression':'Suppress'}</button></>:null}</div></ActionMenu>;
}
