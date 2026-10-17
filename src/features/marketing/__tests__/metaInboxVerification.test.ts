import {describe,it,expect,vi} from 'vitest';
import { RUNTIME_SUPABASE } from '../../../../supabase/functions/_shared/metaSecurity.ts';
import {verifyInboxConnection} from '../../../../supabase/functions/_shared/metaInboxVerification.ts';
import {MetaError} from '../../../../supabase/functions/_shared/metaGraph.ts';
const permissions=['pages_messaging','pages_manage_metadata','instagram_basic','instagram_manage_messages'];
const connection={channel:'facebook',provider_account_id:'111',meta_user_id:'333',credential_generation:5,capabilities:{page_task_source:'accounts',page_tasks_verified:true,page_tasks:['MESSAGING']}};
function graph(overrides:any={}) {
 return {request:vi.fn(async(path:string,_token:string,_params:any,_method:string,inspect:any)=>{
  const value=overrides[path]??({'444/subscriptions':{data:['page','instagram'].map(object=>({object,active:true,callback_url:`${RUNTIME_SUPABASE}/functions/v1/marketing-inbox/webhook`,fields:(object==='page'?['messages','messaging_postbacks','message_deliveries','message_reads','message_echoes']:['messages','messaging_postbacks','messaging_seen']).map(name=>({name}))}))},'debug_token':{data:{is_valid:true,type:'PAGE',app_id:'444',profile_id:'111',user_id:'333',expires_at:0,data_access_expires_at:0,scopes:permissions,granular_scopes:[{scope:'business_management',target_ids:['555']}]}},'me':{id:'111'},'111':{id:'111',business:{id:'555'},instagram_business_account:{id:'666'}},'111/subscribed_apps':{data:[{id:'444',subscribed_fields:['messages','messaging_postbacks','message_deliveries','message_reads','message_echoes']}]},'111/conversations':{data:[{participants:{data:[{id:'777'}]},messages:{data:[{id:'actual-mid'}]}}]}} as any)[path];
  if(value instanceof Error){inspect?.(400,190,{graph_error_subcode:463});throw value;}
  inspect?.(200,null,{});return value;
 })};
}
const verify=(g:any,c:any=connection,inbound:any[]=[])=>verifyInboxConnection(g,'444','test-app-token',c,{token:'test-page-token'},async()=>{},inbound);
describe('independent messaging capability verification',()=>{
 it('verifies the exact app callback without returning callback secrets or unrelated subscriptions',async()=>{
  const result=await verify(graph({'444/subscriptions':{data:[{object:'page',active:true,callback_url:`${RUNTIME_SUPABASE}/functions/v1/marketing-inbox/webhook`,verify_token:'never-return-this',fields:[{name:'messages'},{name:'leadgen'}]}]}}));
  expect(result.app_webhook).toEqual({object:'page',registered:true,active:true,callback_matches:true,fields:['messages']});
  expect(JSON.stringify(result)).not.toContain('never-return-this');
  expect((await verify(graph({'444/subscriptions':{data:[{object:'page',active:true,callback_url:'https://wrong.invalid',fields:[]}]}}))).app_webhook.callback_matches).toBe(false);
 });
 it('requires explicit messaging tasks and real inbound matches, never read or posting success',async()=>{
  const result=await verify(graph());expect(result.authorization_verified).toBe(true);expect(result.granted_permissions).toEqual(['pages_messaging','pages_manage_metadata']);expect(result.real_inbound_verified).toBe(false);
  const posting=await verify(graph(),{...connection,capabilities:{...connection.capabilities,page_tasks:['MANAGE','CREATE_CONTENT']}});expect(posting.authorization_verified).toBe(false);
 });
 it('separates echo configuration from incoming delivery and rejects ambiguous installation evidence',async()=>{const old={id:'444',subscribed_fields:['messages','messaging_postbacks','message_deliveries','message_reads']};const result=await verify(graph({'111/subscribed_apps':{data:[old]}}));expect(result.authorization_verified).toBe(true);expect(result.subscriptions_verified).toBe(true);expect(result.echo_subscriptions_verified).toBe(false);expect(result.echo_subscription_status).toEqual({app:true,page:false});for(const response of [{data:[{...old,subscribed_fields:[...old.subscribed_fields,'message_echoes']}],paging:{next:'more'}},{data:[old,old]}])expect((await verify(graph({'111/subscribed_apps':response}))).echo_subscription_status.page).toBe(false);});
 it('keeps Instagram identity and scopes independent',async()=>{
  const c={...connection,channel:'instagram',provider_account_id:'666'};
  expect((await verify(graph(),c)).authorization_verified).toBe(true);
  expect((await verify(graph({'111':{id:'111',instagram_business_account:{id:'999'}}}),c)).authorization_verified).toBe(false);
 });
 it('checks Instagram seen on the app object and read receipts on its linked Page',async()=>{
  const c={...connection,channel:'instagram',provider_account_id:'666'};
  expect((await verify(graph(),c)).subscriptions_verified).toBe(true);
  const incompleteApp={data:[{object:'instagram',active:true,callback_url:`${RUNTIME_SUPABASE}/functions/v1/marketing-inbox/webhook`,fields:[{name:'messages'},{name:'messaging_postbacks'}]}]};
  const noSeen=await verify(graph({'444/subscriptions':incompleteApp}),c);
  expect(noSeen.subscriptions_verified).toBe(false);expect(noSeen.missing_subscriptions).toContain('messaging_seen');
  const noReads=await verify(graph({'111/subscribed_apps':{data:[{id:'444',subscribed_fields:['messages','messaging_postbacks']}]}}),c);
  expect(noReads.subscriptions_verified).toBe(false);expect(noReads.missing_subscriptions).toContain('message_reads');
 });
 it('never lets a Page subscription substitute for missing, inactive or wrong app callback',async()=>{
  for(const row of [null,{object:'page',active:false},{object:'page',active:true,callback_url:'https://wrong.invalid'}]){
   const result=await verify(graph({'444/subscriptions':{data:row?[{...row,fields:['messages','messaging_postbacks','message_deliveries','message_reads','message_echoes'].map(name=>({name}))}]:[]}}));
   expect(result.authorization_verified).toBe(true);expect(result.subscriptions_verified).toBe(false);
   expect(result.missing_subscriptions).toContain('app_callback');
  }
 });
 it('rejects wrong authorizer, expired token and wrong scope targets',async()=>{
  for(const extra of [{user_id:'999'},{expires_at:1},{granular_scopes:[{scope:'pages_messaging',target_ids:['999']}]},{scopes:['pages_manage_metadata']}]){
   const defaults=await graph().request('debug_token','','','',null);
   expect((await verify(graph({'debug_token':{data:{...defaults.data,...extra}}}))).authorization_verified).toBe(false);
  }
 });
 it('marks webhook evidence only when provider history matches the signed event',async()=>{
  const real={channel:'facebook',account_id:'111',peer_id:'777',event_id:'actual-mid'};
  expect((await verify(graph(),connection,[real])).verified_inbound_ids).toEqual(['actual-mid']);
  expect((await verify(graph(),connection,[{...real,event_id:'dashboard-test'}])).real_inbound_verified).toBe(false);
 });
 it('requires exact app subscriptions and sanitized error evidence',async()=>{
  const result=await verify(graph({'111/subscribed_apps':new MetaError('meta_permission_or_token_invalid')}));
  expect(result.subscriptions_verified).toBe(false);expect(result.evidence.find((e:any)=>e.endpoint==='111/subscribed_apps')).toMatchObject({http_status:400,graph_error_code:190,graph_error_subcode:463});
  expect(JSON.stringify(result)).not.toContain('test-page-token');expect(JSON.stringify(result)).not.toContain('test-app-token');
 });
});

