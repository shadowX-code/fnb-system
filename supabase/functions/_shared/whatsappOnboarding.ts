import {hash} from './metaSecurity.ts';
import {MetaError} from './metaGraph.ts';
export const WHATSAPP_SCOPES=['whatsapp_business_management','whatsapp_business_messaging'];
export const WHATSAPP_FIELDS=['messages','smb_message_echoes','account_update','history','smb_app_state_sync'];
export type WhatsAppConfig={appId:string;appSecret:string;configId:string;version:string;signupVersion:string;enabled:boolean;callback:string};
export type Graph={request:(path:string,token:string,params?:Record<string,unknown>,method?:string)=>Promise<any>};
const numeric=(v:unknown):v is string=>typeof v==='string'&&/^\d{1,32}$/.test(v);
export function configured(c:WhatsAppConfig){return numeric(c.appId)&&numeric(c.configId)&&!!c.appSecret&&/^v\d+\.0$/.test(c.version)&&['v4','v5'].includes(c.signupVersion);}
export async function exchangeWhatsAppCode(g:Graph,c:WhatsAppConfig,code:string){
 if(typeof code!=='string'||code.length<1||code.length>4096)throw new MetaError('invalid_signup_code');
 // BISU code exchange is single use. Do not run the FB user-token extension flow.
 const r=await g.request('oauth/access_token','',{client_id:c.appId,client_secret:c.appSecret,code});
 if(typeof r.access_token!=='string'||!r.access_token||r.access_token.length>16000)throw new MetaError('signup_exchange_uncertain',true);
 return r.access_token as string;
}
export async function collect(g:Graph,path:string,token:string,params:Record<string,unknown>){
 const rows:any[]=[];let after:string|undefined;const seen=new Set<string>();
 for(let page=0;page<10;page++){
  const r=await g.request(path,token,{...params,limit:100,...(after?{after}:{})});
  if(!Array.isArray(r.data)||r.data.length>100)throw new MetaError('whatsapp_assets_unverified');rows.push(...r.data);
  if(!r.paging?.next)return rows;
  after=r.paging?.cursors?.after;if(typeof after!=='string'||after.length>2000||seen.has(after))throw new MetaError('whatsapp_assets_incomplete');seen.add(after);
 }
 throw new MetaError('whatsapp_assets_incomplete');
}
export async function verifyWhatsAppAccount(g:Graph,c:WhatsAppConfig,token:string,expected:{waba_id:string;phone_id:string;customer_business_id:string},now=Date.now()){
 if(![expected.waba_id,expected.phone_id,expected.customer_business_id].every(numeric))throw new MetaError('invalid_whatsapp_assets');
 const d=(await g.request('debug_token',`${c.appId}|${c.appSecret}`,{input_token:token})).data;
 if(d?.is_valid!==true||String(d.app_id)!==c.appId||!numeric(d.user_id)||d.type!=='SYSTEM_USER')throw new MetaError('whatsapp_token_identity_mismatch');
 if(!Array.isArray(d.scopes)||!WHATSAPP_SCOPES.every(s=>d.scopes.includes(s)))throw new MetaError('whatsapp_permissions_required');
 const grant=d.granular_scopes?.find((s:any)=>s.scope==='whatsapp_business_management');
 if(!Array.isArray(grant?.target_ids)||!grant.target_ids.includes(expected.waba_id))throw new MetaError('whatsapp_waba_grant_required');
 if(typeof d.expires_at!=='number'||!Number.isFinite(d.expires_at)||d.expires_at<0||(d.data_access_expires_at!==undefined&&(typeof d.data_access_expires_at!=='number'||!Number.isFinite(d.data_access_expires_at)||d.data_access_expires_at<0)))throw new MetaError('whatsapp_token_expiry_unverified');
 const limits=[d.expires_at,d.data_access_expires_at].filter(v=>Number(v)>0).map(v=>Number(v)*1000);
 if(limits.some(v=>!Number.isFinite(v)||v<=now))throw new MetaError('whatsapp_token_expired');
 // A non-expiring business token still needs a fresh provider verification every 24h.
 const expiry=new Date(Math.min(now+86400000,...limits)).toISOString();
 const w=await g.request(expected.waba_id,token,{fields:'id,owner_business_info'});
 if(w.id!==expected.waba_id||w.owner_business_info?.id!==expected.customer_business_id)throw new MetaError('whatsapp_business_owner_mismatch');
 const phones=await collect(g,`${expected.waba_id}/phone_numbers`,token,{fields:'id'});
 if(phones.filter(p=>p.id===expected.phone_id).length!==1)throw new MetaError('whatsapp_phone_waba_mismatch');
 return {subject:d.user_id,expiresAt:expiry};
}
export async function verifyWhatsAppAssets(g:Graph,c:WhatsAppConfig,token:string,expected:{waba_id:string;phone_id:string;customer_business_id:string;approved_phone_hash?:string|null;confirmedPhoneNumber?:string;mode?:'coexistence'|'new_number'},now=Date.now()){
 const {subject,expiresAt}=await verifyWhatsAppAccount(g,c,token,expected,now);
 const newNumber=expected.mode==='new_number';
 const fieldsToRead=['id','is_on_biz_app','platform_type'];
 if(expected.approved_phone_hash||expected.confirmedPhoneNumber)fieldsToRead.push('display_phone_number');
 if(newNumber)fieldsToRead.push('status','code_verification_status');
 const p=await g.request(expected.phone_id,token,{fields:fieldsToRead.join(',')});
 if(newNumber){
  if(!expected.approved_phone_hash||p.id!==expected.phone_id||p.is_on_biz_app!==false
   ||p.code_verification_status!=='VERIFIED'||!['CLOUD_API','NOT_APPLICABLE'].includes(p.platform_type))
   throw new MetaError('whatsapp_cloud_identity_unverified');
 }else if(p.id!==expected.phone_id||p.is_on_biz_app!==true||p.platform_type!=='CLOUD_API'){
  throw new MetaError('coexistence_unsupported');
 }
 const displayPhone=expected.approved_phone_hash||expected.confirmedPhoneNumber?normalizedWhatsAppPhone(p.display_phone_number):null;
 if(expected.confirmedPhoneNumber&&displayPhone!==expected.confirmedPhoneNumber)throw new MetaError('whatsapp_approved_phone_mismatch');
 const phoneHash=expected.approved_phone_hash?await hash(displayPhone!):null;
 if(expected.approved_phone_hash&&phoneHash!==expected.approved_phone_hash)throw new MetaError('whatsapp_approved_phone_mismatch');
 // App configuration is inspected, never changed by onboarding.
 const subs=await collect(g,`${c.appId}/subscriptions`,`${c.appId}|${c.appSecret}`,{});
 const sub=subs.find(s=>s.object==='whatsapp_business_account'&&s.callback_url===c.callback&&s.active===true);
 const fields=sub?.fields?.map((f:any)=>typeof f==='string'?f:f.name)||[];
 if(!(newNumber?['messages','account_update']:WHATSAPP_FIELDS).every(f=>fields.includes(f)))throw new MetaError('whatsapp_app_webhooks_required');
 return {app_id:c.appId,waba_id:expected.waba_id,phone_id:expected.phone_id,business_id:expected.customer_business_id,subject,
 ...(phoneHash?{approved_phone_hash:phoneHash}:{}),...(displayPhone?{display_phone_number:displayPhone}:{}),scopes:WHATSAPP_SCOPES,expires_at:expiresAt,is_on_biz_app:!newNumber,platform_type:p.platform_type,registration_verified:newNumber&&p.platform_type==='CLOUD_API'&&p.status==='CONNECTED'};
}
export const CLOUD_TEST_APP='2204918033458414';
export const CLOUD_TEST_WABA='1675083730240518';
export const CLOUD_TEST_PHONE='1221509657713215';
const CLOUD_TEST_SYSTEM_USER='122103065595539221';

