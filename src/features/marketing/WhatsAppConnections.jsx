import {createPortal} from 'react-dom';
import {useEffect,useRef,useState} from 'react';
import {MessageCircle} from 'lucide-react';
import {useAuth} from '../../auth/AuthContext.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import {marketingService} from './marketingService.js';
import {loadWhatsAppSDK,launchWhatsAppSignup,rehearseWhatsAppSignup,whatsappReasonLabels as reasons} from './whatsappSignup.js';

const modes={
 coexistence:{title:'Keep using WhatsApp Business App',description:'Connect your existing number and keep using the app on your phone.'},
 new_number:{title:'Use a dedicated WhatsApp number',description:'Set up a separate number for your team to use in FeedX.'},
};
const normalizePhone=value=>value.trim().replace(/[ ().-]/g,'');
const phonePattern=/^\+[1-9]\d{6,14}$/;
const brandName=(brands,id)=>brands.find(brand=>brand.id===id)?.name||'Authorized Brand';

function connectionStatus(connection){
 if(connection.local_state==='disconnected')return 'Disconnected';
 if(connection.local_state==='paused')return 'Receiving paused';
 if(connection.state==='connected')return 'Connected';
 if(connection.reason==='cloud_registration_required')return 'Registration required';
 if(['awaiting_sync','awaiting_customer_inbound','awaiting_test_inbound'].includes(connection.reason))return 'Waiting for verification';
 if(connection.state==='unsupported')return 'Unsupported';
 return 'Action required';
}

