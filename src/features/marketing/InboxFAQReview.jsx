import {useState} from 'react';
import Modal from '../../components/feedback/Modal.jsx';
import {faqApprovalUnavailable} from './inboxKnowledge.js';
export default function InboxFAQReview({faq,data,busy,onClose,onApprove,knowledgeHref}){
 const [confirmed,setConfirmed]=useState(false),general=faq.answer_kind==='general';
 const issue=faqApprovalUnavailable(faq,data.knowledge,data.general_templates);
 return <Modal title="Review FAQ" onClose={()=>{if(!busy)onClose()}} footer={<><button className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy||!confirmed||Boolean(issue)} onClick={()=>onApprove(general?'fact_free':'supported')}>Approve FAQ</button></>}>
 <div className="marketing-inbox-form"><h3>{faq.question}</h3><p className="faq-review-answer">{faq.answer}</p><p>{faq.category||'General'} · {faq.language}</p>
 {general?<p>This answer was recognized as conversational. Review it independently of Brand Knowledge.</p>:<><h4>Supporting knowledge</h4>{(faq.reference_keys||[]).map(key=><blockquote key={key}><strong>{key.replaceAll('_',' ')}</strong><p>{data.knowledge?.profile?.[key]?.text||'Unavailable'}</p></blockquote>)}</>}
 {issue?<p role="status">{issue} {knowledgeHref?<a href={knowledgeHref}>Open Brand Knowledge</a>:null}</p>:null}
 <label className="marketing-inbox-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{general?'I reviewed this answer and confirm it contains no Brand or operational factual claims.':'I verified this answer against the selected current approved knowledge.'}</label>
 <p>Approval applies only to this FAQ revision. It never sends a customer message.</p></div>
 </Modal>;
}
