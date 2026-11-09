import {describe,it,expect,vi} from 'vitest';
import {hash} from "../../../../supabase/functions/_shared/metaSecurity.ts";
import {verifyWhatsAppAssets,exchangeWhatsAppCode,finishWhatsAppOnboarding,WHATSAPP_FIELDS} from '../../../../supabase/functions/_shared/whatsappOnboarding.ts';
import {whatsappLifecycle} from '../../../../supabase/functions/_shared/whatsappLifecycle.ts';
const c={appId:'100',appSecret:'fixture-secret',configId:'101',version:'v25.0',signupVersion:'v4',enabled:true,callback:'https://example.invalid/webhook'};
const expected={waba_id:'200',phone_id:'201',customer_business_id:'202'};
function graph(overrides:Record<string,any>={}){
 const responses:any={debug_token:{data:{is_valid:true,app_id:'100',user_id:'999',type:'SYSTEM_USER',scopes:['whatsapp_business_management','whatsapp_business_messaging'],granular_scopes:[{scope:'whatsapp_business_management',target_ids:['200']}],expires_at:0,data_access_expires_at:0}},'200':{id:'200',owner_business_info:{id:'202'}},'200/phone_numbers':{data:[{id:'201'}]},'201':{id:'201',is_on_biz_app:true,platform_type:'CLOUD_API'},'100/subscriptions':{data:[{object:'whatsapp_business_account',callback_url:c.callback,active:true,fields:WHATSAPP_FIELDS.map(name=>({name}))}]},...overrides};
 return {request:vi.fn(async(path:string)=>{if(!(path in responses))throw new Error('Unexpected provider call');return structuredClone(responses[path])})};
}
describe('official WhatsApp server-side contracts',()=>{
 it('exchanges a code once without extending a Facebook user token',async()=>{const g=graph({'oauth/access_token':{access_token:'fixture'}});expect(await exchangeWhatsAppCode(g,c,'code')).toBe('fixture');expect(g.request).toHaveBeenCalledTimes(1);expect(g.request.mock.calls[0][0]).toBe('oauth/access_token');});
 it('verifies app, granular WABA grant, business ownership, exact phone and coexistence',async()=>{const r=await verifyWhatsAppAssets(graph(),c,'fixture',expected,1700000000000);expect(r.expires_at).toBe(new Date(1700086400000).toISOString());expect(r.subject).toBe('999');});
 it.each([
 ['wrong app',{debug_token:{data:{is_valid:true,app_id:'666'}}}],
 ['wrong business',{'200':{id:'200',owner_business_info:{id:'666'}}}],
 ['wrong phone',{'200/phone_numbers':{data:[{id:'666'}]}}],
 ['mobile disconnected',{'201':{id:'201',is_on_biz_app:false,platform_type:'CLOUD_API'}}],
 ['wrong callback',{'100/subscriptions':{data:[{object:'whatsapp_business_account',active:true,callback_url:'https://elsewhere.invalid',fields:WHATSAPP_FIELDS}]}}],
 ['incomplete pagination',{'200/phone_numbers':{data:[{id:'201'}],paging:{next:'https://untrusted.invalid'}}}],
 ])('fails closed on %s',async(_,override)=>{await expect(verifyWhatsAppAssets(graph(override),c,'fixture',expected)).rejects.toThrow();});
 it('requires exact permissions and target grants',async()=>{const g=graph();const r=await g.request('debug_token');r.data.granular_scopes[0].target_ids=['666'];g.request.mockImplementation(async(p:string)=>p==='debug_token'?r:({}));await expect(verifyWhatsAppAssets(g,c,'fixture',expected)).rejects.toThrow('whatsapp_waba_grant_required');});
 it('does not follow arbitrary pagination URLs',async()=>{const g=graph({'200/phone_numbers':{data:[{id:'201'}],paging:{next:'https://untrusted.invalid',cursors:{after:'same'}}}});await expect(verifyWhatsAppAssets(g,c,'fixture',expected)).rejects.toThrow('whatsapp_assets_incomplete');expect(g.request.mock.calls.every(x=>!x[0].startsWith('https'))).toBe(true);});
});
function steps(){const states:Record<string,string>={subscription:'pending',contacts:'pending',history:'pending'};return {states,step:vi.fn(async(name:string,outcome?:string)=>{if(outcome){states[name]=outcome;return {state:outcome}}const before=states[name];if(before==='pending')states[name]='claimed';return {perform:before==='pending',state:states[name]}})};}
it('persists intent before subscription and each once-only sync request',async()=>{
 const s=steps();let subscribed=false;const calls:string[]=[];
 const g={request:vi.fn(async(path:string,_token:string,params:any,method?:string)=>{calls.push(`${path}:${method||'GET'}`);if(path==='200/subscribed_apps'){if(method==='POST'){expect(s.states.subscription).toBe('claimed');subscribed=true;return {success:true}}return {data:subscribed?[{whatsapp_business_api_data:{id:'100'}}]:[]}}expect(s.states[params.sync_type==='history'?'history':'contacts']).toBe('claimed');return {request_id:'fixture'}})};
 await finishWhatsAppOnboarding(g,c,'fixture','200','201',s.step,async()=>{});
 expect(s.states).toEqual({subscription:'verified',contacts:'accepted',history:'accepted'});
 await finishWhatsAppOnboarding(g,c,'fixture','200','201',s.step,async()=>{});
 expect(calls.filter(x=>x.endsWith(':POST'))).toHaveLength(3);
 expect(calls.some(x=>/register|deregister|messages|templates/.test(x))).toBe(false);
});
it('an uncertain one-shot sync is never replayed, including a retry',async()=>{
 const s=steps();s.states.subscription='verified';const g={request:vi.fn(async(p:string)=>{if(p==='200/subscribed_apps')return {data:[{whatsapp_business_api_data:{id:'100'}}]};throw new Error('timeout')})};
 expect((await finishWhatsAppOnboarding(g,c,'fixture','200','201',s.step,async()=>{})).reason).toBe('sync_outcome_uncertain');
 await finishWhatsAppOnboarding(g,c,'fixture','200','201',s.step,async()=>{});
 expect(g.request.mock.calls.filter(x=>x[0]==='201/smb_app_data')).toHaveLength(1);
});
it('stale generation guard stops all provider mutations',async()=>{const g=graph();await expect(finishWhatsAppOnboarding(g,c,'fixture','200','201',steps().step,async()=>{throw new Error('stale')})).rejects.toThrow('stale');expect(g.request).not.toHaveBeenCalled();});
it('quarantines sync data encrypted and exposes only progress, no contact text',async()=>{
 const key=btoa('x'.repeat(32));const payload={object:'whatsapp_business_account',entry:[{id:'200',changes:[{field:'history',value:{metadata:{phone_number_id:'201'},history:[{metadata:{progress:100},threads:[{id:'private-peer',messages:[{text:{body:'private text'}}]}]}]}}]}]};
 const r=await whatsappLifecycle(payload,key);expect(r[0].progress).toBe(100);expect(r[0].sealed_payload.version).toBe(1);expect(JSON.stringify(r)).not.toContain('private');
});

