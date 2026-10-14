import {test} from 'node:test';
import assert from 'node:assert/strict';
import {marketingEnvironment,metaEnvironmentMatches,serverEnvironment} from '../../supabase/functions/_shared/marketingEnvironment.mjs';
const staging='https://ujkzdaaadnvcfayuldmh.supabase.co', production='https://oyfobxdoyfuzsodogpgs.supabase.co';
for(const [url,name,origin,app,login] of [[staging,'staging','https://fnb-system-staging.vercel.app','2204918033458414','1398015649111006'],[production,'production','https://os.feedx.my','2182829996001809','2027095767950085']]){
 test(name+' has consistent OAuth, webhook, Drive and privacy project routing',()=>{
  const p=marketingEnvironment(url,name);assert.equal(p.origin,origin);assert.equal(p.projectRef,new URL(url).hostname.split('.')[0]);
  assert.equal(p.metaRedirect,url+'/functions/v1/marketing-meta/callback');assert.equal(p.webhook,url+'/functions/v1/marketing-inbox/webhook');assert.equal(p.driveRedirect,url+'/functions/v1/marketing-drive/callback');assert.equal(metaEnvironmentMatches(p,app,login),true);
 });
 test(name+' rejects the other environment credentials',()=>{const p=marketingEnvironment(url);assert.equal(metaEnvironmentMatches(p,app==='2182829996001809'?'2204918033458414':'2182829996001809',login),false);assert.equal(metaEnvironmentMatches(p,app,login==='2027095767950085'?'1398015649111006':'2027095767950085'),false)});
}
test('unknown, malformed and mismatched projects fail closed',()=>{
 for(const u of ['',production+'/',production+'/attacker','http://oyfobxdoyfuzsodogpgs.supabase.co','https://attacker.invalid'])assert.equal(marketingEnvironment(u),null);
 assert.equal(marketingEnvironment(production,'staging'),null);assert.equal(serverEnvironment(()=>''),null);assert.equal(metaEnvironmentMatches(null,'',''),false);
});
