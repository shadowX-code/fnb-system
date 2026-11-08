import {requestInboxAssistant} from './inboxAssistant.ts';

const whatsappScenarios:Record<string,string>={
 service_window_closed:'A Meta-approved template and recipient authorization are required outside the service window.',
 consent_missing:'Current WhatsApp consent is unavailable.',
 human_takeover:'Staff owns this conversation.',
 external_owner:'Another system owns WhatsApp automation.',
 credential_unverified:'The current WhatsApp credential generation is unverified.',
};

export function applyWhatsAppSimulation(result:any,scenario:string){
 if(scenario!=='eligible'&&!Object.hasOwn(whatsappScenarios,scenario))throw new Error('invalid_whatsapp_simulation');
 if(result.state!=='completed'||!result.result)return result;
 const {mode,decision}=result.result;
 return {...result,result:{...result.result,channel:'whatsapp',scenario,
  decision:mode==='suggest_only'||scenario==='eligible'?decision:{
   kind:'handoff',reason:scenario,text:whatsappScenarios[scenario],
  },
 }};
}

// Simulation has no conversation/draft/outbox identity and cannot enter a delivery adapter.
export async function runInboxPlayground(caller:any,service:any,invoke:any,body:any,key:string,model:string,generate=requestInboxAssistant) {
 const whatsapp=body.channel==='whatsapp';
 if(body.channel!==undefined&&!whatsapp)throw new Error('invalid_simulation_channel');
 const scenario=body.scenario;
 if(whatsapp&&scenario!=='eligible'&&!Object.hasOwn(whatsappScenarios,scenario))throw new Error('invalid_whatsapp_simulation');
 const project=(result:any)=>whatsapp?applyWhatsAppSimulation(result,scenario):result;
 const prepared=await invoke(caller,'marketing_inbox_test_prepare',{p_request:body.requestId,p_org:body.org,p_brand:body.brand,p_mode:body.mode,p_history:body.history,p_outlet:body.outletId||null});
 if(prepared.state!=='prepared')return project(prepared);
 const actor=await invoke(caller,'marketing_inbox_actor');
 const claim=await invoke(service,'marketing_inbox_test_claim',{p_request:body.requestId,p_actor:actor});
 if(!claim)return {state:'already_claimed_or_superseded'};
 let result:any;
 try {
  result=await generate(claim,key,model);
  return project(await invoke(service,'marketing_inbox_test_finish',{p_request:body.requestId,p_lease:claim.lease,p_body:result.body,p_model:result.model,p_input:result.input,p_output:result.output}));
 }catch(error){
  await invoke(service,'marketing_inbox_test_finish',{p_request:body.requestId,p_lease:claim.lease,p_body:{latency_ms:result?.body?.latency_ms||0},p_model:result?.model||model,p_input:result?.input??null,p_output:result?.output??null,p_error:true}).catch(()=>{});
  throw error;
 }
}
