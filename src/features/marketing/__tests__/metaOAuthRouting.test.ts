import {describe,it,expect} from 'vitest';
import {metaOAuthRoute,metaOAuthRoutes} from '../../../../supabase/functions/_shared/metaOAuthRouting.mjs';
const prod={SUPABASE_URL:'https://oyfobxdoyfuzsodogpgs.supabase.co',MARKETING_ENVIRONMENT:'production',MARKETING_META_APP_ID:'2182829996001809',MARKETING_META_LOGIN_CONFIG_ID:'2027095767950085'};
const messaging={MARKETING_META_OAUTH_INBOX_ENABLED:'true',MARKETING_META_OAUTH_PUBLISHING_ENABLED:'true',MARKETING_META_MESSAGING_LOGIN_CONFIG_ID:'2180882642780186'};
const get=(values:Record<string,string>)=>(key:string)=>values[key];
describe('server-owned purpose-specific Meta OAuth configuration',()=>{
 it('preserves Publishing routing even when Messaging is enabled',()=>{
  for(const values of [prod,{...prod,...messaging}])expect(metaOAuthRoute('publishing',get(values))).toEqual({purpose:'publishing',configId:'2027095767950085'});
  expect(metaOAuthRoute('messaging',get({...prod,...messaging}))).toEqual({purpose:'messaging',configId:'2180882642780186'});
 });
 it('fails closed without both explicit scope opt-ins and exact Messaging config',()=>{
  expect(metaOAuthRoutes(get(prod)).messaging.available).toBe(false);
  for(const key of Object.keys(messaging))expect(metaOAuthRoute('messaging',get({...prod,...messaging,[key]:''}))).toBeNull();
  for(const id of ['1398015649111006','2027095767950085','999'])expect(metaOAuthRoute('messaging',get({...prod,...messaging,MARKETING_META_MESSAGING_LOGIN_CONFIG_ID:id}))).toBeNull();
 });
 it('rejects client config IDs, unknown purposes and cross-environment manifests',()=>{
  for(const purpose of ['2180882642780186','ads','',{},null])expect(metaOAuthRoute(purpose,get({...prod,...messaging}))).toBeNull();
  for(const values of [{...prod,MARKETING_META_APP_ID:'2204918033458414'},{...prod,MARKETING_META_LOGIN_CONFIG_ID:'2180882642780186'},{...prod,MARKETING_ENVIRONMENT:'staging'},{...prod,SUPABASE_URL:'https://other.supabase.co'}])expect(metaOAuthRoute('publishing',get(values))).toBeNull();
 });
 it('preserves the existing Staging configuration for both purposes',()=>{
  const values={SUPABASE_URL:'https://ujkzdaaadnvcfayuldmh.supabase.co',MARKETING_ENVIRONMENT:'staging',MARKETING_META_APP_ID:'2204918033458414',MARKETING_META_LOGIN_CONFIG_ID:'1398015649111006',...messaging};
  for(const purpose of ['publishing','messaging'])expect(metaOAuthRoute(purpose,get(values)).configId).toBe('1398015649111006');
 });
});
