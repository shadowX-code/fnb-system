import {useState} from 'react';
import Modal from '../../components/feedback/Modal.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import TextareaField from '../../components/forms/TextareaField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import {FAQ_CATEGORIES} from './faqCategories.js';
export default function InboxFAQEditor({faq,data,brandName,busy,onClose,onSave}){
 const [form,setForm]=useState({...faq,category:faq.category||'general',alternativeText:(faq.alternative_questions||[]).join('\n')});
 const set=(key,value)=>setForm(f=>({...f,[key]:value}));
 return <Modal title={faq.id?'Edit FAQ':'New FAQ'} description={brandName} onClose={()=>{if(!busy)onClose()}} footerClassName="flex-wrap" footer={<><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" name="publication" value="inactive" form="faq-editor-form" className="btn-secondary" disabled={busy}>Save Inactive</button><button type="submit" name="publication" value="active" form="faq-editor-form" className="btn-primary" disabled={busy}>Save & Activate</button></>}>
 <form id="faq-editor-form" className="marketing-inbox-form" onSubmit={event=>{event.preventDefault();onSave({...form,is_active:event.nativeEvent.submitter?.value==='active',alternative_questions:form.alternativeText.split('\n').map(q=>q.trim()).filter(Boolean)})}}>
 <AdminFormField label="Question" required><input className="control" aria-label="Question" value={form.question} onChange={e=>set('question',e.target.value)} maxLength={500} required disabled={busy}/></AdminFormField>
 <TextareaField label="Answer" ariaLabel="Answer" value={form.answer} onChange={value=>set('answer',value)} rows={5} maxLength={4000} required disabled={busy} helper="Write the answer your team would use. Staff can edit it before sending."/>
 <SelectField label="Category" required searchable value={form.category} onChange={value=>set('category',value)} options={data?.categories||FAQ_CATEGORIES} disabled={busy}/>
 {faq.legacy_category&&faq.legacy_category.toLowerCase()!==form.category.replaceAll('_',' ')?<p className="faq-library-limit">Original category: {faq.legacy_category}</p>:null}
 <TextareaField label="Alternative Questions" ariaLabel="Alternative Questions" value={form.alternativeText} onChange={value=>set('alternativeText',value)} rows={3} maxLength={5010} disabled={busy} helper="Optional · one per line, up to 10. Include common English, Chinese or Malay phrasings."/>
 {faq.use_issue&&faq.is_active?<p role="status">{faq.use_issue}</p>:null}
 <p className="faq-library-limit">Activation makes this FAQ available for matching. Operational answers are checked against available source data; uncertain facts need staff confirmation. Saving never sends a message.</p>
 </form></Modal>;
}
