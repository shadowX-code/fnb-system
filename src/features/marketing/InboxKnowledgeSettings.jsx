import {useEffect, useState} from 'react';
import Badge from '../../components/ui/Badge.jsx';
import SelectField from '../../components/forms/SelectField.jsx';

export default function InboxKnowledgeSettings({data,configuration,can,busy,configure,onKnowledge}) {
 const [policy,setPolicy]=useState(data?.policy||{revision:0,automation_mode:'suggest',ai_allowed:false});
 useEffect(()=>setPolicy(data?.policy||{revision:0,automation_mode:'suggest',ai_allowed:false}),[data?.policy?.revision]);
 const knowledge=data?.knowledge;
 const approved=Boolean(knowledge?.approved_for_replies);
 return <form id="inbox-settings-form" className="inbox-knowledge-settings" onSubmit={event=>{event.preventDefault();if(can('configure'))configure('policy',policy.revision,{automation_mode:policy.automation_mode,ai_allowed:Boolean(policy.ai_allowed),staff_reply_requires_approval:Boolean(policy.staff_reply_requires_approval)})}}>
  <section aria-labelledby="inbox-knowledge-heading"><header><h3 id="inbox-knowledge-heading">Brand Knowledge</h3><Badge tone={approved?'success':'warning'}>{approved?'Approved for replies':knowledge?'Approval needed':'Not configured'}</Badge></header>
   <p>Factual FAQs and AI suggestions use only human-verified facts from the approved current revision. Approving knowledge is separate from approving an FAQ. Conversational replies are reviewed separately.</p>
   {onKnowledge?<a className="btn-secondary" href={onKnowledge}>Open Brand Knowledge</a>:null}
   {!approved?<p>Verify and approve the current facts on Brand Knowledge. FAQ drafts can be prepared now.</p>:null}
  </section>
  <section aria-labelledby="inbox-ai-heading"><header><h3 id="inbox-ai-heading">AI Suggestions</h3><Badge>{configuration?.ai_configured?'Provider configured':'Provider unavailable'}</Badge></header><p>Suggestions use approved Brand facts and permitted conversation context. Staff review and explicitly send every reply.</p>{!configuration?.ai_configured?<p>The AI provider is unavailable. A platform administrator must configure the existing integration; approved FAQs remain available.</p>:null}
   {can('configure')?<><SelectField label="FAQ matching" value={policy.automation_mode||'suggest'} onChange={automation_mode=>setPolicy(p=>({...p,automation_mode}))} options={[{value:'off',label:'Off'},{value:'suggest',label:'Suggest replies'},{value:'faq',label:'Prepare FAQ drafts'}]}/><label className="marketing-inbox-check"><input type="checkbox" checked={Boolean(policy.ai_allowed)} onChange={e=>setPolicy(p=>({...p,ai_allowed:e.target.checked}))}/>Allow AI suggestions with approved facts and conversation history with direct contact details removed</label></>:<p>{policy.ai_allowed?'Brand AI consent enabled.':'Brand AI consent is disabled. Ask an authorized Inbox administrator.'}</p>}
  </section>
  <section aria-labelledby="inbox-approval-heading"><h3 id="inbox-approval-heading">Reply Approval</h3><p>All replies require an explicit staff send. Sensitive requests and escalations retain their existing approval requirements. Automatic customer replies remain disabled.</p>{can('configure')?<><label className="marketing-inbox-check"><input type="checkbox" checked={Boolean(policy.staff_reply_requires_approval)} onChange={e=>setPolicy(p=>({...p,staff_reply_requires_approval:e.target.checked}))}/>Require approval for all staff replies</label><button type="submit" className="btn-primary" disabled={busy}>Save brand settings</button></>:null}</section>
 </form>;
}