it('never exchanges or mutates provider state while server pilot activation is disabled',async()=>{
 const {whatsappSignupHandler}=await import('../../../../supabase/functions/_shared/whatsappSignupHandler.ts');
 const caller={rpc:vi.fn(async()=>({data:{eligible:true,can_configure:true,state:'eligible'}}))};const service={rpc:vi.fn()};
 const values:Record<string,string>={MARKETING_META_APP_ID:'100',MARKETING_META_APP_SECRET:'fixture',MARKETING_META_GRAPH_VERSION:'v25.0',MARKETING_WHATSAPP_SIGNUP_CONFIG_ID:'101',MARKETING_WHATSAPP_SIGNUP_VERSION:'v4',MARKETING_META_TOKEN_ENCRYPTION_KEY:btoa('x'.repeat(32))};
 const env=(n:string)=>values[n]||'';
 expect(await whatsappSignupHandler('/whatsapp/readiness',{organizationId:'org',brandId:'brand'},caller,service,'user',env)).toMatchObject({eligible:false,state:'verification_required',reason:'pilot_activation_required'});
 await expect(whatsappSignupHandler('/whatsapp/begin',{organizationId:'org',brandId:'brand'},caller,service,'user',env)).rejects.toThrow('whatsapp_verification_required');expect(service.rpc).not.toHaveBeenCalled();expect(caller.rpc.mock.calls.every(x=>x[0]==='marketing_whatsapp_readiness')).toBe(true);
});

