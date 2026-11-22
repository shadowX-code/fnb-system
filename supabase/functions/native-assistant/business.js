import {queryDiscoveryTools,isQueryEnvelope,queryEnvelopeArguments,discoverQueries,excludeCompetingQueries} from '../_shared/assistant/queryDiscovery.js';
import {employeeDirectoryRead} from '../_shared/people/employeeDirectoryRead.js';
import {restaurantGapReads} from '../_shared/restaurant/gapReads.js';
import {financeGapReads} from '../_shared/finance/gapReads.js';
import {peopleGapReads} from '../_shared/people/gapReads.js';
import {crewGapReads} from '../_shared/crew/gapReads.js';
import {factoryGapReads} from '../_shared/factory/gapReads.js';
import {marketingGapReads} from '../_shared/marketing/gapReads.js';
import {restaurantCatalogueReads} from '../_shared/restaurant/catalogueReads.js';
import {assetCatalogueRead} from '../_shared/restaurant/assetCatalogueRead.js';
import {peopleCatalogueReads} from '../_shared/people/catalogueReads.js';
import {factoryCatalogueReads} from '../_shared/factory/catalogueReads.js';
import {factoryPlatformReads} from '../_shared/factory/platformReads.js';
import {crewPlatformReads} from '../_shared/crew/platformReads.js';
import {marketingPlatformReads} from '../_shared/marketing/platformReads.js';
import {peoplePlatformReads} from '../_shared/people/platformReads.js';
import {financePlatformReads} from '../_shared/finance/platformReads.js';
import {draftAction,captionAction} from '../_shared/marketing/draftAction.js';
import {plannerRead} from '../_shared/marketing/plannerRead.js';
import {reportRead} from '../_shared/finance/reportRead.js';
import {leaveRead} from '../_shared/crew/leaveRead.js';
import {employmentRead} from '../_shared/people/employmentRead.js';
import {cleaningRead} from '../_shared/factory/cleaningRead.js';
import {AssistantError} from '../_shared/assistantError.js';
import {finishedGoodsRead} from '../_shared/factory/finishedGoodsRead.js';
import {systemGuidance} from '../_shared/assistant/systemGuidance.js';
import {entityKey,explicitNamedOutlet,resolveBrand,resolveOutlet} from '../_shared/assistant/entityResolution.js';
import {confirmedOutlet,outcomeFor,outletContinuation} from './businessQuery.js';