export default function WhatsAppConnections({organizationId,brandId,brands=[],testing=false,actionTarget,managedHeader}) {
 const auth=useAuth();
 const configure=auth.hasPermission('marketing_settings.configure');
 const [data,setData]=useState(null),[loadError,setLoadError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[detail,setDetail]=useState(null);
 const [signup,setSignup]=useState(null),[shutdown,setShutdown]=useState(null),[rehearsal,setRehearsal]=useState(null);
 const scope=JSON.stringify([organizationId,brandId,auth.user?.id]);
 const lifetime=useRef(null);
 useEffect(()=>{
  const controller=new AbortController();lifetime.current=controller;
  return()=>controller.abort();
 },[scope]);
 useEffect(()=>{
  const controller=new AbortController();
  setLoading(true);setLoadError('');
  Promise.all([marketingService.whatsappConnections(organizationId,brandId,controller.signal),marketingService.whatsappReadiness(organizationId,brandId)])
   .then(([accounts,readiness])=>{if(!controller.signal.aborted)setData({scope,...accounts,readiness});})
   .catch(e=>{if(!controller.signal.aborted)setLoadError(e.message);})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[organizationId,brandId,scope,refresh]);
 const current=data?.scope===scope?data:null;
 const readiness=current?.readiness;
 const accounts=current?.connections||[];
 const connections=accounts.filter(c=>testing?c.onboarding_mode==='cloud_api':c.onboarding_mode!=='cloud_api');
 const selected=connections.find(c=>c.id===detail?.id);
 const activeSignup=signup?.scope===scope?signup:null;
 const canConfigure=configure&&!!brandId&&readiness?.can_configure===true;
 const brandAvailable=!!brandId&&brands.some(b=>b.id===brandId&&b.is_active!==false)&&!accounts.length;
 const modeAvailable=mode=>canConfigure&&!loading&&!loadError&&readiness?.eligible===true&&readiness.mode===mode;
 const eligible=modeAvailable(activeSignup?.mode);
 const startAvailable=brandAvailable&&canConfigure&&!loading&&!loadError;
 const statusMessage=reason=>reason==='reconnect_required'?'Meta authorization needs renewal. Reconnect the same WhatsApp number.':reasons[reason]||'Review this connection before continuing.';
 const reload=()=>setRefresh(n=>n+1);
 async function run(action,onSuccess=reload,onFailure){
  const signal=lifetime.current.signal;
  setBusy(true);setError('');
  try{const result=await action(signal);if(!signal.aborted)onSuccess(result);}
  catch(e){if(!signal.aborted){setError(e.message);onFailure?.();}}
  finally{if(!signal.aborted)setBusy(false);}
 }
 useEffect(()=>{
  setBusy(false);setError('');setShutdown(null);setRehearsal(null);
  setSignup(w=>w?.scope===scope?w:null);
  setDetail(d=>d?.brand_id===brandId?d:null);
 },[scope,brandId]);

 function startSignup(connection){
  setError('');
  const next={scope,phase:'options',mode:connection?.onboarding_mode||'',connection,
   phone:phonePattern.test(connection?.account_name||'')?connection.account_name:''};
  setSignup(next);
  if(connection)prepare(next);
 }
 function prepare(next){
  if(!modeAvailable(next.mode)||busy)return;
  // Prepare before the button click so Meta opens with a direct user gesture.
  run(async signal=>{
   const session=await marketingService.beginWhatsApp({organizationId,brandId,connectionId:next.connection?.id||null,generation:next.connection?.credential_generation||0,mode:next.mode});
   if(!signal.aborted)await loadWhatsAppSDK(session);
   return session;
  },session=>setSignup({...next,session}));
 }
 function chooseMode(mode){
  const next={...activeSignup,mode};
  setError('');setSignup(next);
  if(!next.session)prepare(next);
 }
 function launch(){
  const current=activeSignup;
  if(!eligible||busy||!current.session)return;
  if(Date.parse(current.session.expires_at)<=Date.now()){
   setSignup({...current,session:null});
   setError('Your authorization window expired. Try again to open Meta.');
   return;
  }
  setSignup({...current,phase:'authorizing'});
  run(signal=>launchWhatsAppSignup(current.session,{signal}),
   authorization=>setSignup({...current,phase:'confirm',authorization}),
   ()=>setSignup({...current,phase:'options',session:null}));
 }
 function finish(){
  const current=activeSignup;
  if(!eligible||busy||!current.confirmed||!current.authorization||!phonePattern.test(normalizePhone(current.phone)))return;
  const {code,assets}=current.authorization;
  setSignup({...current,phase:'verify',authorization:null,session:null});
  run(()=>marketingService.completeWhatsApp({organizationId,brandId,sessionId:current.session.id,state:current.session.state,code,assets,
   confirmBrandOwnership:true,confirmPhoneNumber:normalizePhone(current.phone)}),reload,reload);
 }
 function verify(c){
  run(()=>marketingService.verifyWhatsApp({organizationId,brandId,connectionId:c.id,generation:c.credential_generation,resumeReceiving:c.local_state==='paused'}));
 }
 function bindTest(c){
  run(()=>marketingService.bindWhatsAppCloudTest({organizationId,brandId,generation:c?.credential_generation??0}));
 }
 function manage(c){
  setError('');setDetail({id:c.id,brand_id:c.brand_id});
 }
 function openChat(c){
  return `/marketing/whatsapp-chat?marketing_brand=${encodeURIComponent(c.brand_id)}&marketing_org=${encodeURIComponent(organizationId)}`;
 }
 const actions=c=><div className="flex flex-wrap gap-2">
  {testing
   ?readiness?.cloud_test_configured&&c.reason!=='awaiting_test_inbound'&&c.state!=='connected'?<button className="btn-secondary" disabled={busy} onClick={()=>bindTest(c)}>Verify test number again</button>:null
   :<>
    {c.local_state!=='disconnected'?<button className="btn-secondary" disabled={busy||loading||!!loadError||!readiness?.eligible||readiness.mode!==c.onboarding_mode} onClick={()=>verify(c)}>{c.local_state==='paused'?'Resume receiving':c.reason==='cloud_registration_required'?'Verify registration':'Verify connection'}</button>:null}
    <button className="btn-secondary" disabled={busy||loading||!!loadError||!readiness?.eligible||readiness.mode!==c.onboarding_mode} onClick={()=>{setDetail(null);startSignup(c);}}>Reconnect</button>
   </>}
  {c.local_state==='active'?<button className="btn-secondary" disabled={busy} onClick={()=>setShutdown({connection:c,action:'pause',request:crypto.randomUUID()})}>Pause receiving</button>:null}
  {c.local_state!=='disconnected'?<button className="btn-secondary" disabled={busy} onClick={()=>setShutdown({connection:c,action:'disconnect',request:crypto.randomUUID()})}>Disconnect from FeedX</button>:null}
 </div>;
 const verifiedConnection=connections.find(c=>c.brand_id===brandId);
 const connectAction=!testing&&configure&&(!brandId||!connections.length)
  ?<button className="btn-primary" disabled={!startAvailable} onClick={()=>startSignup()}>Connect WhatsApp</button>:null;
 const headerAction=connectAction||(!testing&&verifiedConnection
  ?<button className="btn-primary" onClick={()=>manage(verifiedConnection)}>Manage connection</button>:null);
 const approvalStatus=readiness?.reason==='server_configuration_required'?'Signup setup pending':!canConfigure?'Administrator access required':'Meta approval pending';
 const statusError=error?<p role="alert" className="text-sm">{error}</p>:null;

 return <section aria-label={testing?'WhatsApp Staging tools':'WhatsApp numbers'}>
  {actionTarget&&headerAction?createPortal(headerAction,actionTarget):null}
  <AsyncDataSurface loading={loading} error={loadError} hasData={!!current} onRetry={reload}>
   {current&&testing?<div className="space-y-3">
    <p className="text-sm">Test WABA and simulated Meta callbacks for Staging verification.</p>
    {statusError}
    {!brandId?<p className="text-sm">Select the isolated QA Brand in WhatsApp Chat to manage its test number.</p>:null}
    {connections.map(c=><div key={c.id} className="space-y-2">
     <strong>{c.account_name}</strong> · {connectionStatus(c)}
     {c.reason!=='receive_only'&&<p className="text-sm">{c.reason==='reconnect_required'?'Verify again with a valid Staging test token.':statusMessage(c.reason)}</p>}
     <dl className="text-sm"><dt>Receiving</dt><dd>{c.state==='connected'?'Verified':'Not verified'}</dd><dt>Sending</dt>
      <dd>{c.state==='connected'||c.reason==='awaiting_test_inbound'?'Available for eligible test recipients.':'Verify the test connection to send.'}</dd>
     </dl>
     {canConfigure?actions(c):null}
    </div>)}
    <div className="flex flex-wrap gap-2">
     {canConfigure&&readiness.cloud_test_configured&&!accounts.length?<button className="btn-secondary" disabled={busy} onClick={()=>bindTest(null)}>Verify and bind test number</button>:null}
     <button className="btn-secondary" onClick={()=>setRehearsal({scenario:'success',version:'v5'})}>Rehearse WhatsApp signup</button>
     <button className="btn-secondary" disabled={busy} onClick={reload}>Refresh status</button>
    </div>
   </div>:null}
   {current&&!testing?<>
    {connections.length?<div className="settings-integration-table card overflow-hidden"><DataTable mobileLayout="stack" density="compact" minWidth={570}
     getRowKey={c=>c.id} rows={connections} columns={[
      {key:'account',header:'Number / Brand',render:c=><div className="settings-integration-identity"><MessageCircle size={19} aria-hidden="true"/><span><strong>{c.account_name}</strong><small>{brandName(brands,c.brand_id)}</small></span></div>},
      {key:'status',header:'Status',render:c=><Badge tone={c.state==='connected'?'success':'neutral'}>{connectionStatus(c)}</Badge>},
      {key:'action',header:'Next action',render:c=><div className="flex flex-wrap gap-2">
       {auth.hasPermission('marketing_inbox.view')?<a className="btn-secondary" href={openChat(c)}>Open Chat</a>:null}
       <button className="btn-secondary" onClick={()=>manage(c)}>Manage Connection</button>
      </div>},
     ]}/></div>:null}
    {!connections.length?<div className="card settings-wa-empty">
     <span className="settings-platform-icon"><MessageCircle size={21} aria-hidden="true"/></span>
     <div><h2 className="font-semibold">No WhatsApp numbers connected</h2>
     <p className="mt-1 text-sm text-text-secondary">{!configure?'A Brand administrator can connect a business number.':!brandId?'Choose a Brand above to connect a business number.':accounts.length?'Choose another Brand to connect a business number.':!canConfigure?'A Brand administrator can connect a business number.':'Connect a business number to manage customer conversations in FeedX.'}</p></div>
     {!managedHeader?connectAction:null}
    </div>:null}
   </>:null}
  </AsyncDataSurface>
  {activeSignup?<Modal title={activeSignup.connection?'Reconnect WhatsApp':'Connect WhatsApp'}
   description={brandName(brands,brandId)} panelClassName="settings-wa-sheet"
   onClose={()=>{if(!busy){setSignup(null);setError('');}}}
   footer={activeSignup.phase==='options'
    ?eligible&&!activeSignup.session&&!busy
     ?<button className="btn-primary" onClick={()=>prepare(activeSignup)}>Try again</button>
     :<button className="btn-primary" disabled={!eligible||!activeSignup.session||busy} onClick={launch}>{busy?'Preparing Meta…':'Continue with Meta'}</button>
    :activeSignup.phase==='confirm'
     ?<button className="btn-primary" disabled={busy||!eligible||!activeSignup.confirmed||!phonePattern.test(normalizePhone(activeSignup.phone))} onClick={finish}>Confirm and verify</button>
     :activeSignup.phase==='verify'&&!busy&&!loading
      ?verifiedConnection?<button className="btn-primary" onClick={()=>{setSignup(null);manage(verifiedConnection);}}>Manage connection</button>
       :<button className="btn-secondary" onClick={reload}>Check status again</button>
      :null}>
   <div className="space-y-3">
    {statusError}
    {activeSignup.phase==='options'?<>
     <fieldset className="settings-wa-modes" disabled={busy||!!activeSignup.connection}>
      <legend className="mb-2 text-sm font-medium">How will you use WhatsApp?</legend>
      {Object.entries(modes).map(([id,mode])=><label key={id} className="settings-wa-option">
       <input type="radio" name="whatsapp-mode" checked={activeSignup.mode===id} onChange={()=>chooseMode(id)}/>
       <span><strong>{mode.title}</strong><small className="text-text-secondary">{mode.description}</small></span>
      </label>)}
     </fieldset>
     <div className="settings-wa-availability" role="status">
      <Badge tone={eligible?'success':loading?'neutral':'warning'}>{loading?'Checking availability':loadError?'Status unavailable':eligible?'Meta signup available':readiness?.eligible&&!activeSignup.mode?'Choose a connection option':readiness?.eligible?'Option unavailable':approvalStatus}</Badge>
      {!eligible&&!loading?<p className="text-sm text-text-secondary">{loadError?'Refresh the connection page and try again.':readiness?.eligible?(activeSignup.mode?'This Brand is approved for the other connection option.':'FeedX checks availability for the selected option.'):readiness?.reason==='server_configuration_required'?'FeedX is preparing Meta signup.':!canConfigure?'A Brand administrator can continue.':'This Brand can connect once Meta access and number approval are confirmed.'}</p>:null}
     </div>
    </>:null}
    {activeSignup.phase==='authorizing'?<p role="status" className="text-sm">Complete authorization in the Meta window to continue.</p>:null}
    {activeSignup.phase==='confirm'?<>
     <p className="text-sm">Enter the exact number you selected in Meta, including its country code.</p>
     <label className="block text-sm font-medium">WhatsApp number <input className="control block w-full mt-1" type="tel" autoComplete="tel" value={activeSignup.phone} onChange={e=>setSignup({...activeSignup,phone:e.target.value,confirmed:false})}/></label>
     <label className="settings-wa-confirm text-sm"><input type="checkbox" checked={!!activeSignup.confirmed} onChange={e=>setSignup({...activeSignup,confirmed:e.target.checked})}/>I’m authorized to connect this number to {brandName(brands,brandId)}.</label>
    </>:null}
    {activeSignup.phase==='verify'?<div role="status" className="space-y-2">
     {busy||loading?<p className="text-sm">Verifying the number with Meta…</p>:verifiedConnection?<><Badge tone={verifiedConnection.state==='connected'?'success':'neutral'}>{connectionStatus(verifiedConnection)}</Badge><p className="text-sm">{statusMessage(verifiedConnection.reason)}</p></>:<p className="text-sm">FeedX could not confirm the connection. Check its status before starting again.</p>}
    </div>:null}
   </div>
  </Modal>:null}
  {selected&&!shutdown?<Drawer title="Manage Connection" description={selected.account_name} onClose={()=>{if(!busy)setDetail(null);}}>
   <div className="space-y-3"><p className="text-sm">{brandName(brands,selected.brand_id)} · {modes[selected.onboarding_mode]?.title||'WhatsApp Business'}</p>
    <Badge tone={selected.state==='connected'?'success':'neutral'}>{connectionStatus(selected)}</Badge>
    <p className="text-sm">{statusMessage(selected.reason)}</p>
    {!brandId&&configure?<p className="text-sm">Choose this number’s Brand above to change its connection.</p>:null}
    {statusError}
    <p className="text-sm">Sending in FeedX: {selected.sending_enabled?'Enabled':'Unavailable'}</p>
    {canConfigure?<>{actions(selected)}<details className="settings-history"><summary>Advanced Details</summary><dl className="settings-connection-details mt-3"><dt>Connection ID</dt><dd className="break-all">{selected.id}</dd><dt>Authorization generation</dt><dd>{selected.credential_generation}</dd><dt>Verification status</dt><dd>{selected.reason||'Unavailable'}</dd></dl></details></>:null}
   </div>
  </Drawer>:null}
  {shutdown?<Modal title={shutdown.action==='pause'?'Pause WhatsApp receiving':'Disconnect WhatsApp from FeedX'} onClose={()=>{if(!busy)setShutdown(null);}}
   footer={<button className="btn-primary" disabled={busy} onClick={()=>run(()=>marketingService.whatsappLocalCommand(shutdown.request,shutdown.connection.id,shutdown.connection.credential_generation,shutdown.action),()=>{setShutdown(null);reload();})}>{busy?'Updating…':shutdown.action==='pause'?'Confirm pause':'Confirm local disconnect'}</button>}>
   <p className="text-sm">{shutdown.action==='pause'?'FeedX will stop receiving new WhatsApp messages until you resume and verify access.':'FeedX will stop receiving and remove its saved authorization. Reconnect the same number to restore access.'}</p>
   <p className="mt-2 text-sm">{shutdown.connection.onboarding_mode==='coexistence'?'Your mobile app keeps working.':'Your number remains configured in Meta.'}</p>{statusError}
  </Modal>:null}
  {rehearsal?<Modal title="WhatsApp signup rehearsal" onClose={()=>setRehearsal(null)}
   footer={<button className="btn-primary" onClick={()=>setRehearsal({...rehearsal,result:rehearseWhatsAppSignup(rehearsal.scenario,rehearsal.version)})}>Run simulated callback</button>}>
   <p className="text-sm">Simulation only. This uses fictional numbers and leaves Meta and FeedX connections untouched.</p>
   <SelectField label="Signup version" value={rehearsal.version} onChange={version=>setRehearsal({...rehearsal,version,result:null})} options={[{value:'v5',label:'Version 5'},{value:'v4',label:'Version 4'}]}/>
   <SelectField label="Sample response" value={rehearsal.scenario} onChange={scenario=>setRehearsal({...rehearsal,scenario,result:null})} options={[
    {value:'success',label:'Coexistence callback'},{value:'new_number',label:'Dedicated number callback'},{value:'cancel',label:'Customer cancels'},
    {value:'untrusted',label:'Untrusted callback origin'},{value:'mismatch',label:'Number differs from approval'},{value:'uncertain',label:'Synchronization outcome unknown'},
   ]}/>
   {rehearsal.result?<p className="mt-3 text-sm" role="status">{rehearsal.result}</p>:null}
  </Modal>:null}
 </section>;
}
