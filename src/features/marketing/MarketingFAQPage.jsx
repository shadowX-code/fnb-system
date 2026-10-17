import {useEffect,useRef,useState} from 'react';
import {MoreHorizontal} from 'lucide-react';
import {useAuth} from '../../auth/AuthContext.jsx';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminUnderlineTabs from '../../components/navigation/AdminUnderlineTabs.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ActionMenu from '../../components/ui/ActionMenu.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import {marketingService} from './marketingService.js';
import {inboxService} from './inboxService.js';
import {resolveBrandContext,selectBrandContext} from './brandContext.js';
import Modal from '../../components/feedback/Modal.jsx';
import {FAQ_CATEGORIES,faqCategoryLabel} from './faqCategories.js';
import InboxFAQEditor from './InboxFAQEditor.jsx';
import InboxKnowledgeSettings from './InboxKnowledgeSettings.jsx';
import './marketing.css';
import './marketingInbox.css';
import './marketingFAQ.css';
const freshFAQ=()=>({question:'',answer:'',language:'EN',category:'general',alternative_questions:[],revision:0});
export default function MarketingFAQPage(){
 const auth=useAuth(),can=action=>auth.hasPermission(`marketing_inbox.${action}`),user=auth.user?.id;
 const [context,setContext]=useState(null),[org,setOrg]=useState(''),[brand,setBrand]=useState(''),[read,setRead]=useState(null),[configuration,setConfiguration]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0),[edit,setEdit]=useState(null);
 const [search,setSearch]=useState(''),[status,setStatus]=useState(''),[category,setCategory]=useState(''),[tab,setTab]=useState('library'),[menu,setMenu]=useState(null),[history,setHistory]=useState(null);
 const scope=JSON.stringify([user,org,brand]),active=useRef(scope),request=useRef(null);active.current=scope;
 const data=read?.scope===scope?read.data:null;
 useEffect(()=>{let live=true;setContext(null);setRead(null);setError('');marketingService.context().then(value=>{if(!live)return;setContext(value);const q=new URLSearchParams(location.search),next=resolveBrandContext(value,q.get('marketing_brand'),q.get('marketing_org'));const first=value.brands.find(b=>b.organization_id===next.org&&b.is_active!==false);setOrg(next.org);setBrand(next.brand||first?.id||'')}).catch(e=>{if(live)setError(e.message)});inboxService.configuration().then(value=>{if(live)setConfiguration(value)}).catch(()=>{});return()=>{live=false}},[user]);
 useEffect(()=>{setEdit(null);setHistory(null);setBusy(false);request.current=null;setNotice('');setCategory('');setStatus('');setSearch('');setMenu(null)},[scope]);
 useEffect(()=>{let live=true;setRead(previous=>previous?.scope===scope?previous:null);setError('');if(!brand){setLoading(false);return()=>{live=false}}setLoading(true);inboxService.faqSettings(brand).then(value=>{if(live)setRead({scope,data:value})}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[scope,refresh]);
 async function configure(command,revision,payload={}){const expected=active.current;const fp=JSON.stringify([scope,command,revision,payload]);if(request.current?.fp!==fp)request.current={fp,id:crypto.randomUUID()};setBusy(true);setMenu(null);setError('');try{const result=await inboxService.configure(request.current.id,brand,revision,command,payload);if(expected!==active.current)return;request.current=null;setEdit(null);setHistory(null);setNotice(command==='save_faq'?(payload.is_active?'FAQ saved and active.':'FAQ saved inactive.'):command==='activate_faq'?'FAQ activated.':command==='deactivate_faq'?'FAQ deactivated.':'Settings saved.');setRefresh(v=>v+1);return result}catch(e){if(expected===active.current)setError(e.message)}finally{if(expected===active.current)setBusy(false)}}
 const knowledgeHref=auth.hasPermission('marketing_settings.view')?`/marketing/brand-knowledge?marketing_brand=${brand}&marketing_org=${org}`:null;
 const faqs=data?.faqs||[],brandName=context?.brands.find(b=>b.id===brand)?.name||'';
 const categories=data?.categories||FAQ_CATEGORIES;
 const visible=faqs.filter(f=>(!status||(status==='active'?f.is_active:!f.is_active))&&(!category||f.category===category)&&[f.question,f.answer,...(f.alternative_questions||[])].join(' ').toLowerCase().includes(search.toLowerCase()));
 async function showHistory(f){const expected=active.current;setMenu(null);setError('');try{const value=await inboxService.faqHistory(brand,f.id);if(expected===active.current)setHistory(value)}catch(e){if(expected===active.current)setError(e.message)}}
 const columns=[
 {key:'question',header:'Question / Answer',priority:'primary',render:f=><div className="faq-table-copy"><button className="faq-title-button" onClick={()=>setEdit(f)} disabled={!can('configure')}>{f.question}</button><p>{f.answer}</p></div>},
 {key:'category',header:'Category',render:f=><>{faqCategoryLabel(f.category)}{f.legacy_category&&f.category==='others'?<small className="faq-library-limit"> · {f.legacy_category}</small>:null}</>},
 {key:'status',header:'Status',render:f=><div className="faq-table-support"><Badge tone={f.is_active?'success':'neutral'}>{f.is_active?'Active':'Inactive'}</Badge>{f.is_active&&f.use_issue?<p>{f.use_issue}</p>:null}</div>},
 {key:'actions',header:'Actions',render:f=><ActionMenu open={menu===f.id} onOpenChange={open=>setMenu(open?f.id:null)} ariaLabel={`Actions for ${f.question}`} trigger={({open,toggle,ariaLabel})=><button className="icon-btn" aria-label={ariaLabel} aria-expanded={open} disabled={busy||loading} onClick={toggle}><MoreHorizontal size={16}/></button>}><>{can('configure')?<><button role="menuitem" onClick={()=>{setMenu(null);setEdit(f)}}>Edit</button><button role="menuitem" onClick={()=>configure(f.is_active?'deactivate_faq':'activate_faq',f.revision,{id:f.id})}>{f.is_active?'Deactivate':'Activate'}</button></>:null}<button role="menuitem" onClick={()=>showHistory(f)}>History</button></></ActionMenu>}];
 return <WorkspacePage section="Marketing · Settings" title="FAQ & AI" density="compact" controls={context?<div className="admin-scope-controls"><SelectField label="Brand" value={brand} onChange={value=>selectBrandContext(context,value,org,setOrg,setBrand)} searchable="auto" options={context.brands.map(b=>({value:b.id,label:b.name}))}/></div>:null} actions={can('configure')&&brand?<button className="btn-primary" disabled={busy||loading||!data||faqs.length>=100} title={faqs.length>=100?'The 100-FAQ limit has been reached.':undefined} onClick={()=>setEdit(freshFAQ())}>New FAQ</button>:null}>
 {error?<p role="alert" className="text-danger">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
 <AsyncDataSurface loading={loading} error={!data?error:''} hasData={Boolean(data)} onRetry={()=>setRefresh(v=>v+1)}>
 {data?<><p className="faq-library-limit">Manage your Brand’s customer-service answers and supplemental policies. Active FAQs can suggest replies; staff always decides what to send.</p>
 <AdminUnderlineTabs ariaLabel="FAQ & AI sections" value={tab} onChange={setTab} tabs={[{value:'library',label:'FAQ Library'},{value:'settings',label:'AI & Reply Settings'}]}/>
 {tab==='library'?<><div className="faq-status-counts" aria-label="FAQ status counts">{[['','All'],['active','Active'],['inactive','Inactive']].map(([value,label])=><button key={value} className={`btn-secondary ${status===value?'is-active':''}`} aria-pressed={status===value} onClick={()=>setStatus(value)}>{label} <span>{value?faqs.filter(f=>value==='active'?f.is_active:!f.is_active).length:faqs.length}</span></button>)}</div>
 <AdminFilterToolbar compact search={<AdminSearchField label="Search FAQs" value={search} onChange={setSearch} placeholder="Question, answer or alternative phrasing…"/>} filters={<SelectField label="Category" searchable value={category} onChange={setCategory} options={[{value:'',label:'All categories'},...categories]}/>}/>
 {visible.length?<DataTable density="compact" mobileLayout="stack" minWidth={760} columns={columns} rows={visible} getRowKey={f=>f.id}/>:<div className="faq-empty"><h2>{faqs.length?'No matching FAQs':'Create your first FAQ'}</h2><p>{faqs.length?'Adjust the search, category or status filter.':'Add a common question and a useful answer. Save it active for suggestions, or inactive to prepare it first.'}</p></div>}<p className="faq-library-limit">{faqs.length}/100 FAQs · Inactive records retain their history. Activation never sends a message.</p></>:<InboxKnowledgeSettings data={data} configuration={configuration} can={can} busy={busy} configure={configure} onKnowledge={knowledgeHref}/>}</>:null}
 </AsyncDataSurface>
 {edit&&can('configure')?<InboxFAQEditor key={`${brand}:${edit.id||'new'}`} faq={edit} data={data} brandName={brandName} busy={busy} onClose={()=>setEdit(null)} onSave={value=>configure('save_faq',value.revision,{id:value.id,question:value.question,answer:value.answer,language:value.language||'EN',category:value.category,alternative_questions:value.alternative_questions,is_active:value.is_active})}/>:null}
 {history?<Modal title="FAQ history" onClose={()=>setHistory(null)} footer={<button className="btn-secondary" onClick={()=>setHistory(null)}>Close</button>}><div className="marketing-inbox-form"><strong>{history.current?.question}</strong><p>Revision {history.current?.revision} · {history.current?.is_active?'Active':'Inactive'}</p>{history.current?.approved_by?<p>Historical approval evidence retained for the original lifecycle.</p>:null}{history.events?.length?history.events.map((e,i)=><details key={i}><summary>{new Date(e.created_at).toLocaleString()} · {e.action.replace('inbox_','').replaceAll('_',' ')}</summary>{e.details?.before?<p>Before: {e.details.before.answer}</p>:null}<p>{e.details?.after?.answer}</p></details>):<p>No publication events in this recent window. Historical approvals and revisions remain preserved.</p>}</div></Modal>:null}

 </WorkspacePage>;
}
