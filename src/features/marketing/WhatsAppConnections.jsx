import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../../auth/AuthContext.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import {marketingService} from './marketingService.js';
import {loadWhatsAppSDK,launchWhatsAppSignup,whatsappStateLabels as labels,whatsappReasonLabels as reasons} from './whatsappSignup.js';

export default function WhatsAppConnections({organizationId,brandId,brands=[]}) {
 const auth=useAuth(),configure=auth.hasPermission('marketing_settings.configure');
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[prepared,setPrepared]=useState(null),[confirmed,setConfirmed]=useState(false),[shutdown,setShutdown]=useState(null);
 const scope=`${organizationId}:${brandId||''}:${auth.user?.id||''}`,currentScope=useRef(scope),lifetime=useRef(new AbortController());currentScope.current=scope;
 useEffect(()=>{
  const controller=new AbortController();lifetime.current=controller;let active=true;
  setData(null);setError('');setLoading(true);setPrepared(null);setShutdown(null);setConfirmed(false);setBusy(false);
  Promise.all([marketingService.whatsappConnections(organizationId,brandId,controller.signal),marketingService.whatsappReadiness(organizationId,brandId)])
   .then(([accounts,readiness])=>{if(active)setData({scope,...accounts,readiness});})
   .catch(e=>{if(active)setError(e.message);})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;controller.abort();};
 },[organizationId,brandId,scope,refresh]);
 const current=data?.scope===scope?data:null;
 async function act(connection,reconnect=false,resumeReceiving=false){
  const requested=scope;setBusy(true);setError('');
  try{
   if(connection&&!reconnect){await marketingService.verifyWhatsApp({organizationId,brandId,connectionId:connection.id,generation:connection.credential_generation,resumeReceiving});if(currentScope.current===requested)setRefresh(n=>n+1);}
   else{const s=await marketingService.beginWhatsApp({organizationId,brandId,connectionId:connection?.id||null,generation:connection?.credential_generation||0});await loadWhatsAppSDK(s);if(currentScope.current===requested){setPrepared(s);setConfirmed(false);}}
  }catch(e){if(currentScope.current===requested)setError(e.message);}
  finally{if(currentScope.current===requested)setBusy(false);}
 }
 async function stopReceiving(){
  const requested=scope,s=shutdown;setBusy(true);setError('');
  try{await marketingService.whatsappLocalCommand(s.request,s.connection.id,s.connection.credential_generation,s.action);if(currentScope.current===requested){setShutdown(null);setRefresh(n=>n+1);}}
  catch(e){if(currentScope.current===requested)setError(e.message);}
  finally{if(currentScope.current===requested)setBusy(false);}
 }
 function launch(){
  const requested=scope,s=prepared;setBusy(true);setError('');
  launchWhatsAppSignup(s,{signal:lifetime.current.signal}).then(({code,assets})=>{
   if(currentScope.current!==requested) return;
   return marketingService.completeWhatsApp({organizationId,brandId,sessionId:s.id,state:s.state,code,assets,confirmBrandOwnership:true});
  }).then(()=>{if(currentScope.current===requested){setPrepared(null);setRefresh(n=>n+1);}})
   .catch(e=>{if(currentScope.current===requested){setPrepared(null);setError(e.message);}})
   .finally(()=>{if(currentScope.current===requested)setBusy(false);});
 }
 const readiness=current?.readiness,state=current?.connections?.[0]?.state||current?.signup_state||'not_connected';
 return <section className="card p-5" aria-label="WhatsApp Cloud API">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">WhatsApp Business App</h2><Badge tone={state==='connected'?'success':state==='action_required'?'warning':'neutral'}>{labels[state]||'Not Connected'}</Badge></div>
  <p className="mt-2 text-sm">Connect an eligible WhatsApp Business App account through Meta while staff keep using the mobile app. This pilot receives messages only. Sending, AI replies and campaign execution are disabled.</p>
  <AsyncDataSurface loading={loading} error={error} hasData={!!current} onRetry={()=>setRefresh(n=>n+1)}>
   {current?<>
    {brandId&&!current.connections?.length?<div className="mt-3"><Badge tone="neutral">{labels[readiness?.state]||'Verification Required'}</Badge></div>:null}
    {current.signup_state==='action_required'&&!current.connections?.length?<p className="mt-3 text-sm">The previous Meta signup could not be confirmed. Start a new connection after reviewing the account in Meta.</p>:null}
    {!brandId?<p className="mt-3 text-sm">Select one Brand to verify or connect WhatsApp.</p>:<p className="mt-3 text-sm" role="status">{reasons[readiness?.reason]||'Verify eligibility before connecting.'}</p>}
    {current.connections?.length?<ul className="mt-3 space-y-3">{current.connections.map(c=><li key={c.id} className="text-sm">
     <div><strong>{c.account_name}</strong> · {brands.find(b=>b.id===c.brand_id)?.name||'Authorized Brand'} · {labels[c.state]||'Action Required'}</div>
     <p>{reasons[c.reason]||'Review this connection before continuing.'}</p>
     {configure&&brandId?<div className="mt-2 flex flex-wrap gap-2">{c.local_state!=='disconnected'?<button className="btn-secondary" disabled={busy||!readiness?.eligible} onClick={()=>act(c,false,c.local_state==='paused')}>{c.local_state==='paused'?'Resume receiving':'Retry Verification'}</button>:null}<button className="btn-secondary" disabled={busy||!readiness?.eligible} onClick={()=>act(c,true)}>Reconnect</button>{c.local_state==='active'?<button className="btn-secondary" disabled={busy} onClick={()=>setShutdown({connection:c,action:'pause',request:crypto.randomUUID()})}>Pause receiving</button>:null}{c.local_state!=='disconnected'?<button className="btn-secondary" disabled={busy} onClick={()=>setShutdown({connection:c,action:'disconnect',request:crypto.randomUUID()})}>Disconnect from FeedX</button>:null}</div>:null}
    </li>)}</ul>:<p className="mt-3 text-sm">No WhatsApp Cloud connection registered.</p>}
    {configure&&brandId?<div className="mt-3 flex flex-wrap gap-2">{!current.connections?.length?<button className="btn-primary" disabled={busy||!readiness?.eligible} onClick={()=>act(null)}>Connect WhatsApp</button>:null}<button className="btn-secondary" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Check Eligibility</button></div>:null}
   </>:null}
  </AsyncDataSurface>
  {shutdown?<Modal title={shutdown.action==='pause'?'Pause WhatsApp receiving':'Disconnect WhatsApp from FeedX'} onClose={()=>{if(!busy)setShutdown(null)}} footer={<button className="btn-primary" disabled={busy} onClick={stopReceiving}>{busy?'Updating…':shutdown.action==='pause'?'Confirm pause':'Confirm local disconnect'}</button>}>
   <p className="text-sm">{shutdown.action==='pause'?'FeedX will stop receiving and processing new WhatsApp messages until you explicitly resume and verify access.':'FeedX will stop receiving and remove its saved WhatsApp authorization. Reconnect the same number to restore access.'}</p>
   <p className="mt-3 text-sm">Your mobile app keeps working. This action does not disconnect Meta’s Business Platform link. For provider offboarding, the account owner must use WhatsApp Business App → Settings → Account → Business Platform → Disconnect Account.</p>
  </Modal>:null}
  {prepared?<Modal title="Connect WhatsApp Business App" onClose={()=>{if(!busy)setPrepared(null)}} footer={<button className="btn-primary" disabled={!confirmed||busy} onClick={launch}>{busy?'Waiting for Meta…':'Continue to Meta'}</button>}>
   <p className="text-sm">Meta will check this account’s eligibility. Use the existing WhatsApp Business App option and keep the mobile app open during synchronization. FeedX will not register a replacement number or disconnect the app.</p>
   <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I am authorized to connect this WhatsApp number exclusively to {brands.find(b=>b.id===brandId)?.name||'this Brand'}.</label>
  </Modal>:null}
 </section>;
}
