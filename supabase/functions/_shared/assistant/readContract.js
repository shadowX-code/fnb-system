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
 const properties=def.properties,parameters={type:'object',properties:Object.fromEntries(Object.entries(properties).map(([k,{nullable,...s}])=>[k,nullable?{...s,type:[s.type,'null']}:s])),required:Object.keys(properties),additionalProperties:false};
 return Object.freeze({...def,kind:'READ',version:1,deniedCode:'business_read_denied',authorized:access=>access.permissions?.[def.permission]===true,
  validate:args=>validateFields(properties,args),tool:{type:'function',name:def.id,description:def.description,strict:true,parameters},
  async execute(caller,args,signal){
   validateFields(properties,args);await permitted(caller,def.permission,signal);signal?.throwIfAborted();
   const {data,error}=await caller.rpc(def.rpc,def.arguments(args)).abortSignal(signal);
   if(error)throw new AssistantError(error.code==='42501'?'business_read_denied':'business_read_unavailable',error.code==='42501'?403:503);
   const evidence={capability:def.id,source:def.source,scope:def.scope,requested_scope:args,as_of:new Date().toISOString(),version:1,...def.project(data,args)};
   if(new TextEncoder().encode(JSON.stringify(evidence)).length>10000)throw new AssistantError('business_result_limit',413);
   return evidence;
  }
 });
}
