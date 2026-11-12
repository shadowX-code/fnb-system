import {useEffect, useState} from 'react';
import {Eye, Pencil, Plus, RefreshCw} from 'lucide-react';
import {useAuth} from '../../auth/AuthContext.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import {formatOperationalDateTime} from '../../lib/dateTime.js';
import {marketingService} from './marketingService.js';
import {numberedVariables} from '../../../supabase/functions/_shared/whatsappTemplateContent.mjs';
import {templateFields, WhatsAppTemplatePreview} from './WhatsAppTemplateCatalog.jsx';

import WhatsAppTemplateEditor from './WhatsAppTemplateEditor.jsx';
import {draftStorageKey, emptyTemplateDrafts, friendlyTemplateName, makeTemplateDraft, readTemplateDrafts, templateLanguageLabel} from './whatsappTemplateDrafts.js';
import './whatsappTemplates.css';

const allFilters={search:'',category:'',status:'',language:''};
const statusLabels = {APPROVED:'Approved',PENDING:'In review',REJECTED:'Rejected',PAUSED:'Paused',IN_APPEAL:'In appeal',DRAFT:'Draft'};
const statusLabel = status => statusLabels[status] || status.toLowerCase().replaceAll('_',' ').replace(/^./,letter=>letter.toUpperCase());

export default function WhatsAppTemplatesPage() {
 const auth=useAuth();
 const [context,setContext]=useState(null);
 const [brandId,setBrandId]=useState('');
 const [error,setError]=useState('');
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let current=true;
  setError('');
  setContext(null);
  marketingService.context().then(({brands})=>{
   if(!current)return;
   const active=brands.filter(brand=>brand.is_active!==false);
   const requested=new URLSearchParams(window.location.search).get('marketing_brand');
   setBrandId(active.find(brand=>brand.id===requested)?.id||active[0]?.id||'');
   setContext(active);
  }).catch(failure=>{if(current)setError(failure.message);});
  return()=>{current=false;};
 },[auth.user?.id,attempt]);
 const brand=context?.find(item=>item.id===brandId);
 const layout=children=><WorkspacePage section="Marketing · CRM" title="WhatsApp Templates" density="compact"
  controls={context?.length?<div className="wa-template-brand"><SelectField label="Brand" value={brandId} onChange={setBrandId}
   searchable="auto" options={context.map(item=>({value:item.id,label:item.name}))}/></div>:null}>
  {children}
 </WorkspacePage>;
 if(brand)return <WhatsAppTemplateWorkspace key={`${auth.user?.id}:${brandId}`} brand={brand}
  userId={auth.user?.id} wrapLibrary={layout}/>;
 return layout(<AsyncDataSurface loading={!context&&!error} error={error} hasData={Boolean(context)} onRetry={()=>setAttempt(value=>value+1)}>
  {context?<p className="card p-4">No active Brand is available.</p>:null}
 </AsyncDataSurface>);
}

