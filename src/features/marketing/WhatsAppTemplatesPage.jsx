import {useEffect, useRef, useState} from 'react';
import {useAuth} from '../../auth/AuthContext.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import {formatOperationalDateTime} from '../../lib/dateTime.js';
import {marketingService} from './marketingService.js';
import {templateFields, WhatsAppTemplatePreview} from './WhatsAppTemplateCatalog.jsx';

const categories = [{value:'UTILITY',label:'Utility'},{value:'MARKETING',label:'Marketing'}];
const statusLabels = {APPROVED:'Approved',PENDING:'In review',REJECTED:'Rejected',PAUSED:'Paused',IN_APPEAL:'In appeal'};
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
 return <WorkspacePage section="Marketing · CRM" title="WhatsApp Templates" density="compact"
  controls={context?.length?<SelectField label="Brand" value={brandId} onChange={setBrandId}
   searchable="auto" options={context.map(item=>({value:item.id,label:item.name}))}/>:null}>
  <AsyncDataSurface loading={!context&&!error} error={error} hasData={Boolean(context)} onRetry={()=>setAttempt(value=>value+1)}>
   {brand?<WhatsAppTemplateWorkspace key={`${auth.user?.id}:${brandId}`} brand={brand}/>:context?<p className="card p-4">No active Brand is available.</p>:null}
  </AsyncDataSurface>
 </WorkspacePage>;
}

export function WhatsAppTemplateWorkspace({brand,readOnly=false}) {
 const [scope,setScope]=useState(null);
 const [catalog,setCatalog]=useState(null);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [selected,setSelected]=useState(null);
 const [editor,setEditor]=useState(null);
 const [search,setSearch]=useState('');
 const [sync,setSync]=useState(0);
 const [busy,setBusy]=useState(true);
 useEffect(()=>{
  let current=true;
  const organizationId=brand.organization_id,brandId=brand.id;
  setBusy(true);
  setError('');
  marketingService.whatsappConnections(organizationId,brandId).then(async result=>{
   if(!current)return;
   const connection=result.connections.find(item=>item.brand_id===brandId);
   setScope(connection?{organizationId,brandId,connectionId:connection.id,generation:connection.credential_generation,test:connection.onboarding_mode==='cloud_api'}:null);
   if(!connection){setCatalog(null);return;}
   const refreshed=await marketingService.whatsappTemplateCatalog({organizationId,brandId,connectionId:connection.id,generation:connection.credential_generation});
   if(current)setCatalog(refreshed);
  }).catch(failure=>{
   if(current){setError(failure.message);setCatalog(null);}
  }).finally(()=>{if(current)setBusy(false);});
  return()=>{current=false;};
 },[brand.id,brand.organization_id,sync]);
 const refresh=()=>setSync(value=>value+1);
 const rows=(catalog?.templates||[]).filter(row=>[row.name,row.language,row.category,statusLabel(row.status)].some(value=>value.toLowerCase().includes(search.trim().toLowerCase())));
 const current=catalog?.templates.find(row=>row.id===selected);
 const detail=()=>setSelected(null);
 const connectionsHref=`/marketing/connections?provider=whatsapp&marketing_brand=${encodeURIComponent(brand.id)}&marketing_org=${encodeURIComponent(brand.organization_id)}`;
 return <section className="space-y-3" aria-label="WhatsApp template catalog">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div className="space-y-1">
    <div className="flex flex-wrap items-center gap-2">
     {scope?.test?<Badge tone="warning">Staging test account</Badge>:null}
     <Badge tone={busy?'neutral':error?'warning':catalog?'success':'neutral'}>{busy?'Checking Meta':error?'Sync unavailable':catalog?'Synced from Meta':'Connection required'}</Badge>
    </div>
    {catalog?.checkedAt?<p className="text-sm text-text-secondary">Last checked {formatOperationalDateTime(catalog.checkedAt)}</p>:null}
   </div>
   <div className="flex flex-wrap gap-2">
    <button className="btn-secondary" disabled={busy} onClick={refresh}>Refresh from Meta</button>
    {!readOnly&&catalog?<button className="btn-primary" disabled={busy} onClick={()=>{setNotice('');setEditor({});}}>New template</button>:null}
   </div>
  </div>
  {notice?<p role="status" className="text-sm">{notice}</p>:null}
  {error?<p role="alert" className="card p-4 text-sm">{error} {scope?.test?'Verify the test number in WhatsApp Chat’s Staging tools if its authorization expired.':<a href={connectionsHref}>Open Connections</a>}</p>:null}
  {!scope&&!busy&&!error?<div className="card space-y-2 p-4"><p>Connect WhatsApp for this Brand to see its templates.</p><a href={connectionsHref}>Open Connections</a></div>:null}
  {catalog?<><AdminFormField label="Search templates"><input type="search" className="control w-full" value={search} onChange={event=>setSearch(event.target.value)}/></AdminFormField>
   {rows.length?<DataTable rows={rows} getRowKey={row=>row.id} density="compact" mobileLayout="stack" minWidth={520}
    columns={[
     {key:'name',header:'Template',render:row=><button type="button" className="break-all text-left font-semibold text-primary" onClick={()=>setSelected(row.id)}>{row.name}</button>},
     {key:'category',header:'Category',render:row=>statusLabel(row.category)},
     {key:'language',header:'Language',render:row=>row.language},
     {key:'status',header:'Meta status',render:row=><Badge tone={row.status==='APPROVED'?'success':row.status==='PENDING'?'warning':row.status==='REJECTED'?'danger':'neutral'}>{statusLabel(row.status)}</Badge>},
     {key:'variables',header:'Variables',render:row=>templateFields(row).length+row.components.flatMap(component=>component.buttons).filter(button=>button.needsValue).length},
    ]}/>:<p role="status" className="card p-4">{search?'No templates match this search.':'Meta returned no templates for this account.'}</p>}
  </>:null}
  {current&&!editor?<Drawer title="Template details" description={current.name} onClose={detail}
   footer={!readOnly&&current.canEdit?<button className="btn-primary" onClick={()=>{setNotice('');setEditor(current);}}>Edit template</button>:null}>
   <div className="space-y-3">
    <p className="text-sm">{statusLabel(current.category)} · {current.language} · {statusLabel(current.status)}</p>
    <WhatsAppTemplatePreview template={current}/>
    {current.status==='REJECTED'?<p className="text-sm">Review Meta’s reason in WhatsApp Manager before resubmitting.</p>:null}
    {!readOnly&&!current.canEdit?<p className="text-sm text-text-secondary">Editing is unavailable for this template or its current status.</p>:null}
   </div>
  </Drawer>:null}
  {editor?<TemplateEditor record={editor} scope={scope} onClose={()=>setEditor(null)}
   onResult={message=>{setNotice(message);setEditor(null);setSelected(null);setCatalog(null);refresh();}}/>:null}
 </section>;
}

