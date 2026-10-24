import {describe,it,expect} from 'vitest';
import {facebookReceiptRecoveryAllowed,instagramExtendedConfigured,facebookVideoConfigured,publishingConfigured,publishingAccountAllowed,productionPublishingPolicy,staffReplyConfigured,staffReplyAllowed,metaOAuthScopes} from '../../../../supabase/functions/_shared/marketingExecution.mjs';
const prod={SUPABASE_URL:'https://oyfobxdoyfuzsodogpgs.supabase.co',MARKETING_ENVIRONMENT:'production',MARKETING_META_APP_ID:'2182829996001809',MARKETING_META_LOGIN_CONFIG_ID:'2027095767950085'};
const staging={SUPABASE_URL:'https://ujkzdaaadnvcfayuldmh.supabase.co',MARKETING_ENVIRONMENT:'staging',MARKETING_META_APP_ID:'2204918033458414',MARKETING_META_LOGIN_CONFIG_ID:'1398015649111006'};
const connection={channel:'facebook',provider_account_id:'111',credential_generation:1,status:'test_authorized'};
const reader=(values:any)=>(key:string)=>values[key];
const publishing={MARKETING_META_PUBLISHING_ENABLED:'true',MARKETING_META_PUBLISH_ACCOUNT_IDS:'111,222'};
const replies={MARKETING_INBOX_STAFF_REPLY_ENABLED:'true',MARKETING_INBOX_REPLY_ACCOUNT_IDS:'111,222',MARKETING_INBOX_REPLY_PEER_IDS:'333'};
describe('environment-bound execution gates',()=>{
 it('fails closed by default and ignores copied Staging execution flags in Production',()=>{
  const get=reader({...prod,MARKETING_META_TEST_ACCOUNT_IDS:'111',MARKETING_INBOX_SEND_ENABLED:'true',MARKETING_INBOX_TEST_PEER_IDS:'333'});
  expect(publishingConfigured(get)).toBe(false);expect(publishingAccountAllowed(connection,get)).toBe(false);
  expect(staffReplyConfigured(get)).toBe(false);expect(staffReplyAllowed('111','333',get)).toBe(false);
  expect(productionPublishingPolicy(connection,true,get)).toBe(false);
 });
 it('requires the exact environment, App and Login Configuration even with enabled flags',()=>{
  for(const wrong of [{SUPABASE_URL:'https://other.supabase.co'},{MARKETING_ENVIRONMENT:'staging'},{MARKETING_META_APP_ID:staging.MARKETING_META_APP_ID},{MARKETING_META_LOGIN_CONFIG_ID:staging.MARKETING_META_LOGIN_CONFIG_ID},{MARKETING_META_APP_ID:''}]){
   const get=reader({...prod,...publishing,...replies,...wrong});
   expect(publishingConfigured(get)).toBe(false);expect(staffReplyAllowed('111','333',get)).toBe(false);
  }
 });
 it.each(['false','TRUE','1',''])('does not accept publishing flag %s',flag=>{
  expect(publishingConfigured(reader({...prod,...publishing,MARKETING_META_PUBLISHING_ENABLED:flag}))).toBe(false);
 });
 it('limits publishing to valid channel, exact account, current generation and authorized status',()=>{
  const get=reader({...prod,...publishing});expect(publishingAccountAllowed(connection,get)).toBe(true);
  expect(publishingAccountAllowed({...connection,channel:'instagram',provider_account_id:'222',status:'production_authorized'},get)).toBe(true);
  for(const wrong of [{channel:'ad_account'},{provider_account_id:'11'},{credential_generation:0},{credential_generation:'1'},{status:'disconnected'}])expect(publishingAccountAllowed({...connection,...wrong},get)).toBe(false);
  expect(productionPublishingPolicy(connection,false,get)).toBe(false);
 });
 it.each(['','111,','111,invalid','111,*','1'.repeat(31),Array(51).fill('111').join(',')])('rejects invalid publishing allowlist %s',value=>{
  expect(publishingConfigured(reader({...prod,...publishing,MARKETING_META_PUBLISH_ACCOUNT_IDS:value}))).toBe(false);
 });
 it('keeps publishing and staff reply authority independent and requires both reply allowlists',()=>{
  const get=reader({...prod,...replies});expect(staffReplyAllowed('111','333',get)).toBe(true);
  expect(publishingAccountAllowed(connection,get)).toBe(false);
  expect(staffReplyAllowed('444','333',get)).toBe(false);expect(staffReplyAllowed('111','444',get)).toBe(false);
  expect(staffReplyAllowed('111','333',reader({...prod,...replies,MARKETING_INBOX_REPLY_PEER_IDS:''}))).toBe(false);
  expect(staffReplyAllowed('111','333',reader({...prod,...publishing}))).toBe(false);
 });
 it('preserves existing Staging test account and test peer restrictions',()=>{
  const get=reader({...staging,MARKETING_META_TEST_ACCOUNT_IDS:'111',MARKETING_INBOX_SEND_ENABLED:'true',MARKETING_INBOX_TEST_PEER_IDS:'333',...publishing,...replies});
  expect(publishingAccountAllowed(connection,get)).toBe(true);expect(publishingAccountAllowed({...connection,status:'production_authorized'},get)).toBe(false);
  expect(staffReplyAllowed('622626120924115','333',get)).toBe(true);expect(staffReplyAllowed('111','333',get)).toBe(false);
  expect(productionPublishingPolicy(connection,true,get)).toBeNull();
 });
 it('never expands OAuth scopes from execution flags; each permission request needs its own opt-in',()=>{
  const base=['pages_show_list','instagram_basic','read_insights','ads_read'];
  expect(metaOAuthScopes(base,reader({...prod,...publishing,...replies}))).toEqual(base);
  expect(metaOAuthScopes(base,reader({...prod,MARKETING_META_OAUTH_PUBLISHING_ENABLED:'true'}))).toEqual([...base,'pages_manage_posts','instagram_content_publish']);
  expect(metaOAuthScopes(base,reader({...prod,MARKETING_META_OAUTH_INBOX_ENABLED:'true'}))).toEqual([...base,'pages_manage_metadata','pages_messaging','instagram_manage_messages']);
  expect(metaOAuthScopes(base,reader({...staging,MARKETING_META_OAUTH_INBOX_ENABLED:'true'}))).toEqual(base);
 });
});

