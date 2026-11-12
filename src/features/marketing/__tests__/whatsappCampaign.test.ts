import {expect,it,vi} from 'vitest';
import {runWhatsAppCampaign} from '../../../../supabase/functions/_shared/whatsappCampaign.ts';
import {whatsappTemplateIntent} from '../../../../supabase/functions/_shared/whatsappTemplateIntent.ts';
import {normalizeWhatsAppWebhook} from '../../../../supabase/functions/_shared/whatsappInbox.ts';
import {STAGING_SUPABASE} from '../../../../supabase/functions/_shared/metaSecurity.ts';

const app='2204918033458414',waba='1675083730240518',phone='1221509657713215',peer='60123456789';
const delivery='c3864149-d3ba-41af-9ac4-d5533b73c22b',provider='wamid.campaign_fixture';
const data:Record<string,string>={SUPABASE_URL:STAGING_SUPABASE,MARKETING_META_APP_ID:app};
const run='db4c84ca-8ca2-4b37-a551-0be843fa48ec';
const env=(key:string)=>data[key]||'';
function graph(){
 return {version:'v25.0',request:vi.fn(async(path:string,_token:string,_params?:unknown,method?:string)=>{
  if(method==='POST')return {messaging_product:'whatsapp',contacts:[{wa_id:peer}],messages:[{id:provider}]};
  if(path==='debug_token')return {data:{is_valid:true,app_id:app,user_id:'111',type:'USER',expires_at:Math.floor(Date.now()/1000)+600,
   scopes:['whatsapp_business_management','whatsapp_business_messaging']}};
  if(path===waba)return {id:waba};
  if(path===phone)return {id:phone,platform_type:'CLOUD_API'};
  if(path===waba+'/phone_numbers')return {data:[{id:phone}]};
  if(path===app+'/subscriptions')return {data:[{active:true,object:'whatsapp_business_account',
   callback_url:STAGING_SUPABASE+'/functions/v1/marketing-inbox/webhook',fields:[{name:'messages'}]}]};
  if(path===waba+'/subscribed_apps')return {data:[{whatsapp_business_api_data:{id:app}}]};
  if(path===waba+'/message_templates')return {data:[{id:'111',name:'booking',language:'en_US',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Booking notice'}]}]};
  throw new Error('unexpected_fixture_request');
 })};
}
const tokenFor=async()=> 'fixture';
async function fixture(preview?:unknown){
 const g=graph();
 const choice={id:'111',language:'en_US'};
 const intent=await whatsappTemplateIntent(g,'fixture',choice,phone,'campaign');
 g.request.mockClear();
 let state='scheduled',leased=false;
 const call=vi.fn(async(_name:string,args:any)=>{
  if(args.p_operation==='claim'){
   if(leased||state!=='scheduled')return null;
   leased=true;
   return {id:delivery,run_id:run,lease:'fixture',connection_id:'fixture',generation:2,peer,template:{...choice,providerFingerprint:intent.providerFingerprint,...(preview===undefined?{}:{preview})}};
  }
  if(args.p_operation==='begin')state='sending';
  if(['accepted','failed','unknown'].includes(args.p_operation))state=args.p_operation;
  return {recorded:true};
 });
 return {g,call,state:()=>state};
}
it.each(['SUPABASE_URL','MARKETING_META_APP_ID'])('does not claim or call Meta with a different %s',async(key)=>{
 const {g,call}=await fixture();
 expect(await runWhatsAppCampaign(call,g,name=>name===key?'different':env(name),tokenFor)).toBe(false);
 expect(call).not.toHaveBeenCalled();
 expect(g.request).not.toHaveBeenCalled();
});
it('does not call Meta when the server finds no eligible campaign delivery',async()=>{
 const g=graph();
 const call=vi.fn().mockResolvedValue(null);
 expect(await runWhatsAppCampaign(call,g,env,tokenFor)).toBe(false);
 expect(call).toHaveBeenCalledExactlyOnceWith('marketing_campaign_whatsapp_worker',{p_run:null,p_operation:'claim'});
 expect(g.request).not.toHaveBeenCalled();
});
it('does not send when the server rejects the leased delivery at the final guard',async()=>{
 const {g,call}=await fixture();
 const original=call.getMockImplementation()!;
 let guards=0;
 call.mockImplementation((name,args)=>args.p_operation==='guard'&&++guards===2?Promise.resolve(null):original(name,args));
 expect(await runWhatsAppCampaign(call,g,env,tokenFor)).toBe(true);
 expect(g.request.mock.calls.filter(args=>args[3]==='POST')).toHaveLength(0);
 expect(call.mock.calls.every(([,args])=>args.p_operation==='claim'||args.p_run===run)).toBe(true);
});
it('rejects a saved preview that no longer matches the approved template',async()=>{
 const {g,call,state}=await fixture([{type:'BODY',text:'Changed copy'}]);
 expect(await runWhatsAppCampaign(call,g,env,tokenFor)).toBe(true);
 expect(state()).toBe('failed');
 expect(g.request.mock.calls.filter(args=>args[3]==='POST')).toHaveLength(0);
});
it('persists one accepted outcome across concurrent ticks and a restart',async()=>{
 const {g,call,state}=await fixture();
 expect(await Promise.all([runWhatsAppCampaign(call,g,env,tokenFor),runWhatsAppCampaign(call,g,env,tokenFor)])).toEqual([true,false]);
 expect(await runWhatsAppCampaign(call,g,env,tokenFor)).toBe(false);
 expect(state()).toBe('accepted');
 expect(g.request.mock.calls.filter(args=>args[3]==='POST')).toEqual([[phone+'/messages','fixture',
  expect.objectContaining({to:peer,type:'template',biz_opaque_callback_data:delivery}),'POST']]);
 expect(call.mock.calls.some(([,args])=>args.p_operation==='accepted'&&args.p_receipt===provider)).toBe(true);
});
it('retains a transport timeout as unknown and never retries the POST',async()=>{
 const {g,call,state}=await fixture();
 const read=g.request.getMockImplementation()!;
 g.request.mockImplementation((...args)=>args[3]==='POST'?Promise.reject(new Error('timeout')):read(...args));
 expect(await runWhatsAppCampaign(call,g,env,tokenFor)).toBe(true);
 expect(state()).toBe('unknown');
 expect(await runWhatsAppCampaign(call,g,env,tokenFor)).toBe(false);
 expect(g.request.mock.calls.filter(args=>args[3]==='POST')).toHaveLength(1);
});
it('retains only signed-payload context identifiers for attribution and receipt matching',()=>{
 const value={messaging_product:'whatsapp',metadata:{phone_number_id:phone},
  messages:[{from:peer,id:'wamid.reply',timestamp:'1700000000',type:'text',text:{body:'Hello'},context:{id:provider}},
   {from:peer,id:'wamid.ambiguous',timestamp:'1700000000',type:'text',text:{body:'Hello'}}],
  statuses:[{id:provider,recipient_id:peer,timestamp:'1700000000',status:'delivered',biz_opaque_callback_data:delivery}]};
 const events=normalizeWhatsAppWebhook({object:'whatsapp_business_account',entry:[{id:waba,changes:[{field:'messages',value}]}]});
 expect(events[0].reply_to_message_id).toBe(provider);
 expect(events[1].reply_to_message_id).toBeUndefined();
 expect(events[2].campaign_callback_id).toBe(delivery);
});