function TemplateEditor({record,scope,onClose,onResult}) {
 const [name,setName]=useState(record.name||'');
 const [language,setLanguage]=useState(record.language||'en');
 const [category,setCategory]=useState(record.category||'UTILITY');
 const [text,setText]=useState(record.components?.[0]?.text||'');
 const [samples,setSamples]=useState({});
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [refreshRequired,setRefreshRequired]=useState(false);
 const sending=useRef(false);
 const preview={components:[{type:'BODY',text,buttons:[]}]};
 const fields=templateFields(preview);
 const sampleValues=fields.map(field=>samples[field.key]||'');
 const valid=Boolean(text.trim()&&sampleValues.every(value=>value.trim())
  &&(record.id||(/^[a-z0-9_]{1,512}$/.test(name)&&/^[a-z]{2,3}(?:_[A-Za-z]{2,8}){0,2}$/.test(language))));
 async function submit(event) {
  event.preventDefault();
  if(!valid||refreshRequired||sending.current)return;
  sending.current=true;
  setBusy(true);
  setError('');
  const {test,...connection}=scope;
  const identity=record.id?{id:record.id,revision:record.revision}:{name,language,category};
  try{
   await marketingService.submitWhatsAppTemplate({...connection,template:{...identity,text,samples:sampleValues}});
   onResult('Meta accepted the submission. Refresh the catalog for its current review status.');
  }catch(failure){
   setError(failure.message);
   if(!failure.code||['whatsapp_template_outcome_uncertain','whatsapp_template_stale','whatsapp_template_duplicate','whatsapp_template_edit_unavailable'].includes(failure.code))setRefreshRequired(true);
  }
  finally{sending.current=false;setBusy(false);}
 }
 const close=()=>{if(!sending.current)onClose();};
 return <Drawer title={record.id?'Edit WhatsApp template':'New WhatsApp template'} onClose={close}
  closeOnEscape={!busy} closeOnOverlay={!busy}
  footer={refreshRequired?<button type="button" className="btn-secondary" onClick={()=>onResult(error)}>Refresh catalog</button>:<button type="submit" form="whatsapp-template-editor" className="btn-primary" disabled={busy||!valid}>{busy?'Submitting…':'Submit to Meta for review'}</button>}>
  <form id="whatsapp-template-editor" className="space-y-3" onSubmit={submit}>
   <p className="text-sm text-text-secondary">FeedX supports text-only Utility and Marketing templates. Meta reviews every submission.</p>
   {record.id?<p className="break-all text-sm">{name} · {language} · {statusLabel(category)}</p>:<>
    <AdminFormField label="Template name"><input className="control w-full" value={name} onChange={event=>setName(event.target.value)} maxLength={512} required disabled={busy} placeholder="reservation_reminder"/></AdminFormField>
    <SelectField label="Category" value={category} onChange={setCategory} options={categories} disabled={busy}/>
    <AdminFormField label="Language code"><input className="control w-full" value={language} onChange={event=>setLanguage(event.target.value)} maxLength={12} required disabled={busy} placeholder="en or en_US"/></AdminFormField>
   </>}
   <AdminFormField label="Message body"><textarea className="control w-full" rows={5} maxLength={1024} required value={text} disabled={busy}
    placeholder="Your reservation for {{1}} is confirmed." onChange={event=>setText(event.target.value)}/></AdminFormField>
   {fields.map(field=><AdminFormField key={field.key} label={`Example for {{${field.name}}}`}><input className="control w-full" maxLength={100} required disabled={busy}
    value={samples[field.key]||''} onChange={event=>setSamples(values=>({...values,[field.key]:event.target.value}))}/></AdminFormField>)}
   <WhatsAppTemplatePreview template={preview} values={samples}/>
   {error?<p role="alert" className="text-sm">{error}</p>:null}
  </form>
 </Drawer>;
}
