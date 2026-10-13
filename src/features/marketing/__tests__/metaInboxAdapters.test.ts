import {describe,it,expect,vi} from 'vitest';
import {advanceInboxDelivery,commentReplyIntent,inboxFailureCode} from '../../../../supabase/functions/_shared/metaInboxAdapters.ts';
import {messagingIntent,validateAISuggestion} from '../../../../supabase/functions/_shared/marketingInbox.ts';
const authority={execution_enabled:true,send_verified:true,webhook_verified:true,exact_authorizer_verified:true,page_tasks:['MESSAGE'],granted_scopes:['pages_messaging','instagram_manage_messages'],last_inbound_at:new Date().toISOString(),page_id:'111'};
describe('bounded Send API contracts',()=>{
 it('uses the documented MESSAGE task and rejects posting authority/opt-out/comments',()=>{
  expect(messagingIntent('facebook',authority,'222','Hello').path).toBe('111/messages');
  for(const extra of [{page_tasks:['MANAGE','CREATE_CONTENT']},{opted_out:true},{medium:'comment'},{webhook_verified:false}])expect(()=>messagingIntent('facebook',{...authority,...extra},'222','Hello')).toThrow();
 });
 it('checkpointed uncertain writes cannot create a duplicate outbound response',async()=>{
  let state:any={};const post=vi.fn().mockRejectedValue(new Error('timeout'));
  const args={channel:'facebook' as const,authority,recipient:'222',text:'Hello',guard:async()=>{},checkpoint:async(v:any)=>{state=v;},post};
  expect((await advanceInboxDelivery({...args,state})).state).toBe('reconciling');
  expect((await advanceInboxDelivery({...args,state})).state).toBe('reconciling');expect(post).toHaveBeenCalledTimes(1);
 });
 it('requires an actual verified receipt and resumes it without another POST',async()=>{
  let state:any={};const post=vi.fn().mockResolvedValue({message_id:'mid1',recipient_id:'222'});
  const args={channel:'instagram' as const,authority,recipient:'222',text:'Hello',guard:async()=>{},checkpoint:async(v:any)=>{state=v;},post};
  expect(await advanceInboxDelivery({...args,state})).toEqual({state:'sent',receipt:'mid1'});
  await advanceInboxDelivery({...args,state});expect(post).toHaveBeenCalledTimes(1);
 });
 it('comments need separate resource ownership and permission',()=>{
  expect(()=>commentReplyIntent('facebook',authority,'111_555','Hi')).toThrow();
  expect(commentReplyIntent('instagram',{execution_enabled:true,comment_reply_verified:true,exact_authorizer_verified:true,resource_owned:true,granted_scopes:['instagram_manage_comments']},'555','Hi').path).toBe('555/replies');
 });
 it('rejects invented AI intents',()=>expect(()=>validateAISuggestion({text:'Hi',question:'',language:'EN',reference_keys:['rules'],human_required:false,intent:'make_reservation'},{rules:{}},'reply')).toThrow());
});

it('preserves bounded definitive rejection categories without retaining provider payloads',async()=>{for(const [graphCode,code] of [[190,'provider_token_invalid'],[200,'provider_permission_required'],[613,'provider_rate_limited'],[551,'provider_recipient_unavailable'],[100,'provider_rejected']] as const){let state:any={};const post=vi.fn().mockRejectedValue({definitive:true,graphCode,message:'private provider payload'});const args={channel:'facebook' as const,authority,recipient:'222',text:'Hello',guard:async()=>{},checkpoint:async(v:any)=>{state=v},post};expect(await advanceInboxDelivery({...args,state})).toEqual({state:'failed',code});expect(JSON.stringify(state)).not.toContain('private');await advanceInboxDelivery({...args,state});expect(post).toHaveBeenCalledTimes(1);expect(inboxFailureCode({graphCode})).toBe(code)}});
it('closed and future messaging windows are rejected before any POST',async()=>{for(const last_inbound_at of [new Date(Date.now()-25*3600000).toISOString(),new Date(Date.now()+3600000).toISOString()]){const post=vi.fn();await expect(advanceInboxDelivery({channel:'instagram',authority:{...authority,last_inbound_at},recipient:'222',text:'Hello',state:{},guard:async()=>{},checkpoint:async()=>{},post})).rejects.toThrow();expect(post).not.toHaveBeenCalled()}});
