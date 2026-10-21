import {it,expect} from 'vitest';
import {signupAssets,signupOptions,whatsappStateLabels} from '../whatsappSignup.js';
const event=(p,origin='https://www.facebook.com')=>({origin,data:JSON.stringify(p)});
const v4={type:'WA_EMBEDDED_SIGNUP',event:'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',data:{waba_id:'200'}};
it('uses dedicated coexistence config and code flow',()=>{expect(signupOptions({configId:'100',signupVersion:'v4'})).toMatchObject({response_type:'code',extras:{featureType:'whatsapp_business_app_onboarding'}});expect(signupOptions({configId:'100',signupVersion:'v5'}).extras).toEqual({version:'v5'});});
it('rejects origin suffix attacks, ordinary cloud finish, malformed IDs and multi-account v5',()=>{
 expect(signupAssets(event(v4,'https://evilfacebook.com'),'v4')).toBeNull();expect(signupAssets(event({...v4,event:'FINISH'}),'v4')).toBeNull();
 expect(signupAssets(event({...v4,data:{waba_id:200}}),'v4')).toBeNull();expect(signupAssets(event(v4),'v4')).toEqual({waba_id:'200',phone_id:undefined,business_id:undefined,mode:'coexistence'});
 expect(signupAssets(event({type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{is_on_biz_app:true,messaging_account_ids:['200','300'],phone_number_id:'201',business_id:'202'}}),'v5')).toBeNull();
});
it('normalizes official v5 messaging account and explicit business-app finish',()=>{expect(signupAssets(event({type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{is_on_biz_app:true,messaging_account_ids:['200'],phone_number_id:'201',business_id:'202'}}),'v5')).toEqual({waba_id:'200',phone_id:'201',business_id:'202',mode:'coexistence'});expect(Object.values(whatsappStateLabels)).toEqual(['Not Connected','Verification Required','Eligible','Connected','Action Required','Unsupported']);});

it('pairs SDK code and trusted completion in either arrival order and aborts stale flows',async()=>{
 const {loadWhatsAppSDK,launchWhatsAppSignup}=await import('../whatsappSignup.js');
 const config={appId:'100',configId:'101',graphVersion:'v25.0',signupVersion:'v4'};
 let callback;window.FB={init:()=>{},login:cb=>{callback=cb}};await loadWhatsAppSDK(config);
 const emit=()=>window.dispatchEvent(new MessageEvent('message',event(v4)));
 let pending=launchWhatsAppSignup(config);emit();callback({authResponse:{code:'fixture-one'}});expect(await pending).toMatchObject({code:'fixture-one',assets:{waba_id:'200'}});
 pending=launchWhatsAppSignup(config);callback({authResponse:{code:'fixture-two'}});emit();expect(await pending).toMatchObject({code:'fixture-two'});
 const controller=new AbortController();pending=launchWhatsAppSignup(config,{signal:controller.signal});const rejected=expect(pending).rejects.toThrow('cancelled');controller.abort();await rejected;callback({authResponse:{code:'stale'}});emit();
 pending=launchWhatsAppSignup(config);const cancelled=expect(pending).rejects.toThrow('cancelled');window.dispatchEvent(new MessageEvent('message',event({type:'WA_EMBEDDED_SIGNUP',event:'CANCEL'})));await cancelled;
});
