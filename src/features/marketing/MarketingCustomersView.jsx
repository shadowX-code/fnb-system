import { useEffect, useState } from 'react';
import { Pencil, MessageCircle, Upload, Plus, Tags } from 'lucide-react';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import TagPicker from '../../components/forms/TagPicker.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import EmptyState from '../../components/feedback/EmptyState.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ColumnSettings from '../../components/tables/ColumnSettings.jsx';
import AdminSummaryGrid from '../../components/ui/AdminSummaryGrid.jsx';
import CustomerTagsDialog from './CustomerTagsDialog.jsx';
import {customerName,customerEdit,DEFAULT_CUSTOMER_COLUMNS,CUSTOMER_COLUMNS,preferredCustomerColumns,saveCustomerColumns,customerDate,posMetric,CUSTOMER_SORT_KEYS,CUSTOMER_SORT_OPTIONS,customerSortDirection,nextCustomerSort} from './customerPresentation.js';
import { contactLabel, contactState } from './customerContact.js';
import CustomerDetailDrawer from './CustomerDetailDrawer.jsx';
import { outreachService } from './outreachService.js';

export default function MarketingCustomersView({userId,org,brand,inactive=false,data,can,refresh,show,onImport,onChanged}) {
 const [filters,setFilters]=useState({search:'',consent:'',tags:[],outlet:'',status:'',sort:''}),[query,setQuery]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(20),[result,setResult]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState(''),[tagsOpen,setTagsOpen]=useState(false),[tagRefresh,setTagRefresh]=useState(0);
 useEffect(()=>{const id=setTimeout(()=>{setQuery(filters.search);setPage(1)},250);return()=>clearTimeout(id)},[filters.search]);
 useEffect(()=>{let live=true;setLoading(true);setError('');outreachService.customers(org,brand,{...filters,search:query},page,size).then(r=>{if(live)setResult(r)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[org,brand,query,filters.consent,JSON.stringify(filters.tags),filters.outlet,filters.status,filters.sort,page,size,refresh,tagRefresh]);
 const [columns,setColumns]=useState(()=>preferredCustomerColumns(userId));
 useEffect(()=>setColumns(preferredCustomerColumns(userId)),[userId]);
 const change=(key,value)=>{setFilters(f=>({...f,[key]:value}));setPage(1)};
 const openConsent=c=>show('consent',{id:c.id,state:contactState(c),source:'Customer request'});
 const actions=c=><CustomerActions customer={c} can={can} show={show} openConsent={openConsent}/>;
 return <section className="outreach-customers">
  <AdminSummaryGrid variant="compact" ariaLabel="Customer summary" items={[
   {key:'total',label:'Total Customers'}, {key:'subscribed',label:'WhatsApp Subscribers'},
   {key:'not_subscribed',label:'Not Subscribed'}, {key:'do_not_contact',label:'Do Not Contact'}
  ].map(item=>({...item,value:result?.summary?.[item.key],state:result?.summary?'ready':loading?'loading':'unavailable'}))}/>
  <div className="outreach-section-heading justify-end"><div className="outreach-actions"><ColumnSettings columns={CUSTOMER_COLUMNS.map(([key,label])=>({key,label,required:['name','actions'].includes(key)}))} value={columns} defaults={DEFAULT_CUSTOMER_COLUMNS} onChange={next=>{setColumns(next);saveCustomerColumns(userId,next)}}/>{can('platform_customers.manage')?<><button className="btn-secondary" onClick={()=>setTagsOpen(true)}><Tags size={15}/> Manage Tags</button><button className="btn-secondary" disabled={inactive} onClick={onImport}><Upload size={15}/> Import</button><button className="btn-primary" disabled={inactive} onClick={()=>show('customer',{language:'EN'})}><Plus size={15}/> Add customer</button></>:null}</div></div>
  <AdminFilterToolbar compact denseFields ariaLabel="Customer filters" search={<AdminSearchField ariaLabel="Search customers" placeholder="Name, phone or tag" value={filters.search} onChange={value=>change('search',value)}/>} filters={<>
   <SelectField label="WhatsApp consent" value={filters.consent} onChange={v=>change('consent',v)} options={[{value:'',label:'All'},{value:'eligible',label:'Subscribed'},{value:'required',label:'Not Subscribed'},{value:'suppressed',label:'Do Not Contact'}]}/>
   <TagPicker value={filters.tags} options={data.tags||[]} onChange={v=>change('tags',v)}/>
   {(data.outlets?.length>0||filters.outlet)?<SelectField label="Outlet" value={filters.outlet} onChange={v=>change('outlet',v)} options={[{value:'',label:'All'},...(data.outlets||[]).map(o=>({value:o.id,label:o.name}))]}/>:null}
  </>} moreFilters={<><SelectField label="Customer status" value={filters.status} onChange={v=>change('status',v)} options={[{value:'',label:'All'},{value:'active',label:'Active'},{value:'inactive',label:'Inactive'}]}/><SelectField label="Sort customers" value={filters.sort} onChange={v=>change('sort',v)} options={CUSTOMER_SORT_OPTIONS}/></>} activeFilters={Object.entries(filters).filter(([k,v])=>(Array.isArray(v)?v.length:v)&&k!=='search').map(([k,v])=>({key:k,label:({consent:'WhatsApp consent',tags:'Tags',outlet:'Outlet',status:'Status',sort:'Sort'})[k],value:Array.isArray(v)?v.join(', '):data.outlets?.find(o=>o.id===v)?.name||(k==='sort'?CUSTOMER_SORT_OPTIONS.find(o=>o.value===v)?.label:null)||({eligible:'Subscribed',required:'Not Subscribed',suppressed:'Do Not Contact',active:'Active',inactive:'Inactive',name_desc:'Name Z–A',activity:'Latest campaign activity'})[v]||v,onRemove:()=>change(k,k==='tags'?[]:'')}))} onClear={()=>{setFilters({search:'',consent:'',tags:[],outlet:'',status:'',sort:''});setPage(1)}}/>
  <AsyncDataSurface loading={loading} error={error} hasData={!!result}>{result?.customers.length?<>
   <DataTable density="compact" minWidth={columns.length>6?columns.length*125:780} rows={result.customers} getRowKey={c=>c.id} onRowClick={c=>setSelected(c.id)} getRowProps={c=>({tabIndex:0,'aria-label':`View ${customerName(c)}`,onKeyDown:e=>{if(e.target===e.currentTarget&&['Enter',' '].includes(e.key)){e.preventDefault();setSelected(c.id)}}})} columns={[
    ...CUSTOMER_COLUMNS.filter(([key])=>columns.includes(key)&&!['consent','activity','actions'].includes(key)).map(([key,label])=>({key,header:label,align:['total_visit','total_spent','avg_spent'].includes(key)?'right':undefined,...(CUSTOMER_SORT_KEYS.includes(key)?{sortDirection:customerSortDirection(filters.sort,key),onSort:()=>change('sort',nextCustomerSort(filters.sort,key))}:{}),render:c=>key==='name'?<div className="outreach-customer-name"><span aria-hidden="true" className="outreach-avatar">{c.display_name?.trim()?.slice(0,1)||'#'}</span><strong>{customerName(c)}</strong></div>:key==='tags'?<div className="outreach-tags">{c.tags?.length?c.tags.map(t=><Badge key={t}>{t}</Badge>):'—'}</div>:key==='outlet'?c.outlet_name||'—':key==='birthday'?customerDate(c.birthday):['total_visit','avg_spent','total_spent','last_visit','member_since'].includes(key)?<span title={c.pos_snapshot?`${c.pos_snapshot.source} · Snapshot ${c.pos_snapshot.snapshot_date}`:'No imported POS snapshot'}>{posMetric(c,key)}{c.pos_snapshot?.metrics?.[key]!==undefined?<small>Imported POS · {c.pos_snapshot.source}</small>:null}</span>:c[key]||'—'})),
    ...(columns.includes('consent')?[{key:'consent',header:'WhatsApp Consent',render:c=><Badge tone={contactState(c)==='do_not_contact'?'danger':contactState(c)==='subscribed'?'success':'default'}>{contactLabel(c)}</Badge>}]:[]),
    ...(columns.includes('activity')?[{key:'activity',header:'Last Activity',render:c=>c.last_activity?<><span>{new Date(c.last_activity).toLocaleDateString('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',year:'numeric'})}</span><small>Manual campaign handling</small></>:<span className="text-text-secondary">—</span>}]:[]),
    ...(columns.includes('actions')?[{key:'actions',header:'Actions',width:112,render:actions}]:[])
   ]}/>
   <AdminPagination total={result.total} page={page} pageSize={size} loading={loading} noun="customers" onPageChange={setPage} onPageSizeChange={v=>{setSize(v);setPage(1)}}/>
  </>:<EmptyState title={filters.search||Object.values(filters).some(v=>Array.isArray(v)?v.length:Boolean(v))?'No matching customers':'Build your brand audience'} description={filters.search||Object.values(filters).some(v=>Array.isArray(v)?v.length:Boolean(v))?'Adjust the filters to find customers.':'Add a customer or import a file. WhatsApp marketing consent is recorded separately.'}/>}</AsyncDataSurface>
 {tagsOpen?<CustomerTagsDialog key={brand} org={org} brand={brand} onClose={()=>setTagsOpen(false)} onChanged={()=>{setTagRefresh(v=>v+1);onChanged?.();}}/>:null}
 {selected?<CustomerDetailDrawer key={selected} org={org} brand={brand} customerId={selected} can={can} show={show} refresh={refresh} onClose={()=>setSelected('')}/>:null}
 </section>;
}

function CustomerActions({customer:c,can,show,openConsent}){return <div className="outreach-actions">{can('platform_customers.manage')?<button className="btn-secondary outreach-icon-button" aria-label={`Edit ${customerName(c)}`} title="Edit customer" onClick={()=>show('customer',customerEdit(c))}><Pencil size={16}/></button>:null}{can('marketing_audience.manage')?<button className="btn-secondary outreach-icon-button" aria-label={`WhatsApp consent for ${customerName(c)}`} title="WhatsApp consent" onClick={()=>openConsent(c)}><MessageCircle size={16}/></button>:null}</div>;}
