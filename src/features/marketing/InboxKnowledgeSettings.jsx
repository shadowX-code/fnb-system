import {useEffect,useState} from 'react';
import {MessageSquareText,ShieldCheck,Sparkles,Check,ArrowUpRight,Clock3,Info} from 'lucide-react';
import Badge from '../../components/ui/Badge.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import TimePickerField from '../../components/forms/TimePickerField.jsx';
import './inboxAISettings.css';
import InboxAutomationOwnership from './InboxAutomationOwnership.jsx';

export const AI_REPLY_MODES=[
 {value:'suggest_only',label:'Suggest Only',icon:MessageSquareText,description:'Draft replies for staff to review, edit and send.',detail:'Every reply stays in staff hands.'},
 {value:'safe_auto',label:'Safe Auto Reply',icon:ShieldCheck,description:'Answer low-risk enquiries with reliable, current sources.',detail:'Uncertainty and exceptions go to staff.'},
 {value:'ai_first',label:'AI First',icon:Sparkles,description:'Handle supported follow-ups and ask for clarification.',detail:'Business decisions always go to staff.'},
];
const emptyPolicy={revision:0,automation_mode:'suggest',ai_allowed:false};
const defaultWindow={days:[0,1,2,3,4,5,6],start:'09:00',end:'22:00'};
const modeLabel=value=>AI_REPLY_MODES.find(x=>x.value===value)?.label||'Suggest Only';

