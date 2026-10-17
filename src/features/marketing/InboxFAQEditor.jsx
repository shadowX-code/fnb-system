import {useState} from 'react';
import Modal from '../../components/feedback/Modal.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import TextareaField from '../../components/forms/TextareaField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import {faqApprovalUnavailable} from './inboxKnowledge.js';
export const faqTopics=[['exact','Approved phrasings only'],['greeting','Greetings · EN / 中文 / BM'],['thanks','Thanks · EN / 中文 / BM'],['brand_identity','Brand name'],['menu','Menu request'],['operating_hours','Opening hours'],['locations','Address / location']];
export default function InboxFAQEditor({faq,data,brandName,busy,onClose,onSave,knowledgeHref}){
 const [form,setForm]=useState({...faq,alternativeText:(faq.alternative_questions||[]).join('\n')});
 const set=(key,value)=>setForm(f=>({...f,[key]:value}));
 const templates=data?.general_templates||[],general=form.answer_kind==='general',knowledge=data?.knowledge;
 const selected=templates.find(t=>t.key===form.template_key);
 const references=form.reference_keys||[];
 const facts=[...new Set([...Object.entries(knowledge?.profile||{}).filter(([,v])=>v.provenance==='verified_brand_fact'&&v.text?.trim()).map(([key])=>key),...references])];
 const reason=faqApprovalUnavailable({...form,knowledge_revision:knowledge?.revision},knowledge,templates);
 function chooseTemplate(key,language=form.language){const template=templates.find(t=>t.key===key);setForm(f=>({...f,template_key:key,language,answer:template?.answers?.[language]||'',reference_keys:[]}));}
 return <Modal title={faq.id?'Edit FAQ':'New FAQ'} description={brandName} onClose={()=>{if(!busy)onClose()}} footerClassName="flex-wrap" footer={<><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" form="faq-editor-form" className="btn-primary" disabled={busy}>Save draft</button></>}>
 <form id="faq-editor-form" className="marketing-inbox-form" onSubmit={event=>{event.preventDefault();onSave({...form,reference_keys:general?[]:references,alternative_questions:form.alternativeText.split('\n').map(q=>q.trim()).filter(Boolean)})}}>
 <SelectField label="Answer type" value={form.answer_kind||'factual'} onChange={kind=>setForm(f=>({...f,answer_kind:kind,template_key:null,answer:kind==='general'?'':f.answer,reference_keys:kind==='general'?[]:f.reference_keys}))} options={[{value:'factual',label:'Brand-specific factual answer'},{value:'general',label:'General conversational template'}]}/>
 <AdminFormField label="Question" required><input className="control" aria-label="Question" value={form.question} onChange={e=>set('question',e.target.value)} maxLength={500} required/></AdminFormField>
 <SelectField label="Language" value={form.language} onChange={language=>general?chooseTemplate(form.template_key,language):set('language',language)} options={['EN','ZH','BM'].map(value=>({value,label:{EN:'English',ZH:'中文',BM:'Bahasa Melayu'}[value]}))}/>
 {general?<><SelectField label="General template" value={form.template_key||''} onChange={chooseTemplate} options={[{value:'',label:'Choose fact-free wording'},...templates.map(t=>({value:t.key,label:t.name}))]}/><p>These templates make no operational claims and do not require Brand Knowledge. Custom hours, prices, promotions or other facts require a factual answer.</p><AdminFormField label="Answer" required><textarea className="control" aria-label="Answer" rows={4} value={form.answer||''} readOnly required/></AdminFormField>{!selected?<p role="status">Choose a general template before saving.</p>:null}</>:<TextareaField label="Answer for review" ariaLabel="Answer for review" value={form.answer} onChange={value=>set('answer',value)} rows={4} maxLength={4000} required/>}
 <AdminFormField label="Category" required><input className="control" aria-label="Category" value={form.category||'General'} onChange={e=>set('category',e.target.value)} maxLength={80} required/></AdminFormField>
 <TextareaField label="Alternative phrasings (optional)" ariaLabel="Alternative phrasings (optional)" value={form.alternativeText} onChange={value=>set('alternativeText',value)} rows={3} maxLength={5010} helper="One phrasing per line, up to 10. Include approved EN, Chinese or Malaysian variants."/>
 <SelectField label="Topic matching" value={form.match_intent||'exact'} onChange={value=>set('match_intent',value)} options={faqTopics.map(([value,label])=>({value,label}))}/>
 <p>Topic matching recognizes bounded common questions. Unclear or competing matches need staff help; it never generates an answer.</p>
 {!general?<fieldset><legend>Supporting facts · optional for drafts</legend>{facts.map(key=><label className="marketing-inbox-check" key={key}><input type="checkbox" checked={references.includes(key)} onChange={e=>set('reference_keys',e.target.checked?[...references,key]:references.filter(k=>k!==key))}/>{key.replaceAll('_',' ')}{!knowledge?.profile?.[key]?' · unavailable':''}</label>)}</fieldset>:null}
 {reason?<p role="status">{reason} {!general&&knowledgeHref?<a href={knowledgeHref}>Open Brand Knowledge</a>:null}</p>:null}
 <details><summary>Outlet applicability</summary><p>Brand-wide only. Current Brand Knowledge and Inbox identities do not establish an Outlet-specific fact scope. Outlet-specific automatic answers are unavailable.</p></details>
 <p>Saving creates a draft and clears its FAQ approval. No customer message is sent.</p>
 </form></Modal>;
}
