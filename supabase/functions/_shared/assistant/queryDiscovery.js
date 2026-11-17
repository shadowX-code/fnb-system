import {AssistantError} from '../assistantError.js';
// Transport envelopes over the existing dispatcher, never a second registry or authority.
export const queryDiscoveryTools=[
 {type:'function',name:'find_business_queries',description:'Discover currently authorized FeedX operations. Use short English module keywords (employees, factory finished goods, finance, crew, marketing), or empty search to page all. Returns exact schemas; no business data.',strict:true,parameters:{type:'object',properties:{search:{type:'string',maxLength:80},page:{type:'integer',minimum:1,maximum:20}},required:['search','page'],additionalProperties:false}},
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
 let args;try{args=JSON.parse(a.arguments_json);}catch{bad();}
 return {operation:a.operation,args};
}
export function discoverQueries(operations,capabilities,args){
 const query=discoveryWords(args.search);
 const ranking=/\b(?:top|highest|lowest|rank(?:ing)?)\b|最高|最低/i.test(args.search);
 const available=new Set(capabilities.filter(c=>c.availability==='connected').map(c=>c.id));
 const rows=operations.filter(o=>available.has(o.id)).flatMap(operation=>{
  if(!args.search.trim())return [{operation,score:0}];
  if(operation.id.toLowerCase()===args.search.trim().toLowerCase())return [{operation,score:1000}];
  const section=operation.source?.split('/')[1];
  const workspace={people:'HR',inventory:'Restaurant','sales-purchase':'Restaurant'}[section] || section;
  const identity=discoveryWords([operation.id,operation.module_id,operation.label,workspace].join(' '));
  if(!query.length||!query.every(word=>identity.includes(word)))return [];
  const label=discoveryWords(operation.label);
  const modules=discoveryWords(operation.module_id);
  const supportedRank=ranking&&operation.moduleInterface?.query?.dimensions?.includes('rank');
  return [{operation,score:(supportedRank?100:0)+query.filter(word=>modules.includes(word)).length*2+query.filter(word=>label.includes(word)).length}];
 }).sort((a,b)=>b.score-a.score).map(row=>row.operation);
 const start=(args.page-1)*8;
 return {discovery_only:true,not_business_evidence:true,total_operations:rows.length,page:args.page,has_more:rows.length>start+8,operations:rows.slice(start,start+8).map(o=>({operation:o.id,module:o.module_id,kind:o.kind,description:o.tool.description,parameters:o.tool.parameters,queries:o.moduleInterface?.query,scope:o.scope})),
  ...(!rows.length?{instruction:'No match for this search. Search with only the resource or module name, without filtering, metric, unit or ranking words. Do not substitute a different domain or assume this search result proves that the user lacks permission.'}:{})};
}

const grammar = new Set(('a an the of by in from for to show list all top highest lowest count summary how many compare rank ranking status current stock balance read records operations please what is are '+
 'about for using same and unit units three two first page active inactive archived kg g mg ml litre litres pack packs sku').split(' '));
function discoveryWords(value) {
 const words = value.toLowerCase()
  .replace(/\bfg\b|成品/g,' finished goods ')
  .replace(/\brm\b|原材料|原料/g,' raw material ')
  .replace(/\bemployment (?:status|types?)\b|员工|雇员/g,' employee ')
  .replace(/\braw catalogue\b/g,' raw material catalogue ')
  .match(/[a-z][a-z0-9]*/g) || [];
 return [...new Set(words.filter(word=>!grammar.has(word)).map(word=>word.length>4&&word.endsWith('s')?word.slice(0,-1):word))];
}
