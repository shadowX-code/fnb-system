import {MetaGraph,MetaError} from './metaGraph.ts';
import {connectionBinding,hash,nonce,seal,unseal,tokenEncryptionReady,STAGING_SUPABASE} from './metaSecurity.ts';
import {CLOUD_TEST_APP,CLOUD_TEST_PHONE,verifyWhatsAppCloudTest,configured,exchangeWhatsAppCode,verifyWhatsAppAssets,resolveWhatsAppSignupAssets,finishWhatsAppOnboarding,type WhatsAppConfig} from './whatsappOnboarding.ts';
const cloudTestFailures:Record<string,string>={
 whatsapp_test_brand_denied:'You need permission to configure WhatsApp for the designated Staging test Brand.',
 whatsapp_test_config_missing:'Staging test credentials or server configuration are missing or unusable.',
 whatsapp_test_generation_invalid:'Refresh Connections before verifying the test number again.',
 whatsapp_token_identity_mismatch:'Meta did not verify a valid test access token for Feedx Staging.',
 whatsapp_token_expiry_unverified:'Meta reported an expired test token or could not confirm its expiry.',
 whatsapp_permissions_required:'The test token needs WhatsApp Business Management and WhatsApp Business Messaging permissions.',
 whatsapp_waba_grant_required:'The test token does not grant access to the designated test WhatsApp Business Account.',
 whatsapp_phone_waba_mismatch:'Meta did not confirm that the designated Cloud API phone belongs to the test WhatsApp Business Account.',
 whatsapp_test_token_check_failed:'Meta could not inspect the test token. Check the Staging app credentials and token validity.',
 whatsapp_test_asset_check_failed:'Meta could not read the test WhatsApp Business Account or phone. Check the test token’s asset access.',
 whatsapp_test_app_webhook_check_failed:'Meta could not read the Staging app’s WhatsApp webhook configuration.',
 whatsapp_test_app_webhook_missing:'Configure the canonical Staging WhatsApp webhook callback and subscribe to the messages field in Meta.',
 whatsapp_test_waba_subscription_check_failed:'Meta could not read the test WhatsApp Business Account’s app subscriptions. Check account access.',
 whatsapp_test_waba_subscription_missing:'Subscribe Feedx Staging to the designated test WhatsApp Business Account in Meta.',
 whatsapp_authority_rejected:'FeedX could not verify the Brand access or save this test binding. Refresh Connections and check the Brand’s current binding.',
};
export function whatsappCloudTestFailure(error:unknown){
 const code=error instanceof MetaError&&Object.hasOwn(cloudTestFailures,error.code)?error.code:'whatsapp_test_failed';
 const message=error instanceof MetaError&&error.graphCode===190
  ?'Meta rejected the credential used for this check. Check the Staging test token and app authorization.'
  :cloudTestFailures[code]||'WhatsApp test verification could not finish. Try again or contact your FeedX administrator.';
 return {code,error:message};
}
async function call(db:any,name:string,args:any){const {data,error}=await db.rpc(name,args);if(error)throw new MetaError('whatsapp_authority_rejected');return data;}
export async function whatsappSignupHandler(path:string,body:any,caller:any,service:any,user:string,env:(n:string)=>string){
 const c:WhatsAppConfig={appId:env('MARKETING_META_APP_ID'),appSecret:env('MARKETING_META_APP_SECRET'),version:env('MARKETING_META_GRAPH_VERSION'),configId:env('MARKETING_WHATSAPP_SIGNUP_CONFIG_ID'),signupVersion:env('MARKETING_WHATSAPP_SIGNUP_VERSION'),enabled:env('MARKETING_WHATSAPP_ONBOARDING_ENABLED')==='true',callback:`${STAGING_SUPABASE}/functions/v1/marketing-inbox/webhook`};
 const ready=await call(caller,'marketing_whatsapp_readiness',{p_org:body.organizationId,p_brand:body.brandId||null,p_app:c.appId,p_config:c.configId,p_version:c.version,p_signup:c.signupVersion});
 const key=env('MARKETING_META_TOKEN_ENCRYPTION_KEY');
 const testBrand=env('MARKETING_WHATSAPP_TEST_BRAND_ID');
 const testToken=env('MARKETING_WHATSAPP_TEST_ACCESS_TOKEN');
 const cloudTestConfigured=env('SUPABASE_URL')===STAGING_SUPABASE&&c.appId===CLOUD_TEST_APP
  &&!!c.appSecret&&/^v\d+\.0$/.test(c.version)&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(testBrand)
  &&body.brandId===testBrand&&!!ready.can_configure&&!!testToken&&testToken.length<=16000&&await tokenEncryptionReady(key);
 if(path==='/whatsapp/bind-cloud-test'){
  if(!ready.can_configure||body.brandId!==testBrand)throw new MetaError('whatsapp_test_brand_denied');
  if(!cloudTestConfigured)throw new MetaError('whatsapp_test_config_missing');
  if(!Number.isSafeInteger(body.generation)||body.generation<0)throw new MetaError('whatsapp_test_generation_invalid');
  const graph=new MetaGraph({appId:c.appId,appSecret:c.appSecret,configId:c.configId,version:c.version});
  const evidence=await verifyWhatsAppCloudTest(graph,c,testToken);
  const sealed=await seal({token:testToken},key,connectionBinding({brand_id:testBrand,channel:'whatsapp',provider_account_id:CLOUD_TEST_PHONE}));
  return await call(service,'marketing_whatsapp_bind_cloud_test',{p_org:body.organizationId,p_brand:testBrand,p_auth_user:user,
   p_generation:body.generation,p_sealed:sealed,p_subject:evidence.subject,p_expiry:evidence.expiresAt});
 }
 const serverReady=configured(c)&&await tokenEncryptionReady(env('MARKETING_META_TOKEN_ENCRYPTION_KEY'));
 const eligible=ready.eligible&&serverReady&&c.enabled;
 if(path==='/whatsapp/readiness')return {...ready,cloud_test_configured:cloudTestConfigured,eligible,state:eligible?'eligible':'verification_required',reason:!serverReady?'server_configuration_required':!c.enabled?'pilot_activation_required':ready.reason,sending_enabled:false,ai_enabled:false};
 if(!eligible||!ready.can_configure)throw new MetaError('whatsapp_verification_required');
 const g=new MetaGraph({appId:c.appId,appSecret:c.appSecret,configId:c.configId,version:c.version});
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
  if(!a||a.mode!=='coexistence')throw new MetaError('whatsapp_signup_assets_mismatch');
  const token=await exchangeWhatsAppCode(g,c,body.code);
  const expected=await resolveWhatsAppSignupAssets(g,token,s,a);
  const evidence=await verifyWhatsAppAssets(g,c,token,expected);
  const sealed=await seal({token},key,connectionBinding({brand_id:s.brand_id,channel:'whatsapp',provider_account_id:expected.phone_id}));
  const bound=await call(service,'marketing_whatsapp_bind',{p_session:s.id,p_auth_user:user,p_sealed:sealed,p_evidence:evidence});
  material=await call(service,'marketing_meta_diagnostic_material',{p_connection:bound.connection_id,p_auth_user:user});credential={token};
 }else if(path==='/whatsapp/verify'){
  material=await call(service,'marketing_meta_diagnostic_material',{p_connection:body.connectionId,p_auth_user:user});
  if(material.brand_id!==body.brandId||material.organization_id!==body.organizationId||material.channel!=='whatsapp'||material.credential_generation!==body.generation)throw new MetaError('whatsapp_connection_changed');
  credential=await unseal(material.sealed_token,[key,env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],connectionBinding(material));
  const expected=await call(service,'marketing_whatsapp_verification_material',{p_connection:material.id,p_auth_user:user,p_generation:material.credential_generation});
  try{const evidence=await verifyWhatsAppAssets(g,c,credential.token,expected);await call(service,'marketing_whatsapp_record_verification',{p_connection:material.id,p_auth_user:user,p_generation:material.credential_generation,p_evidence:{...evidence,resume_receiving:body.resumeReceiving===true}});}
  catch(error){await call(service,'marketing_whatsapp_record_verification',{p_connection:material.id,p_auth_user:user,p_generation:material.credential_generation,p_evidence:{issue:error instanceof MetaError&&error.code==='coexistence_unsupported'?'coexistence_unsupported':'provider_verification_required'}});throw error;}
 }else throw new MetaError('whatsapp_endpoint_unavailable');
 const guard=async()=>{const m=await call(service,'marketing_whatsapp_verification_material',{p_connection:material.id,p_auth_user:user,p_generation:material.credential_generation});if(m.brand_id!==body.brandId)throw new MetaError('whatsapp_connection_changed');};
 const step=(name:string,outcome?:string,receipt?:string)=>call(service,'marketing_whatsapp_step',{p_connection:material.id,p_auth_user:user,p_generation:material.credential_generation,p_step:name,p_outcome:outcome??null,p_request_id:receipt??null});
 return {...await finishWhatsAppOnboarding(g,c,credential.token,material.whatsapp_waba_id,material.provider_account_id,step,guard),sending_enabled:false,ai_enabled:false};
}