it('persists only observed Inbox permissions, including missing-grant revocation',async()=>{
 const result=await verify(graph({'debug_token':{data:{is_valid:true,type:'PAGE',app_id:'444',profile_id:'111',user_id:'333',expires_at:0,data_access_expires_at:0,scopes:['pages_manage_metadata']}}}));
 expect(result.granted_permissions).toEqual(['pages_manage_metadata']);
 expect(result.missing_permissions).toContain('pages_messaging');
 expect(result.authorization_verified).toBe(false);
});

it.each(['facebook','instagram'])('verifies retained current %s OAuth messaging tasks despite optional owner denial',async channel=>{
 const c={...connection,channel,provider_account_id:channel==='instagram'?'666':'111',oauth_accounts_generation_verified:true,capabilities:{...connection.capabilities,discovery_path:'accounts'}};
 // Instagram first verifies the exact linkage; only the separate owner field is denied.
 const g=graph();const request=g.request;
 g.request=vi.fn(async(path,token,params,method,inspect)=>path==='111'&&params.fields==='id,business{id}'?null:request(path,token,params,method,inspect));
 const result=await verify(g,c);
 expect(result).toMatchObject({authorization_verified:true,task_source:'oauth_accounts_current_generation',real_inbound_verified:false});
 expect(g.request.mock.calls.some(([path])=>path.endsWith('/roles'))).toBe(false);
 for(const patch of [{oauth_accounts_generation_verified:false},{meta_user_id:'999'},{capabilities:{...c.capabilities,page_tasks:['MANAGE']}},{capabilities:{...c.capabilities,discovery_path:'business_owned'}}])expect((await verify(g,{...c,...patch})).authorization_verified).toBe(false);
 expect((await verify(g,c,[])).real_inbound_verified).toBe(false);
});
