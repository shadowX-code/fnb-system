import {AssistantError} from '../assistantError.js';
// Transport envelopes over the existing dispatcher, never a second registry or authority.
export const queryDiscoveryTools=[
 {type:'function',name:'find_business_queries',description:'Discover currently authorized FeedX data and knowledge operations. Search by module (Employees, Factory Finished Goods, Factory Production SOP, Crew SOP Library, Brand Knowledge, approved FAQ). Returns exact schemas, no business data or document text.',strict:true,parameters:{type:'object',properties:{search:{type:'string',maxLength:80},page:{type:'integer',minimum:1,maximum:20}},required:['search','page'],additionalProperties:false}},
 {type:'function',name:'run_business_query',description:'Invoke one previously discovered operation through the existing authorized dispatcher. arguments_json must encode the exact discovered schema. ACTION prepares a preview only; confirmation remains separate.',strict:true,parameters:{type:'object',properties:{operation:{type:'string',maxLength:100},arguments_json:{type:'string',maxLength:4000}},required:['operation','arguments_json'],additionalProperties:false}}
];
export function isQueryEnvelope(id){return queryDiscoveryTools.some(t=>t.name===id);}
export function queryEnvelopeArguments(id,a){
 const bad=()=>{throw new AssistantError('tool_arguments_invalid',400);};
 if(!a||typeof a!=='object'||Array.isArray(a))bad();
 if(id==='find_business_queries'){
  if(Object.keys(a).length!==2||typeof a.search!=='string'||a.search.length>80||!Number.isInteger(a.page)||a.page<1||a.page>20)bad();
  return a;
 }
 if(id!=='run_business_query'||Object.keys(a).length!==2||typeof a.operation!=='string'||a.operation.length>100||isQueryEnvelope(a.operation)||typeof a.arguments_json!=='string'||a.arguments_json.length>4000)bad();
 // Keep a bounded malformed inner payload identifiable through authorization.
 // The dispatcher can then provide the exact schema without running the read.
 let args;try{args=JSON.parse(a.arguments_json);}catch{}
 return {operation:a.operation,args};
}
export function discoverQueries(operations,capabilities,args){
 const query=discoveryWords(args.search);
 const competing=excludeCompetingQueries(operations,args.search);
 const ranking=/\b(?:top|highest|lowest|rank(?:ing)?)\b|最高|最低/i.test(args.search);
 const available=new Set(capabilities.filter(c=>c.availability==='connected').map(c=>c.id));
 const rows=operations.filter(o=>available.has(o.id)&&!competing.has(o.id)).flatMap(operation=>{
  if(!args.search.trim())return [{operation,score:0}];
  if(operation.id.toLowerCase()===args.search.trim().toLowerCase())return [{operation,score:1000}];
  const section=operation.moduleInterface?.source?.split('/')[1];
  const workspace={people:'HR',inventory:'Restaurant','sales-purchase':'Restaurant'}[section] || section;
  const identity=discoveryWords([operation.id,operation.module_id,operation.label,workspace].join(' '));
  const explicitResource=matchesResource(operation,query);
  const exactTerms=query.every(word=>identity.includes(word));
  if(!query.length||!explicitResource&&!exactTerms)return [];
  const label=discoveryWords(operation.label);
  const modules=discoveryWords(operation.module_id);
  const supportedRank=ranking&&operation.moduleInterface?.query?.dimensions?.includes('rank');
  return [{operation,score:(exactTerms?30:0)+(explicitResource?10:0)+(supportedRank?100:0)+query.filter(word=>modules.includes(word)).length*2+query.filter(word=>label.includes(word)).length}];
 }).sort((a,b)=>b.score-a.score).map(row=>row.operation);
 const start=(args.page-1)*8;
 return {discovery_only:true,not_business_evidence:true,total_operations:rows.length,page:args.page,has_more:rows.length>start+8,operations:rows.slice(start,start+8).map(o=>({operation:o.id,module:o.module_id,kind:o.kind,description:o.tool.description,parameters:o.tool.parameters,queries:o.moduleInterface?.query,scope:o.scope,...(o.knowledge?{source_type:o.knowledge.type}:{} )})),
  ...(!rows.length?{instruction:'No operation matched this search. Retry discovery with just the resource or module name. No business source was queried. If no matching operation is available, explain that the capability could not be found; do not report missing records, zero or permission denial.'}:{})};
}

function matchesResource(operation,query){
 return (operation.discoveryPhrases||[]).map(discoveryWords).some(words=>words.length>1&&words.every(word=>query.includes(word)));
}

export function excludeCompetingQueries(operations,prompt){
 if(typeof prompt!=='string'||!prompt.trim())return new Set();
 const query=discoveryWords(prompt);
 const matched=new Set(operations.filter(operation=>operation.discoveryFamily&&matchesResource(operation,query)));
 const namedFamilies=new Set([...matched].map(operation=>operation.discoveryFamily));
 return new Set(operations.filter(operation=>namedFamilies.has(operation.discoveryFamily)&&!matched.has(operation)).map(operation=>operation.id));
}

const grammar = new Set(('a an the of by in from for to show list all top highest lowest count summary how many compare rank ranking status current currently stock balance balances read records operations please what which is are have has '+
 'about using same and unit units three two first page active inactive archived kg g mg ml litre litres pack packs sku').split(' '));
function discoveryWords(value) {
 const words = value.toLowerCase()
  .replace(/\bfg\b|成品/g,' finished goods ')
  .replace(/\brm\b|原材料|原料/g,' raw material ')
  .replace(/\bemployment[ -](?:status|types?)\b|员工|雇员/g,' employee ')
  .replace(/\basset-(?!tracking\b)[a-z0-9][a-z0-9-]*|资产追踪|资产追蹤/g,' asset tracking ')
  .replace(/\braw catalogue\b/g,' raw material catalogue ')
  .match(/[a-z][a-z0-9]*/g) || [];
 return [...new Set(words.filter(word=>!grammar.has(word)).map(word=>word.length>4&&word.endsWith('s')?word.slice(0,-1):word))];
}