it('resolves a v4 WABA-only finish to the exact pre-approved phone, then verifies provider assets',async()=>{
 const {resolveWhatsAppSignupAssets}=await import('../../../../supabase/functions/_shared/whatsappOnboarding.ts');
 const {hash}=await import('../../../../supabase/functions/_shared/metaSecurity.ts');const phoneHash=await hash('+60119900000');
 const session={waba_id:null,phone_id:null,customer_business_id:'202',approved_phone_hash:phoneHash};
 const g=graph({'200/phone_numbers':{data:[{id:'201',display_phone_number:'+60 11-9900 000'}]},'201':{id:'201',is_on_biz_app:true,platform_type:'CLOUD_API',display_phone_number:'+60119900000'}});
 const expected=await resolveWhatsAppSignupAssets(g,'fixture',session,{mode:'coexistence',waba_id:'200'});
 expect(expected.phone_id).toBe('201');expect((await verifyWhatsAppAssets(g,c,'fixture',expected)).approved_phone_hash).toBe(phoneHash);
 const wrong=graph({'201':{id:'201',is_on_biz_app:true,platform_type:'CLOUD_API',display_phone_number:'+60118800000'}});
 await expect(verifyWhatsAppAssets(wrong,c,'fixture',expected)).rejects.toThrow('whatsapp_approved_phone_mismatch');
});
it('rejects ambiguous staged phone discovery and an unapproved business',async()=>{
 const {resolveWhatsAppSignupAssets}=await import('../../../../supabase/functions/_shared/whatsappOnboarding.ts');const {hash}=await import('../../../../supabase/functions/_shared/metaSecurity.ts');
 const session={waba_id:null,phone_id:null,customer_business_id:'202',approved_phone_hash:await hash('+60119900000')};
 const g=graph({'200/phone_numbers':{data:[{id:'201',display_phone_number:'+60119900000'},{id:'202',display_phone_number:'+60119900000'}]}});
 await expect(resolveWhatsAppSignupAssets(g,'fixture',session,{mode:'coexistence',waba_id:'200'})).rejects.toThrow('whatsapp_approved_phone_mismatch');
 await expect(resolveWhatsAppSignupAssets(g,'fixture',session,{mode:'coexistence',waba_id:'200',business_id:'666'})).rejects.toThrow('whatsapp_signup_assets_mismatch');
});

it('isolates malformed lifecycle changes and retains encrypted valid history; encryption failures still fail closed',async()=>{
 const key=btoa('x'.repeat(32));const reject=vi.fn();const value={metadata:{phone_number_id:'201'},history:[{metadata:{progress:100},threads:[]}]};
 const payload={object:'whatsapp_business_account',entry:[{id:'200',changes:[{field:'history',value:{...value,history:[null]}},{field:'smb_app_state_sync',value:null},{field:'history',value}]}]};
 const events=await whatsappLifecycle(payload,key,Date.now(),reject);expect(events).toHaveLength(1);expect(events[0].progress).toBe(100);expect(reject).toHaveBeenCalledTimes(2);
 await expect(whatsappLifecycle(payload,'missing-key')).rejects.toThrow();
});