export async function verifyWhatsAppCloudTest(g:Graph,c:WhatsAppConfig,token:string,now=Date.now()){
 const appToken=`${c.appId}|${c.appSecret}`;
 const checked=async<T>(code:string,read:()=>Promise<T>):Promise<T>=>{
  try{return await read();}
  catch(error){throw new MetaError(code,false,error instanceof MetaError&&error.retryable,error instanceof MetaError?error.graphCode:undefined);}
 };
 const d=(await checked('whatsapp_test_token_check_failed',()=>g.request('debug_token',appToken,{input_token:token})))?.data;
 if(c.appId!==CLOUD_TEST_APP||d?.is_valid!==true||d.app_id!==CLOUD_TEST_APP||!numeric(d.user_id)||!['USER','SYSTEM_USER'].includes(d.type))
  throw new MetaError('whatsapp_token_identity_mismatch');
 if(!Array.isArray(d.scopes)||!WHATSAPP_SCOPES.every(scope=>d.scopes.includes(scope)))throw new MetaError('whatsapp_permissions_required');
 const grants=d.granular_scopes??[];
 const managementGrant=grants.some((grant:any)=>grant.scope==='whatsapp_business_management'
  &&Array.isArray(grant.target_ids)&&grant.target_ids.includes(CLOUD_TEST_WABA));
 for(const grant of grants){
  if(!WHATSAPP_SCOPES.includes(grant.scope))continue;
  // The verified Staging System User omits both targets. The exact asset reads below are still required.
  if(grant.target_ids===undefined&&(
   (d.type==='SYSTEM_USER'&&d.user_id===CLOUD_TEST_SYSTEM_USER)||
   (grant.scope==='whatsapp_business_messaging'&&managementGrant)
  ))continue;
  if(!Array.isArray(grant.target_ids)||!grant.target_ids.includes(CLOUD_TEST_WABA))
   throw new MetaError('whatsapp_waba_grant_required');
 }
 const expiry=d.expires_at*1000;
 const dataExpiry=d.data_access_expires_at??0;
 if(!Number.isSafeInteger(d.expires_at)||expiry<=now||!Number.isSafeInteger(dataExpiry)||dataExpiry<0||(dataExpiry!==0&&dataExpiry*1000<=now))
  throw new MetaError('whatsapp_token_expiry_unverified');
 const waba=await checked('whatsapp_test_asset_check_failed',()=>g.request(CLOUD_TEST_WABA,token,{fields:'id'}));
 const phones=await checked('whatsapp_test_asset_check_failed',()=>collect(g,`${CLOUD_TEST_WABA}/phone_numbers`,token,{fields:'id'}));
 const phone=await checked('whatsapp_test_asset_check_failed',()=>g.request(CLOUD_TEST_PHONE,token,{fields:'id,platform_type'}));
 if(waba.id!==CLOUD_TEST_WABA||phones.filter(p=>p.id===CLOUD_TEST_PHONE).length!==1||phone.id!==CLOUD_TEST_PHONE||phone.platform_type!=='CLOUD_API')
  throw new MetaError('whatsapp_phone_waba_mismatch');
 const subs=await checked('whatsapp_test_app_webhook_check_failed',()=>collect(g,`${CLOUD_TEST_APP}/subscriptions`,appToken,{}));
 const sub=subs.find(s=>s.object==='whatsapp_business_account'&&s.callback_url===c.callback&&s.active===true);
 if(!Array.isArray(sub?.fields)||!sub.fields.some((f:any)=>f==='messages'||f?.name==='messages'))
  throw new MetaError('whatsapp_test_app_webhook_missing');
 if(!await checked('whatsapp_test_waba_subscription_check_failed',()=>subscribedWhatsApp(g,c,token,CLOUD_TEST_WABA)))
  throw new MetaError('whatsapp_test_waba_subscription_missing');
 return {subject:d.user_id,expiresAt:new Date(Math.min(now+86400000,expiry,dataExpiry?dataExpiry*1000:Infinity)).toISOString()};
}