describe('normal Production operation after controlled acceptance',()=>{
 it('permits verified bound publishing accounts without per-operation allowlist changes',()=>{
  const get=reader({...prod,MARKETING_META_PUBLISHING_ENABLED:'true',MARKETING_META_PUBLISHING_MODE:'normal'});
  expect(publishingConfigured(get)).toBe(true);
  expect(productionPublishingPolicy({...connection,provider_account_id:'999'},true,get)).toBe(true);
  expect(productionPublishingPolicy(connection,false,get)).toBe(false);
  for(const wrong of [{status:'disconnected'},{channel:'ad_account'},{credential_generation:0},{provider_account_id:'*'}])expect(publishingAccountAllowed({...connection,...wrong},get)).toBe(false);
  expect(staffReplyConfigured(get)).toBe(false);
 });
 it('normal mode relies on canonical authority without mandatory operator allowlists',()=>{
  const values={...prod,MARKETING_INBOX_STAFF_REPLY_ENABLED:'true',MARKETING_INBOX_REPLY_MODE:'normal'};
  expect(staffReplyConfigured(reader(values))).toBe(true);
  for(const account of ['622626120924115','17841473217923034','999']) {
   for(const peer of ['444','555'])expect(staffReplyAllowed(account,peer,reader(values))).toBe(true);
   for(const peer of ['',null,'*','not-an-id'])expect(staffReplyAllowed(account,peer,reader(values))).toBe(false);
   expect(staffReplyAllowed(account,'444',reader({...values,MARKETING_INBOX_STAFF_REPLY_ENABLED:'false'}))).toBe(false);
  }
  for(const account of ['',null,'*','invalid'])expect(staffReplyAllowed(account,'444',reader(values))).toBe(false);
  expect(publishingConfigured(reader(values))).toBe(false);
 });
 it('honors independent optional emergency account and peer restrictions in normal mode',()=>{
  const values={...prod,MARKETING_INBOX_STAFF_REPLY_ENABLED:'true',MARKETING_INBOX_REPLY_MODE:'normal'};
  const accounts=reader({...values,MARKETING_INBOX_REPLY_ACCOUNT_IDS:'111,222'});
  expect(staffReplyAllowed('111','444',accounts)).toBe(true);expect(staffReplyAllowed('999','444',accounts)).toBe(false);
  const peers=reader({...values,MARKETING_INBOX_REPLY_PEER_IDS:'333'});
  expect(staffReplyAllowed('999','333',peers)).toBe(true);expect(staffReplyAllowed('999','444',peers)).toBe(false);
  const both=reader({...values,MARKETING_INBOX_REPLY_ACCOUNT_IDS:'111',MARKETING_INBOX_REPLY_PEER_IDS:'333'});
  expect(staffReplyAllowed('111','333',both)).toBe(true);expect(staffReplyAllowed('999','333',both)).toBe(false);expect(staffReplyAllowed('111','444',both)).toBe(false);
  expect(staffReplyAllowed('999','444',reader({...values,MARKETING_INBOX_REPLY_ACCOUNT_IDS:'',MARKETING_INBOX_REPLY_PEER_IDS:''}))).toBe(true);
 });
 it.each(['111,','111,invalid','111,*','1'.repeat(31),Array(51).fill('111').join(',')])('fails closed for malformed configured restrictions in both reply modes: %s',value=>{
  for(const replyMode of ['controlled','normal'])for(const key of ['MARKETING_INBOX_REPLY_ACCOUNT_IDS','MARKETING_INBOX_REPLY_PEER_IDS']) {
   const get=reader({...prod,...replies,MARKETING_INBOX_REPLY_MODE:replyMode,[key]:value});
   expect(staffReplyConfigured(get)).toBe(false);expect(staffReplyAllowed('111','333',get)).toBe(false);
  }
 });
 it.each(['',undefined])('controlled mode still requires both explicit lists: %s',value=>{
  for(const key of ['MARKETING_INBOX_REPLY_ACCOUNT_IDS','MARKETING_INBOX_REPLY_PEER_IDS']) {
   const get=reader({...prod,...replies,[key]:value});expect(staffReplyConfigured(get)).toBe(false);expect(staffReplyAllowed('111','333',get)).toBe(false);
  }
 });
 it('fails closed for unknown modes, disabled flags and environment mismatch',()=>{
  for(const value of ['NORMAL','all','*']){
   const get=reader({...prod,...publishing,...replies,MARKETING_META_PUBLISHING_MODE:value,MARKETING_INBOX_REPLY_MODE:value});
   expect(publishingConfigured(get)).toBe(false);expect(staffReplyConfigured(get)).toBe(false);
  }
  const normal={MARKETING_META_PUBLISHING_MODE:'normal',MARKETING_INBOX_REPLY_MODE:'normal'};
  expect(publishingConfigured(reader({...prod,...normal}))).toBe(false);expect(staffReplyConfigured(reader({...prod,...normal}))).toBe(false);
  const wrong=reader({...prod,...publishing,...replies,...normal,MARKETING_META_APP_ID:staging.MARKETING_META_APP_ID});
  expect(publishingConfigured(wrong)).toBe(false);expect(staffReplyConfigured(wrong)).toBe(false);
 });
 it('does not relax Staging or expand OAuth when normal modes are copied',()=>{
  const get=reader({...staging,MARKETING_META_PUBLISHING_MODE:'normal',MARKETING_INBOX_REPLY_MODE:'normal',...publishing,...replies});
  expect(publishingConfigured(get)).toBe(false);expect(staffReplyConfigured(get)).toBe(false);
  expect(metaOAuthScopes(['read_insights'],reader({...prod,...publishing,...replies,MARKETING_META_PUBLISHING_MODE:'normal',MARKETING_INBOX_REPLY_MODE:'normal'}))).toEqual(['read_insights']);
 });
});

