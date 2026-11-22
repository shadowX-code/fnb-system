// Per conversational turn, shared by the SDK tool adapter and the Text model loop.
// This carries no authority. Every allowed retry still executes the canonical dispatcher.
function invocation(tool,args){
 if(tool!=='run_business_query')return {operation:tool,args};
 let inner;
 try{inner=JSON.parse(args?.arguments_json);}catch{}
 return {operation:args?.operation,args:inner};
}
export function createQueryRecovery(){
 const translations=new Map();
 const denied=new Map();
 const key=(id,args)=>JSON.stringify([id,Object.entries(args||{}).sort(([a],[b])=>a.localeCompare(b))]);
 return {
  pending(operation){return translations.get(operation)?.remaining===true;},
  before(tool,params){
   const {operation,args}=invocation(tool,params);
   if(!operation||!args)return null;
   const previous=denied.get(key(operation,args));
   if(previous)return previous;
   const translation=translations.get(operation);
   if(!translation)return null;
   const permitted=translation.remaining&&translation.choices.has(args.query)&&
    ['outlet_id','outlet_name'].every(k=>!args[k]||translation.scope[k].includes(args[k]));
   translation.remaining=false;
   if(permitted)return null;
   return {operation,error:'entity_ambiguous',query_outcome:'AMBIGUOUS',no_evidence:true,not_business_evidence:true,
    instruction:'Ask the user to clarify the item at this outlet. No further translation attempt is available in this turn.'};
  },
  after(tool,params,result){
   const {operation,args}=invocation(tool,params);
   if(!operation||!args||!result)return;
   if(result.query_outcome==='UNAUTHORIZED'){
    denied.set(key(operation,args),{operation,error:result.error||'business_read_denied',query_outcome:'UNAUTHORIZED',
     no_evidence:true,not_business_evidence:true,instruction:'This request is denied. Report the limitation and do not repeat this read.'});
   }
   if(result.resolution_required==='cross_language_name'&&Array.isArray(result.candidates)&&!translations.has(operation)){
    const choices=new Set(result.candidates.slice(0,20).flatMap(c=>[c.name,c.code]).filter(value=>typeof value==='string'&&value.length>0));
    translations.set(operation,{choices,scope:{outlet_id:[args.outlet_id,result.outlet?.id],
     outlet_name:[args.outlet_name,result.outlet?.name,result.outlet?.code]},remaining:true});
   }else if(result.query_outcome==='SUCCESS')translations.delete(operation);
  },
 };
}