describe('Staging Cloud API test number verification',()=>{
 const config={...c,appId:'2204918033458414'};
 const waba='1675083730240518',phone='1221509657713215',now=1700000000000;
 const debug={is_valid:true,app_id:config.appId,user_id:'999',type:'USER',scopes:['whatsapp_business_management','whatsapp_business_messaging'],expires_at:1700003600};
 const subscription={object:'whatsapp_business_account',callback_url:config.callback,active:true,fields:[{name:'messages'}]};
 const fixture=(overrides={})=>graph({
  debug_token:{data:debug},[waba]:{id:waba},[`${waba}/phone_numbers`]:{data:[{id:phone}]},
  [phone]:{id:phone,platform_type:'CLOUD_API'},[`${config.appId}/subscriptions`]:{data:[subscription]},
  [`${waba}/subscribed_apps`]:{data:[{whatsapp_business_api_data:{id:config.appId}}]},...overrides
 });
 it('verifies a temporary dashboard token and uses read-only Graph calls',async()=>{
  const {verifyWhatsAppCloudTest}=await import('../../../../supabase/functions/_shared/whatsappOnboarding.ts');
  const g=fixture();
  await expect(verifyWhatsAppCloudTest(g,config,'fixture',now)).resolves.toEqual({subject:'999',expiresAt:new Date(debug.expires_at*1000).toISOString()});
  expect(g.request).toHaveBeenCalledTimes(6);
  expect(g.request.mock.calls.every(args=>args.length<=3)).toBe(true);
 });
 it('accepts omitted messaging targets only with an exact management grant and verified assets',async()=>{
  const {verifyWhatsAppCloudTest}=await import('../../../../supabase/functions/_shared/whatsappOnboarding.ts');
  const messaging={scope:'whatsapp_business_messaging'};
  const management={scope:'whatsapp_business_management',target_ids:[waba]};
  const token=(granular_scopes:Array<{scope:string;target_ids?:string[]}>)=>({debug_token:{data:{...debug,granular_scopes}}});
  const grants=token([management,messaging]);
  await expect(verifyWhatsAppCloudTest(fixture(grants),config,'fixture',now)).resolves.toMatchObject({subject:'999'});
  await expect(verifyWhatsAppCloudTest(fixture(token([messaging])),config,'fixture',now)).rejects.toThrow('whatsapp_waba_grant_required');

  const systemUser=(target_ids?:string[])=>({debug_token:{data:{...debug,type:'SYSTEM_USER',user_id:'122103065595539221',
   granular_scopes:[{scope:'whatsapp_business_management',target_ids},messaging]}}});
  await expect(verifyWhatsAppCloudTest(fixture(systemUser()),config,'fixture',now)).resolves.toMatchObject({subject:'122103065595539221'});
  await expect(verifyWhatsAppCloudTest(fixture(systemUser(['666'])),config,'fixture',now)).rejects.toThrow('whatsapp_waba_grant_required');
  await expect(verifyWhatsAppCloudTest(fixture({...systemUser(),[waba]:{id:'666'}}),config,'fixture',now)).rejects.toThrow('whatsapp_phone_waba_mismatch');

  await expect(verifyWhatsAppCloudTest(fixture(token([management,{...messaging,target_ids:['666']}])),config,'fixture',now)).rejects.toThrow('whatsapp_waba_grant_required');
  await expect(verifyWhatsAppCloudTest(fixture({...grants,[`${waba}/phone_numbers`]:{data:[]}}),config,'fixture',now)).rejects.toThrow('whatsapp_phone_waba_mismatch');
  await expect(verifyWhatsAppCloudTest(fixture({...grants,[`${waba}/subscribed_apps`]:{data:[]}}),config,'fixture',now)).rejects.toThrow('whatsapp_test_waba_subscription_missing');
 });
 it.each([
  ['wrong app',{debug_token:{data:{...debug,app_id:'100'}}}],
  ['expired token',{debug_token:{data:{...debug,expires_at:1700000000}}}],
  ['unscoped token',{debug_token:{data:{...debug,scopes:[]}}}],
  ['wrong WABA grant',{debug_token:{data:{...debug,granular_scopes:[{scope:'whatsapp_business_management',target_ids:['666']}]}}}],
  ['wrong phone',{[`${waba}/phone_numbers`]:{data:[{id:'666'}]}}],
  ['wrong callback',{[`${config.appId}/subscriptions`]:{data:[{...subscription,callback_url:'https://wrong.invalid'}]}}],
  ['missing messages field',{[`${config.appId}/subscriptions`]:{data:[{...subscription,fields:[]}]}}],
  ['unsubscribed WABA',{[`${waba}/subscribed_apps`]:{data:[]}}],
 ])('rejects %s',async(_,overrides)=>{
  const {verifyWhatsAppCloudTest}=await import('../../../../supabase/functions/_shared/whatsappOnboarding.ts');
  await expect(verifyWhatsAppCloudTest(fixture(overrides),config,'fixture',now)).rejects.toThrow();
 });
});

