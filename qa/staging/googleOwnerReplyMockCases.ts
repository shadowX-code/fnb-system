// Pure in-memory verification: this transport never delegates to fetch or touches Google/DB records.
import { GoogleOwnerReplies, executeOwnerReply, replyFingerprint, reconcileOwnerReply } from '../../supabase/functions/_shared/googleBusinessReplies.ts';
import { BusinessProfileError } from '../../supabase/functions/_shared/googleBusinessProfile.ts';
import { hash } from '../../supabase/functions/_shared/metaSecurity.ts';
const name='accounts/fixture/locations/fixture/reviews/fixture';
const base={name,starRating:'FIVE',createTime:'2026-10-01T00:00:00Z',updateTime:'2026-10-01T00:00:00Z',comment:'Synthetic QA review',reviewer:{displayName:'Fixture'}};
function assert(ok:unknown,message:string):asserts ok {if(!ok)throw new Error(message);}
export async function runGoogleOwnerReplyMockVerification() {
 const report:any[]=[];
 for(const mode of ['publish','update','lost_response','retry_reconcile','permission','rate_limit','conflict','pending_moderation','audit_ack_loss','expired_authorization','preflight_network','authority_drift','readback_lag']) {
  const comment='Thank you. 谢谢您的反馈。 Terima kasih.';
  let remote:any=mode==='update' ? {comment:'Old fixture reply',updateTime:'2026-10-02T00:00:00Z'} : undefined;
  const expectedHash=await replyFingerprint(remote);
  if(mode==='conflict')remote={comment:'Other Admin changed this reply',updateTime:'2026-10-03T00:00:00Z'};
  let puts=0,gets=0,finishCalls=0;
  const transport:typeof fetch=async(_url,init)=>{
   if(init?.method==='PUT') {
    puts++;
    if(mode==='permission')return Response.json({}, {status:403});
    if(mode==='rate_limit')return Response.json({}, {status:429});
    assert(JSON.parse(String(init.body)).comment===comment,'Authored multilingual reply changed');
    remote={comment,updateTime:'2026-10-14T12:00:00Z',...(mode==='pending_moderation'?{reviewReplyState:'PENDING'}:{})};
    if(['lost_response','retry_reconcile'].includes(mode))throw new Error('Synthetic lost write response');
    return Response.json(remote);
   }
   gets++;
   if(mode==='expired_authorization')return Response.json({}, {status:401});
   if(mode==='preflight_network')throw new Error('Synthetic read failure');
   if(mode==='retry_reconcile' && gets===2)throw new Error('Synthetic temporary read failure');
   return Response.json({...base,...(remote?{reviewReply:remote}:{})});
  };
  const provider=new GoogleOwnerReplies('synthetic-token',transport);
  let state='ready';
  const outcomes:any[]=[];
  const run=()=>executeOwnerReply({provider:{updateReply:(resource:string,text:string)=>provider.updateReply(resource,text),getReview:async(resource:string)=>{
    const review=await provider.getReview(resource);
    if(mode==='readback_lag' && reconcileOwnerReply(review,{comment:'Accepted fixture reply',updateTime:'2026-10-14T12:00:00Z'}).reply_sync_pending)throw new BusinessProfileError('reply_readback_pending',409);
    return review;
   }},
   beforeWrite:async()=>{if(mode==='authority_drift')throw new BusinessProfileError('reply_authority_changed',409);},
   claim:async()=>state==='confirmed'?{id:'fixture',status:state,claimed:false}:{id:'fixture',review_name:name,status:state,claimed:true,desired_hash:await hash(comment)},
   intent:async()=>({comment,expectedHash}),
   finish:async(_record,outcome)=>{finishCalls++;if(mode==='audit_ack_loss' && finishCalls<=2)throw new Error('Synthetic audit acknowledgement loss');state=outcome.status;outcomes.push(outcome);},
  });
  let result=await run();
  if(mode==='retry_reconcile' || mode==='audit_ack_loss'){
   assert(result.status==='uncertain','Lost evidence was incorrectly confirmed');state='uncertain';result=await run();
  }
  if(mode==='conflict')assert(result.status==='conflict' && puts===0,'Changed remote reply was overwritten');
  else if(mode==='expired_authorization')assert(result.status==='rejected' && result.code==='reconnect_required' && puts===0,'Expired authorization published a reply');
  else if(mode==='preflight_network')assert(result.status==='rejected' && puts===0,'Failed preflight published a reply');
  else if(mode==='readback_lag')assert(result.status==='rejected' && result.code==='reply_readback_pending' && puts===0,'Lagging read allowed a duplicate write');
  else if(mode==='authority_drift')assert(result.status==='rejected' && result.code==='reply_authority_changed' && puts===0,'Changed authority published a reply');
  else if(mode==='permission')assert(result.status==='rejected' && result.code==='google_access_denied' && puts===1,'Permission failure retried');
  else if(mode==='rate_limit')assert(result.status==='rejected' && result.code==='google_rate_limited' && result.request===`PUT /v4/${name}/reply` && puts===1 && gets===1,'429 diagnostic or retry behavior changed');
  else {
   assert(result.status==='confirmed' && puts===1,'Reply was duplicated or not confirmed');
   if(mode==='pending_moderation')assert(result.remoteReply?.reviewReplyState==='PENDING','Moderation evidence lost');
   const before=gets;assert((await run()).status==='confirmed' && puts===1 && gets===before,'Confirmed request replay touched Google');
  }
  report.push({case:mode,passed:true,getCalls:gets,putCalls:puts,auditedOutcomes:outcomes.map(o=>o.status)});
 }
 return {realGoogleWrites:0,passed:report.length,cases:report};
}
