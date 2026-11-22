// Emit the acceptance matrix from the same definitions exercised by the build.
// Live results are recorded separately because they depend on environment and actor.
import {operations} from '../supabase/functions/native-assistant/business.js';
import {businessSemanticEntry} from '../supabase/functions/_shared/assistant/moduleInterface.js';
import {systemGuidance} from '../supabase/functions/_shared/assistant/systemGuidance.js';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {reconcileBusinessModules} from '../src/features/integrations/businessModuleProjection.js';
import {assistantCoverageReview} from '../src/features/integrations/assistantCoverageReview.js';
import {canonicalPathForRoute,resolveCanonicalPath} from '../src/app/routeOwnership.js';
import {scenarios} from '../qa/staging/nativeAssistantCertification.mjs';
import {adminModuleSource} from './assistantModuleSources.mjs';

const cell=value=>String(value ?? '').replaceAll('|','\\|').replace(/\s+/g,' ').trim();
const code=name=>'\x60'+name+'\x60';
const modulePath=module=>canonicalPathForRoute(module.id)||(module.route&&resolveCanonicalPath(module.route)?module.route:null);
const reads=operations.filter(operation=>operation.kind==='READ');
const reviewed=readFileSync(new URL('../docs/audits/native-assistant-gap-closure.md',import.meta.url),'utf8');
const reviewedModules=new Map(reviewed.split('\n').flatMap(line=>{
 const [,id,status,,limitation]=line.split('|').map(value=>value.trim());
 return /^(partial|shared|full|blocked|missing|not_applicable)$/.test(status)?[[id,{classification:status,missing:limitation}]]:[];
}));

export function moduleCoverage(){
 const {business}=reconcileBusinessModules();
 const ids=new Set(business.map(module=>module.id));
 assert.equal(ids.size,business.length,'Duplicate canonical module identity');
 for(const op of operations){
  assert(ids.has(op.module_id),`Unknown capability owner: ${op.id} → ${op.module_id}`);
  for(const id of op.related_module_ids||[])assert(ids.has(id)&&id!==op.module_id,`Invalid shared module: ${op.id} → ${id}`);
 }
 return business.map(module=>{
  const review=assistantCoverageReview[module.id]||reviewedModules.get(module.id);
  assert(review,`Missing reviewed AI coverage declaration for ${module.id}`);
  const direct=reads.filter(op=>op.module_id===module.id);
  const shared=reads.filter(op=>op.related_module_ids?.includes(module.id));
  const actions=operations.filter(op=>op.kind==='ACTION'&&op.module_id===module.id);
  const coverage=direct.length?'partial':shared.length?'shared':review.classification==='not_applicable'?'not_applicable':'blocked';
  const fallback=/^Only listed operations/.test(review.missing||'');
  const available=[...direct,...shared];
  const boundary=fallback&&available.length?available.map(op=>op.scope+' '+op.moduleInterface.pagination).join(' '):review.missing||review.available;
  assert(boundary,`Missing source or authority boundary for ${module.id}`);
  return {module,direct,shared,actions,coverage,boundary,review,adminSource:adminModuleSource(module)};
 });
}

