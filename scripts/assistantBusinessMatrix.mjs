// Emit the acceptance matrix from the same definitions exercised by the build.
// Live results are recorded separately because they depend on environment and actor.
import {operations} from '../supabase/functions/native-assistant/business.js';

const cell=value=>String(value ?? '').replaceAll('|','\\|').replace(/\s+/g,' ').trim();
const code=name=>'\x60'+name+'\x60';
console.log(`# FeedX Native Assistant business acceptance matrix

Every registered READ has a generated question and an executable regression for discovery, exact schema, disabled/stale policy, denied permission and invalid arguments. Run \`npm run test:assistant-business\` to produce current results. PASS below refers to that gate. Live natural-language answer acceptance is a separate record.

Each row adds these common questions: can I reuse this authorized scope in a follow-up, what does an empty or bounded result mean, and does denial yield no evidence? Follow-ups must fetch fresh evidence. Where a declaration is bounded, ask for its declared output and filters. Complete totals, detail, group, rank and comparisons are BLOCKED unless the contract or documented source result supports them. No output is itself a passing answer.

| Module / operation | Source authority / human permission | Acceptance question | Dimensions and filters | Completeness / limitation | Contract gate / live |
|---|---|---|---|---|---|`);
for(const op of operations.filter(o=>o.kind==='READ')){
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
    :`Show the recorded ${label} for the requested scope. What detail is available from this result?`;
 const source=op.rpc || [...(op.query?.toString()||'').matchAll(/\.(?:from|rpc)\(['"]([^'"]+)/g)].map(match=>match[1]).join(', ') || contract.authority;
 const cells=[
  `${op.module_id} / ${code(op.id)}`,
  `${source} · ${code(op.permission)} · ${op.source}`,
  question,
  `${supported.join(', ')}. Inputs: ${fields.join(', ')||'none'}. ${op.description || op.tool.description}`,
  `${contract.aggregates}. ${contract.pagination} ${op.scope}`,
  'PASS contract gate / BLOCKED from blanket live sign-off; see run evidence',
 ];
 console.log('| '+cells.map(cell).join(' | ')+' |');
}
