import {useEffect,useRef,useState} from 'react';
import {FlaskConical,RotateCcw} from 'lucide-react';
import Modal from '../../components/feedback/Modal.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {inboxService} from './inboxService.js';
import {automaticReplyReason} from './inboxPresentation.js';
import {AI_REPLY_MODES} from './InboxKnowledgeSettings.jsx';
import './inboxPlayground.css';

const modes=AI_REPLY_MODES.map(x=>({value:x.value,label:x.label}));
const cost=value=>value==null?'Cost unavailable':`~US$${Number(value).toFixed(6)}`;
export default function InboxAIPlayground({org,brand,brandName,initialMode='suggest_only',configuration,onClose}) {
 const [mode,setMode]=useState(initialMode),[outlet,setOutlet]=useState(''),[context,setContext]=useState(null),[turns,setTurns]=useState([]),[question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef(null),inflight=useRef(false),live=useRef(true),end=useRef(null),input=useRef(null);
 function loadContext(){return inboxService.testContext(org,brand).then(value=>{if(live.current)setContext(value)}).catch(e=>{if(live.current)setError(e.message)})}
 useEffect(()=>{live.current=true;loadContext();return()=>{live.current=false}},[org,brand]);
 useEffect(()=>{end.current?.scrollIntoView?.({block:'nearest'});if(turns.length&&!busy)input.current?.focus()},[turns.length,busy]);
 const unavailable=!configuration?.ai_configured?'AI provider is unavailable. Review AI readiness.':context&&!context.consent?'Save Brand AI consent in settings before testing.':context?.daily_remaining===0?'The shared daily AI request limit is reached. Try again after earlier requests expire.':turns.length>=6?'Six test turns reached. Start a fresh simulation.':'';
 async function run(event){
  event.preventDefault();if(inflight.current||!context||unavailable||!question.trim()||question.length>1000)return;
  const history=[...turns.flatMap(t=>[{kind:'incoming',text:t.question},{kind:'echo',text:Array.from(t.result.decision.text||t.result.body.text).slice(0,1000).join('')}]),{kind:'incoming',text:question.trim()}];
  while(history.length>1&&new TextEncoder().encode(JSON.stringify(history)).length>17000)history.splice(0,2);
  const body={org,brand,mode,outletId:outlet||null,history},fingerprint=JSON.stringify(body);
  if(request.current?.fingerprint!==fingerprint)request.current={fingerprint,id:crypto.randomUUID()};
  inflight.current=true;setBusy(true);setError('');
  try{
   const response=await inboxService.testAI({...body,requestId:request.current.id});if(!live.current)return;
   if(response.state!=='completed'||!response.result)throw new Error(response.state==='cooldown'?'Wait one minute before starting another test.':response.state==='generating'?'A test is already running. Wait before retrying.':response.state==='superseded'?'Knowledge or consent changed. Review the current setup and try a new turn.':'This test did not complete. No message was sent.');
   setTurns(previous=>[...previous,{question:question.trim(),result:response.result,cached:response.cached}]);setOutlet(response.result.outlet_context?.outlet_id||'');setQuestion('');request.current=null;await loadContext();
  }catch(e){if(live.current)setError(e.message)}finally{inflight.current=false;if(live.current)setBusy(false)}
 }
 function reset(){if(inflight.current)return;setTurns([]);setQuestion('');setError('');request.current=null}
 return <Modal title={`Test AI · ${brandName}`} description="Private simulation. No customer conversation, messaging delivery or activation." placement="right" panelClassName="inbox-playground-panel" bodyClassName="inbox-playground-body" onClose={onClose} footer={<><button type="button" className="btn-secondary" disabled={busy||(!turns.length&&!error)} onClick={reset}><RotateCcw size={15}/>Start fresh</button><button type="submit" form="inbox-ai-test-form" className="btn-primary" disabled={busy||!context||!!unavailable||!question.trim()||question.length>1000}><FlaskConical size={15}/>{busy?'Testing…':'Run test'}</button></>}>
  <div className="inbox-playground-setup"><div><Badge tone="info"><FlaskConical size={13}/>Simulation only</Badge><span>{context?`${context.daily_remaining} shared requests left today`:'Checking readiness…'}</span></div><div className="inbox-playground-selects"><SelectField label="Simulated mode" value={mode} disabled={busy} onChange={value=>{setMode(value);reset()}} options={modes}/><SelectField label="Outlet context" value={outlet} disabled={busy||!context} onChange={setOutlet} options={[{value:'',label:'Auto / ask customer'},...(context?.outlets||[]).map(o=>({value:o.id,label:o.name}))]}/></div><p>Uses saved knowledge, consent and recent test context. Mode changes here are never saved. Live channel and recipient eligibility are not tested.</p></div>
  {unavailable?<div role="status" className="inbox-playground-notice">{unavailable}</div>:null}
  <div className="inbox-playground-transcript" aria-label="Simulated conversation" aria-live="polite">
   {!turns.length?<div className="inbox-playground-empty"><FlaskConical size={24}/><h3>Try a customer question</h3><p>Ask about this Brand’s menu, hours or offers, then try a follow-up. Use fictional, non-sensitive content.</p><div>{['What is your brand name?','Tonight still open ah?','I need a human about a refund.'].map(text=><button type="button" className="btn-secondary" disabled={busy} key={text} onClick={()=>setQuestion(text)}>{text}</button>)}</div></div>:turns.map((turn,i)=>{
    const r=turn.result,body=r.body,providerUnavailable=body.failure_reason?.startsWith('ai_'),handoff=r.decision.kind==='handoff'||body.classification==='needs_human_attention';
    return <section className="inbox-playground-turn" key={i}><p className="inbox-playground-question">{turn.question}</p><div className="inbox-playground-answer"><div><Badge tone={handoff?'warning':r.decision.kind==='clarify'?'info':'neutral'}>{providerUnavailable?'AI unavailable':handoff?'Needs human attention':body.classification==='insufficient_knowledge'?'Needs more knowledge':r.mode==='suggest_only'?'Staff review required':r.decision.kind==='clarify'?'Would clarify':'Would reply'}</Badge>{turn.cached?<small>Cached result</small>:null}</div><p>{r.decision.text||body.text}</p>{handoff?<p className="inbox-muted">No automatic reply · {automaticReplyReason(r.decision.reason||body.handoff_reasons?.[0])}</p>:null}<details><summary>Sources &amp; decision</summary>{body.failure_reason?<p>{automaticReplyReason(body.failure_reason)}</p>:null}{body.sources?.length?<ul>{body.sources.map(s=><li key={s.key}>{s.label}</li>)}</ul>:<p>No supporting source.</p>}{body.unresolved_questions?.length?<p>Unresolved: {body.unresolved_questions.join(' · ')}</p>:null}{body.handoff_reasons?.length?<p>Staff follow-up: {body.handoff_reasons.map(automaticReplyReason).join(' · ')}</p>:null}<p>Outlet: {r.outlet_context?.name||'Unknown / clarification required'}</p></details><footer><span>{body.match_source==='deterministic'?(body.matched_faq_ids?.length?'FAQ match · no AI tokens':'Safety check · no AI tokens'):`${r.input_tokens??'—'} in / ${r.output_tokens??'—'} out tokens`}</span><span>{cost(r.estimated_cost_usd)} · {r.latency_ms==null?'Latency unavailable':`${(r.latency_ms/1000).toFixed(1)}s`}</span></footer></div></section>
   })}
   {busy?<p role="status" className="inbox-muted">Checking current sources and generating a test reply…</p>:null}<div ref={end}/>
  </div>
  <form id="inbox-ai-test-form" onSubmit={run}><label className="inbox-playground-input">Test customer message<textarea ref={input} className="control" rows={3} maxLength={1000} value={question} disabled={busy} onChange={e=>setQuestion(e.target.value)} placeholder="Ask a question or continue the conversation…"/></label><div className="inbox-playground-input-meta"><span>Nothing is sent to Meta.</span><span>{question.length}/1000</span></div></form>
  {error?<p role="alert" className="inbox-playground-error">{error}</p>:null}
 </Modal>
}
