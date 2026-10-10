import {describe,it,expect,vi} from 'vitest';
import {verifyInboxConnection} from '../../../../supabase/functions/_shared/metaInboxVerification.ts';
import {MetaError} from '../../../../supabase/functions/_shared/metaGraph.ts';
const permissions=['pages_messaging','pages_manage_metadata','instagram_basic','instagram_manage_messages'];
const connection={channel:'facebook',provider_account_id:'111',meta_user_id:'333',credential_generation:5,capabilities:{page_task_source:'accounts',page_tasks_verified:true,page_tasks:['MESSAGING']}};
function graph(overrides:any={}) {
 return {request:vi.fn(async(path:string,_token:string,_params:any,_method:string,inspect:any)=>{
  const value=overrides[path]??({'debug_token':{data:{is_valid:true,type:'PAGE',app_id:'444',profile_id:'111',user_id:'333',expires_at:0,data_access_expires_at:0,scopes:permissions,granular_scopes:[{scope:'business_management',target_ids:['555']}]}},'me':{id:'111'},'111':{id:'111',business:{id:'555'},instagram_business_account:{id:'666'}},'111/subscribed_apps':{data:[{id:'444',subscribed_fields:['messages','messaging_postbacks','message_deliveries','message_reads','messaging_seen']}]},'111/conversations':{data:[{participants:{data:[{id:'777'}]},messages:{data:[{id:'actual-mid'}]}}]}} as any)[path];
  if(value instanceof Error){inspect?.(400,190,{graph_error_subcode:463});throw value;}
  inspect?.(200,null,{});return value;
 })};
}
const verify=(g:any,c:any=connection,inbound:any[]=[])=>verifyInboxConnection(g,'444','test-app-token',c,{token:'test-page-token'},async()=>{},inbound);
describe('independent messaging capability verification',()=>{
 it('requires explicit messaging tasks and real inbound matches, never read or posting success',async()=>{
  const result=await verify(graph());expect(result.authorization_verified).toBe(true);expect(result.real_inbound_verified).toBe(false);
  const posting=await verify(graph(),{...connection,capabilities:{...connection.capabilities,page_tasks:['MANAGE','CREATE_CONTENT']}});expect(posting.authorization_verified).toBe(false);
 });
 it('keeps Instagram identity and scopes independent',async()=>{
  const c={...connection,channel:'instagram',provider_account_id:'666'};
  expect((await verify(graph(),c)).authorization_verified).toBe(true);
  expect((await verify(graph({'111':{id:'111',instagram_business_account:{id:'999'}}}),c)).authorization_verified).toBe(false);
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
