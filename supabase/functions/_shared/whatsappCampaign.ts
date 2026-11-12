import {MetaError} from './metaGraph.ts';
import {STAGING_SUPABASE} from './metaSecurity.ts';
import {advanceInboxDelivery} from './metaInboxAdapters.ts';
import {CLOUD_TEST_APP,CLOUD_TEST_PHONE,verifyWhatsAppCloudTest} from './whatsappOnboarding.ts';
import {whatsappTemplateIntent} from './whatsappTemplateIntent.ts';

export async function runWhatsAppCampaign(
 call:(name:string,args:any)=>Promise<any>, graph:any, env:(key:string)=>string,
 tokenFor:(connection:{id:string;credential_generation:number})=>Promise<string>,
){
 if(env('SUPABASE_URL')!==STAGING_SUPABASE||env('MARKETING_META_APP_ID')!==CLOUD_TEST_APP)return false;
 const worker=(run:string|null,operation:string,extra:Record<string,unknown>={})=>call('marketing_campaign_whatsapp_worker',
  {p_run:run,p_operation:operation,...extra});
 const claim=await worker(null,'claim');
 if(!claim)return false;
 const operation=(name:string,extra:Record<string,unknown>)=>worker(claim.run_id,name,extra);
 const identity={p_delivery:claim.id,p_lease:claim.lease};
 let postStarted=false;
 const checkpoint=async(state:{pending?:boolean;receipt?:string;failed?:string})=>{
  const outcome=state.pending?'begin':state.receipt?'accepted':state.failed?'failed':'unknown';
  const recorded=await operation(outcome,{...identity,p_receipt:state.receipt||null,p_reason:state.failed||null});
  if(!recorded)throw new Error('campaign_authority_changed');

 };
 try {
  const token=await tokenFor({id:claim.connection_id,credential_generation:claim.generation});
  await verifyWhatsAppCloudTest(graph,{
   appId:CLOUD_TEST_APP,appSecret:env('MARKETING_META_APP_SECRET'),version:graph.version,
   configId:'',signupVersion:'',enabled:false,callback:`${STAGING_SUPABASE}/functions/v1/marketing-inbox/webhook`,
  },token);
  const intent=await whatsappTemplateIntent(graph,token,claim.template,CLOUD_TEST_PHONE,'campaign');
  if(intent.providerFingerprint!==claim.template.providerFingerprint)throw new Error('campaign_template_changed');
  const result=await advanceInboxDelivery({
   channel:'whatsapp',whatsappCampaignCallback:claim.id,whatsappTemplate:intent.template,
   authority:{},recipient:claim.peer,text:intent.text,state:{},checkpoint,
   guard:async()=>{if(!await operation('guard',identity))throw new Error('campaign_authority_changed');},
   post:async(path,params)=>{
    postStarted=true;
    try{return await graph.request(path,token,params,'POST');}
    catch(error){
     if(error instanceof MetaError&&!error.uncertain)
      throw Object.assign(new Error('provider_rejected'),{definitive:true,graphCode:error.graphCode});
     throw error;
    }
   },
  });
  if(result.state==='reconciling')await checkpoint({});
 }catch{
  await operation(postStarted?'unknown':'failed',{...identity,p_reason:'template_or_provider_unavailable'});
 }
 return true;
}
