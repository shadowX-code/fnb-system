import {useEffect,useState} from 'react';
import {Utensils,ExternalLink,Pencil} from 'lucide-react';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/feedback/EmptyState.jsx';
import {canonicalPathForRoute} from '../../app/routeOwnership.js';
import {marketingService} from './marketingService.js';
export function productPrice(row){return row.current_price==null?'Not confirmed':`${row.currency} ${Number(row.current_price).toFixed(2)}`;}
export default function RestaurantProductLibrary({brandId,outlets,canEdit,onOpen,revision}){
 const [search,setSearch]=useState(''),[category,setCategory]=useState(''),[outlet,setOutlet]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(20),[read,setRead]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 const key=JSON.stringify([brandId,search,category,outlet,page,size,revision,retry]);
 useEffect(()=>{let live=true;setLoading(true);setError('');const timer=setTimeout(()=>marketingService.knowledgeProducts({brandId,search,category,outlet,page,size}).then(data=>{if(live)setRead({key,data})}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)}),200);return()=>{live=false;clearTimeout(timer)}},[key]);
 const data=read?.key===key?read.data:null,change=(setter)=>(v)=>{setter(v);setPage(1)};
 return <section className="knowledge-product-library">
  <AdminFilterToolbar compact denseFields ariaLabel="Restaurant product filters" search={<AdminSearchField label="Search products" value={search} onChange={change(setSearch)} placeholder="Search product, category or description"/>} filters={<><SelectField label="Category" value={category} onChange={change(setCategory)} options={[{value:'',label:'All categories'},...(read?.data.categories||[]).map(v=>({value:v,label:v}))]}/>{outlets.length>1?<SelectField label="Outlet" value={outlet} onChange={change(setOutlet)} options={[{value:'',label:'All linked Outlets'},...outlets.map(o=>({value:o.id,label:o.name}))]}/>:null}</>}/>
  <div className="knowledge-source-note"><span>Product Sales Analytics · latest available Outlet report</span><a href={canonicalPathForRoute('product_analytics')} className="knowledge-source-link">View at Source <ExternalLink size={12}/></a></div>
  {loading?<p role="status" className="knowledge-panel">Loading linked products…</p>:error?<div className="knowledge-feedback" role="alert">{error}<button className="btn-secondary btn-sm" onClick={()=>setRetry(v=>v+1)}>Retry</button></div>:data?.rows.length?<div className="knowledge-panel knowledge-menu-table"><DataTable density="compact" minWidth={740} rows={data.rows} getRowKey={r=>`${r.outlet_id}:${r.product_key}`} columns={[
   {key:'name',header:'Product',render:r=><div className="knowledge-product-name"><strong>{r.name}</strong>{r.supplement?.current&&r.supplement.data.signature?<Badge tone="info">Signature</Badge>:null}{r.variant?<small>{r.variant}</small>:null}<small>Observed {new Intl.DateTimeFormat('en-MY',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(r.report_year,r.report_month-1,1)))}</small></div>},
   {key:'category',header:'Category',render:r=>r.category||'Uncategorized'},
   {key:'outlet_id',header:'Outlet',render:r=>outlets.find(o=>o.id===r.outlet_id)?.name||'Source unavailable'},
   {key:'price',header:'Configured price',align:'right',render:productPrice},
   {key:'copy',header:'Marketing copy',render:r=><Badge tone={r.supplement?(r.supplement.current?'success':'warning'):'neutral'}>{r.supplement?(r.supplement.current?(r.supplement.data.customer_facing?'Ready for AI':'Saved · Not in AI'):'Review source change'):'Not added'}</Badge>},
   {key:'action',header:'',align:'right',render:r=><button className="btn-secondary btn-sm" onClick={()=>onOpen(r)}>{canEdit?<Pencil size={12}/>:null}{canEdit?'Edit copy':'View details'}</button>},
  ]}/><AdminPagination page={page} pageSize={size} total={data.total} onPageChange={setPage} onPageSizeChange={change(setSize)} noun="products"/></div>:<div className="knowledge-panel"><EmptyState title={search||category?'No matching products':outlets.length?'No linked product observations':'Link an Outlet to view its products'} description={outlets.length?'Products appear from completed Restaurant Product Sales reports. No duplicate product entry or PDF upload is required.':'Manage the existing Brand–Outlet relationship at source. Products will resolve from that relationship.'} icon={Utensils} className="knowledge-empty-state"/><a className="btn-secondary btn-sm" href={canonicalPathForRoute(outlets.length?'product_analytics':'brands')}>Manage at Source <ExternalLink size={12}/></a></div>}
  <p className="field-helper">Product observations are historical. Availability remains unconfirmed; review missing prices at the Restaurant source.</p>
 </section>;
}
