import {describe,it,expect,vi} from 'vitest';
import {advanceInboxDelivery,commentReplyIntent} from '../../../../supabase/functions/_shared/metaInboxAdapters.ts';
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
