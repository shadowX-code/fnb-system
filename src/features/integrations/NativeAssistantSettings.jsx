import {assistantProviderPresentation} from './assistantProviderPresentation.js';
import AdminUnderlineTabs from '../../components/navigation/AdminUnderlineTabs.jsx';
import NativeAssistantCapabilities from './NativeAssistantCapabilities.jsx';
import DashboardSection from '../../components/layout/DashboardSection.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import VoiceUsage from '../ai-assistant/VoiceUsage.jsx';
import {voiceOptions} from '../ai-assistant/realtimeVoice.js';
import {useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import SelectField from '../../components/forms/SelectField.jsx';
import {hasPermission} from '../../utils/accessControl.js';
import Badge from '../../components/ui/Badge.jsx';
import {formatOperationalMoment} from '../../lib/dateTime.js';
import {assistantCall,assistantErrors} from '../ai-assistant/nativeAssistantService.js';
export default function NativeAssistantSettings({auth,store}){
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
 async function feature(action,values={}){setBusy(true);setError('');setMessage('');const mine=generation.current;try{const result=await assistantCall(action,values);if(mine===generation.current){setMessage(['capability_connection','action_policy'].includes(action)?'Capability configuration saved.':'Capability read verified · '+result.as_of);await load();return result;}}catch(e){if(mine===generation.current)setError(e.message);return {error:e.message};}finally{setBusy(false);}}
 const dirty=!!data&&(model!==data.config.model||enabled!==data.config.enabled);
 const canEnable=!!data?.runtime.connection_ready&&data.config.tested_provider_revision===data.config.provider_revision;
 const selectedVoice=data?.runtime.voice_providers?.find(row=>row.provider===voiceProvider);
 return <section className="min-w-0 space-y-4" aria-label="Native Assistant configuration">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <div><h2 className="text-base font-semibold">Native Assistant</h2><p className="text-sm text-text-secondary">Providers, authorized capabilities and environment usage.</p></div>
   <button type="button" className="btn-secondary inline-flex items-center gap-2" aria-label="Refresh Native Assistant status" onClick={()=>void load()} disabled={busy}><RefreshCw size={15}/> Refresh</button>
  </div>
  <AdminUnderlineTabs value={section} onChange={setSection} ariaLabel="Native Assistant sections" tabs={[
   {value:'overview',label:'Overview'},{value:'access',label:'AI Capabilities'},{value:'voice',label:'Voice & Usage'},
  ]}/>
  {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}{message&&<p role="status" className="text-sm text-text-secondary">{message}</p>}
  {diagnostic?.source==='openai'&&<details open className="text-xs text-text-secondary"><summary className="cursor-pointer">Provider response details</summary><dl className="mt-2 grid gap-2 sm:grid-cols-2">{[['Source','OpenAI upstream'],['HTTP status',diagnostic.http_status],['Provider error code',diagnostic.provider_error_code??'Not supplied'],['Provider error type',diagnostic.provider_error_type??'Not supplied'],['Endpoint',diagnostic.endpoint],['Model',diagnostic.model],['Missing permissions',(diagnostic.missing_permissions||[]).join(', ')||'Not specified']].map(([label,value])=><div key={label} className="min-w-0"><dt className="font-medium">{label}</dt><dd className="break-all">{value}</dd></div>)}</dl></details>}
  {section==='voice'?<VoiceUsage key={identity} onSaved={load}/>:!data?<p role="status" className="text-sm text-text-secondary">{error?'Native Assistant configuration is unavailable. Refresh to try again.':'Loading server configuration…'}</p>:section==='access'?<NativeAssistantCapabilities auth={auth} store={store} data={data} canEdit={canEdit} busy={busy} onFeature={feature}/>:<div className="grid items-start gap-4 lg:grid-cols-2">
   <DashboardSection title="Text conversation" density="compact" action={<Badge tone={data.runtime.ready?'success':'neutral'}>{data.runtime.ready?'Enabled':data.config.enabled?'Not connected':'Disabled'}</Badge>} contentClassName="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2"><SelectField label="LLM provider" value="openai" options={[{value:'openai',label:'OpenAI'}]} disabled={!canEdit||busy} onChange={()=>{}}/><SelectField label="Model" value={model} options={(data.runtime.providers?.find(p=>p.value==='openai')||data.runtime.providers?.[0])?.models.map(value=>({value,label:value}))||[]} disabled={!canEdit||busy} onChange={setModel}/></div>
    <label className="inline-flex items-center gap-2 text-sm"><input className="admin-checkbox" type="checkbox" checked={enabled} disabled={!canEdit||busy||!canEnable&&!enabled} onChange={e=>setEnabled(e.target.checked)}/> Enable text conversations</label>
    <dl className="space-y-2 text-xs">
     <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-text-secondary">Connection</dt><dd>{data.runtime.connection_ready?'Authorized configuration':assistantErrors[data.runtime.blocker]||'Not connected'}</dd></div>
     <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-text-secondary">Last verified</dt><dd>{data.config.last_success_at?formatOperationalMoment(data.config.last_success_at):'Not recorded'}</dd></div>
    </dl>
    <details className="text-xs text-text-secondary"><summary className="cursor-pointer">Connection details</summary><div className="mt-2 space-y-2"><p>Runtime: {data.runtime.runtime_available?'Available':'Unavailable'}</p><p>Credential reference: <code className="break-all">{data.runtime.credential_ref}</code></p>{data.config.last_test_at&&<p>Last attempt: {formatOperationalMoment(data.config.last_test_at)} · {data.config.last_test_outcome}</p>}{!data.runtime.connection_ready&&<p>The credential custodian must bind a dedicated, approved Native Assistant key. Other domain credentials are not reused.</p>}</div></details>
    <p className="text-xs text-text-secondary">Save changes, then test before enabling. Verification is historical, not continuous health.</p>
    <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3"><button type="button" className="btn-secondary" disabled={!canEdit||busy||dirty} onClick={()=>void perform('test')}>Test connection</button><button type="button" className="btn-primary" disabled={!canEdit||busy||!dirty} onClick={()=>void perform('configure')}>Save</button></div>
   </DashboardSection>
   <DashboardSection title="Voice conversation" density="compact" action={<Badge tone={selectedVoice?.tested_at&&!selectedVoice.test_error?'success':'neutral'}>{!selectedVoice?.configured?'Not connected':selectedVoice.test_error?'Connection failed':selectedVoice.tested_at?'Connection verified':'Not tested'}</Badge>} contentClassName="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2"><SelectField label="Default voice provider" value={voiceProvider} options={[
     {value:'',label:'Select a voice provider',disabled:true},
     ...['openai','grok'].map(value=>({value,label:value==='openai'?'OpenAI Realtime':'Grok Voice',disabled:!data.runtime.voice_providers?.some(row=>row.provider===value&&row.tested_at&&!row.test_error)})),
    ]} disabled={!canEdit||busy} onChange={value=>{setVoiceProvider(value);setVoiceName(voiceOptions[value]?.[0]||'');}}/>
    <AdminFormField label="Model" as="div"><p className="control flex items-center break-all">{assistantProviderPresentation[voiceProvider]?.model||'Not selected'}</p></AdminFormField>
    {voiceOptions[voiceProvider]&&<SelectField label="Voice" value={voiceName} options={voiceOptions[voiceProvider].map(value=>({value,label:value}))} disabled={!canEdit||busy} onChange={setVoiceName}/>}</div>
    <dl className="space-y-2 text-xs"><div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-text-secondary">Last verified</dt><dd>{selectedVoice?.tested_at?formatOperationalMoment(selectedVoice.tested_at):'Not recorded'}</dd></div><div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-text-secondary">Environment enablement</dt><dd><button type="button" className="text-primary underline underline-offset-2" onClick={()=>setSection('voice')}>View Voice Policy</button></dd></div></dl>
    <p className="text-xs text-text-secondary">Changes apply to new calls. Credentials and connection tests remain in Providers.</p>
    <div className="flex justify-end border-t border-border pt-3"><button type="button" className="btn-primary" disabled={!canEdit||busy||!voiceProvider||(voiceProvider===(data.runtime.voice_default?.provider||'')&&voiceName===(data.runtime.voice_default?.voice||''))} onClick={()=>void saveVoice()}>Save voice default</button></div>
   </DashboardSection>
  </div>}
 </section>;
}
