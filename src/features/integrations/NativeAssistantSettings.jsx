import VoiceUsage from '../ai-assistant/VoiceUsage.jsx';
import {voiceOptions} from '../ai-assistant/realtimeVoice.js';
import {useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import SelectField from '../../components/forms/SelectField.jsx';
import {hasPermission} from '../../utils/accessControl.js';
import Badge from '../../components/ui/Badge.jsx';
import {formatOperationalMoment} from '../../lib/dateTime.js';
import {assistantCall,assistantErrors} from '../ai-assistant/nativeAssistantService.js';
export default function NativeAssistantSettings({auth}){
 const [data,setData]=useState(null),[model,setModel]=useState('gpt-4o-mini'),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[diagnostic,setDiagnostic]=useState(null);
 const generation=useRef(0),identity=auth?.user?.id||auth?.profile?.id,canEdit=hasPermission(auth,'roles.edit');
 const [voiceProvider,setVoiceProvider]=useState(''),[voiceName,setVoiceName]=useState('');
 async function saveVoice(){
  setBusy(true);setError('');setMessage('');
  const mine=generation.current;
  try{
   await assistantCall('provider_activate',{provider:voiceProvider,voice:voiceName});
   if(mine===generation.current){setMessage('Voice default saved for new calls.');await load();}
  }catch(e){if(mine===generation.current)setError(e.message);}finally{setBusy(false);}
 }
 async function load(){const mine=++generation.current;try{const r=await assistantCall('configuration');if(mine===generation.current){setData(r);setModel(r.config.model);setEnabled(r.config.enabled);setVoiceProvider(r.runtime.voice_default?.provider||'');setVoiceName(r.runtime.voice_default?.voice||'');}}catch(e){if(mine===generation.current)setError(e.message);}}
 useEffect(()=>{setData(null);setError('');setMessage('');setDiagnostic(null);void load();return()=>{generation.current++;};},[identity,canEdit]);
 async function perform(action){setBusy(true);setError('');setMessage('');setDiagnostic(null);const mine=generation.current;try{
  const r=await assistantCall(action,action==='configure'?{provider:'openai',model,credential_ref:'native-assistant-openai',enabled,expected_revision:data.config.revision}:{request_id:crypto.randomUUID()});
  if(mine===generation.current){setMessage(action==='configure'?'Native Assistant configuration saved.':r.outcome==='verified'?'Connection verified with a real model response.':assistantErrors[r.code]||'Connection is unavailable.');await load();}
 }catch(e){if(mine===generation.current){setError(e.message);setDiagnostic(e.diagnostic||null);await load();}}finally{setBusy(false);}}
 async function feature(action,values={}){setBusy(true);setError('');setMessage('');const mine=generation.current;try{const result=await assistantCall(action,values);if(mine===generation.current){setMessage(action==='features'?'Service availability saved.':'Finished Goods read verified · '+result.total_matching+' matching products · '+result.as_of);await load();}}catch(e){if(mine===generation.current)setError(e.message);}finally{setBusy(false);}}
 const dirty=!!data&&(model!==data.config.model||enabled!==data.config.enabled);
 const canEnable=!!data?.runtime.connection_ready&&data.config.tested_provider_revision===data.config.provider_revision;
 return <section className="card p-4" aria-label="Native Assistant configuration">
  <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Native Assistant</h2><Badge tone={data?.runtime.ready?'success':'neutral'}>{data?.runtime.ready?'Enabled':data?'Not connected':'Loading'}</Badge></div>
   <div className="flex items-center gap-2"><button type="button" className="btn-ghost" aria-label="Refresh Native Assistant status" onClick={()=>void load()} disabled={busy}><RefreshCw size={14}/></button><button type="button" className="btn-secondary" disabled={!data||!canEdit||busy||dirty} onClick={()=>void perform('test')}>Test connection</button><button type="button" className="btn-primary" disabled={!data||!canEdit||busy||!dirty} onClick={()=>void perform('configure')}>Save</button></div></div>
  {error&&<p role="alert" className="mb-3 text-sm text-rose-700">{error}</p>}{message&&<p role="status" className="mb-3 text-sm text-text-secondary">{message}</p>}
  {diagnostic?.source==='openai'&&<details open className="mb-3 text-xs text-text-secondary"><summary className="cursor-pointer">Provider response details</summary><dl className="mt-2 grid gap-2 sm:grid-cols-2">{[['Source','OpenAI upstream'],['HTTP status',diagnostic.http_status],['Provider error code',diagnostic.provider_error_code??'Not supplied'],['Provider error type',diagnostic.provider_error_type??'Not supplied'],['Endpoint',diagnostic.endpoint],['Model',diagnostic.model],['Missing permissions',(diagnostic.missing_permissions||[]).join(', ')||'Not specified']].map(([label,value])=><div key={label} className="min-w-0"><dt className="font-medium">{label}</dt><dd className="break-all">{value}</dd></div>)}</dl></details>}
  {data?<><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><SelectField label="LLM provider" value="openai" options={[{value:'openai',label:'OpenAI'}]} disabled={!canEdit||busy} onChange={()=>{}}/><SelectField label="Model" value={model} options={data.runtime.providers[0].models.map(value=>({value,label:value}))} disabled={!canEdit||busy} onChange={setModel}/><details className="text-xs text-text-secondary"><summary>Text connection details</summary><code className="break-all">{data.runtime.credential_ref}</code></details></div>
   <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-text-secondary"><span>Runtime: {data.runtime.runtime_available?'Available':'Unavailable'}</span><span>Connection: {data.runtime.connection_ready?'Authorized credential available':assistantErrors[data.runtime.blocker]||'Not connected'}</span><span>Last successful test: {data.config.last_success_at?formatOperationalMoment(data.config.last_success_at):'Not recorded'}</span></div>
   <label className="mt-3 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={!canEdit||busy||!canEnable&&!enabled} onChange={e=>setEnabled(e.target.checked)}/> Enable text conversations</label>
   <p className="mt-2 text-xs text-text-secondary">Save provider settings, then test before enabling. 6 context turns · 500 output tokens · fixed read-only capabilities · no business writes.</p>
   {!data.runtime.connection_ready&&<details className="mt-2 text-xs text-text-secondary"><summary className="cursor-pointer">Connection requirements</summary><p className="mt-2 leading-relaxed">Ask the credential custodian to bind an approved Native Assistant key to this server reference. The service requires NATIVE_ASSISTANT_OPENAI_API_KEY, NATIVE_ASSISTANT_APPROVED_USE=native-assistant-phase1a, NATIVE_ASSISTANT_APPROVAL_REFERENCE and NATIVE_ASSISTANT_MODELS. Existing Recruitment, Guest AI and Marketing keys are not reused.</p></details>}
   <div className="mt-4 grid gap-3 border-t border-border pt-3 sm:grid-cols-2"><div className="space-y-2 text-xs text-text-secondary"><h3 className="text-sm font-medium text-text-primary">Voice runtime</h3><SelectField label="Default voice provider" value={voiceProvider} options={[
     {value:'',label:'Select a voice provider',disabled:true},
     ...['openai','grok'].map(value=>({value,label:value==='openai'?'OpenAI Realtime':'Grok Voice',disabled:!data.runtime.voice_providers?.some(row=>row.provider===value&&row.tested_at&&!row.test_error)})),
    ]} disabled={!canEdit||busy} onChange={value=>{setVoiceProvider(value);setVoiceName(voiceOptions[value]?.[0]||'');}}/>
   {voiceOptions[voiceProvider]&&<SelectField label="Voice" value={voiceName} options={voiceOptions[voiceProvider].map(value=>({value,label:value}))} disabled={!canEdit||busy} onChange={setVoiceName}/>}
   <button type="button" className="btn-secondary" disabled={!canEdit||busy||!voiceProvider||(voiceProvider===(data.runtime.voice_default?.provider||'')&&voiceName===(data.runtime.voice_default?.voice||''))} onClick={()=>void saveVoice()}>Save voice default</button>
   <p>Changes apply to new calls. Connect and test voice providers in Providers.</p></div><div className="space-y-2 text-xs text-text-secondary"><h3 className="text-sm font-medium text-text-primary">Factory Finished Goods</h3><p>Current Admin permissions · Factory shared catalogue · read only. No Company / Outlet attribution or machine grants.</p><div className="flex flex-wrap items-center gap-3"><button type="button" className="btn-secondary" disabled={!canEdit||busy} onClick={()=>void feature('tool_test')}>Test Finished Goods read</button><label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!data.config.factory_reads_enabled} disabled={!canEdit||busy} onChange={e=>void feature('features',{expected_revision:data.config.revision,factory_reads_enabled:e.target.checked})}/> Enable authorized reads</label></div><p>Availability never grants business access. Each call rechecks your human permissions; no writes or Agent execution receipts.</p></div></div>
   {data.config.last_test_at&&<p className="mt-2 text-xs text-text-secondary">Last test attempt: {formatOperationalMoment(data.config.last_test_at)} · {data.config.last_test_outcome}. A successful test is historical, not continuous provider health.</p>}
  </>:<p className="text-sm text-text-secondary">{error?'Native Assistant configuration is unavailable. Refresh to try again.':'Loading server configuration…'}</p>}
 <VoiceUsage/>
 </section>;
}
