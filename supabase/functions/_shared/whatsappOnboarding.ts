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
async function collect(g:Graph,path:string,token:string,params:Record<string,unknown>){
 const rows:any[]=[];let after:string|undefined;const seen=new Set<string>();
 for(let page=0;page<10;page++){
  const r=await g.request(path,token,{...params,limit:100,...(after?{after}:{})});
  if(!Array.isArray(r.data)||r.data.length>100)throw new MetaError('whatsapp_assets_unverified');rows.push(...r.data);
  if(!r.paging?.next)return rows;
  after=r.paging?.cursors?.after;if(typeof after!=='string'||after.length>2000||seen.has(after))throw new MetaError('whatsapp_assets_incomplete');seen.add(after);
 }
 throw new MetaError('whatsapp_assets_incomplete');
}
export async function verifyWhatsAppAssets(g:Graph,c:WhatsAppConfig,token:string,expected:{waba_id:string;phone_id:string;customer_business_id:string},now=Date.now()){
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
 const p=await g.request(expected.phone_id,token,{fields:'id,is_on_biz_app,platform_type'});
 if(p.id!==expected.phone_id||p.is_on_biz_app!==true||p.platform_type!=='CLOUD_API')throw new MetaError('coexistence_unsupported');
 // App configuration is inspected, never changed by onboarding.
 const subs=await collect(g,`${c.appId}/subscriptions`,`${c.appId}|${c.appSecret}`,{});
 const sub=subs.find(s=>s.object==='whatsapp_business_account'&&s.callback_url===c.callback&&s.active===true);
 const fields=sub?.fields?.map((f:any)=>typeof f==='string'?f:f.name)||[];
 if(!WHATSAPP_FIELDS.every(f=>fields.includes(f)))throw new MetaError('whatsapp_app_webhooks_required');
 return {app_id:c.appId,waba_id:expected.waba_id,phone_id:expected.phone_id,business_id:expected.customer_business_id,subject:d.user_id,
 scopes:WHATSAPP_SCOPES,expires_at:expiry,is_on_biz_app:true,platform_type:'CLOUD_API'};
}
export async function subscribedWhatsApp(g:Graph,c:WhatsAppConfig,token:string,waba:string){
 const apps=await collect(g,`${waba}/subscribed_apps`,token,{});
 return apps.some(a=>a.whatsapp_business_api_data?.id===c.appId);
}
/** Intent persists before provider mutation. A timeout or lost checkpoint never replays a one-shot call. */
export async function finishWhatsAppOnboarding(g:Graph,c:WhatsAppConfig,token:string,waba:string,phone:string,
 step:(name:string,outcome?:string,receipt?:string)=>Promise<any>,guard:()=>Promise<void>){
 await guard();
 if(await subscribedWhatsApp(g,c,token,waba)){
  const s=await step('subscription');if(s.state!=='verified')await step('subscription','verified');
 }else{
  const s=await step('subscription');
  if(!s.perform){if(s.state==='verified')await step('subscription','uncertain');return {state:'action_required',reason:'subscription_outcome_uncertain'};}
  try{await guard();await g.request(`${waba}/subscribed_apps`,token,{},'POST');
   if(!await subscribedWhatsApp(g,c,token,waba))throw new MetaError('subscription_unconfirmed',true);
   await step('subscription','verified');
  }catch{await step('subscription','uncertain');return {state:'action_required',reason:'subscription_outcome_uncertain'};}
 }
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
