import {assistantProviderPresentation} from './assistantProviderPresentation.js';
import AdminUnderlineTabs from '../../components/navigation/AdminUnderlineTabs.jsx';
import NativeAssistantKnowledge from './NativeAssistantKnowledge.jsx';
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
 const generation=useRef(0),identity=auth?.user?.id||auth?.profile?.id,canManage=hasPermission(auth,'roles.view')&&hasPermission(auth,'roles.edit'),canEdit=canManage&&data?.can_edit!==false;
 const [section,setSection]=useState('overview');
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
 useEffect(()=>{setData(null);setError('');setMessage('');setDiagnostic(null);void load();return()=>{generation.current++;};},[identity,canManage]);
 async function perform(action){setBusy(true);setError('');setMessage('');setDiagnostic(null);const mine=generation.current;try{
  const r=await assistantCall(action,action==='configure'?{provider:'openai',model,credential_ref:'native-assistant-openai',enabled,expected_revision:data.config.revision}:{request_id:crypto.randomUUID()});
  if(mine===generation.current){setMessage(action==='configure'?'Native Assistant configuration saved.':r.outcome==='verified'?'Connection verified with a real model response.':assistantErrors[r.code]||'Connection is unavailable.');await load();}
 }catch(e){if(mine===generation.current){setError(e.message);setDiagnostic(e.diagnostic||null);await load();}}finally{setBusy(false);}}
 async function feature(action,values={}){setBusy(true);setError('');setMessage('');const mine=generation.current;try{const result=await assistantCall(action,values);if(mine===generation.current){setMessage(action==='features'?'Service availability saved.':'Finished Goods read verified · '+result.total_matching+' matching products · '+result.as_of);await load();}}catch(e){if(mine===generation.current)setError(e.message);}finally{setBusy(false);}}
 const dirty=!!data&&(model!==data.config.model||enabled!==data.config.enabled);
 const canEnable=!!data?.runtime.connection_ready&&data.config.tested_provider_revision===data.config.provider_revision;
 const selectedVoice=data?.runtime.voice_providers?.find(row=>row.provider===voiceProvider);
 const toolState=!data?.config.factory_reads_enabled?'Disabled':data.runtime.tools?'Available':'Not authorized';
 return <section className="min-w-0 space-y-4" aria-label="Native Assistant configuration">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <div><h2 className="text-base font-semibold">Native Assistant</h2><p className="text-sm text-text-secondary">Providers, authorized capabilities and environment usage.</p></div>
   <button type="button" className="btn-secondary inline-flex items-center gap-2" aria-label="Refresh Native Assistant status" onClick={()=>void load()} disabled={busy}><RefreshCw size={15}/> Refresh</button>
  </div>
  <AdminUnderlineTabs value={section} onChange={setSection} ariaLabel="Native Assistant sections" tabs={[
   {value:'overview',label:'Overview'},{value:'capabilities',label:'Capabilities'},{value:'knowledge',label:'Knowledge'},{value:'voice',label:'Voice & Usage'},
  ]}/>
  {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}{message&&<p role="status" className="text-sm text-text-secondary">{message}</p>}
  {diagnostic?.source==='openai'&&<details open className="text-xs text-text-secondary"><summary className="cursor-pointer">Provider response details</summary><dl className="mt-2 grid gap-2 sm:grid-cols-2">{[['Source','OpenAI upstream'],['HTTP status',diagnostic.http_status],['Provider error code',diagnostic.provider_error_code??'Not supplied'],['Provider error type',diagnostic.provider_error_type??'Not supplied'],['Endpoint',diagnostic.endpoint],['Model',diagnostic.model],['Missing permissions',(diagnostic.missing_permissions||[]).join(', ')||'Not specified']].map(([label,value])=><div key={label} className="min-w-0"><dt className="font-medium">{label}</dt><dd className="break-all">{value}</dd></div>)}</dl></details>}
  {section==='knowledge'?<NativeAssistantKnowledge/>:section==='voice'?<VoiceUsage key={identity} onSaved={load}/>:!data?<p role="status" className="text-sm text-text-secondary">{error?'Native Assistant configuration is unavailable. Refresh to try again.':'Loading server configuration…'}</p>:section==='overview'?<div className="space-y-6">
   <section aria-label="Text provider" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Text conversation</h3><Badge tone={data.runtime.ready?'success':'neutral'}>{data.runtime.ready?'Enabled':data.config.enabled?'Not connected':'Disabled'}</Badge></div>
    <div className="grid gap-3 sm:grid-cols-2"><SelectField label="LLM provider" value="openai" options={[{value:'openai',label:'OpenAI'}]} disabled={!canEdit||busy} onChange={()=>{}}/><SelectField label="Model" value={model} options={(data.runtime.providers?.find(p=>p.value==='openai')||data.runtime.providers?.[0])?.models.map(value=>({value,label:value}))||[]} disabled={!canEdit||busy} onChange={setModel}/></div>
    <dl className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-3">
     <div><dt className="text-text-secondary">Runtime</dt><dd className="mt-1 font-medium">{data.runtime.runtime_available?'Available':'Unavailable'}</dd></div>
     <div><dt className="text-text-secondary">Credential</dt><dd className="mt-1 font-medium">{data.runtime.connection_ready?'Authorized configuration':assistantErrors[data.runtime.blocker]||'Not connected'}</dd></div>
     <div><dt className="text-text-secondary">Last verified connection</dt><dd className="mt-1 font-medium">{data.config.last_success_at?formatOperationalMoment(data.config.last_success_at):'Not recorded'}</dd></div>
    </dl>
    <div className="flex flex-wrap items-center justify-between gap-3"><label className="inline-flex items-center gap-2 text-sm"><input className="admin-checkbox" type="checkbox" checked={enabled} disabled={!canEdit||busy||!canEnable&&!enabled} onChange={e=>setEnabled(e.target.checked)}/> Enable text conversations</label><div className="flex gap-2"><button type="button" className="btn-secondary" disabled={!canEdit||busy||dirty} onClick={()=>void perform('test')}>Test connection</button><button type="button" className="btn-primary" disabled={!canEdit||busy||!dirty} onClick={()=>void perform('configure')}>Save</button></div></div>
    <p className="text-xs text-text-secondary">Save changes, then verify before enabling. A successful test is historical, not continuous provider health.</p>
    <details className="text-xs text-text-secondary"><summary className="cursor-pointer">Text connection details</summary><div className="mt-2 space-y-2"><p>Server credential reference: <code className="break-all">{data.runtime.credential_ref}</code></p>{data.config.last_test_at&&<p>Last test attempt: {formatOperationalMoment(data.config.last_test_at)} · {data.config.last_test_outcome}</p>}{!data.runtime.connection_ready&&<p>Ask the credential custodian to bind the approved Native Assistant key and approval record to this reference. Recruitment, Guest AI and Marketing credentials are not reused.</p>}</div></details>
   </section>
   <section aria-label="Voice provider" className="space-y-3 border-t border-border pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Voice conversation</h3><Badge tone={selectedVoice?.tested_at&&!selectedVoice.test_error?'success':'neutral'}>{!selectedVoice?.configured?'Not connected':selectedVoice.test_error?'Connection failed':selectedVoice.tested_at?'Connection verified':'Not tested'}</Badge></div>
    <div className="grid gap-3 sm:grid-cols-2"><SelectField label="Default voice provider" value={voiceProvider} options={[
     {value:'',label:'Select a voice provider',disabled:true},
     ...['openai','grok'].map(value=>({value,label:value==='openai'?'OpenAI Realtime':'Grok Voice',disabled:!data.runtime.voice_providers?.some(row=>row.provider===value&&row.tested_at&&!row.test_error)})),
    ]} disabled={!canEdit||busy} onChange={value=>{setVoiceProvider(value);setVoiceName(voiceOptions[value]?.[0]||'');}}/>
    {voiceOptions[voiceProvider]&&<SelectField label="Voice" value={voiceName} options={voiceOptions[voiceProvider].map(value=>({value,label:value}))} disabled={!canEdit||busy} onChange={setVoiceName}/>}</div>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-text-secondary">{selectedVoice?.tested_at?`Last verified: ${formatOperationalMoment(selectedVoice.tested_at)}. `:''}Provider credentials and connection tests remain in Providers.</p><button type="button" className="btn-secondary" disabled={!canEdit||busy||!voiceProvider||(voiceProvider===(data.runtime.voice_default?.provider||'')&&voiceName===(data.runtime.voice_default?.voice||''))} onClick={()=>void saveVoice()}>Save voice default</button></div>
    <p className="text-xs text-text-secondary">{assistantProviderPresentation[voiceProvider]&&<>Model: {assistantProviderPresentation[voiceProvider].model} · </>}Changes apply to new calls. Environment enablement and session limits are in Voice &amp; Usage.</p>
   </section>
  </div>:<section className="space-y-4" aria-label="Assistant capabilities">
   <div><h3 className="text-sm font-semibold">Registered business tools</h3><p className="mt-1 text-sm text-text-secondary">One read-only capability. Other FeedX modules and business writes are not connected to this Assistant.</p></div>
   <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-sm font-semibold">Factory Finished Goods</h4><p className="mt-1 text-xs text-text-secondary">Read · Factory shared catalogue · current balances and minimum stock</p></div><Badge tone={toolState==='Available'?'success':toolState==='Not authorized'?'warning':'neutral'}>{toolState}</Badge></div>
   <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-text-secondary">Current-user authorization</dt><dd>{data.config.factory_reads_enabled?(data.runtime.tools?'Authorized by server':'Your current Admin role cannot use this read'):'Not evaluated while disabled'}</dd></div><div><dt className="text-text-secondary">Scope</dt><dd>Factory shared catalogue; no Company or Outlet attribution</dd></div></dl>
   <div className="flex flex-wrap items-center gap-3"><label className="inline-flex items-center gap-2 text-sm"><input className="admin-checkbox" type="checkbox" checked={!!data.config.factory_reads_enabled} disabled={!canEdit||busy} onChange={e=>void feature('features',{expected_revision:data.config.revision,factory_reads_enabled:e.target.checked})}/> Enable authorized reads</label><button type="button" className="btn-secondary" disabled={!canEdit||busy} onClick={()=>void feature('tool_test')}>Test Finished Goods read</button></div>
   <p className="text-xs text-text-secondary">Every call rechecks human permissions. The read test checks your access independently of Assistant enablement; it does not grant access or change inventory.</p>
   <details className="text-xs text-text-secondary"><summary className="cursor-pointer">Tool contract</summary><p className="mt-2"><code>read_factory_finished_goods</code> · Read only. No machine grants, business writes or Agent execution receipts. Recorded evidence includes source, scope and read timestamp.</p></details>
  </section>}
 </section>;
}