export async function subscribedWhatsApp(g:Graph,c:WhatsAppConfig,token:string,waba:string){
 const apps=await collect(g,`${waba}/subscribed_apps`,token,{});
 return apps.some(a=>a.whatsapp_business_api_data?.id===c.appId);
}
/** Intent persists before provider mutation. A timeout or lost checkpoint never replays a one-shot call. */
export async function finishWhatsAppOnboarding(g:Graph,c:WhatsAppConfig,token:string,waba:string,phone:string,
 step:(name:string,outcome?:string,receipt?:string)=>Promise<any>,guard:()=>Promise<void>,mode='coexistence'){
 await guard();
 if(await subscribedWhatsApp(g,c,token,waba)){
  const s=await step('subscription');if(s.state!=='verified'||mode==='new_number')await step('subscription','verified');
 }else{
  const s=await step('subscription');
  if(!s.perform){if(s.state==='verified')await step('subscription','uncertain');return {state:'action_required',reason:'subscription_outcome_uncertain'};}
  try{await guard();await g.request(`${waba}/subscribed_apps`,token,{},'POST');
   if(!await subscribedWhatsApp(g,c,token,waba))throw new MetaError('subscription_unconfirmed',true);
   await step('subscription','verified');
  }catch{await step('subscription','uncertain');return {state:'action_required',reason:'subscription_outcome_uncertain'};}
 }
 if(mode==='new_number')return {state:'action_required',reason:'awaiting_customer_inbound'};
 for(const name of ['contacts','history']){
  await guard();const s=await step(name);
  if(!s.perform){if(s.state!=='accepted')return {state:'action_required',reason:'sync_outcome_uncertain'};continue;}
  try{
   await guard();const r=await g.request(`${phone}/smb_app_data`,token,{messaging_product:'whatsapp',sync_type:name==='contacts'?'smb_app_state_sync':'history'},'POST');
   if(typeof r.request_id!=='string'||!/^[A-Za-z0-9._-]{1,300}$/.test(r.request_id))throw new MetaError('sync_unconfirmed',true);
   await step(name,'accepted',r.request_id);
  }catch{await step(name,'uncertain');return {state:'action_required',reason:'sync_outcome_uncertain'};}
 }
 return {state:'action_required',reason:'awaiting_sync'};
}

