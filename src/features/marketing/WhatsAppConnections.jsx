import {useEffect,useRef,useState} from 'react';
import {MessageCircle} from 'lucide-react';
import {useAuth} from '../../auth/AuthContext.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import WhatsAppTemplateCatalog from './WhatsAppTemplateCatalog.jsx';
import {marketingService} from './marketingService.js';
import {loadWhatsAppSDK,launchWhatsAppSignup,rehearseWhatsAppSignup,whatsappReasonLabels as reasons} from './whatsappSignup.js';

const modes={
 coexistence:{title:'Existing WhatsApp Business App',description:'Connect an eligible number through Meta and keep using the WhatsApp Business App on your phone.'},
 new_number:{title:'Dedicated WhatsApp Number',description:'Set up a dedicated number on the WhatsApp Cloud API. After authorization, complete registration in Meta.'},
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

export default function WhatsAppConnections({organizationId,brandId,brands=[],onBrandChange,testing=false}) {
 const auth=useAuth();
 const configure=auth.hasPermission('marketing_settings.configure');
 const [data,setData]=useState(null),[loadError,setLoadError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[detail,setDetail]=useState(null);
 const [wizard,setWizard]=useState(null),[shutdown,setShutdown]=useState(null),[rehearsal,setRehearsal]=useState(null);
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
 const selected=connections.find(c=>c.id===detail?.id&&c.brand_id===brandId);
 const activeWizard=wizard?.scope===scope?wizard:null;
 const canConfigure=configure&&readiness?.can_configure===true;
 const brandAvailable=!!brandId&&brands.some(b=>b.id===brandId&&b.is_active!==false)&&!accounts.length;
 const eligible=canConfigure&&!loading&&!loadError&&readiness?.eligible===true&&readiness.mode===activeWizard?.mode;
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
  setWizard(w=>w?.scope===scope?w:null);
  setDetail(d=>d?.brand_id===brandId?d:null);
 },[scope,brandId]);

 function startWizard(connection){
  setError('');
  setWizard({scope,step:connection?'authorize':'brand',mode:connection?.onboarding_mode||'',connection,
   phone:phonePattern.test(connection?.account_name||'')?connection.account_name:''});
 }
 function prepare(){
  const w=activeWizard;
  if(!eligible||!phonePattern.test(normalizePhone(w.phone)))return;
  run(async signal=>{
   const s=await marketingService.beginWhatsApp({organizationId,brandId,connectionId:w.connection?.id||null,generation:w.connection?.credential_generation||0,mode:w.mode});
   if(!signal.aborted)await loadWhatsAppSDK(s);
   return s;
  },session=>setWizard({...w,step:'meta',session}));
 }
 function launch(){
  const w=activeWizard;
  if(!eligible||!w.session)return;
  run(signal=>launchWhatsAppSignup(w.session,{signal}),authorization=>setWizard({...w,step:'confirm',authorization}),
   ()=>setWizard({...w,step:'authorize',session:null}));
 }
 function finish(){
  const w=activeWizard;
  if(!eligible||!w.confirmed||!w.authorization)return;
  const {code,assets}=w.authorization;
  setWizard({...w,step:'verify',authorization:null,session:null});
  run(()=>marketingService.completeWhatsApp({organizationId,brandId,sessionId:w.session.id,state:w.session.state,code,assets,
   confirmBrandOwnership:true,confirmPhoneNumber:normalizePhone(w.phone)}),()=>{setWizard({...w,step:'verify',session:null,authorization:null});reload();},
   ()=>{setWizard({...w,step:'verify',session:null,authorization:null});reload();});
 }
 function verify(c){
  run(()=>marketingService.verifyWhatsApp({organizationId,brandId,connectionId:c.id,generation:c.credential_generation,resumeReceiving:c.local_state==='paused'}));
 }
 function bindTest(c){
  run(()=>marketingService.bindWhatsAppCloudTest({organizationId,brandId,generation:c?.credential_generation??0}));
 }
 function manage(c){
  setError('');setDetail({id:c.id,brand_id:c.brand_id});
  if(c.brand_id!==brandId)onBrandChange?.(c.brand_id);
 }
 function openChat(c){
  return `/marketing/whatsapp-chat?marketing_brand=${encodeURIComponent(c.brand_id)}&marketing_org=${encodeURIComponent(organizationId)}`;
 }
 const actions=c=><div className="flex flex-wrap gap-2">
  {testing
   ?readiness?.cloud_test_configured&&c.reason!=='awaiting_test_inbound'&&c.state!=='connected'?<button className="btn-secondary" disabled={busy} onClick={()=>bindTest(c)}>Verify test number again</button>:null
   :<>
    {c.local_state!=='disconnected'?<button className="btn-secondary" disabled={busy||loading||!!loadError||!readiness?.eligible||readiness.mode!==c.onboarding_mode} onClick={()=>verify(c)}>{c.local_state==='paused'?'Resume receiving':c.reason==='cloud_registration_required'?'Verify registration':'Verify connection'}</button>:null}
    <button className="btn-secondary" disabled={busy||loading||!!loadError||!readiness?.eligible||readiness.mode!==c.onboarding_mode} onClick={()=>{setDetail(null);startWizard(c);}}>Reconnect</button>
   </>}
  {c.local_state==='active'?<button className="btn-secondary" disabled={busy} onClick={()=>setShutdown({connection:c,action:'pause',request:crypto.randomUUID()})}>Pause receiving</button>:null}
  {c.local_state!=='disconnected'?<button className="btn-secondary" disabled={busy} onClick={()=>setShutdown({connection:c,action:'disconnect',request:crypto.randomUUID()})}>Disconnect from FeedX</button>:null}
 </div>;
 const verifiedConnection=connections.find(c=>c.brand_id===brandId);
 const statusError=error?<p role="alert" className="text-sm">{error}</p>:null;

 return <section aria-label={testing?'WhatsApp Staging tools':'WhatsApp numbers'}>
  <AsyncDataSurface loading={loading} error={loadError} hasData={!!current} onRetry={reload}>
   {current&&testing?<div className="space-y-3">
    <p className="text-sm">Test WABA and simulated Meta callbacks for Staging verification.</p>
    {statusError}
    {!brandId?<p className="text-sm">Select the isolated QA Brand in WhatsApp Chat to manage its test number.</p>:null}
    {connections.map(c=><div key={c.id} className="space-y-2">
     <strong>{c.account_name}</strong> · {connectionStatus(c)}
     <p className="text-sm">{c.reason==='reconnect_required'?'Verify again with a valid Staging test token.':statusMessage(c.reason)}</p>
     <dl className="text-sm"><dt>Receiving</dt><dd>{c.state==='connected'?'Verified':'Not verified'}</dd><dt>Sending</dt><dd>Controlled by separate Staging QA gates.</dd></dl>
     {canConfigure&&readiness.cloud_test_configured&&c.local_state==='active'?<WhatsAppTemplateCatalog key={c.id+':'+c.credential_generation} organizationId={organizationId} brandId={brandId} connection={c}/>:null}
     {canConfigure?actions(c):null}
    </div>)}
    <div className="flex flex-wrap gap-2">
     {canConfigure&&readiness.cloud_test_configured&&!accounts.length?<button className="btn-secondary" disabled={busy} onClick={()=>bindTest(null)}>Verify and bind test number</button>:null}
     <button className="btn-secondary" onClick={()=>setRehearsal({scenario:'success',version:'v5'})}>Rehearse WhatsApp signup</button>
     <button className="btn-secondary" disabled={busy} onClick={reload}>Refresh status</button>
    </div>
   </div>:null}
   {current&&!testing?<>
    {!activeWizard&&connections.length?<div className="flex flex-wrap items-center justify-between gap-2 mb-3">
     <h2 className="font-semibold">WhatsApp numbers</h2>
     {configure&&(!brandId||brandAvailable)?<button className="btn-primary" onClick={()=>startWizard()}>Connect WhatsApp</button>:null}
    </div>:null}
    {!activeWizard&&connections.length?<div className="settings-integration-table card overflow-hidden"><DataTable mobileLayout="stack" density="compact" minWidth={570}
     getRowKey={c=>c.id} rows={connections} columns={[
      {key:'account',header:'Number / Brand',render:c=><div className="settings-integration-identity"><MessageCircle size={19} aria-hidden="true"/><span><strong>{c.account_name}</strong><small>{brandName(brands,c.brand_id)}</small></span></div>},
      {key:'status',header:'Status',render:c=><Badge tone={c.state==='connected'?'success':'neutral'}>{connectionStatus(c)}</Badge>},
      {key:'action',header:'Next action',render:c=><div className="flex flex-wrap gap-2">
       {auth.hasPermission('marketing_inbox.view')?<a className="btn-secondary" href={openChat(c)}>Open Chat</a>:null}
       <button className="btn-secondary" onClick={()=>manage(c)}>Manage Connection</button>
      </div>},
     ]}/></div>:null}
    {!activeWizard&&!connections.length?<div className="card p-5 settings-wa-setup">
     <MessageCircle size={23} aria-hidden="true"/>
     <h2 className="mt-3 font-semibold">Connect WhatsApp</h2>
     <p className="mt-1 text-sm text-text-secondary">Add a business number so your team can handle WhatsApp conversations in FeedX.</p>
     {configure?<button className="btn-primary mt-3" onClick={()=>startWizard()}>Connect WhatsApp</button>:<p className="mt-2 text-sm">A Brand administrator can connect a number.</p>}
    </div>:null}
   </>:null}
  </AsyncDataSurface>
  {activeWizard?<div className="card p-5 settings-wa-setup space-y-4" aria-label="Connect WhatsApp setup">
   <div><h2 className="font-semibold">{activeWizard.connection?'Reconnect WhatsApp':'Connect WhatsApp'}</h2>
    <p className="text-sm text-text-secondary">{activeWizard.step==='brand'?'Step 1 of 5 · Brand':activeWizard.step==='mode'?'Step 2 of 5 · Connection type':['authorize','meta'].includes(activeWizard.step)?'Step 3 of 5 · Meta authorization':activeWizard.step==='confirm'?'Step 4 of 5 · Confirm number':'Step 5 of 5 · Verify connection'}</p></div>
   {statusError}
   {activeWizard.step==='brand'?<>
    <SelectField label="Brand for WhatsApp" value={brandId} options={[{value:'',label:'Select a Brand'},...brands.filter(b=>b.is_active!==false).map(b=>({value:b.id,label:b.name}))]} onChange={id=>{
     onBrandChange?.(id);setWizard({...activeWizard,scope:JSON.stringify([organizationId,id,auth.user?.id])});
    }}/>
    {brandId&&!loading&&accounts.length?<p className="text-sm">{connections.length?'This Brand already has a WhatsApp connection. Select another Brand or manage its existing connection.':'This Brand is unavailable for customer signup. Choose another Brand.'}</p>:null}
    <button className="btn-primary" disabled={!brandAvailable||loading||!current||!!loadError} onClick={()=>setWizard({...activeWizard,step:'mode'})}>Continue</button>
   </>:null}
   {activeWizard.step==='mode'?<>
    <fieldset className="settings-wa-modes"><legend className="mb-2 font-medium">How will your team use WhatsApp?</legend>
     {Object.entries(modes).map(([id,mode])=><label className="card" key={id}><input type="radio" name="whatsapp-mode" checked={activeWizard.mode===id} onChange={()=>setWizard({...activeWizard,mode:id})}/><span><strong>{mode.title}</strong><small className="text-text-secondary">{mode.description}</small></span></label>)}
    </fieldset>
    <button className="btn-primary" disabled={!activeWizard.mode} onClick={()=>setWizard({...activeWizard,step:'authorize'})}>Continue</button>
   </>:null}
   {['authorize','meta'].includes(activeWizard.step)?<>
    <p className="text-sm"><strong>{brandName(brands,brandId)}</strong> · {modes[activeWizard.mode].title}</p>
    {eligible?<p className="text-sm">{activeWizard.mode==='coexistence'?'Choose the same number in Meta and keep WhatsApp Business open on your phone when prompted.':'Choose the approved number in Meta, then complete its registration in WhatsApp Manager.'}</p>
     :<div className="space-y-2" role="status"><Badge tone="warning">{loading?'Checking availability':'Signup unavailable'}</Badge><p className="text-sm">{loading?'Checking the selected Brand and connection type.':loadError?'Availability could not be checked. Refresh the connection and try again.':!canConfigure?'A Brand administrator must authorize this connection.':readiness?.eligible?'This Brand has approval for a different connection type.':readiness?.reason==='server_configuration_required'?'FeedX is still configuring Meta signup.':readiness?.reason==='platform_or_pilot_verification_required'?'Meta access and approval for this Brand and number must be verified before signup can open.':'WhatsApp onboarding is pending approval. Your administrator can confirm when it becomes available.'}</p></div>}
    {activeWizard.step==='authorize'&&eligible?<label className="block text-sm">Approved WhatsApp number <input className="control block mt-1" type="tel" autoComplete="tel" placeholder="+60123456789" value={activeWizard.phone} disabled={busy} onChange={e=>setWizard({...activeWizard,phone:e.target.value})}/><small className="block mt-1">Include the country code.</small></label>:null}
    {!eligible&&!loading?<button className="btn-secondary mr-2" onClick={reload}>Check availability</button>:null}
    <button className="btn-primary" disabled={!eligible||busy||!phonePattern.test(normalizePhone(activeWizard.phone))} onClick={activeWizard.step==='meta'?launch:prepare}>{busy?'Please wait…':activeWizard.step==='meta'?'Continue to Meta':'Prepare Meta authorization'}</button>
   </>:null}
   {activeWizard.step==='confirm'?<>
    <p className="text-sm">Meta returned an authorization. Confirm the exact number you selected for <strong>{brandName(brands,brandId)}</strong>.</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={!!activeWizard.confirmed} onChange={e=>setWizard({...activeWizard,confirmed:e.target.checked})}/>I selected {normalizePhone(activeWizard.phone)} in Meta and am authorized to connect it to this Brand.</label>
    <button className="btn-primary" disabled={busy||!eligible||!activeWizard.confirmed} onClick={finish}>Confirm and verify</button>
   </>:null}
   {activeWizard.step==='verify'?<div role="status" className="space-y-2">
    {busy||loading?<p className="text-sm">Verifying the approved number with Meta…</p>:verifiedConnection?<><Badge tone={verifiedConnection.state==='connected'?'success':'neutral'}>{connectionStatus(verifiedConnection)}</Badge><p className="text-sm">{statusMessage(verifiedConnection.reason)}</p><button className="btn-secondary" onClick={()=>{setWizard(null);manage(verifiedConnection);}}>Manage Connection</button></>:<p className="text-sm">A connection could not be confirmed. Check your account in Meta before starting again.</p>}
   </div>:null}
   <div className="flex flex-wrap gap-2">
    {['mode','authorize','meta'].includes(activeWizard.step)&&!activeWizard.connection?<button className="btn-secondary" disabled={busy} onClick={()=>{setError('');setWizard({...activeWizard,step:activeWizard.step==='mode'?'brand':'mode',session:null});}}>Back</button>:null}
    <button className="btn-secondary" disabled={busy} onClick={()=>{setWizard(null);setError('');}}>{activeWizard.step==='verify'?'Done':'Cancel setup'}</button>
   </div>
  </div>:null}
  {selected&&!shutdown?<Drawer title="Manage Connection" description={selected.account_name} onClose={()=>{if(!busy)setDetail(null);}}>
   <div className="space-y-3"><p className="text-sm">{brandName(brands,selected.brand_id)} · {modes[selected.onboarding_mode]?.title||'WhatsApp Business'}</p>
    <Badge tone={selected.state==='connected'?'success':'neutral'}>{connectionStatus(selected)}</Badge>
    <p className="text-sm">{statusMessage(selected.reason)}</p>
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
