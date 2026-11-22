import {declareReadInterface,readCompleteness} from './moduleInterface.js';
import {AssistantError} from '../assistantError.js';
export const uuid={type:'string',pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'};
export const date={type:'string',pattern:'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'};
export const pick=(row,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(row||{},k)).map(k=>[k,row[k]]));
export function invalidArgument(reason,field){
 throw new AssistantError('tool_arguments_invalid',400,{validation:{reason,...field?{field}:{}}});
}
// Expected values are constants from the owning contract, never submitted values.
export function requireArgumentValues(args,required){
 const fields=Object.keys(required).filter(field=>args[field]!==required[field]);
 if(fields.length)throw new AssistantError('tool_arguments_invalid',400,{validation:{
  reason:'required_values',fields,expected:pick(required,fields),
 }});
}
export function validateFields(properties,value){
 if(!value||typeof value!=='object'||Array.isArray(value))invalidArgument('object_required');
 if(Object.keys(value).some(k=>!Object.hasOwn(properties,k)))invalidArgument('unexpected_field');
 for(const [key,schema] of Object.entries(properties)){
  if(!Object.hasOwn(value,key))invalidArgument('missing_field',key);
  const types=[schema.type].flat();
  const v=value[key];if(v===null&&(schema.nullable||types.includes('null')))continue;
  if(types.includes('array')){
   if(!Array.isArray(v))invalidArgument('wrong_type',key);
   if(v.length>schema.maxItems||v.some(item=>typeof item!=='string'||!item.trim()||item.length>schema.items.maxLength))invalidArgument('unsupported_value',key);
   continue;
  }
  const numeric=types.includes('number')||types.includes('integer');
  if(!types.includes(typeof v)&&!(numeric&&typeof v==='number'))invalidArgument('wrong_type',key);
  if(numeric&&!Number.isInteger(v))invalidArgument('integer_required',key);
  if(schema.pattern&&!new RegExp(schema.pattern).test(v)||schema.enum&&!schema.enum.includes(v)||schema.maxLength&&v.length>schema.maxLength||numeric&&(v<schema.minimum||v>schema.maximum))invalidArgument('unsupported_value',key);
  if((schema.pattern===date.pattern||schema.pattern===month.pattern)&&
   (!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))invalidArgument('invalid_date',key);
 }
 return value;
}
export async function permitted(caller,permission,signal){
 const {data,error}=await caller.rpc('current_user_has_permission',{permission_code:permission}).abortSignal(signal);
 if(error||data!==true)throw new AssistantError('business_read_denied',403);
}
export async function permittedOutlet(caller,outletId,signal){
 const {data,error}=await caller.rpc('current_user_can_access_outlet',{target_outlet_id:outletId}).abortSignal(signal);
 if(error||data!==true)throw new AssistantError('business_read_denied',403);
}
// Fixed domain contracts supply RPC/parameters/projection; callers never choose SQL or RPC names.
export function readContract(def){
 const moduleInterface=declareReadInterface(def);
 const properties=def.properties,parameters={type:'object',properties:Object.fromEntries(Object.entries(properties).map(([k,{nullable,...s}])=>[k,nullable?{...s,type:[s.type,'null']}:s])),required:Object.keys(properties),additionalProperties:false};
 const validate=(args)=>{
  const normalized=validateFields(properties,def.normalizeArguments?def.normalizeArguments(args):args);
  def.check?.(normalized);
  return normalized;
 };
 return Object.freeze({...def,moduleInterface,kind:'READ',version:def.version||1,deniedCode:'business_read_denied',authorized:access=>access.permissions?.[def.permission]===true,
  validate,tool:{type:'function',name:def.id,description:def.description,strict:true,parameters},
  async execute(caller,args,signal){
   args=validate(args);await permitted(caller,def.permission,signal);signal?.throwIfAborted();
   if(def.outletScope)await permittedOutlet(caller,args.outlet_id,signal);
   let result;
   if(def.load)result={data:await def.load(caller,args,signal)};
   else {
    let query=def.query?def.query(caller,args):caller.rpc(def.rpc,def.arguments(args));
    if(def.range)query=query.range(0,def.range-1);
    result=await query.abortSignal(signal);
   }
   const {data,error}=result;
   if(error||data==null)throw new AssistantError(error?.code==='42501'?'business_read_denied':'business_read_unavailable',error?.code==='42501'?403:503);
   let projected;
   try{projected=def.project(data,args);}catch(error){
    if(error instanceof AssistantError)throw error;
    throw new AssistantError('business_read_unavailable',503);
   }
   const evidence={capability:def.id,source:def.source,scope:def.scope,requested_scope:args,as_of:new Date().toISOString(),version:def.version||1,...projected};
   evidence.completeness=readCompleteness(moduleInterface,evidence,args);
   if(new TextEncoder().encode(JSON.stringify(evidence)).length>10000)throw new AssistantError('business_result_limit',413);
   return evidence;
  }
 });
}

export const page={type:'number',minimum:1,maximum:100};
export const month={...date,pattern:'^20[0-9]{2}-(0[1-9]|1[0-2])-01$'};
export function boundedPeriod(a){if(Date.parse(a.to)<Date.parse(a.from)||Date.parse(a.to)-Date.parse(a.from)>31*86400000)throw new AssistantError('tool_arguments_invalid',400);}
export function rowsEvidence(rows,keys,limit=20){
 if(!Array.isArray(rows))throw new AssistantError('business_read_unavailable',503);
 return {rows:rows.slice(0,limit).map(r=>pick(r,keys)),returned_count:Math.min(rows.length,limit),truncated:rows.length>limit,complete:false,coverage:'Bounded results; not a complete inventory. returned_count is not a total; truncated=false does not assert completeness.'};
}

// Counts are calculated by the same canonical query and filters as the page.
export async function countedRows(query,args,fields,signal){
 const first=(args.page-1)*20;
 const {data,count,error}=await (args.mode==='summary'?query:query.range(first,first+19)).abortSignal(signal);
 if(error?.code==='42501')throw new AssistantError('business_read_denied',403);
 if(error||!Number.isSafeInteger(count)||count<0||
  args.mode!=='summary'&&(!Array.isArray(data)||data.length!==Math.min(20,Math.max(count-first,0))))
  throw new AssistantError('business_read_unavailable',503);
 return {rows:args.mode==='summary'?[]:data.map(row=>pick(row,fields)),
  total_matching:count,aggregate_complete:true,page:args.page,page_size:20,truncated:args.mode!=='summary'&&count>first+20};
}
