import {describe,it,expect,vi,beforeEach} from 'vitest';
import {runConnectionHealth} from '../../../../supabase/functions/_shared/metaConnectionHealth.ts';
import {verifyInboxConnection} from '../../../../supabase/functions/_shared/metaInboxVerification.ts';
import {readRecentInbox} from '../../../../supabase/functions/_shared/metaInboxRecovery.ts';
vi.mock('../../../../supabase/functions/_shared/metaSecurity.ts',async(importOriginal)=>({...await importOriginal<any>(),connectionBinding:()=> 'fixture',unseal:async()=>({token:'fixture'}),seal:async()=>({})}));
vi.mock('../../../../supabase/functions/_shared/metaConnectionDiagnostics.ts',()=>({diagnoseMetaConnection:async()=>({channel:'facebook',token:{valid:true,app_matches:true,type:'PAGE',expiry_in_future:true,granted_scopes:['read_insights']},credential_identity_matches:true,publishing_evidence:{eligibility:'verified'}})}));
vi.mock('../../../../supabase/functions/_shared/metaInboxVerification.ts',()=>({verifyInboxConnection:vi.fn()}));
vi.mock('../../../../supabase/functions/_shared/metaInboxRecovery.ts',()=>({readRecentInbox:vi.fn()}));
const job={connection_id:'fixture',generation:1,lease:'lease',auth_user_id:'actor'};
const material={id:'fixture',credential_generation:1,channel:'facebook'};
const evidence={authorization_verified:true,subscriptions_verified:true,page_id:'111',evidence:[],app_webhook:{registered:true,active:true,callback_matches:true,fields:['messages','messaging_postbacks','message_deliveries','message_reads','message_echoes']}};
const installed={data:[{id:'app',subscribed_fields:['messages','messaging_postbacks','message_deliveries','message_reads','message_echoes']}]};
function database(messaging:any={configuration_verified:true,delivery_verified:false}) {
 return {rpc:vi.fn(async(name:string)=>({error:null,data:name==='marketing_meta_health_claim'?job:name==='marketing_meta_health_guard'?true:name==='marketing_meta_diagnostic_material'?material:name==='marketing_inbox_verification_events'?[]:name==='marketing_inbox_record_verification'?messaging:null}))};
}
beforeEach(()=>{
 vi.clearAllMocks();
 vi.mocked(verifyInboxConnection).mockImplementation(async(...args:any[])=>{args[7]?.(installed);return evidence as any;});
 vi.mocked(readRecentInbox).mockResolvedValue({events:[],state:'available',reason:'recent_window_checked',complete:false} as any);
});
describe('bounded automatic connection health',()=>{
 it('does not call Meta when no job is due',async()=>{
  const db={rpc:vi.fn().mockResolvedValue({data:null,error:null})};const graph={request:vi.fn()};
  expect(await runConnectionHealth(db,graph as any,{appId:'app'},['key'])).toBeNull();
  expect(verifyInboxConnection).not.toHaveBeenCalled();expect(graph.request).not.toHaveBeenCalled();
 });
 it('distinguishes configuration from signed delivery and stores no recovered bodies in health',async()=>{
  for(const delivered of [false,true]){
   const db=database({configuration_verified:true,delivery_verified:delivered});
   vi.mocked(readRecentInbox).mockResolvedValue({events:[{body:'private'}],state:'available',reason:'recent_window_checked',complete:false} as any);
   const result=await runConnectionHealth(db,{} as any,{appId:'app'},['key']);
   expect(result.messaging.state).toBe(delivered?'delivery_verified':'awaiting_first_delivery');
   const health=db.rpc.mock.calls.find(([name])=>name==='marketing_meta_record_health')?.[1] as any;
   expect(JSON.stringify(health)).not.toContain('private');
   expect(db.rpc.mock.calls.some(([name])=>name==='marketing_inbox_reconcile')).toBe(true);
  }
 });
 it('repairs an existing Page missing only echoes through the canonical intent and verifies configuration without inventing delivery',async()=>{
  const db=database(),graph={request:vi.fn(async(_path:string,_token:string,_params:any,method:string)=>method==='POST'?{success:true}:installed)};
  let checks=0;
  vi.mocked(verifyInboxConnection).mockImplementation(async(...args:any[])=>{args[7]?.(checks++?installed:{data:[{id:'app',subscribed_fields:installed.data[0].subscribed_fields.filter(s=>s!=='message_echoes')}]});return {...evidence,echo_subscription_status:{app:true,page:checks>1}} as any;});
  const result=await runConnectionHealth(db,graph as any,{appId:'app'},['key']);
  expect(graph.request.mock.calls.filter(c=>c[3]==='POST')).toEqual([['111/subscribed_apps','fixture',{subscribed_fields:expect.arrayContaining(['message_echoes','messages','message_reads','message_deliveries','messaging_postbacks'])},'POST']]);
  expect(db.rpc).toHaveBeenCalledWith('marketing_meta_subscription_intent',expect.objectContaining({p_state:'pending'}));
  expect(result.echo_subscription_status).toEqual({app:true,page:true});expect(result.messaging.state).toBe('awaiting_first_delivery');
 });
 it('does not reconcile before configuration verification and schedules transient retries',async()=>{
  const db=database({configuration_verified:false,delivery_verified:false});
  vi.mocked(verifyInboxConnection).mockImplementation(async(...args:any[])=>{args[7]?.(installed);return {...evidence,authorization_verified:false,evidence:[{http_status:503}]} as any;});
  await runConnectionHealth(db,{} as any,{appId:'app'},['key']);
  expect(readRecentInbox).not.toHaveBeenCalled();
  expect(db.rpc).toHaveBeenCalledWith('marketing_meta_health_finish',expect.objectContaining({p_error:'meta_temporarily_unavailable'}));
 });
});
