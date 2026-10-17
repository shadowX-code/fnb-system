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
 const knowledge=data?.knowledge,references=form.reference_keys||[];
 const facts=[...new Set([...Object.entries(knowledge?.profile||{}).filter(([,v])=>v.provenance==='verified_brand_fact'&&v.text?.trim()).map(([key])=>key),...references])];
 const reason=faq.id?faqApprovalUnavailable(faq,knowledge,data?.general_templates):'';
 return <Modal title={faq.id?'Edit FAQ':'New FAQ'} description={brandName} onClose={()=>{if(!busy)onClose()}} footerClassName="flex-wrap" footer={<><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" form="faq-editor-form" className="btn-primary" disabled={busy}>Save draft</button></>}>
 <form id="faq-editor-form" className="marketing-inbox-form" onSubmit={event=>{event.preventDefault();onSave({...form,alternative_questions:form.alternativeText.split('\n').map(q=>q.trim()).filter(Boolean)})}}>
 <AdminFormField label="Question" required><input className="control" aria-label="Question" value={form.question} onChange={e=>set('question',e.target.value)} maxLength={500} required/></AdminFormField>
 <TextareaField label="Answer" ariaLabel="Answer" value={form.answer} onChange={value=>set('answer',value)} rows={4} maxLength={4000} required helper="Write the reply your team would naturally use. Staff can edit it before sending."/>
 <AdminFormField label="Category" required><input className="control" aria-label="Category" value={form.category||'General'} onChange={e=>set('category',e.target.value)} maxLength={80} required/></AdminFormField>
 <TextareaField label="Alternative Questions" ariaLabel="Alternative Questions" value={form.alternativeText} onChange={value=>set('alternativeText',value)} rows={3} maxLength={5010} helper="Optional · one per line, up to 10. Include common EN, Chinese or Malay phrasings."/>
 {reason?<p role="status">{reason} {knowledgeHref?<a href={knowledgeHref}>Open Brand Knowledge</a>:null}</p>:null}
 <details className="faq-advanced"><summary>Advanced Options</summary><div className="marketing-inbox-form">
 <SelectField label="Language" value={form.language} onChange={value=>set('language',value)} options={['EN','ZH','BM'].map(value=>({value,label:{EN:'English',ZH:'中文',BM:'Bahasa Melayu'}[value]}))}/>
 <SelectField label="Topic Matching" value={form.match_intent||'exact'} onChange={value=>set('match_intent',value)} options={faqTopics.map(([value,label])=>({value,label}))}/>
 <fieldset><legend>Supporting knowledge</legend>{facts.length?facts.map(key=><label className="marketing-inbox-check" key={key}><input type="checkbox" checked={references.includes(key)} onChange={e=>set('reference_keys',e.target.checked?[...references,key]:references.filter(k=>k!==key))}/><span>{key.replaceAll('_',' ')}{!knowledge?.profile?.[key]?' · unavailable':''}<small className="faq-fact-preview">{knowledge?.profile?.[key]?.text}</small></span></label>):<p>No verified supporting facts yet. You can still save a draft.</p>}</fieldset>
 <p>Exact quoted approved facts are linked when you save. For paraphrased factual answers, select the supporting knowledge here. Uncertain answers require verified support and reviewer confirmation.</p>
 {knowledgeHref?<a href={knowledgeHref}>Manage Brand Knowledge</a>:null}
 <p>Brand-wide applicability. Outlet-specific matching is unavailable without verified conversation Outlet context.</p>
 </div></details>
 <p>Save now; review any approval prerequisites afterward. Saving resets FAQ approval and never sends a message.</p>
 </form></Modal>;
}
