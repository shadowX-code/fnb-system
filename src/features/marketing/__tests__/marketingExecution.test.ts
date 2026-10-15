import {describe,it,expect} from 'vitest';
import {publishingConfigured,publishingAccountAllowed,productionPublishingPolicy,staffReplyConfigured,staffReplyAllowed,metaOAuthScopes} from '../../../../supabase/functions/_shared/marketingExecution.mjs';
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
 it('permits ordinary conversation peers only behind the independent staff gate',()=>{
  const values={...prod,MARKETING_INBOX_STAFF_REPLY_ENABLED:'true',MARKETING_INBOX_REPLY_MODE:'normal'};
  expect(staffReplyAllowed('999','444',reader(values))).toBe(true);
  for(const peer of ['',null,'*','not-an-id'])expect(staffReplyAllowed('999',peer,reader(values))).toBe(false);
  expect(staffReplyAllowed('999','444',reader({...values,MARKETING_INBOX_STAFF_REPLY_ENABLED:'false'}))).toBe(false);
  expect(publishingConfigured(reader(values))).toBe(false);
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
