import {useEffect, useState} from 'react';
import {SlidersHorizontal} from 'lucide-react';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import ActionMenu from '../../components/ui/ActionMenu.jsx';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/feedback/EmptyState.jsx';
import {adsMetric, adsMetricNames, adsResultLabel, insightFor, campaignResult} from './adsPresentation.js';
const optional = ['impressions','reach','clicks','ctr','cpc','cpm'];
const statusTone = status => status === 'ACTIVE' ? 'success' : status === 'PAUSED' ? 'neutral' : 'warning';
export default function AdsCampaigns({accounts,account,onAccount,report,brands,canReview,onReview,onDetail}) {
  const [level,setLevel]=useState('campaign'),[parent,setParent]=useState(''),[search,setSearch]=useState(''),[assignment,setAssignment]=useState('all'),[status,setStatus]=useState(''),[resultType,setResultType]=useState('link_click'),[sort,setSort]=useState('spend'),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(20),[extras,setExtras]=useState([]),[columnsOpen,setColumnsOpen]=useState(false);
  useEffect(()=>{setParent('');setLevel('campaign');setResultType('link_click');},[account]);
  useEffect(()=>setPage(1),[level,parent,search,assignment,status,resultType,account,sort,pageSize]);
  const campaign = row => level==='campaign'?row:report?.configs?.campaigns?.find(c=>c.id===row.campaign_id);
  const configs = report?.configs?.[level==='campaign'?'campaigns':level==='adset'?'adsets':'ads'] || [];
  const filtered = configs.filter(r=>(!parent || r[level==='adset'?'campaign_id':'adset_id']===parent) && (!search || `${r.name} ${r.id}`.toLowerCase().includes(search.toLowerCase())) && (!status || r.effective_status===status) && (assignment==='all' || (assignment==='assigned'?Boolean(campaign(r)?.feedx_brand_id):!campaign(r)?.feedx_brand_id)));
  const spend = row => insightFor(report,level,row.id)?.metrics?.spend?.value;
  const sorted = [...filtered].sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):(spend(b) ?? -1)-(spend(a) ?? -1)||a.name.localeCompare(b.name));
  const currentPage = Math.min(page,Math.max(1,Math.ceil(sorted.length/pageSize))), rows = sorted.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const result = row => campaignResult(insightFor(report,level,row.id),campaign(row),resultType);
  const currency = report?.account?.currency || accounts.find(a=>a.id===account)?.health?.currency;
  const brandName = row => brands.find(b=>b.id===campaign(row)?.feedx_brand_id)?.name || 'Unassigned';
  const resultTypes = [...new Set(['link_click', ...(report?.insights?.[level] || []).flatMap(r=>(r.actions || []).map(a=>a.type))])];
  const resultCell = row => {const item=result(row);return <><span>{adsMetric({value:item?.value},'clicks')}</span><small className="block text-xs text-text-secondary">{item?.label || 'Select a result type'}</small></>};
  const columns = [
    {key:'name',header:level==='campaign'?'Campaign':level==='adset'?'Ad Set':'Ad',className:'ads-campaign-name',render:r=><button className="ads-detail-link" onClick={()=>onDetail(r,level,level!=="ad"?()=>drill(r):null)}>{r.name}</button>},
    {key:'brand',header:'Brand',render:brandName},
    {key:'spend',header:'Spend',align:'right',render:r=>adsMetric(insightFor(report,level,r.id)?.metrics?.spend,'spend',currency)},
    {key:'results',header:'Results',align:'right',render:resultCell},
    {key:'cost',header:'Cost/Result',align:'right',render:r=>adsMetric({value:result(r)?.cost},'spend',currency)},
    {key:'status',header:'Status',render:r=><Badge semantic tone={statusTone(r.effective_status)}>{r.effective_status?.replaceAll('_',' ') || 'Unavailable'}</Badge>},
    ...extras.map(key=>({key,header:adsMetricNames[key],align:'right',render:r=>adsMetric(insightFor(report,level,r.id)?.metrics?.[key],key,currency)})),
  ];
  const drill = row => {setParent(row.id);setLevel(level==='campaign'?'adset':'ad')};
  return <section className="ads-campaigns" aria-label="Campaign performance">
    <AdminFilterToolbar compact denseFields ariaLabel="Campaign filters" secondaryActions={<>
      {canReview && report && <button className="btn-secondary" onClick={onReview}>Review Brand attribution</button>}
      <ActionMenu open={columnsOpen} onOpenChange={setColumnsOpen} ariaLabel="Campaign columns" width={220} trigger={({open,toggle})=><button className="btn-secondary" aria-haspopup="menu" aria-expanded={open} onClick={toggle}><SlidersHorizontal size={14}/>Columns</button>}><fieldset className="ads-column-options"><legend>Additional metrics</legend>{optional.map(key=><label key={key}><input type="checkbox" checked={extras.includes(key)} onChange={e=>setExtras(e.target.checked?[...extras,key]:extras.filter(k=>k!==key))}/>{adsMetricNames[key]}</label>)}</fieldset></ActionMenu>
    </>}>
      <AdminSearchField label="Search campaigns" placeholder="Campaign name or ID" value={search} onChange={setSearch}/>
      <SelectField label="Ad Account" value={account} onChange={onAccount} options={accounts.map(a=>({value:a.id,label:a.name}))}/>
      <SelectField label="Brand attribution" value={assignment} onChange={setAssignment} options={[{value:'all',label:'All campaigns'},{value:'unassigned',label:'Unassigned'},{value:'assigned',label:'Assigned'}]}/>
      <SelectField label="Status" value={status} onChange={setStatus} options={[{value:'',label:'All statuses'},...[...new Set(configs.map(r=>r.effective_status).filter(Boolean))].map(value=>({value,label:value.replaceAll('_',' ')}))]}/>
    </AdminFilterToolbar>
    <div className="ads-campaign-options">
      <SelectField label="Level" value={level} onChange={v=>{setLevel(v);setParent('')}} options={[{value:'campaign',label:'Campaigns'},{value:'adset',label:'Ad Sets'},{value:'ad',label:'Ads'}]}/>
      <SelectField label="Result type" value={resultType} onChange={setResultType} options={[{value:'',label:'By campaign objective'},...resultTypes.map(value=>({value,label:adsResultLabel(value)}))]}/>
      <SelectField label="Sort" value={sort} onChange={setSort} options={[{value:'spend',label:'Spend · highest first'},{value:'name',label:'Name · A–Z'}]}/>
      {parent && <button className="btn-secondary" onClick={()=>setParent('')}>Show all {level==='adset'?'Ad Sets':'Ads'}</button>}
    </div>
    <p className="text-xs text-text-secondary">{report?.scope==='organization'?'Shared-account campaigns · Unassigned spend is excluded from Brand dashboards.':'Confirmed Brand campaigns only.'} Results use one labeled Meta action; missing rows remain unavailable.</p>
    {!report?<EmptyState title="Advertising data not synchronized" description="Initial reporting is automatic. Check Ad Accounts for progress or recovery."/>:!rows.length?<EmptyState title="No matching campaigns" description="Adjust search, status or Brand attribution filters. Missing reporting is never shown as zero."/>:<>
      <div className="ads-desktop"><DataTable density="compact" minWidth={extras.length?900:740} columns={columns} rows={rows} getRowKey={r=>r.id}/></div>
      <div className="ads-mobile">{rows.map(r=><article className="ads-panel" key={r.id}><div className="ads-account"><button className="ads-detail-link" onClick={()=>onDetail(r,level,level!=="ad"?()=>drill(r):null)}>{r.name}</button><Badge>{r.effective_status || 'Unavailable'}</Badge></div><p className="text-xs text-text-secondary">{brandName(r)}</p><dl className="ads-mobile-performance"><div><dt>Spend</dt><dd>{adsMetric(insightFor(report,level,r.id)?.metrics?.spend,'spend',currency)}</dd></div><div><dt>Results</dt><dd>{resultCell(r)}</dd></div><div><dt>Cost/Result</dt><dd>{adsMetric({value:result(r)?.cost},'spend',currency)}</dd></div></dl></article>)}</div>
      <AdminPagination page={currentPage} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={setPageSize}/>
    </>}
  </section>;
}
