import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ChevronRight,Facebook,HardDrive,Instagram,MessageCircle} from 'lucide-react';
import {useAuth} from '../../auth/AuthContext.jsx';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import {marketingService} from './marketingService.js';
import {resolveBrandContext,selectBrandContext} from './brandContext.js';
import SocialAccounts from './SocialAccounts.jsx';
import WhatsAppConnections from './WhatsAppConnections.jsx';
import GoogleDriveSettings from './GoogleDriveSettings.jsx';
import BrandKnowledgeWorkspace from './BrandKnowledgeWorkspace.jsx';
import BrandAccessConsole from './BrandAccessConsole.jsx';
import './marketingSettings.css';
export function legacySettingsDestination(search=''){
 const query=new URLSearchParams(search),tab=query.get('tab');
 return tab==='knowledge'?'/marketing/brand-knowledge':tab==='access'?'/marketing/brand-access':'/marketing/connections';
}
const titles={connections:'Connections',knowledge:'Brand Knowledge',access:'Team & Brand Access'};
const providers=[
 {id:'facebook',name:'Facebook',description:'Pages, publishing, inbox and insights',Icon:Facebook},
 {id:'instagram',name:'Instagram',description:'Professional accounts, publishing, inbox and insights',Icon:Instagram},
 {id:'whatsapp',name:'WhatsApp Business',description:'Business numbers and customer conversations',Icon:MessageCircle},
 {id:'drive',name:'Google Drive',description:'Shared media and Brand folders',Icon:HardDrive},
];
function providerFromLocation(){
 const query=new URLSearchParams(window.location.search);
 if(query.has('provider'))return providers.find(p=>p.id===query.get('provider'))?.id||'';
 if(query.has('drive_result'))return 'drive';
 if(query.has('meta_result')){
  try{if(sessionStorage.getItem('marketing.meta.connectionsProvider')==='instagram')return 'instagram';}catch{}
  return 'facebook';
 }
 return '';
}
export default function MarketingSettingsPage({section='connections',ui}){
 const legacy=section==='legacy',page=legacy?({'/marketing/brand-knowledge':'knowledge','/marketing/brand-access':'access'}[legacySettingsDestination(window.location.search)]||'connections'):section;
 const auth=useAuth(),user=auth.user?.id,can=code=>auth.hasPermission(code);
 const [context,setContext]=useState(null),[contextRefresh,setContextRefresh]=useState(0),[org,setOrg]=useState(''),[brandId,setBrandId]=useState(''),[read,setRead]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const [provider,setProvider]=useState(providerFromLocation);
 useEffect(()=>{
  const restore=()=>setProvider(providerFromLocation());
  window.addEventListener('popstate',restore);
  return()=>window.removeEventListener('popstate',restore);
 },[]);
 function openProvider(id){
  const url=new URL(window.location.href);
  url.searchParams.set('provider',id);
  if(!id){url.searchParams.delete('meta_result');url.searchParams.delete('meta_reason');url.searchParams.delete('drive_result');}
  window.history.pushState(window.history.state,'',url);
  setProvider(id);
 }
 const selected=providers.find(p=>p.id===provider);
 const scope=useRef('');scope.current=JSON.stringify([user,org,brandId,page]);
 useEffect(()=>{if(!legacy)return;const url=new URL(window.location.href);url.pathname=legacySettingsDestination(url.search);window.history.replaceState(window.history.state,'',url);window.dispatchEvent(new PopStateEvent('popstate'));},[legacy]);
 useEffect(()=>{let live=true;setContext(null);setRead(null);setLoading(true);setError('');marketingService.context().then(c=>{if(!live)return;setContext(c);const query=new URLSearchParams(window.location.search);let saved='';try{saved=sessionStorage.getItem(`marketing.settings.brand.${user}`)||'';}catch{}const next=resolveBrandContext(c,query.get('marketing_brand')||saved,query.get('marketing_org'));if(page==='knowledge'&&!next.brand)next.brand=c.brands.find(b=>b.organization_id===next.org&&b.is_active!==false)?.id||c.brands.find(b=>b.organization_id===next.org)?.id||'';setOrg(next.org);setBrandId(next.brand);}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false};},[user,contextRefresh]);
 useEffect(()=>{if(!context||!org)return;let live=true;setError('');if(page==='connections'||page==='access'){setLoading(false);return;}setLoading(true);const requested=scope.current;marketingService.knowledgeWorkspace(brandId).then(r=>{if(live&&requested===scope.current)setRead({key:requested,data:r})}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false};},[user,org,brandId,page,context,refresh]);
 useEffect(()=>{if(!context)return;try{sessionStorage.setItem(`marketing.settings.brand.${user}`,brandId)}catch{}},[brandId,context,user]);
 useEffect(()=>{if(page==='knowledge'&&context&&!brandId){const b=context.brands.find(b=>b.organization_id===org&&b.is_active!==false)||context.brands.find(b=>b.organization_id===org);if(b)setBrandId(b.id)}},[page,context,org,brandId]);
 const data=read?.key===scope.current?read.data:null;
 const brands=context?.brands.filter(b=>b.organization_id===org)||[],brand=brands.find(b=>b.id===brandId);
 return <WorkspacePage section="Marketing · Settings" title={page==='connections'&&selected?selected.name:titles[page]} wrapTitle={page==='access'} density="compact" controls={context&&(page==='knowledge'||page==='connections'&&selected)?<div className="admin-scope-controls" aria-label="Settings Brand context"><SelectField label="Brand" value={brandId} onChange={v=>selectBrandContext(context,v,org,setOrg,setBrandId)} searchable="auto" options={[...(page==='knowledge'?[]:[{value:'',label:'All'}]),...context.brands.map(b=>({value:b.id,label:b.name}))]}/></div>:null}>
 <AsyncDataSurface loading={loading} error={error} hasData={!!context} onRetry={()=>context?setRefresh(v=>v+1):setContextRefresh(v=>v+1)}>
 {context&&!org?<div className="card p-5 text-sm">Ask an administrator to grant Brand access and team permissions.</div>:null}
 {org&&page==='connections'?<div className="settings-connections">
  {selected?<button className="btn-secondary settings-directory-back" onClick={()=>openProvider('')}><ArrowLeft size={16}/> All connections</button>:null}
  {!selected?<section className="card settings-provider-directory" aria-label="Connection providers">
   {providers.map(({id,name,description,Icon})=><button key={id} aria-label={name} aria-describedby={`connection-provider-${id}`} onClick={()=>openProvider(id)}>
    <span className={`settings-platform-icon ${id}`}><Icon size={20} aria-hidden="true"/></span>
    <span><strong>{name}</strong><small id={`connection-provider-${id}`}>{description}</small></span><ChevronRight size={17} aria-hidden="true"/>
   </button>)}
  </section>:null}
  {provider==='facebook'||provider==='instagram'?<SocialAccounts key={`${provider}:${org}:${brandId}:${user}`} channel={provider} organizationId={org} brandId={brandId} brands={brands}/>:null}
  {provider==='whatsapp'?<WhatsAppConnections key={user} organizationId={org} brandId={brandId} brands={brands} onBrandChange={id=>selectBrandContext(context,id,org,setOrg,setBrandId)}/>:null}
  {provider==='drive'?<GoogleDriveSettings key={`drive:${org}:${brandId}:${user}`} organizationId={org} brandId={brandId} brands={brands}/>:null}
 </div>:null}
 {org&&page==='knowledge'&&data?(brand?<BrandKnowledgeWorkspace key={`${org}:${brandId}:${user}`} brand={brand} data={data} can={can} onSaved={()=>{ui?.notify?.({title:'Brand Knowledge saved.',tone:'success'});setRefresh(v=>v+1)}}/>:<div className="card p-5 text-sm">Select an authorized Brand to view its knowledge.</div>):null}
 {org&&page==='access'?<BrandAccessConsole key={`${org}:${user}`} org={org} brands={brands} auth={auth} onSaved={()=>setRefresh(v=>v+1)}/>:null}
 </AsyncDataSurface>
 </WorkspacePage>;
}
