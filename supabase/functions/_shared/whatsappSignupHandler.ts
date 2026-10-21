import {MetaGraph,MetaError} from './metaGraph.ts';
import {connectionBinding,hash,nonce,seal,unseal,tokenEncryptionReady,STAGING_SUPABASE} from './metaSecurity.ts';
import {configured,exchangeWhatsAppCode,verifyWhatsAppAssets,finishWhatsAppOnboarding,type WhatsAppConfig} from './whatsappOnboarding.ts';
async function call(db:any,name:string,args:any){const {data,error}=await db.rpc(name,args);if(error)throw new MetaError('whatsapp_authority_rejected');return data;}
export async function whatsappSignupHandler(path:string,body:any,caller:any,service:any,user:string,env:(n:string)=>string){
 const c:WhatsAppConfig={appId:env('MARKETING_META_APP_ID'),appSecret:env('MARKETING_META_APP_SECRET'),version:env('MARKETING_META_GRAPH_VERSION'),configId:env('MARKETING_WHATSAPP_SIGNUP_CONFIG_ID'),signupVersion:env('MARKETING_WHATSAPP_SIGNUP_VERSION'),enabled:env('MARKETING_WHATSAPP_ONBOARDING_ENABLED')==='true',callback:`${STAGING_SUPABASE}/functions/v1/marketing-inbox/webhook`};
 const ready=await call(caller,'marketing_whatsapp_readiness',{p_org:body.organizationId,p_brand:body.brandId||null,p_app:c.appId,p_config:c.configId,p_version:c.version,p_signup:c.signupVersion});
 const serverReady=configured(c)&&await tokenEncryptionReady(env('MARKETING_META_TOKEN_ENCRYPTION_KEY'));
 const eligible=ready.eligible&&serverReady&&c.enabled;
 if(path==='/whatsapp/readiness')return {...ready,eligible,state:eligible?'eligible':'verification_required',reason:!serverReady?'server_configuration_required':!c.enabled?'pilot_activation_required':ready.reason,sending_enabled:false,ai_enabled:false};
 if(!eligible||!ready.can_configure)throw new MetaError('whatsapp_verification_required');
 const g=new MetaGraph({appId:c.appId,appSecret:c.appSecret,configId:c.configId,version:c.version});
 const key=env('MARKETING_META_TOKEN_ENCRYPTION_KEY');
 if(path==='/whatsapp/begin'){
  const state=nonce();const s=await call(caller,'marketing_whatsapp_begin',{p_org:body.organizationId,p_brand:body.brandId,p_state_hash:await hash(state),p_app:c.appId,p_config:c.configId,p_version:c.version,p_signup:c.signupVersion,p_connection:body.connectionId||null,p_generation:body.generation??0});
  return {...s,state,appId:c.appId,configId:c.configId,graphVersion:c.version,signupVersion:c.signupVersion};
 }
 let material:any,credential:any;
 if(path==='/whatsapp/complete'){
  if(body.confirmBrandOwnership!==true||typeof body.state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.state))throw new MetaError('whatsapp_ownership_confirmation_required');
  // Consumption occurs before exchange. Replays, revoked roles and wrong actors cannot obtain a token.
  const s=await call(service,'marketing_whatsapp_consume',{p_session:body.sessionId,p_auth_user:user,p_state_hash:await hash(body.state)});
  if(s.brand_id!==body.brandId||s.organization_id!==body.organizationId||s.app_id!==c.appId||s.config_id!==c.configId||s.graph_version!==c.version||s.signup_version!==c.signupVersion)throw new MetaError('whatsapp_signup_scope_changed');
  const a=body.assets;
  if(!a||a.waba_id!==s.waba_id||(a.phone_id&&a.phone_id!==s.phone_id)||(a.business_id&&a.business_id!==s.customer_business_id)||a.mode!=='coexistence')throw new MetaError('whatsapp_signup_assets_mismatch');
  const token=await exchangeWhatsAppCode(g,c,body.code);
  const evidence=await verifyWhatsAppAssets(g,c,token,s);
  const sealed=await seal({token},key,connectionBinding({brand_id:s.brand_id,channel:'whatsapp',provider_account_id:s.phone_id}));
  const bound=await call(service,'marketing_whatsapp_bind',{p_session:s.id,p_auth_user:user,p_sealed:sealed,p_evidence:evidence});
  material=await call(service,'marketing_meta_diagnostic_material',{p_connection:bound.connection_id,p_auth_user:user});credential={token};
 }else if(path==='/whatsapp/verify'){
  material=await call(service,'marketing_meta_diagnostic_material',{p_connection:body.connectionId,p_auth_user:user});
  if(material.brand_id!==body.brandId||material.organization_id!==body.organizationId||material.channel!=='whatsapp'||material.credential_generation!==body.generation)throw new MetaError('whatsapp_connection_changed');
  credential=await unseal(material.sealed_token,[key,env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],connectionBinding(material));
  const expected=await call(service,'marketing_whatsapp_verification_material',{p_connection:material.id,p_auth_user:user,p_generation:material.credential_generation});
  try{const evidence=await verifyWhatsAppAssets(g,c,credential.token,expected);await call(service,'marketing_whatsapp_record_verification',{p_connection:material.id,p_auth_user:user,p_generation:material.credential_generation,p_evidence:evidence});}
  catch(error){await call(service,'marketing_whatsapp_record_verification',{p_connection:material.id,p_auth_user:user,p_generation:material.credential_generation,p_evidence:{issue:error instanceof MetaError&&error.code==='coexistence_unsupported'?'coexistence_unsupported':'provider_verification_required'}});throw error;}
 }else throw new MetaError('whatsapp_endpoint_unavailable');
 const guard=async()=>{const m=await call(service,'marketing_whatsapp_verification_material',{p_connection:material.id,p_auth_user:user,p_generation:material.credential_generation});if(m.brand_id!==body.brandId)throw new MetaError('whatsapp_connection_changed');};
 const step=(name:string,outcome?:string,receipt?:string)=>call(service,'marketing_whatsapp_step',{p_connection:material.id,p_auth_user:user,p_generation:material.credential_generation,p_step:name,p_outcome:outcome??null,p_request_id:receipt??null});
 return {...await finishWhatsAppOnboarding(g,c,credential.token,material.whatsapp_waba_id,material.provider_account_id,step,guard),sending_enabled:false,ai_enabled:false};
}
