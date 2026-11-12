import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, Link2, MessageCircle, Phone, Plus, Trash2} from 'lucide-react';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import {compileTemplateComponents, numberedVariables, templateNamePattern, templateValidationMessages} from '../../../supabase/functions/_shared/whatsappTemplateContent.mjs';
import {generateMetaTemplateName, templateLanguageLabel, templateLanguages} from './whatsappTemplateDrafts.js';

export const templateCategories = [{value:'UTILITY',label:'Utility'},{value:'MARKETING',label:'Marketing'}];
const buttonOptions = [
 {value:'QUICK_REPLY',label:'Quick reply',Icon:MessageCircle},
 {value:'URL',label:'Visit website',Icon:Link2},
 {value:'PHONE_NUMBER',label:'Call phone',Icon:Phone},
];
const refreshCodes=['whatsapp_template_stale','whatsapp_template_duplicate','whatsapp_template_edit_unavailable'];
const renderText=(text, values)=>text.replace(/{{([1-9]\d*)}}/g,(token,key)=>values[key]?.trim()||token);

export default function WhatsAppTemplateEditor({initial,brandName,scope,unavailable,onClose,onSave,onSubmit,onRefresh,onDiscard}) {
 const [draft,setDraft]=useState(initial);
 const [error,setError]=useState('');
 const [confirm,setConfirm]=useState('');
 const [busy,setBusy]=useState(false);
 const [refreshRequired,setRefreshRequired]=useState(Boolean(initial.uncertain));
 const [validationShown,setValidationShown]=useState(false);
 const bodyInput=useRef(null);
 const headerInput=useRef(null);
 const sending=useRef(false);
 const dirty=JSON.stringify(draft)!==JSON.stringify(initial);
 const update=values=>setDraft(current=>({...current,...values}));
 const bodyVariables=numberedVariables(draft.text);
 const headerHasVariable=numberedVariables(draft.header).length>0;
 const samples=bodyVariables.map(key=>draft.samples[key]||'');
 const submission={text:draft.text,samples,header:draft.header,headerSample:draft.headerSample,footer:draft.footer,buttons:draft.buttons};
 const compiled=compileTemplateComponents(submission);
 const issue=!draft.friendly.trim()?'Enter a friendly name.':
  !templateNamePattern.test(draft.name)?'Use lowercase letters, numbers and underscores for the Meta template name.':
  templateValidationMessages[compiled.error];
 const langs=templateLanguages.some(item=>item.value===draft.language)?templateLanguages:
  [{value:draft.language,label:templateLanguageLabel(draft.language)},...templateLanguages];

 useEffect(()=>{
  if(!dirty&&!busy)return;
  const warn=event=>{event.preventDefault();event.returnValue='';};
  const guard=event=>{
   if(event.destination.sameDocument&&event.cancelable&&new URL(event.destination.url).pathname!==window.location.pathname
    &&(busy||!window.confirm('Leave without saving changes to this draft?')))event.preventDefault();
  };
  window.addEventListener('beforeunload',warn);
  window.navigation?.addEventListener('navigate',guard);
  return()=>{
   window.removeEventListener('beforeunload',warn);
   window.navigation?.removeEventListener('navigate',guard);
  };
 },[dirty,busy]);

 function insertVariable(key,input,limit) {
  const field=input.current;
  const text=draft[key];
  const start=field?.selectionStart??text.length, end=field?.selectionEnd??start;
  const existing=numberedVariables(text);
  const next=String(Math.max(0,...existing.map(Number))+1);
  const left=text.slice(0,start),right=text.slice(end);
  const insert=`${left&&!/\s$/.test(left)?' ':''}{{${next}}}${right&&!/^[\s.,!?]/.test(right)?' ':''}`;
  const value=left+insert+right;
  if(value.length>limit)return;
  const ordered=numberedVariables(value);
  const renumbered=value.replace(/{{([1-9]\d*)}}/g,(_,id)=>`{{${ordered.indexOf(id)+1}}}`);
  update({[key]:renumbered,...(key==='text'?{samples:Object.fromEntries(ordered.map((id,i)=>[String(i+1),draft.samples[id]||'']))}:{})});
  requestAnimationFrame(()=>{field?.focus();field?.setSelectionRange(start+insert.length,start+insert.length);});
 }

 function changeButton(index, change) {
  update({buttons:draft.buttons.map((button,i)=>i===index?{...button,...change}:button)});
 }

 function save() {
  setError('');
  try{onSave(draft);}
  catch{setError('This browser could not save the draft. Keep the editor open and try again.');}
 }

 async function submit() {
  if(sending.current||issue||unavailable||refreshRequired||!scope)return;
  sending.current=true;
  setBusy(true);
  setError('');
  const identity=draft.source||{name:draft.name,language:draft.language,category:draft.category};
  try{
   // Keep the attempted draft available if the request leaves the browser without a confirmed outcome.
   await onSubmit(draft,{...identity,...submission});
  }catch(failure){
   setError(failure.message);
   const uncertain=!failure.code||failure.code==='whatsapp_template_outcome_uncertain';
   if(uncertain)update({uncertain:true});
   if(uncertain||refreshCodes.includes(failure.code))setRefreshRequired(true);
  }finally{sending.current=false;setBusy(false);setConfirm('');}
 }

 return <div className="wa-template-editor">
  <button type="button" className="btn-secondary" disabled={busy} onClick={()=>dirty?setConfirm('leave'):onClose()}>
   <ArrowLeft size={16} aria-hidden="true"/> Template Library
  </button>
  <WorkspacePage title={draft.source?'Edit WhatsApp template':'New WhatsApp template'} density="compact"
   description={brandName}
   actions={<>
    <button type="button" className="btn-secondary" disabled={busy} onClick={save}>Save Draft</button>
    <button type="submit" className="btn-primary" form="whatsapp-template-form" disabled={busy||Boolean(unavailable)||refreshRequired}>
     {busy?'Submitting…':'Submit for Review'}
    </button>
   </>}>
   <div className="wa-template-editor-grid">
    <form id="whatsapp-template-form" className="card wa-template-form" noValidate onSubmit={event=>{
     event.preventDefault();
     setValidationShown(true);
     if(!issue&&!unavailable&&!refreshRequired&&!busy)setConfirm('submit');
    }}>
     <fieldset disabled={busy}>
      <section aria-labelledby="wa-template-details">
       <div className="wa-template-section-heading"><h2 id="wa-template-details">Template details</h2><Badge>Draft</Badge></div>
       <AdminFormField label="Friendly name" helper="Visible in this browser only.">
        <input className="control w-full" value={draft.friendly} maxLength={100} placeholder="Reservation reminder"
         onChange={event=>{
          const friendly=event.target.value;
          update({friendly,...(!draft.manualName?{name:generateMetaTemplateName(friendly)}:{})});
         }}/>
       </AdminFormField>
       <AdminFormField label="Meta template name">
        <input className="control w-full" value={draft.name} maxLength={512} readOnly={Boolean(draft.source)}
         placeholder="reservation_reminder" onChange={event=>update({name:event.target.value,manualName:true})}/>
       </AdminFormField>
       <p className="wa-template-help">{draft.source?'Meta keeps the name, category and language of the existing template.':'Generated from the friendly name. You can edit it before submitting.'}</p>
       <div className="wa-template-field-pair">
        <SelectField label="Category" value={draft.category} onChange={category=>update({category})} options={templateCategories} disabled={busy||Boolean(draft.source)}/>
        <SelectField label="Language" value={draft.language} onChange={language=>update({language})} options={langs} searchable disabled={busy||Boolean(draft.source)}/>
       </div>
      </section>
      <section aria-labelledby="wa-template-message">
       <div className="wa-template-section-heading"><h2 id="wa-template-message">Message content</h2></div>
       <AdminFormField label="Text header (optional)">
        <input ref={headerInput} className="control w-full" value={draft.header} maxLength={60}
         onChange={event=>update({header:event.target.value})}/>
       </AdminFormField>
       <div className="wa-template-field-actions">
        <button type="button" className="btn-secondary" disabled={headerHasVariable||draft.header.length>53} onClick={()=>insertVariable('header',headerInput,60)}><Plus size={14}/> Header variable</button>
        <span>{draft.header.length}/60</span>
       </div>
       <AdminFormField label="Message body">
        <textarea ref={bodyInput} className="control w-full" rows={5} maxLength={1024} value={draft.text}
         placeholder="Your reservation for {{1}} is confirmed." onChange={event=>update({text:event.target.value})}/>
       </AdminFormField>
       <div className="wa-template-field-actions">
        <button type="button" className="btn-secondary" disabled={bodyVariables.length>=10||draft.text.length>1016} onClick={()=>insertVariable('text',bodyInput,1024)}><Plus size={14}/> Body variable</button>
        <span>{draft.text.length}/1,024</span>
       </div>
       <AdminFormField label="Footer (optional)">
        <input className="control w-full" maxLength={60} value={draft.footer} onChange={event=>update({footer:event.target.value})}/>
       </AdminFormField>
      </section>
      {headerHasVariable||bodyVariables.length?<section aria-labelledby="wa-template-samples">
       <div className="wa-template-section-heading"><h2 id="wa-template-samples">Variable samples</h2></div>
       <p className="wa-template-help">Use example values for Meta’s review and the preview.</p>
       {headerHasVariable?<AdminFormField label="Header sample for {{1}}">
        <input className="control w-full" value={draft.headerSample} maxLength={100} onChange={event=>update({headerSample:event.target.value})}/>
       </AdminFormField>:null}
       {bodyVariables.map(key=><AdminFormField key={key} label={`Body sample for {{${key}}}`}>
        <input className="control w-full" value={draft.samples[key]||''} maxLength={100}
         onChange={event=>update({samples:{...draft.samples,[key]:event.target.value}})}/>
       </AdminFormField>)}
      </section>:null}
      <section aria-labelledby="wa-template-buttons">
       <div className="wa-template-section-heading">
        <h2 id="wa-template-buttons">Buttons <span>(optional)</span></h2>
        <button type="button" className="btn-secondary" disabled={draft.buttons.length>=3}
         onClick={()=>update({buttons:[...draft.buttons,{type:draft.buttons[0]?.type||'QUICK_REPLY',text:''}]})}>
         <Plus size={14}/> Add button
        </button>
       </div>
       {draft.buttons.length?<p className="wa-template-help">Use quick replies together, or combine website and call buttons.</p>:null}
       {draft.buttons.map((button,index)=><div className="wa-template-button-fields" key={index}>
        <div className="wa-template-field-pair">
         <SelectField label={`Button ${index+1} type`} value={button.type} onChange={type=>changeButton(index,{type})} options={buttonOptions}/>
         <AdminFormField label={`Button ${index+1} label`}>
          <input className="control w-full" value={button.text} maxLength={25} onChange={event=>changeButton(index,{text:event.target.value})}/>
         </AdminFormField>
        </div>
        {button.type==='URL'?<AdminFormField label="Website URL">
         <input className="control w-full" type="url" maxLength={2000} value={button.url||''} placeholder="https://example.com"
          onChange={event=>changeButton(index,{url:event.target.value})}/>
        </AdminFormField>:null}
        {button.type==='PHONE_NUMBER'?<AdminFormField label="International phone number">
         <input className="control w-full" type="tel" maxLength={16} value={button.phone_number||''} placeholder="+60…"
          onChange={event=>changeButton(index,{phone_number:event.target.value})}/>
        </AdminFormField>:null}
        <button type="button" className="btn-secondary" aria-label={`Remove button ${index+1}`}
         onClick={()=>update({buttons:draft.buttons.filter((_,i)=>i!==index)})}><Trash2 size={14}/> Remove</button>
       </div>)}
      </section>
     </fieldset>
     {(error||(validationShown&&issue))?<p role="alert" className="wa-template-error">{error||issue}</p>:null}
     {unavailable?<p role="status" className="wa-template-help">{unavailable}</p>:null}
     {refreshRequired?<div className="wa-template-recovery">
      <p>Check Meta’s current catalog before starting another submission.</p>
      <button type="button" className="btn-secondary" onClick={onRefresh}>Back to catalog and refresh</button>
     </div>:null}
     {initial.savedAt?<button type="button" className="btn-secondary" disabled={busy} onClick={()=>setConfirm('discard')}>Discard draft</button>:null}
    </form>
    <aside className="wa-template-editor-preview" aria-label="Live WhatsApp preview">
     <div className="wa-template-preview-heading"><h2>Message preview</h2><span>Sample values</span></div>
     <div className="wa-template-device">
      <div className="wa-template-device-bar"><MessageCircle size={18} aria-hidden="true"/><strong>{brandName}</strong></div>
      <div className="wa-template-chat-surface">
       <div className="wa-template-bubble">
        {draft.header.trim()?<strong>{renderText(draft.header,{'1':draft.headerSample})}</strong>:null}
        <p className={!draft.text.trim()?'wa-template-preview-empty':''}>{renderText(draft.text,draft.samples)||'Your message will appear here.'}</p>
        {draft.footer.trim()?<small>{draft.footer}</small>:null}
       </div>
       {draft.buttons.some(button=>button.text.trim())?<ul className="wa-template-preview-buttons">
        {draft.buttons.map((button,index)=>{
         const Icon=buttonOptions.find(item=>item.value===button.type)?.Icon||MessageCircle;
         return button.text.trim()?<li key={index}><Icon size={15} aria-hidden="true"/>{button.text}</li>:null;
        })}
       </ul>:null}
      </div>
     </div>
    </aside>
   </div>
  </WorkspacePage>
  {confirm?<Modal title={confirm==='submit'?'Submit to Meta for review?':confirm==='discard'?'Discard this draft?':'Leave the editor?'}
   onClose={()=>{if(!busy)setConfirm('');}}
   footer={<>
    <button className="btn-secondary" disabled={busy} onClick={()=>setConfirm('')}>Cancel</button>
    <button className="btn-primary" disabled={busy} onClick={()=>{
     if(confirm==='submit'){submit();return;}
     if(confirm==='discard'){
      try{onDiscard(draft.draftId);}catch{setError('This browser could not discard the draft.');setConfirm('');}
     }else onClose();
    }}>{confirm==='submit'?(busy?'Submitting…':'Confirm submission'):confirm==='discard'?'Discard draft':'Leave without saving'}</button>
   </>}>
   <p>{confirm==='submit'?<>Meta will review <strong>{draft.name}</strong> for {brandName}. Its status will appear in the library after sync.</>:
    confirm==='discard'?'This removes the draft from this browser.':'Changes since your last save will be discarded.'}</p>
  </Modal>:null}
 </div>;
}
