// Emit the acceptance matrix from the same definitions exercised by the build.
// Live results are recorded separately because they depend on environment and actor.
import {operations} from '../supabase/functions/native-assistant/business.js';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {reconcileBusinessModules} from '../src/features/integrations/businessModuleProjection.js';
import {assistantCoverageReview} from '../src/features/integrations/assistantCoverageReview.js';

const cell=value=>String(value ?? '').replaceAll('|','\\|').replace(/\s+/g,' ').trim();
const code=name=>'\x60'+name+'\x60';
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
  const boundary=review.missing||review.available;
  assert(boundary,`Missing source or authority boundary for ${module.id}`);
  return {module,direct,shared,actions,coverage,boundary};
 });
}

export const operationQuestion=op=>`What information does FeedX have for ${op.label} in the authorized scope? What can the result establish?`;

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
const run=process.argv[2]?JSON.parse(readFileSync(process.argv[2],'utf8')):null;
const modules=moduleCoverage();
console.log(`# FeedX Native Assistant business acceptance matrix

Generated from the canonical module projection, module-owned operations and reviewed coverage annotations. ${modules.length} modules include Space Station, a virtual navigation workspace with no independent business authority. There are ${reads.length} READ contracts and ${operations.length-reads.length} separately authorized ACTION contracts.

Every registered READ has a business question and executable contract tests. PASS on those tests covers discovery, schema, policy, invalid arguments and human denial under fixtures. An authenticated answer requires an independent source comparison with \`npm run qa:staging:assistant-certify\`. A disabled capability, missing account or unexecuted scenario is BLOCKED. Undeclared query dimensions are UNSUPPORTED. Each module's settings are independent of this coverage inventory.

## Module coverage

| Workspace / domain / module | Coverage | Native READ owners and shared READs | ACTIONs | Unavailable dimensions and authority |
|---|---|---|---|---|`);
for(const row of modules){
 const direct=row.direct.map(op=>code(op.id));
 const shared=row.shared.map(op=>`${code(op.id)} via ${op.module_id}`);
 console.log('| '+[`${row.module.workspace} / ${row.module.section} / ${row.module.id}`,row.coverage,[...direct,...shared].join(', ')||'None',row.actions.map(op=>code(op.id)).join(', ')||'None',row.boundary].map(cell).join(' | ')+' |');
}
console.log(`
## READ operation questions

Follow-ups reuse explicit filters and fetch fresh evidence. A bounded result cannot establish a complete total, grouping, ranking or comparison unless the source explicitly supplies it.

| Module / operation | Source authority / human permission | Acceptance question | Dimensions and filters | Completeness / limitation | Contract gate / live |
|---|---|---|---|---|---|`);
for(const op of reads){
 const contract=op.moduleInterface;
 const query=contract.query;
 const fields=Object.keys(op.tool.parameters.properties);
 const supported=[...query.dimensions];
 if(fields.includes('page')&&!supported.includes('list'))supported.push('page');
 const label=op.label;
 const question=query.dimensions.includes('rank')&&op.module_id.startsWith('factory_')
  ?`What are the highest and lowest ${label} balances in one recorded unit? What is the next page or an exact SKU?`
  :query.dimensions.includes('rank')
   ?`What are the canonical top and lowest products in ${label} for this period? What source coverage applies?`
  :query.dimensions.includes('period_comparison')
   ?`What does ${label} show for the authorized outlet and recorded periods? Which periods are missing?`
   :query.dimensions.includes('count')||query.dimensions.includes('summary')
    ?`What authoritative totals or summary measures are available from ${label} for this scope?`
    :operationQuestion(op);
 const source=op.rpc || [...(op.query?.toString()||op.load?.toString()||'').matchAll(/\.(?:from|rpc)\(['"]([^'"]+)/g)].map(match=>match[1]).join(', ') || contract.authority;
 const cells=[
  `${op.module_id} / ${code(op.id)}`,
  `${source} · ${code(op.permission)} · ${contract.source}`,
  question,
  `${supported.join(', ')}. Inputs: ${fields.join(', ')||'none'}. ${op.description || op.tool.description}`,
  `${contract.aggregates}. ${contract.pagination} ${op.scope} ${query.unsupported.join(' ')}`,
  ['PASS contract gate',
   run?.results?.[op.id] || (run ? run.enabled.includes(op.id)
    ? 'BLOCKED live: no per-operation authenticated answer run within available Text budget'
    : 'BLOCKED live: AI policy disabled; left unchanged'
    : 'BLOCKED from blanket live sign-off; see run evidence')].join(' / '),
 ];
 console.log('| '+cells.map(cell).join(' | ')+' |');
}
}
