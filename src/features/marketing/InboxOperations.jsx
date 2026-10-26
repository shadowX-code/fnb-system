import {useState} from 'react';
import {BellRing,Bot,Hand,ShieldAlert} from 'lucide-react';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ActionMenu from '../../components/ui/ActionMenu.jsx';
import {automaticReplyReason} from './inboxPresentation.js';
import {formatDateTime} from '../../lib/dateTime.js';

export const INBOX_VIEWS=[['all','All'],['needs_reply','Needs Reply'],['mine','Mine'],['ai_handoff','AI Handoff']];
export function InboxOperationalViews({value,onChange,counts}) {
 const primary=INBOX_VIEWS.filter(([key])=>key!=='ai_handoff');
 return <nav className="inbox-view-navigation" aria-label="Conversation queues"><AdminSegmentedControl label="Conversation views" className="inbox-operational-views" value={value} onChange={onChange} options={primary.map(([value,label])=>({value,label:<><span>{label}</span>{" "}<span className="inbox-view-count">{counts?.[value]??'—'}</span></>}))}/><button type="button" className={`inbox-attention-queue ${value==='ai_handoff'?'is-active':''}`} aria-pressed={value==='ai_handoff'} data-has-items={Number(counts?.ai_handoff)>0} onClick={()=>onChange('ai_handoff')}><ShieldAlert size={15}/><span>AI Handoff</span>{" "}<span className="inbox-view-count">{counts?.ai_handoff??'—'}</span></button></nav>;
}
export function inboxHandlingState(c,mode='suggest_only',automaticConfigured=false,handoff=false) {
 if(handoff||c.escalation_reasons?.length)return {label:'Human Attention',tone:'warning',icon:ShieldAlert};
 if(!c.takeover&&c.assigned_to)return {label:'Staff assigned',tone:'neutral',icon:Hand};
 if(c.takeover)return {label:mode==='suggest_only'?'Staff handling':'Staff Taken Over',tone:'neutral',icon:Hand};
 return mode==='suggest_only'?{label:'Suggest Only',tone:'neutral',icon:Bot}:automaticConfigured?{label:'AI Handling',tone:'info',icon:Bot}:{label:'AI paused',tone:'neutral',icon:Bot};
}
export function InboxHandlingBar({current,configuration,can,busy,onTakeover,onResume}) {
 const c=current.conversation,mode=current.ai_handling?.mode||'suggest_only',automatic=mode!=='suggest_only';
 if(!['facebook','instagram'].includes(c.channel))return null;
 const state=inboxHandlingState(c,mode,configuration?.ai_auto_configured,current.needs_human_attention),Icon=state.icon;
 const artifact=current.artifacts?.find(a=>a.source_version===c.version&&a.state==='proposed'&&a.body.classification==='needs_human_attention');
 const reasons=c.escalation_reasons?.length?c.escalation_reasons:artifact?.body.handoff_reasons?.length?artifact.body.handoff_reasons:current.ai_handling?.handoff?.reason?[current.ai_handling.handoff.reason]:[];
 const summary=current.ai_handling?.handoff?.summary||current.ai_handling?.last_turn?.summary||c.summary;
 const resumeBlocked=busy||!can('manage')||!can('ai')||!configuration?.ai_auto_configured||c.opted_out||c.status!=='open'||!!c.escalation_reasons?.length;
 return <section className="inbox-handling-bar" aria-label="AI and staff handling" data-attention={state.tone==='warning'}><div className="inbox-handling-line"><Badge tone={state.tone}><Icon size={13}/>{state.label}</Badge><span>{reasons.length?`${c.takeover||c.assigned_to?'Staff handling · ':''}${reasons.map(automaticReplyReason).join(' · ')}`:automatic&&!configuration?.ai_auto_configured?'Automatic delivery is off':current.ai_handling?.last_turn?.state==='queued'?'Collecting messages':mode==='suggest_only'?'Suggest Only · staff reviews and sends':automatic?'Automatic mode · current channel checks apply':'Staff handling'}</span>{!c.takeover?<button type="button" className="btn-secondary" disabled={busy||!can('manage')||c.opted_out} onClick={onTakeover}><Hand size={14}/>Take Over</button>:automatic?<button type="button" className="btn-secondary" disabled={resumeBlocked} title={resumeBlocked?'Resolve escalation, check activation readiness and current channel eligibility first.':'Clears staff assignment and rechecks AI eligibility for new messages.'} onClick={onResume}><Bot size={14}/>Resume AI</button>:null}</div>{summary?<details><summary>Conversation summary{c.summary===summary&&c.summary_version!=null&&c.summary_version<c.version?' · earlier context':''}</summary><p>{summary}</p></details>:null}</section>
}
export function InboxReminderMenu({value,busy,onChange}) {
 const [open,setOpen]=useState(false),due=value&&Date.parse(value)<=Date.now();
 function choose(hours){setOpen(false);onChange(hours?new Date(Date.now()+hours*3600000).toISOString():null)}
 return <ActionMenu open={open} onOpenChange={setOpen} ariaLabel="Personal reminder" trigger={({toggle})=><button type="button" className={`icon-btn ${due?'inbox-reminder-due':''}`} disabled={busy} aria-expanded={open} aria-label={value?`Reminder ${due?'due':formatDateTime(value)}`:'Remind me'} title={value?`Personal reminder: ${formatDateTime(value)}`:'Remind me'} onClick={toggle}><BellRing size={17}/></button>}><div className="inbox-reminder-menu"><p>Personal reminder · shown in Inbox</p>{[[1,'In 1 hour'],[4,'In 4 hours'],[24,'Tomorrow']].map(([hours,label])=><button type="button" role="menuitem" key={hours} onClick={()=>choose(hours)}>{label}</button>)}{value?<button type="button" role="menuitem" onClick={()=>choose(null)}>Clear reminder</button>:null}</div></ActionMenu>
}
