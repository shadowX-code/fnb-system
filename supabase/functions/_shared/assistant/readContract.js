import {declareReadInterface,readCompleteness} from './moduleInterface.js';
import {AssistantError} from '../assistantError.js';
export const uuid={type:'string',pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'};
export const date={type:'string',pattern:'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'};
export const pick=(row,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(row||{},k)).map(k=>[k,row[k]]));
export function validateFields(properties,value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==Object.keys(properties).length||Object.keys(value).some(k=>!Object.hasOwn(properties,k)))throw new AssistantError('tool_arguments_invalid',400);
 for(const [key,schema] of Object.entries(properties)){
  const v=value[key];if(v===null&&schema.nullable)continue;
  if(typeof v!==schema.type||schema.pattern&&!new RegExp(schema.pattern).test(v)||schema.enum&&!schema.enum.includes(v)||schema.maxLength&&v.length>schema.maxLength||schema.type==='number'&&(!Number.isInteger(v)||v<schema.minimum||v>schema.maximum))throw new AssistantError('tool_arguments_invalid',400);
  if(schema===date&&(!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))throw new AssistantError('tool_arguments_invalid',400);
 }
 return value;
}
export async function permitted(caller,permission,signal){
 const {data,error}=await caller.rpc('current_user_has_permission',{permission_code:permission}).abortSignal(signal);
 if(error||data!==true)throw new AssistantError('business_read_denied',403);
}
// Fixed domain contracts supply RPC/parameters/projection; callers never choose SQL or RPC names.
export function readContract(def){
 const moduleInterface=declareReadInterface(def);
 const properties=def.properties,parameters={type:'object',properties:Object.fromEntries(Object.entries(properties).map(([k,{nullable,...s}])=>[k,nullable?{...s,type:[s.type,'null']}:s])),required:Object.keys(properties),additionalProperties:false};
 return Object.freeze({...def,moduleInterface,kind:'READ',version:def.version||1,deniedCode:'business_read_denied',authorized:access=>access.permissions?.[def.permission]===true,
  validate:args=>validateFields(properties,def.normalizeArguments?def.normalizeArguments(args):args),tool:{type:'function',name:def.id,description:def.description,strict:true,parameters},
  async execute(caller,args,signal){
   args=def.normalizeArguments?def.normalizeArguments(args):args;validateFields(properties,args);await permitted(caller,def.permission,signal);signal?.throwIfAborted();
   def.check?.(args);
   if(def.outletScope){const scope=await caller.rpc('current_user_can_access_outlet',{target_outlet_id:args.outlet_id}).abortSignal(signal);if(scope.error||scope.data!==true)throw new AssistantError('business_read_denied',403);}
   let query=def.query?def.query(caller,args):caller.rpc(def.rpc,def.arguments(args));
   if(def.range)query=query.range(0,def.range-1);
   const {data,error}=await query.abortSignal(signal);
   if(error)throw new AssistantError(error.code==='42501'?'business_read_denied':'business_read_unavailable',error.code==='42501'?403:503);
   const evidence={capability:def.id,source:def.source,scope:def.scope,requested_scope:args,as_of:new Date().toISOString(),version:def.version||1,...def.project(data,args)};
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
