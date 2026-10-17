export function aiSuggestionUnavailable(current,configuration) {
 if(!current?.knowledge?.approved_for_replies)return 'Approve the current facts on Brand Knowledge.';
 if(!current?.policy?.ai_allowed)return 'AI suggestions are disabled for this Brand. An Inbox administrator can enable them in FAQ & AI settings.';
 if(!configuration?.ai_configured)return 'The AI provider is unavailable. Contact a platform administrator; approved FAQs remain available.';
 return '';
}
export function faqPreviewMessage(preview) {
 return {off:'FAQ matching is disabled for this Brand.',knowledge_unapproved:'No approved FAQ matched. Factual answers require current approved Brand Knowledge.',escalate:'This request needs a person. No FAQ answer was selected.',unavailable:'FAQ matching is temporarily unavailable. Try Approved FAQ again.'}[preview?.state]||'No unique approved FAQ matches this question. Review the FAQ Library or write a staff reply.';
}

export function faqApprovalUnavailable(faq,knowledge,templates=[]) {
 if(Object.hasOwn(faq,'approval_issue'))return faq.approval_issue||'';
 if(faq.answer_kind==='general') {
  const template=templates.find(t=>t.key===faq.template_key);
  return template?.answers?.[faq.language]===faq.answer&&!(faq.reference_keys||[]).length ? '' : 'Choose the supplied fact-free general template wording before approval.';
 }
 if(!knowledge?.revision)return 'Add verified Brand facts in Brand Knowledge and approve its current revision.';
 if(!knowledge.approved_for_replies)return `Approve Brand Knowledge revision ${knowledge.revision} for replies.`;
 if(faq.knowledge_revision!==knowledge.revision)return 'Edit and save this FAQ against the current Brand Knowledge revision.';
 const keys=faq.reference_keys||[];
 if(!keys.length)return 'Edit this FAQ and select at least one approved supporting fact.';
 if(keys.some(key=>knowledge.profile?.[key]?.provenance!=='verified_brand_fact'||!knowledge.profile[key].text?.trim()))return 'Edit this FAQ and replace unavailable supporting facts with approved current facts.';
 return '';
}
export function faqStateLabel(faq) {
 return {draft:'Draft',review:'Pending Approval',approved:'Approved',disabled:'Disabled',rejected:'Rejected'}[faq.status]||'Unavailable';
}