export function WhatsAppTemplateWorkspace({brand,userId,readOnly=false,wrapLibrary}) {
 const [scope,setScope]=useState(null);
 const [catalog,setCatalog]=useState(null);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [selected,setSelected]=useState(null);
 const [editor,setEditor]=useState(null);
 const [filters,setFilters]=useState(allFilters);
 const [sync,setSync]=useState(0);
 const [busy,setBusy]=useState(true);
 const storageKey=userId&&!readOnly?draftStorageKey(userId,brand):null;
 const [local,setLocal]=useState(()=>storageKey?readTemplateDrafts(storageKey):emptyTemplateDrafts);
 const organizationId=brand.organization_id,brandId=brand.id;

 useEffect(()=>{
  let current=true;
  setBusy(true);
  setError('');
  marketingService.whatsappConnections(organizationId,brandId).then(async result=>{
   if(!current)return;
   const connection=result.connections.find(item=>item.brand_id===brandId);
   setScope(connection?{
    organizationId,brandId,connectionId:connection.id,generation:connection.credential_generation,
    test:connection.onboarding_mode==='cloud_api',
   }:null);
   if(!connection){setCatalog(null);return;}
   const refreshed=await marketingService.whatsappTemplateCatalog({organizationId,brandId,connectionId:connection.id,generation:connection.credential_generation});
   if(current)setCatalog(refreshed);
  }).catch(failure=>{
   if(current){setError(failure.message);setCatalog(null);}
  }).finally(()=>{if(current)setBusy(false);});
  return()=>{current=false;};
 },[brandId,organizationId,sync]);

 const refresh=()=>setSync(value=>value+1);
 const changeFilter=(key,value)=>setFilters(current=>({...current,[key]:value}));
 const metaRows=(catalog?.templates||[]).map(row=>({...row,friendly:local.labels[row.id]||friendlyTemplateName(row.name)}));
 const library=[...local.drafts.map(draft=>({...draft,id:`draft:${draft.draftId}`,status:'DRAFT'})),...metaRows];
 const rows=library.filter(row=>{
  const query=filters.search.trim().toLowerCase();
  return (!filters.category||row.category===filters.category)&&(!filters.status||row.status===filters.status)
   &&(!filters.language||row.language===filters.language)
   &&[row.friendly,row.name,templateLanguageLabel(row.language)].some(value=>value.toLowerCase().includes(query));
 });
 const current=metaRows.find(row=>row.id===selected);
 const editorSource=editor?.source?metaRows.find(row=>row.id===editor.source.id):null;
 const unavailable=busy?'Wait for the Meta catalog to finish refreshing.':
  !scope||!catalog?'An active WhatsApp connection and successful Meta sync are required to submit.':
  editor?.source&&(!editorSource?.canEdit||editorSource.revision!==editor.source.revision)?
   'The Meta template changed. Open its current version from the library before submitting another edit.':'';
 const connectionsHref=`/marketing/connections?provider=whatsapp&marketing_brand=${encodeURIComponent(brandId)}&marketing_org=${encodeURIComponent(organizationId)}`;

 function persist(change) {
  if(!storageKey)throw new Error('Local drafts are unavailable.');
  const next=change(readTemplateDrafts(storageKey));
  localStorage.setItem(storageKey,JSON.stringify(next));
  setLocal(next);
 }

 function storeDraft(draft) {
  persist(previous=>({...previous,drafts:[
   {...draft,savedAt:new Date().toISOString()},...previous.drafts.filter(item=>item.draftId!==draft.draftId),
  ]}));
 }

 function openEditor(row) {
  setSelected(null);
  setNotice('');
  const existing=row&&local.drafts.find(item=>item.source?.id===row.id);
  setEditor(existing||makeTemplateDraft(row,row?.friendly));
 }

 function closeEditor() {
  setEditor(null);
 }

 function saveDraft(draft) {
  storeDraft(draft);
  setFilters({...allFilters,status:'DRAFT'});
  setNotice('Draft saved in this browser.');
  closeEditor();
 }

 async function submitDraft(draft, template) {
  try{storeDraft({...draft,uncertain:true});}
  catch{throw Object.assign(new Error('This browser could not save the draft before submission. Try again after restoring browser storage.'),{code:'draft_storage_failed'});}
  const {test,...connection}=scope;
  let result;
  try{result=await marketingService.submitWhatsAppTemplate({...connection,template});}
  catch(failure){
   if(failure.code&&failure.code!=='whatsapp_template_outcome_uncertain'){
    try{storeDraft({...draft,uncertain:false});}catch{/* Keep the original recovery draft. */}
   }
   throw failure;
  }
  let message='Meta accepted the submission. The catalog shows the status returned by Meta.';
  try{
   persist(previous=>({drafts:previous.drafts.filter(item=>item.draftId!==draft.draftId),
    labels:{...previous.labels,[result.id]:draft.friendly.trim()}}));
  }catch{message='Meta accepted the submission. This browser could not clear the saved draft. Check the catalog before taking another action.';}
  setNotice(message);
  setFilters(allFilters);
  setCatalog(null);
  closeEditor();
  refresh();
 }

 const counts=library.reduce((totals,row)=>({...totals,[row.status]:(totals[row.status]||0)+1}),{});
 const statusOptions=[...new Set(library.map(row=>row.status))];
 const filterOptions=(key,label,values,labelFor)=>(
  <SelectField label={label} value={filters[key]} onChange={value=>changeFilter(key,value)}
   options={[{value:'',label:{category:'All categories',status:'All statuses',language:'All languages'}[key]},...values.map(value=>({value,label:labelFor(value)}))]}/>
 );
 if(editor)return <WhatsAppTemplateEditor key={editor.draftId} initial={editor} brandName={brand.name}
  scope={scope} unavailable={unavailable} onClose={closeEditor} onSave={saveDraft} onSubmit={submitDraft}
  onRefresh={()=>{closeEditor();refresh();}}
  onDiscard={id=>{persist(previous=>({...previous,drafts:previous.drafts.filter(item=>item.draftId!==id)}));setNotice('Draft discarded.');closeEditor();}}/>;

 const libraryView=<section className="wa-template-library" aria-label="WhatsApp template catalog">
  <div className="wa-template-library-header">
   <div className="wa-template-library-title">
    {!readOnly?<h2>Template Library</h2>:null}
    <div className="wa-template-sync" role="status">
     {scope?.test?<Badge tone="warning">Staging test account</Badge>:null}
     <Badge tone={busy?'neutral':error?'warning':catalog?'success':'neutral'}>
      {busy?'Checking Meta':error?'Sync unavailable':catalog?'Synced from Meta':'Connection required'}
     </Badge>
     {catalog?.checkedAt?<span>Last checked {formatOperationalDateTime(catalog.checkedAt)}</span>:null}
    </div>
   </div>
   <div className="wa-template-actions">
    <button className="btn-secondary" disabled={busy} onClick={refresh}><RefreshCw size={15} aria-hidden="true"/> Refresh from Meta</button>
    {!readOnly&&storageKey?<button className="btn-primary" onClick={()=>openEditor()}><Plus size={16} aria-hidden="true"/> New template</button>:null}
   </div>
  </div>
  {notice?<p role="status" className="wa-template-help">{notice}</p>:null}
  {error?<p role="alert" className="card p-3 text-sm">{error} {scope?.test?'Verify the test number in WhatsApp Chat’s Staging tools if its authorization expired.':<a href={connectionsHref}>Open Connections</a>}</p>:null}
  {!scope&&!busy&&!error?<div className="card space-y-2 p-3 text-sm"><p>Connect WhatsApp for this Brand to sync Meta templates.</p><a href={connectionsHref}>Open Connections</a></div>:null}
  {catalog||library.length?<div className="wa-template-list">
   {!readOnly?<div className="wa-template-counts" aria-label="Template counts">
    {[['','All'],['DRAFT','Drafts'],['PENDING','In review'],['APPROVED','Approved'],['REJECTED','Rejected']].map(([value,label])=>(
     <button type="button" key={label} aria-pressed={filters.status===value} onClick={()=>changeFilter('status',value)}>
      {label} <span>{value?(counts[value]||0):library.length}</span>
     </button>
    ))}
   </div>:null}
   <AdminFilterToolbar compact denseFields ariaLabel="Template filters"
    search={<AdminSearchField label="Search templates" placeholder="Friendly or Meta name" value={filters.search} onChange={value=>changeFilter('search',value)}/>}
    filters={readOnly?null:<>
     {filterOptions('category','Category',[...new Set(library.map(row=>row.category))],statusLabel)}
     {filterOptions('status','Status',statusOptions,statusLabel)}
     {filterOptions('language','Language',[...new Set(library.map(row=>row.language))],templateLanguageLabel)}
    </>}
    onClear={Object.values(filters).some(Boolean)?()=>setFilters(allFilters):undefined}/>
   {rows.length?<DataTable rows={rows} getRowKey={row=>row.id} density="compact" mobileLayout="stack" minWidth={560}
    columns={[
     {key:'name',header:'Template',render:row=><div className="wa-template-row-name">
      <strong>{row.friendly||'Untitled draft'}</strong>
      {row.name?<small>{row.name}</small>:null}
     </div>},
     {key:'category',header:'Category',render:row=>statusLabel(row.category)},
     {key:'language',header:'Language',render:row=>templateLanguageLabel(row.language)},
     {key:'status',header:'Status',render:row=><Badge tone={row.status==='APPROVED'?'success':row.status==='PENDING'?'warning':row.status==='REJECTED'?'danger':'neutral'}>
      {statusLabel(row.status)}
     </Badge>},
     {key:'variables',header:'Variables',render:row=>row.status==='DRAFT'?
      numberedVariables(row.header).length+numberedVariables(row.text).length:
      templateFields(row).length+row.components.flatMap(component=>component.buttons).filter(button=>button.needsValue).length},
     {key:'actions',header:'Actions',render:row=>row.status==='DRAFT'?
      <button className="btn-secondary" onClick={()=>{setNotice('');setEditor(row);}}><Pencil size={14} aria-hidden="true"/> Open draft</button>:
      <div className="wa-template-actions">
       <button className="btn-secondary" aria-label={`Preview ${row.friendly}`} onClick={()=>setSelected(row.id)}><Eye size={14} aria-hidden="true"/> Preview</button>
       {!readOnly&&row.canEdit?<button className="btn-secondary" aria-label={`Edit ${row.friendly}`} onClick={()=>openEditor(row)}><Pencil size={14} aria-hidden="true"/> Edit</button>:null}
      </div>},
    ]}/>:<p role="status" className="wa-template-empty">{library.length?'No templates match these filters.':'Meta returned no templates for this account.'}</p>}
  </div>:null}
  {current?<Drawer title={current.friendly} description={current.name} onClose={()=>setSelected(null)}
   footer={!readOnly&&current.canEdit?<button className="btn-primary" onClick={()=>openEditor(current)}>Edit template</button>:null}>
   <div className="space-y-3">
    <p className="text-sm">{statusLabel(current.category)} · {templateLanguageLabel(current.language)} · {statusLabel(current.status)}</p>
    <WhatsAppTemplatePreview template={current}/>
    {current.status==='REJECTED'?<p className="text-sm">Review Meta’s reason in WhatsApp Manager before resubmitting.</p>:null}
   </div>
  </Drawer>:null}
 </section>;
 return wrapLibrary?wrapLibrary(libraryView):libraryView;
}
