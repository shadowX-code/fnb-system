import {requestInboxAssistant} from './inboxAssistant.ts';

// Simulation has no conversation/draft/outbox identity and cannot enter a delivery adapter.
export async function runInboxPlayground(caller:any,service:any,invoke:any,body:any,key:string,model:string,generate=requestInboxAssistant) {
 const prepared=await invoke(caller,'marketing_inbox_test_prepare',{p_request:body.requestId,p_org:body.org,p_brand:body.brand,p_mode:body.mode,p_history:body.history,p_outlet:body.outletId||null});
 if(prepared.state!=='prepared')return prepared;
 const actor=await invoke(caller,'marketing_inbox_actor');
 const claim=await invoke(service,'marketing_inbox_test_claim',{p_request:body.requestId,p_actor:actor});
 if(!claim)return {state:'already_claimed_or_superseded'};
 let result:any;
 try {
  result=await generate(claim,key,model);
  return await invoke(service,'marketing_inbox_test_finish',{p_request:body.requestId,p_lease:claim.lease,p_body:result.body,p_model:result.model,p_input:result.input,p_output:result.output});
 }catch(error){
  await invoke(service,'marketing_inbox_test_finish',{p_request:body.requestId,p_lease:claim.lease,p_body:{latency_ms:result?.body?.latency_ms||0},p_model:result?.model||model,p_input:result?.input??null,p_output:result?.output??null,p_error:true}).catch(()=>{});
  throw error;
 }
}
