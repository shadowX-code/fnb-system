import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {operations,queryTool} from '../supabase/functions/native-assistant/business.js';
import {moduleCoverage} from './assistantBusinessMatrix.mjs';
import {adminModuleBinding,boundDomainFiles,readBindingSignature,registeredRouteBindings} from './assistantModuleSources.mjs';
import {systemGuidance} from '../supabase/functions/_shared/assistant/systemGuidance.js';
import {scenarios,assertScenarioContracts} from '../qa/staging/nativeAssistantCertification.mjs';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const serialize=value=>JSON.stringify(value,(_k,v)=>typeof v==='function'?v.toString():v);
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const domainFiles=walk('supabase/functions/_shared').filter(p=>/\/(people|factory|crew|finance|restaurant|marketing|assistant)\//.test(p)&&p.endsWith('.js'));
// Directory owners pass a fixed table into the shared loader. Include that
// declared authority so moving the query into a helper keeps its RLS drift gate.
const tokens=new Set(operations.flatMap(o=>[
 o.rpc,/^[a-z][a-z0-9_]+$/.test(o.moduleInterface?.authority||'')?o.moduleInterface.authority:null,
 ...[...(o.load||o.query||o.execute).toString().matchAll(/\.(?:rpc|from)\(['"]([^'"]+)['"]/g)].map(m=>m[1]),
]).filter(Boolean));
const consumers=[...walk('src/services'),...walk('supabase/migrations')].filter(p=>{
 if(!/\.(js|ts|sql)$/.test(p)||p.includes('__tests__'))return false;
 const source=fs.readFileSync(p,'utf8');
 return [...tokens].some(t=>source.includes(t));
});
const fixed=['supabase/functions/native-assistant/business.js','supabase/functions/native-assistant/businessQuery.js','supabase/functions/native-assistant/handler.js','supabase/functions/native-assistant/provider.js','supabase/functions/native-assistant/realtime.js','supabase/functions/native-assistant/context.js','src/features/ai-assistant/sdkVoiceHistory.js','src/features/company-users/pages/UsersPage.jsx','src/features/sales-purchase/pages/AssetTrackingPage.jsx','supabase/functions/_shared/completeRows.js','supabase/functions/_shared/hrWorkforceModel.js','src/features/sales-purchase/utils/analytics.js'];
for(const o of operations){
 if(!o.moduleInterface||o.moduleInterface.module_id!==o.module_id||o.moduleInterface.kind!==o.kind)throw Error(`Missing module interface: ${o.id}`);
 if(o.kind==='READ'&&(!o.moduleInterface.human_permission||!o.moduleInterface.source||!o.moduleInterface.exposure))throw Error(`Incomplete READ declaration: ${o.id}`);
 if(o.kind==='ACTION'&&!o.moduleInterface.execution_policy)throw Error(`Missing ACTION execution policy: ${o.id}`);
 const semantics=o.moduleInterface.semantics;
 if(semantics){
  if(!semantics.entities?.length||!semantics.time||!semantics.relationships?.length||!Object.keys(semantics.metrics||{}).length)
   throw Error(`Incomplete business semantics: ${o.id}`);
  for(const [name,metric] of Object.entries(semantics.metrics)){
   if(!metric.field||!metric.definition||Boolean(metric.unit)===Boolean(metric.unit_field))
    throw Error(`Missing metric evidence, definition or unit contract: ${o.id} / ${name}`);
  }
 }
 if(o.knowledge&&(o.kind!=='READ'||o.knowledge.type!=='managed_knowledge'||!o.knowledge.owner||!o.knowledge.authority||
  !o.knowledge.publication||!o.scope||!o.tool.parameters.properties.query||o.moduleInterface.knowledge?.retrieval!=='live_source'))
  throw Error(`Incomplete source authority or retrieval declaration: ${o.id}`);
}
const coverage=moduleCoverage();
assertScenarioContracts();
const bindings=new Map(coverage.map(row=>[row.module.id,adminModuleBinding(row.module)]));
const paritySources=new Set([...bindings.values()].flatMap(binding=>[...binding.via,...binding.owners]));
for(const {module,direct,shared,review} of coverage.filter(row=>row.review.certification)){
 const allowed=new Set([...direct,...shared].map(op=>op.id));
 if(!review.certification.length||!review.evidence?.length)throw Error(`Incomplete parity review: ${module.id}`);
 for(const id of review.certification){
  if(!scenarios[id]?.operations.some(operation=>allowed.has(operation)))throw Error(`Invalid parity certification: ${module.id} → ${id}`);
 }
 for(const source of review.evidence){
  if(!fs.existsSync(source))throw Error(`Unresolved parity source: ${module.id} → ${source}`);
  paritySources.add(source);
 }
}
const scenarioOperations=new Set(Object.values(scenarios).flatMap(scenario=>scenario.operations));
const certificationGaps=operations.filter(op=>op.kind==='READ'&&!scenarioOperations.has(op.id)).map(op=>op.id).sort();
if(certificationGaps.length)throw Error('Missing dedicated business-answer certification: '+certificationGaps.join(', '));
if(operations.some(o=>o.id===systemGuidance.id)||!coverage.some(({module})=>module.id===systemGuidance.module_id))
 throw Error('System guidance must remain attached to its canonical module and separate from business grants.');
// Presentation files may share large workspace wrappers. Trace their actual
// data bindings and service sources; a JSX label or class has no data authority.
const dataOwners=[...paritySources].filter(p=>p.endsWith('.jsx')).flatMap(boundDomainFiles);
const sourceHash=file=>file==='src/app/routes.jsx'?hash(serialize(registeredRouteBindings)):
 hash(file.endsWith('.jsx')?serialize(readBindingSignature(file)):fs.readFileSync(file));
const current={
 version:4,
 certification_gaps:certificationGaps,
 modules:Object.fromEntries(coverage.map(({module,direct,shared,actions,coverage,review})=>[module.id,hash(serialize({
  workspace:module.workspace,section:module.section,route:module.route,humanPermissions:module.permissions,routeBinding:bindings.get(module.id),coverage,review,
  reads:direct.map(op=>op.id),shared:shared.map(op=>op.id),actions:actions.map(op=>op.id),
  scenarios:Object.entries(scenarios).filter(([,scenario])=>scenario.operations.some(id=>[...direct,...shared].some(op=>op.id===id))),
 }))])),
 operations:Object.fromEntries(operations.map(o=>[o.id,hash(serialize({interface:o.moduleInterface,tool:queryTool(o),discovery:o.discoveryPhrases,discoveryFamily:o.discoveryFamily,intent:o.queryIntent,prepare:o.prepareArguments,textScope:o.scopeTextArguments,load:o.load,query:o.query,rpc:o.rpc,arguments:o.arguments,project:o.project,check:o.check,normalize:o.normalizeArguments,policyGroup:o.policyGroup,execute:o.execute,authorize:o.authorized}))])),
 sources:Object.fromEntries([...new Set([...domainFiles,...consumers,...fixed,...paritySources,...dataOwners,
  'src/app/routeOwnership.js','src/app/routes.jsx','scripts/assistantModuleSources.mjs',
  ...walk('qa/staging').filter(p=>/nativeAssistant(?:OperationalCases|RegisterCertification|OperationalCertification|Certification)\.mjs$/.test(p))])].sort().map(p=>[p,sourceHash(p)])),
};
const file='docs/testing/native-assistant-interface-baseline.json';
const baseline=JSON.parse(fs.readFileSync(file,'utf8'));
if(process.argv.includes('--record-reviewed')){
 fs.writeFileSync(file,JSON.stringify(current,null,2)+'\n');
 console.log(`Recorded reviewed interfaces: ${operations.length}; dependencies: ${Object.keys(current.sources).length}`);
}
else {
 const changes=['modules','operations','sources'].flatMap(group=>[...new Set([...Object.keys(current[group]),...Object.keys(baseline[group]||{})])].filter(key=>current[group][key]!==baseline[group]?.[key]).map(key=>`${group}: ${key}`));
 if(current.version!==baseline.version)changes.push('Baseline format changed');
 if(serialize(certificationGaps)!==serialize(baseline.certification_gaps))changes.push('READ certification scenario coverage');
 if(changes.length){console.error('Assistant contract alignment review required. Verify semantics, permissions, exposure, completeness and compatibility before recording a new baseline.\n'+changes.join('\n'));process.exitCode=1;}
 else console.log(`Assistant interface alignment verified: ${operations.length} contracts across ${coverage.length} modules.`);
}