export function semanticCatalog(){
 const modules=moduleCoverage().map(({module,direct,shared,actions,coverage,boundary,adminSource})=>({
  module:module.id,workspace:module.workspace,domain:module.section,route:modulePath(module),
  coverage,boundary,admin_source:adminSource,reads:direct.map(op=>op.id),shared_reads:shared.map(op=>op.id),actions:actions.map(op=>op.id),
 }));
 return {version:1,modules,operations:[...operations,systemGuidance].map(businessSemanticEntry)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
if(process.argv[2]==='--catalog'){
 console.log(JSON.stringify(semanticCatalog(),null,2));
}else{
const run=process.argv[2]?JSON.parse(readFileSync(process.argv[2],'utf8')):null;
const modules=moduleCoverage();
const counts=Object.groupBy(modules,row=>row.coverage);
const enabled=new Set(run?.enabled||[]);
console.log(`# FeedX Native Assistant business acceptance matrix

Generated from the canonical module projection, module-owned operations and reviewed coverage annotations. ${modules.length} modules include Space Station, a virtual navigation workspace with no independent business authority. There are ${reads.length} READ contracts and ${operations.length-reads.length} separately authorized ACTION contracts.

${Object.keys(scenarios).length} source-to-answer scenarios reference the registered operations. Each READ below lists its real certification question and case IDs. Individual module rows identify the owning Admin surface and scope boundary. PASS on those tests covers discovery, schema, policy, invalid arguments and human denial under fixtures. An authenticated answer requires an independent source comparison with \`npm run qa:staging:assistant-certify\`. A disabled capability, missing account or unexecuted scenario is BLOCKED. Undeclared query dimensions are UNSUPPORTED. Each module's settings are independent of this coverage inventory.

Coverage: ${Object.entries(counts).map(([key,rows])=>rows.length+' '+key).join(', ')}.${run?` Staging policy snapshot (${run.as_of}): ${reads.filter(op=>enabled.has(op.id)).length} enabled READs and ${reads.filter(op=>!enabled.has(op.id)).length} disabled READs.`:' Runtime policy is omitted when no Staging snapshot is supplied.'}

## Module coverage

| Workspace / domain / module | Module route | Coverage | Native READ owners and shared READs | Staging READ policy | ACTIONs | Canonical evidence and remaining boundary |
|---|---|---|---|---|---|---|`);
for(const row of modules){
 const direct=row.direct.map(op=>code(op.id));
 const shared=row.shared.map(op=>`${code(op.id)} via ${op.module_id}`);
 const available=[...row.direct,...row.shared];
 const policy=available.length===0?'No READ':run?`${available.filter(op=>enabled.has(op.id)).length}/${available.length} enabled`:'Snapshot unavailable';
 const references=[...new Set([row.adminSource,...row.review.evidence||[]])].map(code).join(', ');
 const coverageDescription=row.review.available||available.map(op=>op.label+' — '+op.scope).join(' ');
 const evidence=[coverageDescription,row.boundary,references].filter(Boolean).join(' ');
 console.log('| '+[`${row.module.workspace} / ${row.module.section} / ${row.module.id}`,modulePath(row.module)||'Owner or linked module',row.coverage,[...direct,...shared].join(', ')||'None',policy,row.actions.map(op=>code(op.id)).join(', ')||'None',evidence].map(cell).join(' | ')+' |');
}
console.log(`
## READ operation questions

Follow-ups reuse explicit filters and fetch fresh evidence. A bounded result cannot establish a complete total, grouping, ranking or comparison unless the source explicitly supplies it.

| Module / operation | Source authority / human permission | Acceptance question | Measures, dimensions and filters | Completeness / limitation | Contract gate / live |
|---|---|---|---|---|---|`);
for(const op of reads){
 const contract=op.moduleInterface;
 const query=contract.query;
 const fields=Object.keys(op.tool.parameters.properties);
 const supported=[...query.dimensions];
 if(fields.includes('page')&&!supported.includes('list'))supported.push('page');
 const cases=Object.entries(scenarios).filter(([,scenario])=>scenario.operations.includes(op.id));
 const core=cases.find(([,scenario])=>scenario.operations.length===1)??cases[0];
 assert(core,'No final-answer scenario for '+op.id);
 const question=core[1].question+' Cases: '+cases.map(([id])=>code(id)).join(', ')+'.';
 const source=op.rpc || [...(op.query?.toString()||op.load?.toString()||'').matchAll(/\.(?:from|rpc)\(['"]([^'"]+)/g)].map(match=>match[1]).join(', ') || contract.authority;
 const cells=[
  `${op.module_id} / ${code(op.id)}`,
  `${source} · ${code(op.permission)} · ${contract.source}`,
  question,
  `${supported.join(', ')}. ${query.measures?.length?'Measures: '+query.measures.join(', ')+'. ':''}Inputs: ${fields.join(', ')||'none'}. ${contract.exposure.fields?.length?'Fields: '+contract.exposure.fields.join(', ')+'. ':''}${op.description || op.tool.description}`,
  `${contract.aggregates}. ${contract.pagination} ${op.scope} ${query.unsupported.join(' ')}`,
  ['PASS contract gate',
   run?.results?.[op.id] || (run ? enabled.has(op.id)
    ? 'BLOCKED live: no authenticated answer for this release'
    : 'BLOCKED live: AI policy disabled; left unchanged'
    : 'BLOCKED from blanket live sign-off; see run evidence')].join(' / '),
 ];
 console.log('| '+cells.map(cell).join(' | ')+' |');
}
}
}
