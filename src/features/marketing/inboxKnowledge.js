export function aiSuggestionUnavailable(current,configuration) {
 if(!current?.knowledge?.approved_for_replies)return 'Approve current Brand Knowledge in FAQ & AI settings.';
 if(!current?.policy?.ai_allowed)return 'AI suggestions are disabled for this Brand. An Inbox administrator can enable them in FAQ & AI settings.';
 if(!configuration?.ai_configured)return 'The AI provider is unavailable. Contact a platform administrator; approved FAQs remain available.';
 return '';
}
export function faqPreviewMessage(preview) {
 return {off:'FAQ matching is disabled for this Brand.',knowledge_unapproved:'Approve current Brand Knowledge before using FAQs.',escalate:'This request needs a person. No FAQ answer was selected.',unavailable:'FAQ matching is temporarily unavailable. Try Approved FAQ again.'}[preview?.state]||'No unique approved FAQ matches this question. Review the FAQ Library or write a staff reply.';
}
