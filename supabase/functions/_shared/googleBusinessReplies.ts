import { GoogleBusinessProfile, BusinessProfileError, validateGoogleReview, resource } from './googleBusinessProfile.ts';
import { driveFetch } from './googleDrive.ts';
import { hash } from './metaSecurity.ts';
import type { GoogleReviewRecord } from './googleReviewsContract.ts';
type OwnerReply = NonNullable<GoogleReviewRecord['reviewReply']>;
export function reviewResource(name: string, location: string) {
 resource(location,'location');
 if (typeof name !== 'string' || !name.startsWith(`${location}/reviews/`) || !/^[A-Za-z0-9_-]+$/.test(name.slice(`${location}/reviews/`.length))) throw new BusinessProfileError('invalid_review');
 return name;
}
export function replyText(comment: unknown) {
 if (typeof comment !== 'string' || !comment.trim() || new TextEncoder().encode(comment).length>4096) throw new BusinessProfileError('invalid_reply_text');
 return comment;
}
export const replyFingerprint = (reply?: OwnerReply) => hash(JSON.stringify(reply ? { comment: reply.comment, updateTime: reply.updateTime } : null));
// A lagging Google GET must not erase a newer accepted PUT or authorize another write.
export function reconcileOwnerReply(review: GoogleReviewRecord, confirmed?: OwnerReply) {
 const remote=review.reviewReply;
 const pending=Boolean(confirmed && (!remote || remote.comment!==confirmed.comment && Date.parse(remote.updateTime)<=Date.parse(confirmed.updateTime)));
 return {review:pending ? {...review,reviewReply:confirmed} : review,reply_sync_pending:pending};
}
export class GoogleOwnerReplies {
 constructor(private token: string, private transport: typeof fetch = fetch) {}
 async getReview(name: string) {
  const parent = name.split('/reviews/')[0]; reviewResource(name,parent);
  let data:any;
  try{data=await new GoogleBusinessProfile(this.token,this.transport).read('mybusiness.googleapis.com',`v4/${name}`);}catch(error){if(error instanceof BusinessProfileError)throw error;throw new BusinessProfileError('google_unavailable',503,'mybusiness.googleapis.com',`GET /v4/${name}`);}
  const row = { name: data.name || `${parent}/reviews/${data.reviewId}`, starRating: data.starRating, createTime: data.createTime, updateTime: data.updateTime,
   ...(data.comment!==undefined ? { comment:data.comment } : {}), ...(data.reviewer ? { reviewer:data.reviewer } : {}), ...(data.reviewReply ? { reviewReply:data.reviewReply } : {}) };
  if (row.name !== name) throw new BusinessProfileError('invalid_review');
  return validateGoogleReview(row,parent);
 }
 async updateReply(name: string, comment: string) {
  reviewResource(name,name.split('/reviews/')[0]); replyText(comment);
  const service='mybusiness.googleapis.com', request=`PUT /v4/${name}/reply`;
  let response: Response;
  try { response=await driveFetch(this.transport,`https://${service}/v4/${name}/reply`,{method:'PUT',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify({comment}),redirect:'error'},Date.now()+15000,false); }
  catch { throw new BusinessProfileError('reply_outcome_uncertain',503,service,request); }
  if (!response.ok) throw new BusinessProfileError(response.status===401 ? 'reconnect_required' : response.status===403 ? 'google_access_denied' : response.status===429 ? 'google_rate_limited' : response.status>=500 ? 'reply_outcome_uncertain' : 'reply_rejected',response.status,service,request);
  let reply: OwnerReply;
  try { reply=await response.json(); } catch { throw new BusinessProfileError('reply_outcome_uncertain',503,service,request); }
  if (reply.comment!==comment || !Number.isFinite(Date.parse(reply.updateTime))) throw new BusinessProfileError('reply_outcome_uncertain',503,service,request);
  return reply;
 }
}
export type ReplyOutcome = { id:string; status:string; code?:string; remoteReply?:OwnerReply; service?:string; request?:string; operation?:string };
export async function executeOwnerReply(options: {
 claim:()=>Promise<any>; intent:(record:any)=>Promise<{comment:string;expectedHash:string}|null>;
 provider:Pick<GoogleOwnerReplies,'getReview'|'updateReply'>;
 finish:(record:any,outcome:ReplyOutcome)=>Promise<void>; beforeWrite:(record:any)=>Promise<void>;
}) : Promise<ReplyOutcome> {
 const record=await options.claim();
 if (!record.claimed) return {id:record.id,status:record.status,code:record.code};
 const unknownBefore=['sending','uncertain'].includes(record.status);
 let didWrite=false;
 const complete=async(outcome:Omit<ReplyOutcome,'id'>)=>{
  const result={id:record.id,...outcome};
  // Finish is retry-safe: a lost database acknowledgement must never trigger another PUT.
  try { await options.finish(record,result); }
  catch { try { await options.finish(record,result); } catch { return {id:record.id,status:'uncertain',code:'reply_audit_unconfirmed'}; } }
  return result;
 };
 try {
  const remote=await options.provider.getReview(record.review_name);
  if (remote.reviewReply && await hash(remote.reviewReply.comment)===record.desired_hash) return complete({status:'confirmed',code:'remote_reply_reconciled',remoteReply:remote.reviewReply});
  const intent=await options.intent(record);
  if (!intent) return complete({status:'conflict',code:'reply_intent_expired'});
  if (await replyFingerprint(remote.reviewReply)!==intent.expectedHash) return complete({status:'conflict',code:'reply_changed'});
  if (record.read_only) return complete({status:'uncertain',code:'reply_not_confirmed'});
  if(record.operation && record.operation!==(remote.reviewReply ? 'update' : 'publish'))return complete({status:'conflict',code:'reply_changed'});
  await options.beforeWrite(record);
  didWrite=true;
  try {
   const reply=await options.provider.updateReply(record.review_name,intent.comment);
   return complete({status:'confirmed',code:'reply_saved',remoteReply:reply,operation:remote.reviewReply ? 'update' : 'publish'});
  } catch(error) {
   if (!(error instanceof BusinessProfileError) || error.code==='reply_outcome_uncertain') {
    // A successful write may have lost its response. Read once, never auto-repeat the PUT.
    try {
     const current=await options.provider.getReview(record.review_name);
     if (current.reviewReply && await hash(current.reviewReply.comment)===record.desired_hash) return complete({status:'confirmed',code:'remote_reply_reconciled',remoteReply:current.reviewReply});
    } catch(readError) {
     if (readError instanceof BusinessProfileError) return complete({status:'uncertain',code:readError.code,service:readError.service,request:readError.request});
    }
    return complete({status:'uncertain',code:'reply_outcome_uncertain'});
   }
   return complete({status:'rejected',code:error.code,service:error.service,request:error.request});
  }
 } catch(error) {
  const cause=error instanceof BusinessProfileError ? error : new BusinessProfileError('google_unavailable',503);
  return complete({status:unknownBefore||didWrite ? 'uncertain' : 'rejected',code:cause.code,service:cause.service,request:cause.request});
 }
}
