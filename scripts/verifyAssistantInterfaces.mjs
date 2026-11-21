import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {operations} from '../supabase/functions/native-assistant/business.js';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const serialize=value=>JSON.stringify(value,(_k,v)=>typeof v==='function'?v.toString():v);
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const domainFiles=walk('supabase/functions/_shared').filter(p=>/\/(people|factory|crew|finance|restaurant|marketing|assistant)\//.test(p)&&p.endsWith('.js'));
const tokens=new Set(operations.flatMap(o=>[o.rpc,...[...(o.load||o.query||o.execute).toString().matchAll(/\.(?:rpc|from)\(['"]([^'"]+)['"]/g)].map(m=>m[1])]).filter(Boolean));
const consumers=[...walk('src/services'),...walk('supabase/migrations')].filter(p=>/\.(js|ts|sql)$/.test(p)&&!p.includes('__tests__')&&[...tokens].some(t=>fs.readFileSync(p,'utf8').includes(t)));
const fixed=['supabase/functions/native-assistant/business.js','supabase/functions/native-assistant/handler.js','supabase/functions/native-assistant/provider.js','supabase/functions/native-assistant/realtime.js','src/features/ai-assistant/sdkVoiceHistory.js','src/features/company-users/pages/UsersPage.jsx','src/features/sales-purchase/pages/AssetTrackingPage.jsx','supabase/functions/_shared/completeRows.js','supabase/functions/_shared/hrWorkforceModel.js','src/features/sales-purchase/utils/analytics.js'];
for(const o of operations){
 if(!o.moduleInterface||o.moduleInterface.module_id!==o.module_id||o.moduleInterface.kind!==o.kind)throw Error(`Missing module interface: ${o.id}`);
 if(o.kind==='READ'&&(!o.moduleInterface.human_permission||!o.moduleInterface.source||!o.moduleInterface.exposure))throw Error(`Incomplete READ declaration: ${o.id}`);
 if(o.kind==='ACTION'&&!o.moduleInterface.execution_policy)throw Error(`Missing ACTION execution policy: ${o.id}`);
}
const current={version:1,operations:Object.fromEntries(operations.map(o=>[o.id,hash(serialize({interface:o.moduleInterface,tool:o.tool,discovery:o.discoveryPhrases,discoveryFamily:o.discoveryFamily,load:o.load,query:o.query,rpc:o.rpc,arguments:o.arguments,project:o.project,check:o.check,normalize:o.normalizeArguments,policyGroup:o.policyGroup,execute:o.execute,authorize:o.authorized}))])),sources:Object.fromEntries([...new Set([...domainFiles,...consumers,...fixed])].sort().map(p=>[p,hash(fs.readFileSync(p))]))};
const file='docs/testing/native-assistant-interface-baseline.json';
if(process.argv.includes('--record-reviewed')){fs.writeFileSync(file,JSON.stringify(current,null,2)+'\n');console.log(`Recorded reviewed interfaces: ${operations.length}; dependencies: ${Object.keys(current.sources).length}`);}
else {
 const baseline=JSON.parse(fs.readFileSync(file,'utf8'));
 const changes=['operations','sources'].flatMap(group=>[...new Set([...Object.keys(current[group]),...Object.keys(baseline[group])])].filter(key=>current[group][key]!==baseline[group][key]).map(key=>`${group}: ${key}`));
 if(changes.length){console.error('Assistant contract alignment review required. Verify semantics, permissions, exposure, completeness and compatibility before recording a new baseline.\n'+changes.join('\n'));process.exitCode=1;}
 else console.log(`Assistant interface alignment verified: ${operations.length} contracts.`);
}