// Composition of implemented module contracts, not a permission or grant store.
// Discovery never makes a module executable. ACTION tools create previews only.
export const operations = [employeeDirectoryRead,...restaurantGapReads,...peopleGapReads,...financeGapReads,...marketingGapReads,...factoryGapReads,...crewGapReads,finishedGoodsRead,cleaningRead,employmentRead,leaveRead,reportRead,plannerRead,draftAction,captionAction,...factoryPlatformReads,...crewPlatformReads,...marketingPlatformReads,...peoplePlatformReads,...factoryCatalogueReads,...peopleCatalogueReads,...restaurantCatalogueReads,assetCatalogueRead,...financePlatformReads];
const queryOperations=[...operations,systemGuidance];
const guideAvailable=(config,access)=>config.enabled===true&&access.admin===true;
export function assistantQuery(id){const operation=queryOperations.find(item=>item.id===id);if(!operation)throw new AssistantError('tool_not_allowed',403);return operation;}
export function validateBusinessArguments(id,args){
 if(isQueryEnvelope(id)){const parsed=queryEnvelopeArguments(id,args);if(id==='run_business_query')assistantQuery(parsed.operation);return parsed;}
 return assistantQuery(id).validate(args);
}
export function capabilityConnected(config,id){return config.capability_connections?.[id]===true;}
export function businessOperation(id){const operation=operations.find(item=>item.id===id);if(!operation)throw new AssistantError('tool_not_allowed',403);return operation;}
export function businessToolIdentity(tool, args) {
 const id = tool === 'run_business_query' ? args?.operation : tool;
 const operation = queryOperations.find(item => item.id === id);
 if (operation) return { operation: operation.id, operation_label: operation.label };
 if (tool === 'find_business_queries') return { operation: tool, operation_label: 'FeedX query discovery' };
 return {};
}
export function businessToolArgumentShape(tool, args) {
 const id = businessToolIdentity(tool, args).operation;
 const parameters = queryOperations.find(item => item.id === id)?.tool.parameters
  || queryDiscoveryTools.find(item => item.name === id)?.parameters;
 if (!parameters) return {};
 let inner = args;
 if (tool === 'run_business_query') {
  try { inner = queryEnvelopeArguments(tool, args).args; } catch { return {}; }
 }
 if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return {};
 const keys = Object.keys(inner);
 return {
  fields: keys.filter(key => Object.hasOwn(parameters.properties, key)),
  unsupported_field_count: keys.filter(key => !Object.hasOwn(parameters.properties, key)).length,
  ...(parameters.properties.mode?.enum?.includes(inner.mode) ? {mode:inner.mode} : {}),
 };
}
export function businessCapabilities(config,access){
 return operations.map(operation=>({id:operation.id,module_id:operation.module_id,related_module_ids:operation.related_module_ids||[],kind:operation.kind,version:operation.version,
  label:operation.label,scope:operation.scope,permission:operation.permission,query:operation.moduleInterface?.query,policy_group:operation.policyGroup||null,
  ...(operation.knowledge?{knowledge:{...operation.moduleInterface.knowledge,availability:!capabilityConnected(config,operation.id)?'disabled':
   operation.authorized(access)&&(operation.knowledge.additional_permissions||[]).every(permission=>access.permissions?.[permission]===true)?'live_source':'denied'}}:{}),
  connection_enabled:capabilityConnected(config,operation.id),test_supported:operation.kind==='READ',test_parameters:operation.kind==='READ'?operation.tool.parameters.properties:undefined,
  ai_execution_enabled:operation.kind==='ACTION'?config.ai_action_authorizations?.[operation.id]===true:undefined,
  availability:!capabilityConnected(config,operation.id)||operation.kind==='ACTION'&&config.ai_action_authorizations?.[operation.id]!==true?'disabled':operation.authorized(access)?'connected':'denied'}));
}
export function queryTool(operation){
 if(operation.kind!=='READ')return operation.tool;
 const parameters=operation.tool.parameters;
 const extra={};
 if(parameters.properties.outlet_id&&!parameters.properties.outlet_name)extra.outlet_name={type:['string','null'],maxLength:120,description:'Exact human-supplied outlet name/code, or null. Use null for a required outlet_id only when providing this name.'};
 if(parameters.properties.brand_id&&!parameters.properties.brand_name)extra.brand_name={type:['string','null'],maxLength:120,description:'Exact human-supplied Brand name, or null.'};
 if(!Object.keys(extra).length)return operation.tool;
 const properties={...parameters.properties,...extra};
 for(const field of ['outlet','brand']){
  const id=properties[field+'_id'];
  if(extra[field+'_name']&&id.type==='string')properties[field+'_id']={...id,type:['string','null']};
 }
 if(extra.brand_name&&properties.organization_id?.type==='string')properties.organization_id={...properties.organization_id,type:['string','null']};
 return {...operation.tool,parameters:{...parameters,properties,required:Object.keys(properties)}};
}

