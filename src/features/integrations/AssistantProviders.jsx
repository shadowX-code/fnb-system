import {useEffect,useRef,useState} from 'react';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/feedback/ConfirmDialog.jsx';
import {formatOperationalMoment} from '../../lib/dateTime.js';
import {assistantCall} from '../ai-assistant/nativeAssistantService.js';

const providers={
 openai:{name:'OpenAI Realtime',model:'gpt-realtime-2.1-mini',voices:'Cedar, Marin, Echo, Ash, Alloy'},
 grok:{name:'Grok Voice',model:'grok-voice-latest',voices:'Eve'},
};

export default function AssistantProviders(){
 const [registry,setRegistry]=useState(null),[editing,setEditing]=useState(null),[busy,setBusy]=useState(false);
 const [feedback,setFeedback]=useState(null),[revoke,setRevoke]=useState(null);
 const pending=useRef(null);
 useEffect(()=>{
  const controller=new AbortController();
  assistantCall('provider_list',{},controller.signal).then(setRegistry).catch(error=>{
   if(!controller.signal.aborted)setFeedback({error:error.message});
  });
  return ()=>{controller.abort();pending.current?.abort();};
 },[]);
 async function run(action,provider,args={}){
  const controller=new AbortController();
  pending.current=controller;
  setFeedback(null);
  setBusy(true);
  let peer;
  try{
   if(action==='provider_test'){
    const sessions=await assistantCall('session_list',{},controller.signal);
    const session_id=sessions.sessions[0]?.id||(await assistantCall('session_new',{},controller.signal)).session_id;
    args={session_id,request_id:crypto.randomUUID()};
    if(provider==='openai'){
     peer=new RTCPeerConnection();
     peer.addTransceiver('audio',{direction:'recvonly'});
     peer.createDataChannel('oai-events');
     await peer.setLocalDescription(await peer.createOffer());
     args.sdp=peer.localDescription.sdp;
    }
   }
   const result=await assistantCall(action,{provider,...args},controller.signal);
   if(peer)await peer.setRemoteDescription({type:'answer',sdp:result.sdp});
   if(!controller.signal.aborted){
    setEditing(null);
    setFeedback({message:action==='provider_test'?'Provider connection verified. Microphone and playback still require a live call.':action==='provider_revoke'?'Credential removed from FeedX. Revoke the key at the provider to invalidate it there.':'Credential saved. Test the connection before activating it.'});
   }
  }catch(error){if(!controller.signal.aborted)setFeedback({error:error.message,diagnostic:error.diagnostic});}
  finally{
   peer?.close();
   if(!controller.signal.aborted){
    try{setRegistry(await assistantCall('provider_list',{},controller.signal));}catch{}
    setBusy(false);
   }
  }
 }
 return <div role="tabpanel" aria-label="Providers" className="space-y-3">
  {feedback?.error&&<p role="alert" className="text-sm text-rose-700">{feedback.error}</p>}
  {feedback?.message&&<p role="status" className="text-sm">{feedback.message}</p>}
  {feedback?.diagnostic&&<details className="text-xs"><summary>Connection details</summary><p>HTTP {feedback.diagnostic.http_status} · {feedback.diagnostic.model}</p></details>}
  {!registry&&!feedback&&<p role="status">Loading providers…</p>}
  <div className="grid gap-3 sm:grid-cols-2">
   {registry?.providers.map(row=>{
    const details=providers[row.provider];
    return <section key={row.provider} className="card space-y-3 p-4">
     <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{details.name}</h2><Badge tone={row.test_error?'danger':row.tested_at?'success':'neutral'}>{row.test_error?'Connection error':row.active_voice?'Active':row.tested_at?'Ready':row.configured?'Test required':'Not configured'}</Badge></div>
     <p className="text-sm text-text-secondary">{details.model} · {details.voices}</p>
     <p className="text-xs text-text-secondary">Last successful test {row.tested_at?formatOperationalMoment(row.tested_at):'not recorded'}</p>
     {row.approval_reference&&<details className="text-xs"><summary>Credential ownership</summary><p>FeedX Staging · Dedicated voice evaluation · Approval {row.approval_reference}</p></details>}
     {registry.can_edit&&<div className="flex flex-wrap gap-2">
      <button type="button" className="btn-secondary" disabled={busy} onClick={()=>setEditing(row.provider)}>{row.configured?'Replace key':'Connect provider'}</button>
      {row.configured&&<><button type="button" className="btn-secondary" disabled={busy} onClick={()=>void run('provider_test',row.provider)}>Test connection</button><button type="button" className="btn-ghost" disabled={busy} onClick={()=>setRevoke(row.provider)}>Remove key</button></>}
     </div>}
     {editing===row.provider&&registry.can_edit&&<form className="space-y-2" onSubmit={event=>{
      event.preventDefault();
      const form=event.currentTarget;
      const values=new FormData(form);
      const args={credential:String(values.get('credential')).trim(),approval_reference:String(values.get('approval_reference')).trim()};
      form.reset();
      void run('provider_put',row.provider,args);
     }}>
      <p className="text-xs text-text-secondary">Use a dedicated key approved for the Staging voice evaluation. Replacing a key requires a new test.</p>
      <label className="block text-sm">API key<input name="credential" type="password" autoComplete="off" required minLength={20} maxLength={512} className="control block w-full" /></label>
      <label className="block text-sm">Approval reference<input name="approval_reference" required maxLength={120} className="control block w-full" /></label>
      <div className="flex gap-2"><button className="btn-primary" disabled={busy}>Save key</button><button className="btn-ghost" type="button" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button></div>
     </form>}
    </section>;
   })}
  </div>
  <p className="text-xs text-text-secondary">The existing OpenAI text connection is managed separately. Provider credentials grant no FeedX business access.</p>
  <ConfirmDialog request={revoke?{title:'Remove provider key?',message:'FeedX will stop opening new sessions with this key. Revoke it at the provider to invalidate the key upstream.',confirmLabel:'Remove key',danger:true}:null} onCancel={()=>setRevoke(null)} onConfirm={()=>{const provider=revoke;setRevoke(null);void run('provider_revoke',provider);}} />
 </div>;
}
