import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../../auth/AuthContext.jsx';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import {marketingService} from './marketingService.js';
import {resolveBrandContext,selectBrandContext} from './brandContext.js';
import SocialAccounts from './SocialAccounts.jsx';
import GoogleDriveSettings from './GoogleDriveSettings.jsx';
import BrandKnowledgeWorkspace from './BrandKnowledgeWorkspace.jsx';
import BrandAccessConsole from './BrandAccessConsole.jsx';
import './marketingSettings.css';
export function legacySettingsDestination(search=''){
 const query=new URLSearchParams(search),tab=query.get('tab');
 return tab==='knowledge'?'/marketing/brand-knowledge':tab==='access'?'/marketing/brand-access':'/marketing/connections';
}
const titles={connections:'Connections',knowledge:'Brand Knowledge',access:'Brand Access & Team Permissions'};
export default function MarketingSettingsPage({section='connections',ui}){
 const legacy=section==='legacy',page=legacy?({'/marketing/brand-knowledge':'knowledge','/marketing/brand-access':'access'}[legacySettingsDestination(window.location.search)]||'connections'):section;
 const auth=useAuth(),user=auth.user?.id,can=code=>auth.hasPermission(code);
 const [context,setContext]=useState(null),[contextRefresh,setContextRefresh]=useState(0),[org,setOrg]=useState(''),[brandId,setBrandId]=useState(''),[read,setRead]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const scope=useRef('');scope.current=JSON.stringify([user,org,brandId,page]);
 useEffect(()=>{if(!legacy)return;const url=new URL(window.location.href);url.pathname=legacySettingsDestination(url.search);window.history.replaceState(window.history.state,'',url);window.dispatchEvent(new PopStateEvent('popstate'));},[legacy]);
 useEffect(()=>{let live=true;setContext(null);setRead(null);setLoading(true);setError('');marketingService.context().then(c=>{if(!live)return;setContext(c);const query=new URLSearchParams(window.location.search);let saved='';try{saved=sessionStorage.getItem(`marketing.settings.brand.${user}`)||'';}catch{}const next=resolveBrandContext(c,query.get('marketing_brand')||saved,query.get('marketing_org'));if(page==='knowledge'&&!next.brand)next.brand=c.brands.find(b=>b.organization_id===next.org&&b.is_active!==false)?.id||c.brands.find(b=>b.organization_id===next.org)?.id||'';setOrg(next.org);setBrandId(next.brand);}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false};},[user,contextRefresh]);
 useEffect(()=>{if(!context||!org)return;let live=true;setRead(null);setError('');if(page==='connections')return;setLoading(true);const requested=scope.current;marketingService.read({organizationId:org,brandId,section:'settings'}).then(r=>{if(live&&requested===scope.current)setRead({key:requested,data:r})}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false};},[user,org,brandId,page,context,refresh]);
 useEffect(()=>{if(!context)return;try{sessionStorage.setItem(`marketing.settings.brand.${user}`,brandId)}catch{}},[brandId,context,user]);
 useEffect(()=>{if(page==='knowledge'&&context&&!brandId){const b=context.brands.find(b=>b.organization_id===org&&b.is_active!==false)||context.brands.find(b=>b.organization_id===org);if(b)setBrandId(b.id)}},[page,context,org,brandId]);
 const data=read?.key===scope.current?read.data:null;
 const brands=context?.brands.filter(b=>b.organization_id===org)||[],brand=brands.find(b=>b.id===brandId);
 return <WorkspacePage section="Marketing · Settings" title={titles[page]} wrapTitle={page==='access'} density="compact" controls={context?<div className="admin-scope-controls" aria-label="Settings Brand context"><SelectField label="Brand" value={brandId} onChange={v=>selectBrandContext(context,v,org,setOrg,setBrandId)} searchable="auto" options={[...(page==='knowledge'?[]:[{value:'',label:'All authorized brands'}]),...context.brands.map(b=>({value:b.id,label:b.name}))]}/></div>:null}>
 <AsyncDataSurface loading={loading} error={error} hasData={!!context} onRetry={()=>context?setRefresh(v=>v+1):setContextRefresh(v=>v+1)}>
 {context&&!org?<div className="card p-5 text-sm">Ask an administrator to grant Brand access and team permissions.</div>:null}
 {org&&page==='connections'?<div className="settings-connections"><SocialAccounts key={`${org}:${brandId}:${user}`} organizationId={org} brandId={brandId} brands={brands}/><GoogleDriveSettings key={`drive:${org}:${brandId}:${user}`} organizationId={org} brandId={brandId} brands={brands}/></div>:null}
 {org&&page==='knowledge'&&data?(brand?<BrandKnowledgeWorkspace key={`${org}:${brandId}:${user}`} brand={brand} data={data} can={can} onSaved={()=>{ui?.notify?.({title:'Brand Knowledge saved.',tone:'success'});setRefresh(v=>v+1)}}/>:<div className="card p-5 text-sm">Select an authorized Brand to view its knowledge.</div>):null}
 {org&&page==='access'&&data?<BrandAccessConsole key={`${org}:${brandId}:${user}`} org={org} brandId={brandId} brands={brands} data={data} auth={auth} onSaved={()=>setRefresh(v=>v+1)}/>:null}
 </AsyncDataSurface>
 </WorkspacePage>;
}