export default function InboxKnowledgeSettings({data,configuration,configurationError='',channels=null,onRetryConfiguration,can,busy,configure,onKnowledge,onConnections}) {
 const saved=data?.policy||emptyPolicy;
 const [policy,setPolicy]=useState(saved);
 useEffect(()=>setPolicy(saved),[data?.policy]);
 const change=(key,value)=>setPolicy(p=>({...p,[key]:value}));
 const mode=policy.ai_reply_mode||'suggest_only',savedMode=saved.ai_reply_mode||'suggest_only';
 const automatic=mode!=='suggest_only',window_=policy.ai_schedule||defaultWindow;
 const dirty=JSON.stringify(policy)!==JSON.stringify(saved),editable=can('configure');
 const missing=[
  !policy.ai_allowed&&{title:'Brand consent needed',body:'Allow AI to use this Brand’s knowledge and recent conversation context.',href:'#inbox-ai-consent',action:'Review consent'},
  !configuration&&{title:configurationError?'Configuration unavailable':'Checking configuration',body:configurationError||'Loading the existing model and delivery settings.',retry:Boolean(configurationError)},
  configuration&&!configuration.ai_configured&&{title:'AI provider not ready',body:configuration.ai_status==='disabled'?'AI is disabled for this environment. Ask an administrator to enable the existing setup.':configuration.ai_status==='missing_model'?'Ask an administrator to configure the existing AI model.':'Ask an administrator to check the existing model/provider.',retry:true},
  automatic&&configuration&&!configuration.ai_auto_configured&&{title:'Automatic delivery paused',body:'Automatic delivery is disabled by the server.'},
  automatic&&channels?.connections&&!channels.connections.some(c=>c.messaging?.receiving_verified)&&{title:channels.connections.length?'Inbox channels need attention':'No connected Inbox channel',body:channels.connections.length?'No channel currently has verified Inbox receiving configuration. Review the connection blockers.':'Connect an eligible Facebook or Instagram account for automatic replies.',href:onConnections,action:'Review connections'},
  automatic&&channels?.connections?.length>0&&!channels.connections.some(c=>c.messaging?.receiving_verified&&c.automation?.owner==='feedx'&&!c.automation?.issue)&&{title:'Confirm channel automation ownership',body:'FeedX cannot reliably observe every Meta automated reply. Choose one automatic sender for each channel.',href:'#inbox-automation-ownership',action:'Review ownership'},
  automatic&&(!can('ai')||!can('send'))&&{title:'Additional permission needed',body:'Ask an administrator for AI and send authority before saving an automatic mode.'},
 ].filter(Boolean);
 // A Brand-level settings read cannot certify a recipient, messaging window or current source for every future turn.
 const savedReady=Boolean(configuration?.ai_configured&&saved.ai_allowed);
 const status=!configuration?'Status unavailable':!savedReady?'Not active':savedMode==='suggest_only'?'Staff review only':!configuration.ai_auto_configured?'Automatic sending paused':'Automatic mode saved';
 const usableFAQs=data?.faqs?.filter(f=>f.is_active&&!f.use_issue).length||0;
 const knowledgeAvailable=Boolean(data?.knowledge?.approved_for_replies||data?.knowledge?.manager_confirmed);
 const saveBlocked=busy||!dirty||automatic&&(!policy.ai_allowed||!can('ai')||!can('send'));
 return <form id="inbox-settings-form" className="inbox-ai-settings" aria-busy={busy} onSubmit={event=>{
  event.preventDefault();if(!editable||saveBlocked)return;
  configure('policy',policy.revision,{automation_mode:automatic?'suggest':policy.automation_mode||'suggest',ai_allowed:Boolean(policy.ai_allowed),staff_reply_requires_approval:Boolean(policy.staff_reply_requires_approval),ai_reply_mode:mode,ai_availability:policy.ai_availability||'always',ai_timezone:policy.ai_timezone||'Asia/Kuala_Lumpur',ai_schedule:window_});
 }}>
  <header className="ai-settings-heading"><div><h2>AI Customer Service</h2><p>Choose how AI helps your team. Sending remains subject to consent and live channel checks.</p></div><Badge tone={savedReady?'info':'neutral'}>{status}</Badge></header>
  <div className="ai-settings-saved" aria-label="Saved AI status"><span>Saved mode <strong>{modeLabel(savedMode)}</strong></span><span>Brand consent <strong>{saved.ai_allowed?'Enabled':'Off'}</strong></span>{dirty?<Badge tone="warning">Unsaved changes</Badge>:null}{savedReady&&savedMode!=='suggest_only'&&configuration.ai_auto_configured?<span>Each conversation must pass send checks.</span>:null}</div>
  <div className="ai-settings-layout">
   <div className="ai-settings-main">
    <section className="ai-settings-panel" aria-labelledby="ai-mode-heading"><header><div><h3 id="ai-mode-heading">Reply mode</h3><p>Select a mode for this Brand.</p></div>{dirty&&mode!==savedMode?<Badge tone="warning">Draft selection</Badge>:null}</header>
     <fieldset className="ai-mode-options" disabled={!editable||busy}><legend className="sr-only">AI mode</legend>{AI_REPLY_MODES.map(({value,label,description,detail,icon:Icon})=><label key={value} className={`ai-mode-option ${mode===value?'is-selected':''}`}><input type="radio" name="ai-reply-mode" value={value} checked={mode===value} onChange={()=>change('ai_reply_mode',value)}/><span className="ai-mode-top"><Icon size={19} aria-hidden="true"/><strong>{label}</strong><span className="ai-mode-check" aria-hidden="true">{mode===value?<Check size={13}/>:null}</span></span><span>{description}</span><small>{detail}</small></label>)}</fieldset>
     <p className="ai-settings-hint"><Info size={14} aria-hidden="true"/>{dirty?'Selection is a draft. Save applies the mode and consent below; it does not bypass server or conversation checks.':'Mode settings do not confirm that automatic sending is active.'}</p>
     {automatic?<div className="ai-settings-schedule"><h4><Clock3 size={16} aria-hidden="true"/>Automatic reply availability</h4><fieldset disabled={!editable||busy}><div className="inbox-ai-schedule"><SelectField label="Availability" disabled={!editable||busy} value={policy.ai_availability||'always'} onChange={v=>change('ai_availability',v)} options={[{value:'always',label:'Always within the messaging window'},{value:'scheduled',label:'Selected days and hours'}]}/><SelectField label="Timezone" disabled={!editable||busy} searchable value={policy.ai_timezone||'Asia/Kuala_Lumpur'} onChange={v=>change('ai_timezone',v)} options={[{value:'Asia/Kuala_Lumpur',label:'Malaysia · Asia/Kuala_Lumpur'},{value:'Asia/Singapore',label:'Singapore · Asia/Singapore'},...(!['Asia/Kuala_Lumpur','Asia/Singapore'].includes(policy.ai_timezone||'Asia/Kuala_Lumpur')?[{value:policy.ai_timezone,label:policy.ai_timezone}]:[])]}/>{policy.ai_availability==='scheduled'?<><fieldset><legend>Available days</legend><div className="inbox-ai-days">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,n)=><label key={day}><input type="checkbox" checked={window_.days.includes(n)} onChange={e=>change('ai_schedule',{...window_,days:e.target.checked?[...window_.days,n]:window_.days.filter(x=>x!==n)})}/>{day}</label>)}</div></fieldset><div className="inbox-ai-time-range"><TimePickerField label="Starts" value={window_.start} onChange={v=>change('ai_schedule',{...window_,start:v})}/><TimePickerField label="Ends" value={window_.end} onChange={v=>change('ai_schedule',{...window_,end:v})}/></div><p>Earlier end times continue into the next day.</p></>:null}</div></fieldset><p>Availability never extends Meta’s messaging window.</p></div>:null}
    </section>
    <section className="ai-settings-panel" id="inbox-ai-consent" aria-labelledby="ai-consent-heading"><h3 id="ai-consent-heading">Brand AI Consent</h3><label className="ai-setting-toggle"><input type="checkbox" disabled={!editable||busy} checked={Boolean(policy.ai_allowed)} onChange={e=>change('ai_allowed',e.target.checked)}/><span><strong>Allow AI for this Brand</strong><span>Use permitted knowledge and bounded recent conversation context with the existing AI provider. Automatic replies also require a saved automatic mode and all send checks.</span></span></label></section>
    <section className="ai-settings-panel" aria-labelledby="inbox-approval-heading"><h3 id="inbox-approval-heading">Staff Reply Policy</h3><label className="ai-setting-toggle"><input type="checkbox" disabled={!editable||busy} checked={Boolean(policy.staff_reply_requires_approval)} onChange={e=>change('staff_reply_requires_approval',e.target.checked)}/><span><strong>Require approval for all staff replies</strong><span>Staff review and approval remain separate from AI handling. Internal notes are not customer replies.</span></span></label></section>
   </div>
   <aside className="ai-settings-aside">
    <section className="ai-settings-panel ai-settings-readiness" aria-labelledby="ai-readiness-heading"><header><h3 id="ai-readiness-heading">Activation Readiness</h3><Badge tone={missing.length?'warning':'success'}>{!configuration?'Unverified':missing.length?'Setup needed':'Setup ready'}</Badge></header><p>For selected mode: <strong>{modeLabel(mode)}</strong></p>
     {missing.length?<ul aria-label="Activation prerequisites">{missing.map(x=><li key={x.title}><strong>{x.title}</strong><p>{x.body}</p>{x.href?<a href={x.href}>{x.action}<ArrowUpRight size={13} aria-hidden="true"/></a>:null}{x.retry&&onRetryConfiguration?<button type="button" className="ai-settings-link" onClick={onRetryConfiguration}>Retry check</button>:null}</li>)}</ul>:<p className="ai-settings-ready"><Check size={16} aria-hidden="true"/>{automatic?'Brand setup is ready; each send is checked separately.':'Ready to generate staff-reviewed suggestions.'}</p>}
     <details className="ai-settings-check-details"><summary>Channel &amp; knowledge checks</summary><div className="ai-settings-live-checks"><strong>{automatic?'Checked before every send':'Checks remain separate'}</strong><p>{channels?.connections?`${channels.connections.filter(c=>c.messaging?.receiving_verified).length} of ${channels.connections.length} channels have verified receiving configuration. `:channels?.error?'Channel status could not be loaded. Review Connections. ':''}{automatic?'Channel access, messaging window, applicable sources, usage limits and human ownership must pass.':'Staff sending keeps its existing channel, permission and messaging-window checks.'}</p>{onConnections?<a href={onConnections}>Review channel connections<ArrowUpRight size={13} aria-hidden="true"/></a>:null}</div>
     <div className="ai-settings-sources"><strong>Knowledge sources</strong><p>{usableFAQs} usable Active {usableFAQs===1?'FAQ':'FAQs'}{knowledgeAvailable?' · Brand knowledge available':''}. Current product, promotion and Outlet facts are resolved for each enquiry. Missing optional knowledge does not block unrelated supported answers.</p>{onKnowledge?<a href={onKnowledge}>Open Brand Knowledge<ArrowUpRight size={13} aria-hidden="true"/></a>:null}</div></details>
    </section>
    {channels?.connections?.length?<section className="ai-settings-panel" id="inbox-automation-ownership" aria-label="Channel automation ownership"><h3>Automation ownership</h3><p>Use one automatic sender per channel. This does not enable AI or change Meta settings. Suggested questions alone are not sent replies.</p>{channels.connections.map(c=><InboxAutomationOwnership key={`${c.id}:${c.automation?.revision||0}`} connection={c} can={can} busy={busy} configure={configure}/>)}</section>:null}
    <div className="ai-settings-safety"><ShieldCheck size={18} aria-hidden="true"/><div><strong>Staff always retain control</strong><p>Safety escalation is mandatory. Complaints, refunds, allergies and human requests go to staff. Takeover stops future AI sends; AI cannot make bookings, refunds or other business changes.</p></div></div>
   </aside>
  </div>
  {editable?<footer className="ai-settings-footer"><div aria-live="polite"><strong>{busy?'Saving settings…':dirty?'Unsaved changes':'All changes saved'}</strong><span>{dirty?`Save ${modeLabel(mode)} · consent ${policy.ai_allowed?'on':'off'} · staff approval ${policy.staff_reply_requires_approval?'required':'not required'}`:'Normal staff messaging remains available.'}</span></div><div><button type="button" className="btn-secondary" disabled={busy||!dirty} onClick={()=>setPolicy(saved)}>Cancel</button><button type="submit" className="btn-primary" disabled={saveBlocked}>{busy?'Saving…':'Save changes'}</button></div></footer>:<p>You can view settings. Ask a Brand manager with configuration permission to make changes.</p>}
 </form>;
}