it('requires a separate exact video opt-in even when existing Production publishing is active',()=>{expect(facebookVideoConfigured(reader({...prod,...publishing}))).toBe(false);expect(facebookVideoConfigured(reader({...prod,...publishing,MARKETING_META_FACEBOOK_VIDEO_ENABLED:'true'}))).toBe(true);expect(facebookVideoConfigured(reader({...prod,MARKETING_META_FACEBOOK_VIDEO_ENABLED:'TRUE'}))).toBe(false);expect(facebookVideoConfigured(reader({MARKETING_META_FACEBOOK_VIDEO_ENABLED:'true'}))).toBe(false);});

it('keeps extended Instagram execution independently disabled until its exact opt-in',()=>{expect(instagramExtendedConfigured(reader({...prod,...publishing}))).toBe(false);expect(instagramExtendedConfigured(reader({...prod,...publishing,MARKETING_META_INSTAGRAM_EXTENDED_ENABLED:'true'}))).toBe(true);expect(instagramExtendedConfigured(reader({...prod,SUPABASE_URL:'wrong',MARKETING_META_INSTAGRAM_EXTENDED_ENABLED:'true'}))).toBe(false);});

describe('job-specific read-only Facebook receipt recovery permit',()=>{
 const now=Date.parse('2026-10-24T02:00:00Z');
 const job={id:'job',connection_id:'connection',connection_generation:3,channel:'facebook',state:'reconciling',provider_state:{objects:{fb_video:'1830341231428452'}}};
 const permit={job_id:'job',connection_id:'connection',generation:3,video_id:'1830341231428452',post_id:'622626120924115_122185805978804842',issued_at:new Date(now).toISOString(),expires_at:new Date(now+300000).toISOString()};
 const get=(patch:any={})=>reader({...prod,MARKETING_META_FACEBOOK_RECEIPT_RECOVERY:JSON.stringify({...permit,...patch})});
 it('is absent by default and never enables publishing or video execution',()=>{
  expect(facebookReceiptRecoveryAllowed(job,reader(prod),now)).toBe(false);
  expect(facebookReceiptRecoveryAllowed(job,get(),now)).toBe(true);
  expect(publishingConfigured(get())).toBe(false);expect(facebookVideoConfigured(get())).toBe(false);
 });
 it.each([{job_id:'other'},{connection_id:'other'},{generation:2},{generation:'3'},{video_id:'999'},{post_id:'not-a-post'},{issued_at:'invalid'},{expires_at:'invalid'},{expires_at:new Date(now+300001).toISOString()},{expires_at:new Date(now).toISOString()}])('fails closed on mismatched or invalid authorization %j',patch=>{
  expect(facebookReceiptRecoveryAllowed(job,get(patch),now)).toBe(false);
 });
 it('binds the actual returned Post identity before receipt persistence',()=>{
  expect(facebookReceiptRecoveryAllowed(job,get(),now,permit.post_id)).toBe(true);
  expect(facebookReceiptRecoveryAllowed(job,get(),now,'622626120924115_999')).toBe(false);
 });
 it('expires server-side at five minutes and allows immediate revocation',()=>{
  expect(facebookReceiptRecoveryAllowed(job,get(),now-1)).toBe(false);expect(facebookReceiptRecoveryAllowed(job,get(),now+299999)).toBe(true);expect(facebookReceiptRecoveryAllowed(job,get(),now+300000)).toBe(false);
  expect(facebookReceiptRecoveryAllowed(job,reader(prod),now+1)).toBe(false);
 });
 it('cannot authorize another state, channel, generation or environment',()=>{
  for(const patch of [{state:'running'},{channel:'instagram'},{connection_generation:4}])expect(facebookReceiptRecoveryAllowed({...job,...patch},get(),now)).toBe(false);
  expect(facebookReceiptRecoveryAllowed(job,reader({MARKETING_META_FACEBOOK_RECEIPT_RECOVERY:JSON.stringify(permit)}),now)).toBe(false);
 });
 it.each(['{','null','[]','true','x'.repeat(1025)])('rejects malformed permit %s',raw=>{
  expect(facebookReceiptRecoveryAllowed(job,reader({...prod,MARKETING_META_FACEBOOK_RECEIPT_RECOVERY:raw}),now)).toBe(false);
 });
});
