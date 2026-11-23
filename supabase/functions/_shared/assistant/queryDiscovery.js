import {AssistantError} from '../assistantError.js';
import {businessSemanticEntry} from './moduleInterface.js';
// Transport envelopes over the existing dispatcher, never a second registry or authority.
export const queryDiscoveryTools=[
 {type:'function',name:'find_business_queries',description:'Find the authorized operation for a FeedX business question. Search with the current user request or a short business resource. Distinguish Master Inventory item types, asset balances, stock movements, Factory raw materials and finished goods. Starts authorized discovery. A fully scoped Voice request may return verified business evidence directly. When discovery_only is present, the result contains schemas, not records.',strict:true,parameters:{type:'object',properties:{search:{type:'string',maxLength:240},page:{type:'integer',minimum:1,maximum:20}},required:['search','page'],additionalProperties:false}},
 {type:'function',name:'run_business_query',description:'Invoke one previously discovered operation through the existing authorized dispatcher. arguments_json must encode the exact discovered schema. ACTION prepares a preview only; confirmation remains separate.',strict:true,parameters:{type:'object',properties:{operation:{type:'string',maxLength:100},arguments_json:{type:'string',maxLength:4000}},required:['operation','arguments_json'],additionalProperties:false}}
];
export function isQueryEnvelope(id){return queryDiscoveryTools.some(t=>t.name===id);}
export function queryEnvelopeArguments(id,a){
 const bad=()=>{throw new AssistantError('tool_arguments_invalid',400);};
 if(!a||typeof a!=='object'||Array.isArray(a))bad();
 if(id==='find_business_queries'){
  if(Object.keys(a).length!==2||typeof a.search!=='string'||a.search.length>240||!Number.isInteger(a.page)||a.page<1||a.page>20)bad();
  return a;
 }
 if(id!=='run_business_query'||Object.keys(a).length!==2||typeof a.operation!=='string'||a.operation.length>100||isQueryEnvelope(a.operation)||typeof a.arguments_json!=='string'||a.arguments_json.length>4000)bad();
 // Keep a bounded malformed inner payload identifiable through authorization.
 // The dispatcher can then provide the exact schema without running the read.
 let args;try{args=JSON.parse(a.arguments_json);}catch{}
 return {operation:a.operation,args};
}
function rankQueries(operations,search,competing=excludeCompetingQueries(operations,search)){
 const query=discoveryWords(search);
 const identifier=/^(?:read|prepare)_[a-z0-9_]+$/i.test(search);
 const ranking=/\b(?:top|highest|lowest|rank(?:ing)?)\b|最高|最低/i.test(search);
 const counting=/\b(?:how many|count|number of|headcount|berapa|bilangan)\b|多少|幾個|几个/i.test(search);
 const matches=operations.filter(o=>!competing.has(o.id)).flatMap(operation=>{
  const entry=businessSemanticEntry(operation);
  if(!search)return [{operation,entry,score:0}];
  if(identifier)return operation.id.toLowerCase()===search.toLowerCase()?[{operation,entry,score:1000,exact:true}]:[];
  const section=entry.source?.split('/')[1];
  const workspace={people:'HR',inventory:'Restaurant','sales-purchase':'Restaurant'}[section] || section;
  const identity=discoveryWords([entry.operation,entry.owner,entry.label,workspace].join(' '));
  const explicitResource=matchesResource(operation,query,search)||operation.queryIntent?.(search);
  // Match complete owner-declared business names inside a sentence. A word like
  // "employee" or "amount" alone cannot bind an unrelated question to a source.
  const named=[entry.label,...(entry.semantics?.entities||[])].some(name=>matchesPhrase(name,query,search))
   || (entry.query?.measures||[]).some(name=>includesMetricName(search,name));
  const exactTerms=query.length>0&&query.every(word=>identity.includes(word));
  if(!explicitResource&&!exactTerms&&!named)return [];
  const label=discoveryWords(entry.label);
  const modules=discoveryWords(entry.owner);
  const supportedRank=ranking&&entry.query?.dimensions?.includes('rank');
  const ownerCount=counting&&entry.query?.dimensions?.includes('count')&&exactTerms&&
   query.every(word=>modules.includes(word))&&modules.every(word=>query.includes(word));
  return [{operation,entry,strong:Boolean(explicitResource||named||ownerCount),exact:entry.label.toLowerCase()===search.toLowerCase(),
   score:(exactTerms?30:0)+(explicitResource?12:0)+(named?5:0)+(ownerCount?8:0)+(supportedRank?100:0)+query.filter(word=>modules.includes(word)).length*2+query.filter(word=>label.includes(word)).length}];
 }).sort((a,b)=>b.score-a.score);
 const exact=matches.filter(row=>row.exact);
 const strong=exact.length?exact:matches.filter(row=>row.strong);
 const preferred=strong.length===1?strong[0].operation.id:null;
 return {matches,preferred};
}