function normalizedWhatsAppPhone(value:unknown){
 if(typeof value!=='string'||!/^\+?[0-9 ()-]+$/.test(value))throw new MetaError('whatsapp_phone_identity_unverified');
 const digits=value.replace(/[^0-9]/g,'');if(!/^[1-9][0-9]{6,14}$/.test(digits))throw new MetaError('whatsapp_phone_identity_unverified');
 return `+${digits}`;
}
/** Resolve only the approved number; popup IDs never authorize a Brand binding. */
export async function resolveWhatsAppSignupAssets(g:Graph,token:string,session:any,assets:any){
 const mode=session.mode==='new_number'?'new_number':'coexistence';
 if(assets?.mode!==mode||!numeric(assets.waba_id)||(session.waba_id&&assets.waba_id!==session.waba_id)
 ||(assets.business_id&&assets.business_id!==session.customer_business_id)||(session.phone_id&&assets.phone_id&&assets.phone_id!==session.phone_id))throw new MetaError('whatsapp_signup_assets_mismatch');
 if(session.phone_id)return {waba_id:session.waba_id,phone_id:session.phone_id,customer_business_id:session.customer_business_id,approved_phone_hash:session.approved_phone_hash,mode};
 if(!/^[a-f0-9]{64}$/.test(session.approved_phone_hash||''))throw new MetaError('whatsapp_pilot_intent_required');
 let phone=assets.phone_id;
 if(phone!==undefined&&!numeric(phone))throw new MetaError('invalid_whatsapp_assets');
 if(!phone){
  const phones=await collect(g,`${assets.waba_id}/phone_numbers`,token,{fields:'id,display_phone_number'});const matches=[];
  for(const p of phones){if(numeric(p.id)&&await hash(normalizedWhatsAppPhone(p.display_phone_number))===session.approved_phone_hash)matches.push(p.id);}
  if(matches.length!==1)throw new MetaError('whatsapp_approved_phone_mismatch');phone=matches[0];
 }
 return {waba_id:assets.waba_id,phone_id:phone,customer_business_id:session.customer_business_id,approved_phone_hash:session.approved_phone_hash,mode};
}

/** Call only after verifying the connection credential and exact WABA. */
export function readWhatsAppTemplateRows(graph:Graph,token:string,waba:string){
 return collect(graph,`${waba}/message_templates`,token,{fields:'id,name,language,category,status,parameter_format,components'});
}
export async function readWhatsAppTestTemplates(graph:Graph,token:string){
 return presentWhatsAppTemplates(await readWhatsAppTemplateRows(graph,token,CLOUD_TEST_WABA));
}
export function presentWhatsAppTemplates(rows:any[]){
 return rows.filter(row=>numeric(row?.id)&&typeof row.name==='string'&&/^[a-z0-9_]{1,512}$/.test(row.name)
  &&typeof row.language==='string'&&/^[a-z]{2,3}(?:_[A-Za-z]{2,8}){0,2}$/.test(row.language))
 .map(row=>{
  const components=(Array.isArray(row.components)?row.components:[]).slice(0,12).map((component:any)=>({
   type:typeof component?.type==='string'?component.type.slice(0,40):'UNKNOWN',
   format:typeof component?.format==='string'?component.format.slice(0,40):null,
   text:typeof component?.text==='string'?component.text.slice(0,2048):null,
   buttons:(Array.isArray(component?.buttons)?component.buttons:[]).slice(0,10).map((button:any)=>({
    type:typeof button?.type==='string'?button.type.slice(0,40):'UNKNOWN',
    text:typeof button?.text==='string'?button.text.slice(0,80):null,
    needsValue:button?.type==='QUICK_REPLY'||(button?.type==='URL'&&typeof button.url==='string'&&button.url.includes('{{')),
   })),
  }));
  return {id:row.id,name:row.name,language:row.language,category:String(row.category??'UNKNOWN').slice(0,40),
   status:String(row.status??'UNKNOWN').slice(0,40),parameterFormat:row.parameter_format==='NAMED'?'named':'positional',components};
 });
}
