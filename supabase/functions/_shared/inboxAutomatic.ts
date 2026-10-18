import {requestInboxAssistant} from './inboxAssistant.ts';
import {deliverInboxReply} from './inboxDelivery.ts';
import {aiAutoReplyConfigured,aiAutoReplyAllowed} from './marketingExecution.mjs';

/** One bounded turn per idle worker tick; disabled gates perform no queue or provider operation. */
export async function runInboxAutomatic(db:any,graph:any,get:(key:string)=>string,generate=requestInboxAssistant,deliver=deliverInboxReply) {
 if(!aiAutoReplyConfigured(get))return false;
 const call=async(name:string,args:any={})=>{const r=await db.rpc(name,args);if(r.error)throw new Error('automatic_authority_unavailable');return r.data;};
 const turn=await call('marketing_inbox_auto_claim');if(!turn)return false;
 try {
  const result=turn.delivery_only||turn.cached_artifact?null:await generate(turn,get('OPENAI_API_KEY'),get('MARKETING_AI_MODEL'));
  const prepared=turn.delivery_only?turn:await call('marketing_inbox_auto_finish',{p_turn:turn.turn_id,p_lease:turn.lease,p_body:result?.body||{},p_model:result?.model||'',p_input:result?.input??null,p_output:result?.output??null,p_cached:turn.cached_artifact||null});
  if(prepared.state==='prepared') {
   const delivered=await deliver(db,graph.withSignal(AbortSignal.timeout(10000)),get,prepared.draft_id,prepared.auth_user,(account,peer)=>aiAutoReplyAllowed(account,peer,get));
   if(delivered.state!=='sent')await call('marketing_inbox_auto_fail',{p_turn:turn.turn_id,p_lease:turn.lease,p_reason:delivered.state==='reconciling'?'delivery_uncertain':'provider_rejected'});
  }
 } catch {
  // A claimed generation is never automatically rerun, and an uncertain write is never resent.
  try{await call('marketing_inbox_auto_fail',{p_turn:turn.turn_id,p_lease:turn.lease,p_reason:'automatic_processing_failed'});}catch{}
 }
 return true;
}
