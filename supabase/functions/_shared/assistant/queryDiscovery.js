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
 const words=args.search.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
 const available=new Set(capabilities.filter(c=>c.availability==='connected').map(c=>c.id));
 const rows=operations.filter(o=>available.has(o.id)&&words.every(w=>[o.id,o.module_id,o.label,o.tool.description].join(' ').toLowerCase().includes(w)));
 const start=(args.page-1)*8;
 return {discovery_only:true,not_business_evidence:true,total_operations:rows.length,page:args.page,has_more:rows.length>start+8,operations:rows.slice(start,start+8).map(o=>({operation:o.id,module:o.module_id,kind:o.kind,description:o.tool.description,parameters:o.tool.parameters,queries:o.moduleInterface?.query,scope:o.scope}))};
}