const domainOf=operation=>{
 const root=operation.moduleInterface?.source?.split('/')[1];
 return ['operations','sales-purchase','inventory'].includes(root)?'restaurant':root||null;
};
export function createBusinessDispatcher({caller,config,access,readFactory,loadConfig,sessionId}={}){
 const capabilities=businessCapabilities(config||{},access||{});
 const withGuide=(base,current)=>guideAvailable(current,access||{})?[...base,{id:systemGuidance.id,availability:'connected'}]:base;
 const indexed=withGuide(capabilities,config||{});
 const intended=prompt=>queryOperations.filter(operation=>typeof prompt==='string'&&operation.queryIntent?.(prompt));
 const planned=prompt=>{const matches=intended(prompt);return matches.length===1?matches[0]:null;};
 const discoveryRows=(ops,available,params)=>discoverQueries(ops.map(operation=>({...operation,tool:queryTool(operation)})),available,params);
 return {
  capabilities,
  guidance_sources:guideAvailable(config||{},access||{})?[{id:systemGuidance.id,module_id:systemGuidance.module_id,...systemGuidance.knowledge,availability:'live_source',retrieval:'current_release'}]:[],
  tools:(()=>{const offered=queryOperations.filter(operation=>indexed.find(item=>item.id===operation.id)?.availability==='connected');return offered.length>8?queryDiscoveryTools:offered.map(queryTool);})(),
  plan(prompt){
   const operation=planned(prompt);
   if(!operation)return null;
   const available=indexed.find(item=>item.id===operation.id)?.availability==='connected';
   return {operation:operation.id,tool:available?queryTool(operation):null,intent:operation.queryIntent(prompt)};
  },
  isKnowledgeTool:(tool,args)=>!!queryOperations.find(item=>item.id===(tool==='run_business_query'?args?.operation:tool))?.knowledge,
  excludedForPrompt:prompt=>excludeCompetingQueries(operations,prompt),
  toolsForPrompt(prompt,excluded=new Set()){
   if(typeof prompt!=='string'||!prompt.trim())return [];
   const match=discoveryRows(queryOperations.filter(operation=>!excluded.has(operation.id)),indexed,{search:prompt.slice(0,240),page:1});
   return match.operations.filter(item=>item.kind==='READ'||item.kind==='GUIDANCE').slice(0,2).map(item=>queryTool(assistantQuery(item.operation)));
  },
  async execute(id,args,signal,{correctArguments=false,excluded=new Set(),prompt,history,withOutcome=false}={}){
   const enveloped=id==='run_business_query';
   if(isQueryEnvelope(id)){
    const parsed=queryEnvelopeArguments(id,args);
    if(id==='find_business_queries'){
     const current=loadConfig?await loadConfig():config||{};
     const plan=planned(prompt);
     const result=discoveryRows(queryOperations.filter(operation=>!excluded.has(operation.id)&&(!plan||operation.id===plan.id)),
      withGuide(businessCapabilities(current,access||{}),current),plan?{search:plan.id,page:1}:parsed);
     return withOutcome?{...result,query_outcome:outcomeFor(result)}:result;
    }
    id=parsed.operation;args=parsed.args;
   }
   const operation=assistantQuery(id);
   const plan=planned(prompt);
   if(excluded.has(id)||plan&&plan.id!==id)throw new AssistantError('tool_not_allowed',403);
   // ACTION requires a separate, server-owned execution authority and confirmed
   // intent. Neither a tool argument nor the human's existing permission grants it.

   const current=loadConfig?await loadConfig():config||{};
   if(operation.kind==='ACTION'&&current.ai_action_authorizations?.[id]!==true)throw new AssistantError('action_not_authorized',403);
   if(operation.kind==='GUIDANCE'){
    if(!guideAvailable(current,access||{}))throw new AssistantError('business_read_denied',403);
   }else{
    if(!capabilityConnected(current,id))throw new AssistantError('capability_disconnected',403);
    if(!operation.authorized(access||{}))throw new AssistantError(operation.deniedCode,403);
   }
   if(operation.kind==='READ'&&typeof prompt==='string'&&operation.scopeTextArguments)args=operation.scopeTextArguments(args,prompt);
   const domain=domainOf(operation);
   try{
    if(args===undefined)throw new AssistantError('tool_arguments_invalid',400);
    if(operation.kind==='READ'&&args&&typeof args==='object'&&!Array.isArray(args)){
     args={...args};
     const properties=operation.tool.parameters.properties;
     const accepted=queryTool(operation).parameters.properties;
     if(Object.keys(args).some(key=>!Object.hasOwn(accepted,key)))throw new AssistantError('tool_arguments_invalid',400);
     if(properties.outlet_id){
      if(args.outlet_name!=null&&(typeof args.outlet_name!=='string'||!args.outlet_name.trim()||args.outlet_name.length>120))
       throw new AssistantError('tool_arguments_invalid',400);
      // Only an independently identified single-domain turn can bind a name from the whole utterance.
      const explicit=plan&&prompt?await explicitNamedOutlet(caller,prompt,signal):null;
      if(explicit)args.outlet_name=explicit;
      if(plan&&!explicit){
       const wording=' '+entityKey(prompt)+' ';
       const supplied=args.outlet_name||args.outlet_id;
       if(!supplied||!wording.includes(' '+entityKey(supplied)+' ')){
        if(!outletContinuation(prompt))throw new AssistantError('entity_scope_required',409);
        args.outlet_name=null;
        args.outlet_id=null;
       }
      }
      if(!args.outlet_name&&history&&outletContinuation(prompt)){
       const previous=confirmedOutlet(await history(),id,domain);
       if(!previous)throw new AssistantError('entity_scope_required',409);
       args.outlet_id=previous;
      }
      if(!properties.outlet_name){
       if(args.outlet_name){
        const outlet=await resolveOutlet(caller,{outlet_name:args.outlet_name},signal);
        if(!outlet)throw new AssistantError('entity_unresolved',409);
        args.outlet_id=outlet.id;
       }
       delete args.outlet_name;
      }
     }
     if(properties.brand_id&&!properties.brand_name){
      if(args.brand_name!=null){
       if(typeof args.brand_name!=='string'||!args.brand_name.trim()||args.brand_name.length>120)throw new AssistantError('tool_arguments_invalid',400);
       const brand=await resolveBrand(caller,args.brand_name,signal);
       if(!brand)throw new AssistantError('entity_unresolved',409);
       args.brand_id=brand.id;
       if(properties.organization_id&&brand.organization_id)args.organization_id=brand.organization_id;
      }
      delete args.brand_name;
     }
    }
    operation.validate(args);
   }catch(error){
    if((enveloped||correctArguments)&&error.code==='tool_arguments_invalid')return {error:'tool_arguments_invalid',not_business_evidence:true,no_evidence:true,
     ...(withOutcome?{query_outcome:'UNSUPPORTED'}:{}),operation:id,operation_label:operation.label,parameters:queryTool(operation).parameters,validation:error.diagnostic?.validation,instruction:'Correct the argument using the exact schema and operation description. Preserve explicit, supported filters. No business read or action occurred.'};
    throw error;
   }
   signal?.throwIfAborted();
   // caller is the authenticated human client, never the service-role client.
   const evidence=await (readFactory&&id===finishedGoodsRead.id?readFactory(args,signal):operation.execute(caller,args,signal,sessionId));
   return withOutcome&&operation.kind!=='ACTION'?{...evidence,query_outcome:outcomeFor(evidence),query_domain:domain}:evidence;
  },
  format(id,evidence,prompt){return assistantQuery(id).format?.(evidence,prompt)||null;},
 };
}

export async function businessAccess(caller){
 const unique=[...new Set(operations.map(o=>o.permission))];
 const {data,error}=await caller.rpc('native_assistant_permissions',{p_codes:unique});
 if(error||!data||typeof data!=='object'||Array.isArray(data))throw new AssistantError('admin_required',403);
 const permissions=Object.fromEntries(unique.map(permission=>[permission,data[permission]===true]));
 return {admin:true,permissions,factory:permissions['factory_finished_goods.view']===true};
}

// Explicit existing members only. Never derive blanket access from module IDs.
export function modulePolicyMembers(id){
 const members=operations.filter(o=>o.kind==='READ'&&o.policyGroup===id);
 if(!members.length)throw new AssistantError('tool_not_allowed',403);
 return members.map(o=>o.id);
}
