const origins=new Set(['https://www.facebook.com','https://web.facebook.com']);
const id=v=>typeof v==='string'&&/^\d{1,32}$/.test(v);
export function signupOptions(config){
 if(!id(config.configId)||!['v4','v5'].includes(config.signupVersion))throw new Error('WhatsApp signup configuration is unavailable.');
 return {config_id:config.configId,response_type:'code',override_default_response_type:true,
  extras:config.signupVersion==='v5'?{version:'v5'}:config.mode==='new_number'?{version:'v4',setup:{},sessionInfoVersion:'3'}:{setup:{},featureType:'whatsapp_business_app_onboarding',sessionInfoVersion:'3'}};
}
export function signupAssets(event,version,mode='coexistence'){
 if(!origins.has(event.origin)||typeof event.data!=='string'||event.data.length>12000)return null;
 let p;try{p=JSON.parse(event.data)}catch{return null}
 if(p?.type!=='WA_EMBEDDED_SIGNUP')return null;
 if(['CANCEL','ERROR'].includes(p.event))return {cancelled:true};
 if(mode==='new_number'){
  const data=p.data;
  if(p.event!=='FINISH'||!id(data?.phone_number_id)||!id(data?.business_id))return null;
  const waba=version==='v5'
   ?(data.is_on_biz_app===false&&Array.isArray(data.messaging_account_ids)&&data.messaging_account_ids.length===1?data.messaging_account_ids[0]:null)
   :(version==='v4'&&data.is_on_biz_app!==true?data.waba_id:null);
  return id(waba)?{waba_id:waba,phone_id:data.phone_number_id,business_id:data.business_id,mode:'new_number'}:null;
 }
 if(mode!=='coexistence')return null;
 if(version==='v5'){
  const d=p.data;if(p.event!=='FINISH'||d?.is_on_biz_app!==true||!Array.isArray(d.messaging_account_ids)||d.messaging_account_ids.length!==1||!id(d.messaging_account_ids[0])||!id(d.phone_number_id)||!id(d.business_id))return null;
  return {waba_id:d.messaging_account_ids[0],phone_id:d.phone_number_id,business_id:d.business_id,mode:'coexistence'};
 }
 if(p.event!=='FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'||!id(p.data?.waba_id))return null;
 if(p.data.phone_number_id!==undefined&&!id(p.data.phone_number_id)||p.data.business_id!==undefined&&!id(p.data.business_id))return null;
 return {waba_id:p.data.waba_id,phone_id:p.data.phone_number_id,business_id:p.data.business_id,mode:'coexistence'};
}
// Exercise the same message parser without an SDK, authorization code or server request.
export function rehearseWhatsAppSignup(scenario,version='v5'){
 const origin=scenario==='untrusted'?'https://example.invalid':'https://www.facebook.com';
 const cancelled=scenario==='cancel';
 const newNumber=scenario==='new_number';
 const data=version==='v5'
  ?{is_on_biz_app:!newNumber,messaging_account_ids:['101'],phone_number_id:'102',business_id:'103'}
  :{waba_id:'101',phone_number_id:'102',business_id:'103'};
 const event=cancelled?'CANCEL':version==='v5'||newNumber?'FINISH':'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
 const result=signupAssets({origin,data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event,data})},version,newNumber?'new_number':'coexistence');
 if(result?.cancelled)return 'Signup cancelled. Close this rehearsal and start again when ready.';
 if(!result)return 'Callback rejected. Review the signup configuration and confirm Coexistence eligibility.';
 if(newNumber)return 'Sample new-number callback passed. Live signup requires a reviewed Meta configuration and a separate approved registration and verification flow.';
 if(scenario==='mismatch')return 'Connection validation rejected the number. Use the exact number approved for this Brand.';
 if(scenario==='uncertain')return 'Synchronization could not be confirmed. Review the existing connection with your administrator before reconnecting.';
 return 'Sample callback passed. A live connection still requires Meta authorization, asset verification, synchronization and a signed inbound message.';
}
let sdkPromise,initialized,active;
export function loadWhatsAppSDK(config){
 if(!id(config.appId)||!/^v\d+\.0$/.test(config.graphVersion))return Promise.reject(new Error('Meta configuration is unavailable.'));
 if(initialized&&initialized!==`${config.appId}:${config.graphVersion}`)return Promise.reject(new Error('Reload Connections before switching Meta applications.'));
 if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{
  if(window.FB){resolve(window.FB);return;}
  const script=document.createElement('script');script.src='https://connect.facebook.net/en_US/sdk.js';script.async=true;script.crossOrigin='anonymous';
  const timer=setTimeout(()=>{script.remove();sdkPromise=null;reject(new Error('Meta could not load. Retry verification.'));},15000);
  script.onload=()=>{clearTimeout(timer);if(window.FB)resolve(window.FB);else{sdkPromise=null;reject(new Error('Meta could not load.'));}};
  script.onerror=()=>{clearTimeout(timer);script.remove();sdkPromise=null;reject(new Error('Meta could not load. Retry verification.'));};document.head.append(script);
 });
 return sdkPromise.then(fb=>{fb.init({appId:config.appId,version:config.graphVersion,autoLogAppEvents:false,xfbml:false});initialized=`${config.appId}:${config.graphVersion}`;return fb;});
}
// Called directly by the Continue button, after SDK/session preparation, to preserve popup user activation.
export function launchWhatsAppSignup(config,{signal}={}){
 if(active||!window.FB||initialized!==`${config.appId}:${config.graphVersion}`)return Promise.reject(new Error('Another Meta connection is open. Close it and retry.'));
 const options=signupOptions(config);
 return new Promise((resolve,reject)=>{
  let code,assets,finished=false;const marker={};active=marker;
  const cleanup=()=>{finished=true;clearTimeout(timer);window.removeEventListener('message',message);signal?.removeEventListener('abort',abort);if(active===marker)active=null;};
  const fail=()=>{if(finished)return;cleanup();reject(new Error('Meta signup was cancelled or expired. Connect again.'));};
  const abort=()=>fail();
  const finish=()=>{if(!finished&&code&&assets){cleanup();resolve({code,assets});}};
  const message=e=>{if(finished)return;const value=signupAssets(e,config.signupVersion,config.mode);if(value?.cancelled){fail();return;}if(value){if(assets&&JSON.stringify(value)!==JSON.stringify(assets)){fail();return;}assets=value;finish();}};
  const timer=setTimeout(fail,5*60*1000);window.addEventListener('message',message);signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){fail();return;}
  try{window.FB.login(response=>{if(finished)return;const value=response?.authResponse?.code;if(typeof value!=='string'||!value||value.length>4096){fail();return;}code=value;finish();},options);}catch{fail();}
 });
}
export const whatsappStateLabels={not_connected:'Not Connected',verification_required:'Verification Required',eligible:'Eligible',connected:'Connected',action_required:'Action Required',unsupported:'Unsupported'};
export const whatsappReasonLabels={cloud_registration_required:'The approved number is saved. Complete Cloud API registration in Meta, then retry verification.',awaiting_customer_inbound:'Registration and subscription verified. Waiting for an inbound message.',locally_paused:'Receiving is paused in FeedX. Resume requires fresh verification. Your mobile app remains available.',locally_disconnected:'Disconnected locally. Reconnect the same number to restore FeedX receiving; the mobile app and provider link are unchanged.',credential_unavailable:'Saved authorization is unavailable. Reconnect the same number.',server_configuration_required:'FeedX’s WhatsApp signup configuration needs verification.',pilot_activation_required:'Live onboarding awaits approval for the one-Brand pilot.',platform_or_pilot_verification_required:'FeedX’s Meta business, Tech Provider access, app review and Brand pilot approval need verification.',ready_for_authorized_pilot:'Ready to open Meta for this approved Brand.',subscription_verification_required:'WhatsApp webhook subscription needs verification.',sync_outcome_uncertain:'Synchronization could not be confirmed. Contact your FeedX administrator before reconnecting.',sync_deadline_exceeded:'The Meta synchronization window has expired. Contact your FeedX administrator.',awaiting_test_inbound:'Meta authorization and subscription verified. Waiting for a signed test message.',awaiting_sync:'Waiting for synchronization and a signed inbound message.',receive_only:'Receive-only connection. Sending and AI replies are disabled.',reconnect_required:'Meta authorization needs renewal. Reconnect the same WhatsApp Business App number.',provider_verification_required:'Meta access needs verification. Retry verification or reconnect.',provider_disconnected:'Meta reports that the business disconnected. Reconnect the same number after review.',coexistence_unsupported:'Meta could not confirm Business App Coexistence for this number.'};