// Identity alone selects a source for reauthorization. Only discoverQueries can
// expose an operation and its schema to a caller.
export function identifyReadOwner(operations,search){
 return rankQueries(operations.filter(operation=>operation.kind==='READ'),search.trim()).preferred;
}

export function discoverQueries(operations,capabilities,args){
 const available=new Set(capabilities.filter(c=>c.availability==='connected').map(c=>c.id));
 const search=args.search.trim();
 const {matches,preferred}=rankQueries(operations.filter(op=>available.has(op.id)),search,excludeCompetingQueries(operations,search));
 const start=(args.page-1)*8;
 const entries=matches.slice(start,start+8).map(({operation,entry})=>{
  const result={operation:entry.operation,module:entry.owner,kind:entry.kind,description:entry.description,
   parameters:operation.tool.parameters,queries:entry.query,scope:entry.scope};
  if(operation.knowledge)result.source_type=entry.source_type;
  if(entry.semantics&&entry.operation===preferred)result.semantics=entry.semantics;
  return result;
 });
 const selected=entries.find(entry=>entry.operation===preferred);
 const handoff=selected&&selected.kind!=='ACTION'
  ? {kind:'read',tool:'run_business_query',operation:selected.operation}
  : entries.length?{kind:'select_match'}:{kind:'refine_search'};
 return {discovery_only:true,not_business_evidence:true,total_operations:matches.length,page:args.page,has_more:matches.length>start+8,
  preferred_operation:selected?.operation||null,operations:entries,next_step:handoff,
  instruction:handoff.kind==='read'?'Use the returned schema with run_business_query before giving business figures. If required scope is missing, ask for it. This source is available through the runner even when its name is absent from the installed tools.'
   :handoff.kind==='select_match'?'These are available operations, not business results. Use run_business_query with a matching schema. If the requested scope is ambiguous, ask one clarification.'
   :'No operation matched this search or page. Make at most one distinct retry using the resource or module name on its first page. If it still fails, say the source could not be verified. No business source was queried. Do not report missing records, zero or permission denial.'};
}

function matchesPhrase(phrase,query,search){
 if(/\p{Script=Han}/u.test(phrase)&&search.normalize('NFKC').includes(phrase.normalize('NFKC')))return true;
 const words=discoveryWords(phrase);
 return words.length>1&&words.every(word=>query.includes(word));
}

function includesMetricName(search,name){
 // Match the whole measure including generic words such as "count" or "stock".
 // Discarding them would turn low_stock_count into a misleading match for "low".
 const normalize=value=>value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 return (' '+normalize(search)+' ').includes(' '+normalize(name)+' ');
}

function matchesResource(operation,query,search){
 return (operation.discoveryPhrases||[]).some(phrase=>matchesPhrase(phrase,query,search));
}

export function excludeCompetingQueries(operations,prompt){
 if(typeof prompt!=='string'||!prompt.trim())return new Set();
 const query=discoveryWords(prompt);
 const matched=new Set(operations.filter(operation=>operation.discoveryFamily&&matchesResource(operation,query,prompt)));
 const namedFamilies=new Set([...matched].map(operation=>operation.discoveryFamily));
 return new Set(operations.filter(operation=>namedFamilies.has(operation.discoveryFamily)&&!matched.has(operation)).map(operation=>operation.id));
}

const grammar = new Set(('a an the of by in from for to show list all top highest lowest count summary how many compare rank ranking status current currently stock balance balances read records operations please what which is are there have has authorized authorised '+
 'about using same and unit units three two first page active inactive archived kg g mg ml litre litres pack packs sku do does did we us our my me you can could get give tell check today').split(' '));
function discoveryWords(value) {
 const words = value.toLowerCase()
  .replace(/\bfg\b|成品/g,' finished goods ')
  .replace(/\brm\b|原材料|原料/g,' raw material ')
  .replace(/\bemployment[ -](?:status|types?)\b|员工|雇员/g,' employee ')
  .replace(/餐[厅廳](?:的)?\s*(?:库存|庫存|存货|存貨|inventory)|inventori restoran/g,' restaurant inventory ')
  .replace(/(?:库存|庫存|存货|存貨)(?:主档|主檔|目录|目錄)|inventori induk/g,' master inventory ')
  .replace(/库存[移异]动|庫存[移異]動|出入[库庫]|pergerakan (?:inventori|stok)/g,' inventory movements ')
  .replace(/\basset-(?!tracking\b)[a-z0-9][a-z0-9-]*|资产追踪|资产追蹤/g,' asset tracking ')
  .replace(/\braw catalogue\b/g,' raw material catalogue ')
  .match(/[a-z][a-z0-9]*/g) || [];
 return [...new Set(words.filter(word=>!grammar.has(word)).map(word=>word.length>4&&word.endsWith('s')?word.slice(0,-1):word))];
}
