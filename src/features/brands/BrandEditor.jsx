import {useEffect,useRef,useState} from 'react';
import {Building2,Palette,Link2,Plus,Minus} from 'lucide-react';
import Drawer from '../../components/ui/Drawer.jsx';
import ConfirmDialog from '../../components/feedback/ConfirmDialog.jsx';
import AdminEditorSections from '../../components/forms/AdminEditorSections.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {brandService,mappingChanges,isQaOutlet} from '../../services/brandService.js';
import '../../components/forms/outletEditor.css';
import './brandEditor.css';
const sections=[{key:'general',label:'General',icon:Building2},{key:'branding',label:'Branding',icon:Palette},{key:'outlets',label:'Linked Outlets',icon:Link2}];
export default function BrandEditor({record,data,outletName,onClose,onSaved}) {
 const [name,setName]=useState(record?.name||''),[timezone,setTimezone]=useState(record?.timezone||'Asia/Kuala_Lumpur'),[scope,setScope]=useState(''),[ids,setIds]=useState(record?.outlet_ids||[]);
 const [section,setSection]=useState('general'),[review,setReview]=useState(false),[confirmed,setConfirmed]=useState(false),[query,setQuery]=useState(''),[showQa,setShowQa]=useState(false),[discard,setDiscard]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [accent,setAccent]=useState(record?.brand_accent_color||''),[logo,setLogo]=useState(null),[removed,setRemoved]=useState(false),[preview,setPreview]=useState(''),[uploadUncertain,setUploadUncertain]=useState(false);
 const request=useRef(null),prepared=useRef(null),saving=useRef(false),panel=useRef(null);
 const changes=mappingChanges(record?.outlet_ids,ids),mappingChanged=Boolean(changes.added.length+changes.removed.length);
 const dirty=name!==(record?.name||'')||timezone!==(record?.timezone||'Asia/Kuala_Lumpur')||mappingChanged||accent!==(record?.brand_accent_color||'')||!!logo||removed;
 const org=record?.organization_id||data.brands.find(b=>b.id===scope)?.organization_id||(!data.scope_brand_required?data.outlets.find(o=>o.organization_id)?.organization_id:null);
 useEffect(()=>{if(!logo){setPreview('');return}const url=URL.createObjectURL(logo);setPreview(url);return()=>URL.revokeObjectURL(url)},[logo]);
 useEffect(()=>{if(!dirty)return;const warn=e=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty]);
 useEffect(()=>{panel.current?.scrollTo?.({top:0})},[section,review]);
 const close=()=>{if(saving.current)return;if(dirty)setDiscard(true);else onClose()};
 const image=preview||(!removed&&record?.logo_path?brandService.logoUrl(record.logo_path,record.logo_version):'');
 const matches=o=>!query||[o.name,o.code,o.location].join(' ').toLowerCase().includes(query.toLowerCase());
 const linked=data.outlets.filter(o=>ids.includes(o.id)&&matches(o));
 const eligible=data.outlets.filter(o=>!ids.includes(o.id)&&o.is_active&&(!o.organization_id||o.organization_id===org||(!record&&!data.scope_brand_required))&&matches(o));
 const available=eligible.filter(o=>showQa||!isQaOutlet(o));
 const hiddenQa=eligible.filter(isQaOutlet).length;
 function reviewChanges(){
  if(!name.trim()){setSection('general');setError('Enter a Brand name.');return}
  if(accent&&!/^#[\da-fA-F]{6}$/.test(accent)){setSection('branding');setError('Use a six-digit accent color, such as #236647.');return}
  if(logo&&(!['image/jpeg','image/png','image/webp'].includes(logo.type)||logo.size<1||logo.size>2097152)){setSection('branding');setError('Choose a PNG, JPG or WebP logo up to 2 MB.');return}
  setError('');setReview(true);setConfirmed(!mappingChanged);
 }
 async function save(){
  if(saving.current||!confirmed||uploadUncertain)return;
  saving.current=true;setBusy(true);setError('');
  try{
   if(logo&&!prepared.current){
    try{prepared.current=await brandService.uploadLogo(record.id,record.revision,crypto.randomUUID(),logo)}
    catch(e){setUploadUncertain(true);throw new Error(`Logo upload needs verification. Close and reopen before another upload attempt. ${e.message}`)}
   }
   const payload={id:record?.id,expected_revision:record?.revision,name,timezone,outlet_ids:ids,mapping_confirmed:!mappingChanged||confirmed,brand_accent_color:accent,...(prepared.current?{logo_media_id:prepared.current}:removed?{logo_media_id:null}:{})};
   const fingerprint=JSON.stringify([scope,payload]);
   if(request.current?.fingerprint!==fingerprint)request.current={fingerprint,id:crypto.randomUUID()};
   await brandService.command('save_brand',scope,{...payload,request_id:request.current.id});onSaved();
  }catch(e){setError(e.message)}finally{saving.current=false;setBusy(false)}
 }
 function outletRow(o,selected){return <article className="brand-outlet-row" key={o.id}><div><strong>{o.name}</strong><div className="brand-outlet-meta"><span>{[o.code,o.location].filter(Boolean).join(' · ')||'Location not recorded'}</span><Badge tone={o.is_active?'success':'neutral'}>{o.is_active?'Active':'Inactive'}</Badge></div><p>{o.brands?.length?`Linked Brands: ${o.brands.map(b=>b.name).join(', ')}`:'No visible linked Brands'}</p></div><button type="button" className={selected?'btn-ghost btn-sm':'btn-secondary btn-sm'} disabled={busy} aria-label={`${selected?'Remove':'Add'} ${o.name}`} onClick={()=>{setIds(old=>selected?old.filter(id=>id!==o.id):[...old,o.id]);setConfirmed(false)}}>{selected?<Minus size={14}/>:<Plus size={14}/>} {selected?'Remove':'Add'}</button></article>}
 return <><Drawer title={record?`Edit ${record.name}`:'Add Brand'} description="Brand Master · Restaurant" width="xl" onClose={close} closeOnEscape={!discard&&!busy} closeOnOverlay={!busy} bodyClassName="outlet-editor-body" footer={<div className="outlet-service-footer"><span>{mappingChanged?`${changes.added.length} additions · ${changes.removed.length} removals pending`:dirty?'Unsaved changes':'No unsaved changes'}</span><div><button type="button" className="btn-secondary" disabled={busy} onClick={close}>Cancel</button>{review?<><button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setReview(false);setConfirmed(false)}}>Back</button><button type="button" className="btn-primary" disabled={busy||!confirmed||uploadUncertain} onClick={save}>{busy?'Saving…':'Save Brand'}</button></>:<button type="button" className="btn-primary" disabled={busy||!dirty||(data.scope_brand_required&&!record&&!scope)} onClick={reviewChanges}>Review Changes</button>}</div></div>}>
 <AdminEditorSections label="Brand sections" sections={sections} value={section} onChange={next=>{setSection(next);setReview(false);setError('')}} disabled={busy}/>
 <div className="outlet-editor-panel" ref={panel}>{error?<p role="alert" className="outlet-service-error">{error}</p>:null}
 {review?<div className="brand-mapping-review"><h3>Review Brand Changes</h3><p>{name} · {timezone}</p>{record&&name!==record.name?<p>Rename: {record.name} → {name}</p>:null}{accent!==(record?.brand_accent_color||'')?<p>Accent color: {accent||'Default'}</p>:null}{logo||removed?<p>Logo: {logo?'Replace with '+logo.name:'Remove active logo'} · Previous assets remain in history.</p>:null}<section><h4>Added Outlets</h4><p>{changes.added.map(outletName).join(', ')||'None'}</p></section><section><h4>Removed Outlets</h4><p>{changes.removed.map(outletName).join(', ')||'None'}</p></section><p className="text-text-secondary">Other Brand relationships and historical records stay unchanged.</p>{mappingChanged?<label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I confirm the added and removed Outlet mappings.</label>:<p>No Outlet mapping changes.</p>}</div>:<>
 <div className="outlet-editor-heading"><h3>{sections.find(s=>s.key===section).label}</h3><p>{{general:'Shared Brand identity and reporting timezone.',branding:'One Brand logo and accent for all Brand-scoped workspaces.',outlets:'Review exact relationships before saving. An Outlet can retain other authorized Brand links.'}[section]}</p></div>
 {section==='general'?<fieldset className="outlet-editor-grid" disabled={busy}>{!record&&data.scope_brand_required?<SelectField label="Brand access context" value={scope} onChange={id=>{setScope(id);setIds([])}} options={[{value:'',label:'Select existing Brand'},...data.brands.map(b=>({value:b.id,label:b.name}))]}/>:null}<AdminFormField label="Brand Name" required><input className="control" value={name} maxLength={120} onChange={e=>setName(e.target.value)}/></AdminFormField><SelectField label="Timezone" value={timezone} onChange={setTimezone} searchable options={[...new Set([timezone,'Asia/Kuala_Lumpur','Asia/Singapore','UTC',...(Intl.supportedValuesOf?.('timeZone')||[])])].map(value=>({value,label:value}))}/></fieldset>:null}
 {section==='branding'?<fieldset className="outlet-editor-form" disabled={busy}><AdminFormField label="Brand Logo"><div className="outlet-logo-preview">{image?<img src={image} alt="Brand logo preview"/>:<Building2 size={36}/>}<div><strong>{name||'Brand'}</strong><p>PNG, JPG or WebP · up to 2 MB</p></div></div>{record?<><input type="file" aria-label="Brand Logo" accept="image/png,image/jpeg,image/webp" onChange={e=>{setLogo(e.target.files?.[0]||null);setRemoved(false);prepared.current=null}}/>{image?<button type="button" className="btn-ghost w-fit" onClick={()=>{setLogo(null);setRemoved(!!record.logo_media_id);prepared.current=null}}>Remove logo</button>:null}</>:<p className="text-sm text-text-secondary">Save this Brand first, then upload its logo here.</p>}</AdminFormField><AdminFormField label="Accent Color"><div className="outlet-accent-control"><input type="color" aria-label="Accent Color picker" value={/^#[\da-fA-F]{6}$/.test(accent)?accent:'#236647'} onChange={e=>setAccent(e.target.value.toUpperCase())}/><input className="control" aria-label="Accent Color" value={accent} placeholder="#236647" onChange={e=>setAccent(e.target.value)}/><button type="button" className="btn-ghost" onClick={()=>setAccent('')}>Reset</button></div><span className="outlet-accent-preview"><span style={{background:/^#[\da-fA-F]{6}$/.test(accent)?accent:'var(--theme-primary)'}}/>Brand accent preview</span></AdminFormField></fieldset>:null}
 {section==='outlets'?<div className="brand-outlet-selector"><AdminSearchField label="Find Outlet" value={query} onChange={setQuery} placeholder="Search name, code or location…"/>{mappingChanged?<div role="status" className="brand-outlet-pending"><strong>Pending changes</strong>{changes.added.length?<p>Add: {changes.added.map(outletName).join(', ')}</p>:null}{changes.removed.length?<p>Remove: {changes.removed.map(outletName).join(', ')}</p>:null}</div>:null}<section><h4>Currently Linked <span>{ids.length}</span></h4>{linked.length?linked.map(o=>outletRow(o,true)):<p className="brand-outlet-empty">{query?'No linked Outlets match your search.':'No linked Outlets. Select an available Outlet below.'}</p>}{ids.filter(id=>!data.outlets.some(o=>o.id===id)).map(id=><p className="brand-outlet-empty" key={id}>Outlet outside your access · Existing relationship retained</p>)}</section><section><div className="brand-outlet-available-heading"><h4>Available Outlets <span>{available.length}</span></h4><label><input type="checkbox" checked={showQa} onChange={e=>setShowQa(e.target.checked)}/>Show QA / Demo{hiddenQa?` (${hiddenQa})`:''}</label></div>{available.length?available.map(o=>outletRow(o,false)):<p className="brand-outlet-empty">No eligible Outlets match. Search or show QA / Demo Outlets.</p>}</section></div>:null}
 </>}</div></Drawer><ConfirmDialog request={discard?{title:'Discard Brand changes?',message:'Saved Brand details, branding and relationships will remain unchanged.',confirmLabel:'Discard Changes',cancelLabel:'Continue Editing',danger:true}:null} onCancel={()=>setDiscard(false)} onConfirm={onClose}/></>;
}