it('reads template previews from the exact test WABA without retaining example or destination data', async()=>{
 const {readWhatsAppTestTemplates}=await import('../../../../supabase/functions/_shared/whatsappOnboarding.ts');
 const request=vi.fn().mockResolvedValue({data:[{
  id:'103',name:'booking_notice',language:'en_US',category:'UTILITY',status:'APPROVED',parameter_format:'NAMED',
  components:[{type:'HEADER',format:'IMAGE',example:{header_handle:['private media example']}},
   {type:'BODY',text:'Hi {{name}}',example:{body_text:[['private example']]}},
   {type:'BUTTONS',buttons:[{type:'URL',text:'View booking',url:'https://private.example'}]}],
 }]});
 const rows=await readWhatsAppTestTemplates({request},'fixture');
 expect(request.mock.calls[0][0]).toBe('1675083730240518/message_templates');
 expect(request.mock.calls[0][3]).toBeUndefined();
 expect(rows[0]).toMatchObject({name:'booking_notice',language:'en_US',category:'UTILITY',status:'APPROVED',parameterFormat:'named'});
 expect(rows[0].components[2].buttons).toEqual([{type:'URL',text:'View booking',needsValue:false}]);
 expect(JSON.stringify(rows)).not.toContain('private');
});

it('verifies the exact approved new number before and after owner registration',async()=>{
 const approved_phone_hash=await hash('+60123456789');
 const intent={...expected,approved_phone_hash,mode:'new_number' as const};
 const phone={id:'201',is_on_biz_app:false,code_verification_status:'VERIFIED',display_phone_number:'+60 12 345 6789'};
 const get=(fields:object)=>graph({'201':{...phone,...fields}});
 expect(await verifyWhatsAppAssets(get({platform_type:'NOT_APPLICABLE',status:'PENDING'}),c,'fixture',intent)).toMatchObject({registration_verified:false});
 expect(await verifyWhatsAppAssets(get({platform_type:'CLOUD_API',status:'CONNECTED'}),c,'fixture',intent)).toMatchObject({registration_verified:true});
 await expect(verifyWhatsAppAssets(get({platform_type:'CLOUD_API',status:'CONNECTED',display_phone_number:'+60123456780'}),c,'fixture',intent)).rejects.toThrow('whatsapp_approved_phone_mismatch');
 await expect(verifyWhatsAppAssets(get({platform_type:'CLOUD_API',status:'CONNECTED',is_on_biz_app:true}),c,'fixture',intent)).rejects.toThrow('whatsapp_cloud_identity_unverified');
});
it('stops after subscription for a registered new Cloud API number',async()=>{
 const g=graph({'200/subscribed_apps':{data:[{whatsapp_business_api_data:{id:'100'}}]}});
 const s=steps();
 expect(await finishWhatsAppOnboarding(g,c,'fixture','200','201',s.step,async()=>{},'new_number')).toMatchObject({reason:'awaiting_customer_inbound'});
 expect(s.states).toEqual({subscription:'verified',contacts:'pending',history:'pending'});
 expect(g.request).toHaveBeenCalledTimes(1);
});
