import WhatsAppTemplateCatalog from './WhatsAppTemplateCatalog.jsx';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../../auth/AuthContext.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import {marketingService} from './marketingService.js';
import {loadWhatsAppSDK,launchWhatsAppSignup,rehearseWhatsAppSignup,whatsappStateLabels as labels,whatsappReasonLabels as reasons} from './whatsappSignup.js';

function ConnectionReadiness({receiving = false}) {
 return <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
  <div><dt className="inline font-medium">Receiving</dt><dd className="ml-1 inline">{receiving ? 'Verified' : 'Not verified'}</dd></div>
  <div><dt className="inline font-medium">FeedX sending</dt><dd className="ml-1 inline">Disabled</dd></div>
  <div><dt className="inline font-medium">Number quality</dt><dd className="ml-1 inline">Not verified in FeedX</dd></div>
  <div><dt className="inline font-medium">Messaging limits</dt><dd className="ml-1 inline">Not verified in FeedX</dd></div>
 </dl>;
}

export default function WhatsAppConnections({organizationId,brandId,brands=[]}) {
 const auth=useAuth(),configure=auth.hasPermission('marketing_settings.configure');
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[prepared,setPrepared]=useState(null),[confirmed,setConfirmed]=useState(false),[shutdown,setShutdown]=useState(null);
 const [testError,setTestError]=useState(null);
 const [rehearsal,setRehearsal]=useState(null);
 const [signupError,setSignupError]=useState(null);
 const scope=`${organizationId}:${brandId||''}:${auth.user?.id||''}`,currentScope=useRef(scope),lifetime=useRef(new AbortController());currentScope.current=scope;
 useEffect(()=>{
  const controller=new AbortController();lifetime.current=controller;let active=true;
  setData(null);setRehearsal(null);setError('');setTestError(null);setLoading(true);setPrepared(null);setShutdown(null);setConfirmed(false);setBusy(false);
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
 async function bindCloudTest(connection){
  const requested=scope;setBusy(true);setTestError(null);
  try{
   await marketingService.bindWhatsAppCloudTest({organizationId,brandId,generation:connection?.credential_generation??0});
   if(currentScope.current===requested)setRefresh(n=>n+1);
  }catch(e){if(currentScope.current===requested)setTestError({scope:requested,message:e.message});}
  finally{if(currentScope.current===requested)setBusy(false);}
 }
 async function stopReceiving(){
  const requested=scope,s=shutdown;setBusy(true);setError('');
  try{await marketingService.whatsappLocalCommand(s.request,s.connection.id,s.connection.credential_generation,s.action);if(currentScope.current===requested){setShutdown(null);setRefresh(n=>n+1);}}
  catch(e){if(currentScope.current===requested)setError(e.message);}
  finally{if(currentScope.current===requested)setBusy(false);}
 }
 function launch(){
  const requested=scope,s=prepared;setBusy(true);setSignupError(null);
  launchWhatsAppSignup(s,{signal:lifetime.current.signal}).then(({code,assets})=>{
   if(currentScope.current!==requested) return;
   return marketingService.completeWhatsApp({organizationId,brandId,sessionId:s.id,state:s.state,code,assets,confirmBrandOwnership:true});
  }).then(()=>{if(currentScope.current===requested){setPrepared(null);setRefresh(n=>n+1);}})
   .catch(e=>{if(currentScope.current===requested){setPrepared(null);setSignupError({scope,message:e.message});setRefresh(n=>n+1);}})
   .finally(()=>{if(currentScope.current===requested)setBusy(false);});
 }
 const readiness=current?.readiness,state=current?.connections?.[0]?.state||current?.signup_state||'not_connected';
 return <section className="card p-5" aria-label="WhatsApp Cloud API">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">WhatsApp</h2><Badge tone={state==='connected'?'success':state==='action_required'?'warning':'neutral'}>{labels[state]||'Not Connected'}</Badge></div>
  <p className="mt-2 text-sm">Business App Coexistence uses Meta signup to connect an eligible existing account while staff keep using the mobile app. FeedX supports receive-only operation for an approved connection.</p>
  <p className="mt-2 text-sm"><strong>Cloud API test number:</strong> A Staging administrator can verify the authorized test number for receiving. Sending is disabled.</p>
  {testError?.scope===scope?<p className="mt-3 text-sm" role="alert">{testError.message}</p>:null}
  {signupError?.scope===scope?<p className="mt-3 text-sm" role="alert">{signupError.message} Review the refreshed connection status before trying again.</p>:null}
  <AsyncDataSurface loading={loading} error={error} hasData={!!current} onRetry={()=>setRefresh(n=>n+1)}>
   {current?<>
    {brandId&&!current.connections?.length?<div className="mt-3"><Badge tone="neutral">{readiness?.cloud_test_configured?'Test verification available':labels[readiness?.state]||'Verification Required'}</Badge></div>:null}
    {brandId&&!readiness?.eligible?<div className="mt-3 space-y-2">
     <Badge tone="warning">Live onboarding pending approval</Badge>
     <p className="text-sm">Live signup requires Meta business verification, app permissions and approval for this Brand. You can rehearse signup now with fictional responses.</p>
     {configure?<button className="btn-secondary" onClick={()=>setRehearsal({scope,scenario:'success',version:'v5'})}>Rehearse WhatsApp signup</button>:null}
    </div>:null}
    {current.signup_state==='action_required'&&!current.connections?.length?<p className="mt-3 text-sm">The previous Meta signup could not be confirmed. Start a new connection after reviewing the account in Meta.</p>:null}
    {!brandId?<p className="mt-3 text-sm">Select one Brand to verify or connect WhatsApp.</p>:<p className="mt-3 text-sm" role="status">{readiness?.cloud_test_configured?'The test number can be checked here. Business App Coexistence has separate eligibility requirements.':reasons[readiness?.reason]||'Verify eligibility before connecting.'}</p>}
    {current.connections?.length?<ul className="mt-3 space-y-3">{current.connections.map(c=><li key={c.id} className="text-sm">
     <div><strong>{c.account_name}</strong> · {brands.find(b=>b.id===c.brand_id)?.name||'Authorized Brand'} · {labels[c.state]||'Action Required'}</div>
     <p>{(c.onboarding_mode==='cloud_api'&&c.reason==='reconnect_required'?'Verify again with a valid Staging test token.':reasons[c.reason])||'Review this connection before continuing.'}</p>
     <ConnectionReadiness receiving={c.state==='connected'}/>
     {configure&&brandId&&readiness?.cloud_test_configured&&c.onboarding_mode==='cloud_api'&&c.local_state==='active'&&
      <WhatsAppTemplateCatalog key={c.id+':'+c.credential_generation} organizationId={organizationId} brandId={brandId} connection={c}/>}
     {configure&&brandId?<div className="mt-2 flex flex-wrap gap-2">{c.onboarding_mode==='cloud_api'?(readiness?.cloud_test_configured&&c.reason!=='awaiting_test_inbound'&&c.state!=='connected'?<button className="btn-secondary" disabled={busy} onClick={()=>bindCloudTest(c)}>Verify test number again</button>:null):<>{c.local_state!=='disconnected'?<button className="btn-secondary" disabled={busy||!readiness?.eligible} onClick={()=>act(c,false,c.local_state==='paused')}>{c.local_state==='paused'?'Resume receiving':'Retry Verification'}</button>:null}<button className="btn-secondary" disabled={busy||!readiness?.eligible} onClick={()=>act(c,true)}>Reconnect</button></>}{c.local_state==='active'?<button className="btn-secondary" disabled={busy} onClick={()=>setShutdown({connection:c,action:'pause',request:crypto.randomUUID()})}>Pause receiving</button>:null}{c.local_state!=='disconnected'?<button className="btn-secondary" disabled={busy} onClick={()=>setShutdown({connection:c,action:'disconnect',request:crypto.randomUUID()})}>Disconnect from FeedX</button>:null}</div>:null}
    </li>)}</ul>:<>
     <p className="mt-3 text-sm">No WhatsApp Cloud connection registered.</p>
     <ConnectionReadiness/>
    </>}
    {configure&&brandId?<div className="mt-3 flex flex-wrap gap-2">{!current.connections?.length&&readiness?.cloud_test_configured?<button className="btn-secondary" disabled={busy} onClick={()=>bindCloudTest(null)}>Verify and bind test number</button>:null}{!current.connections?.length?<button className="btn-primary" disabled={busy||!readiness?.eligible} onClick={()=>act(null)}>Connect WhatsApp Business App</button>:null}<button className="btn-secondary" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Check Eligibility</button></div>:null}
   </>:null}
  </AsyncDataSurface>
  {rehearsal?.scope===scope?<Modal title="WhatsApp signup rehearsal" onClose={()=>setRehearsal(null)}
   footer={<button className="btn-primary" onClick={()=>setRehearsal({...rehearsal,result:rehearseWhatsAppSignup(rehearsal.scenario,rehearsal.version)})}>Run simulated callback</button>}>
   <p className="text-sm">Simulation only. No Meta popup, credentials or changes to this Brand’s connections.</p>
   <label className="mt-3 block text-sm">Signup version<select className="control block" value={rehearsal.version} onChange={e=>setRehearsal({...rehearsal,version:e.target.value,result:null})}><option value="v5">Version 5</option><option value="v4">Version 4</option></select></label>
   <label className="mt-3 block text-sm">Sample response<select className="control block" value={rehearsal.scenario} onChange={e=>setRehearsal({...rehearsal,scenario:e.target.value,result:null})}>
    <option value="success">Coexistence callback</option><option value="cancel">Customer cancels</option><option value="untrusted">Untrusted callback origin</option><option value="mismatch">Number differs from approval</option><option value="uncertain">Synchronization outcome unknown</option>
   </select></label>
   {rehearsal.result?<p className="mt-3 text-sm" role="status">{rehearsal.result}</p>:null}
  </Modal>:null}
  {shutdown?<Modal title={shutdown.action==='pause'?'Pause WhatsApp receiving':'Disconnect WhatsApp from FeedX'} onClose={()=>{if(!busy)setShutdown(null)}} footer={<button className="btn-primary" disabled={busy} onClick={stopReceiving}>{busy?'Updating…':shutdown.action==='pause'?'Confirm pause':'Confirm local disconnect'}</button>}>
   <p className="text-sm">{shutdown.action==='pause'?'FeedX will stop receiving and processing new WhatsApp messages until you explicitly resume and verify access.':'FeedX will stop receiving and remove its saved WhatsApp authorization. Reconnect the same number to restore access.'}</p>
   {shutdown.connection.onboarding_mode==='cloud_api'?<p className="mt-3 text-sm">This only changes FeedX receiving. The Meta test number and its webhook subscription stay configured.</p>:<p className="mt-3 text-sm">Your mobile app keeps working. This action does not disconnect Meta’s Business Platform link. For provider offboarding, the account owner must use WhatsApp Business App → Settings → Account → Business Platform → Disconnect Account.</p>}
  </Modal>:null}
  {prepared?<Modal title="Connect WhatsApp Business App" onClose={()=>{if(!busy)setPrepared(null)}} footer={<button className="btn-primary" disabled={!confirmed||busy} onClick={launch}>{busy?'Waiting for Meta…':'Continue to Meta'}</button>}>
   <p className="text-sm">Meta will check this account’s eligibility. Use the existing WhatsApp Business App option and keep the mobile app open during synchronization. FeedX will not register a replacement number or disconnect the app.</p>
   <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I am authorized to connect this WhatsApp number exclusively to {brands.find(b=>b.id===brandId)?.name||'this Brand'}.</label>
  </Modal>:null}
 </section>;
}
