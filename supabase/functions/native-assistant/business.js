import {queryDiscoveryTools,isQueryEnvelope,queryEnvelopeArguments,discoverQueries} from '../_shared/assistant/queryDiscovery.js';
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

// Composition of implemented module contracts, not a permission or grant store.
// Discovery never makes a module executable. ACTION tools create previews only.
export const operations = [employeeDirectoryRead,...restaurantGapReads,...peopleGapReads,...financeGapReads,...marketingGapReads,...factoryGapReads,...crewGapReads,finishedGoodsRead,cleaningRead,employmentRead,leaveRead,reportRead,plannerRead,draftAction,captionAction,...factoryPlatformReads,...crewPlatformReads,...marketingPlatformReads,...peoplePlatformReads,...factoryCatalogueReads,...peopleCatalogueReads,...restaurantCatalogueReads,assetCatalogueRead,...financePlatformReads];
export function validateBusinessArguments(id,args){
 if(isQueryEnvelope(id)){const parsed=queryEnvelopeArguments(id,args);if(id==='run_business_query')businessOperation(parsed.operation);return parsed;}
 const operation=operations.find(item=>item.id===id);
 if(!operation)throw new AssistantError('tool_not_allowed',403);
 return operation.validate(args);
}
export function capabilityConnected(config,id){return config.capability_connections?.[id]===true;}
export function businessOperation(id){const operation=operations.find(item=>item.id===id);if(!operation)throw new AssistantError('tool_not_allowed',403);return operation;}
export function businessToolIdentity(tool, args) {
 const id = tool === 'run_business_query' ? args?.operation : tool;
 const operation = operations.find(item => item.id === id);
 if (operation) return { operation: operation.id, operation_label: operation.label };
 if (tool === 'find_business_queries') return { operation: tool, operation_label: 'FeedX query discovery' };
 return {};
}
export function businessToolArgumentShape(tool, args) {
 const id = businessToolIdentity(tool, args).operation;
 const parameters = operations.find(item => item.id === id)?.tool.parameters
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
  connection_enabled:capabilityConnected(config,operation.id),test_supported:operation.kind==='READ',test_parameters:operation.kind==='READ'?operation.tool.parameters.properties:undefined,
  ai_execution_enabled:operation.kind==='ACTION'?config.ai_action_authorizations?.[operation.id]===true:undefined,
  availability:!capabilityConnected(config,operation.id)||operation.kind==='ACTION'&&config.ai_action_authorizations?.[operation.id]!==true?'disabled':operation.authorized(access)?'connected':'denied'}));
}
export function createBusinessDispatcher({caller,config,access,readFactory,loadConfig,sessionId}={}){
 const capabilities=businessCapabilities(config||{},access||{});
 const resolve=id=>{const operation=operations.find(item=>item.id===id);if(!operation)throw new AssistantError('tool_not_allowed',403);return operation;};
 return {
  capabilities,
  tools:(()=>{const offered=operations.filter(operation=>capabilities.find(item=>item.id===operation.id)?.availability==='connected');return offered.length>8?queryDiscoveryTools:offered.map(operation=>operation.tool);})(),
  toolsForPrompt(prompt){
   if(typeof prompt!=='string'||!prompt.trim())return [];
   const match=discoverQueries(operations,capabilities,{search:prompt.slice(0,240),page:1});
   return match.operations.filter(item=>item.kind==='READ').slice(0,2).map(item=>resolve(item.operation).tool);
  },
  async execute(id,args,signal){
   const enveloped=id==='run_business_query';
   if(isQueryEnvelope(id)){
    const parsed=queryEnvelopeArguments(id,args);
    if(id==='find_business_queries'){const current=loadConfig?await loadConfig():config||{};return discoverQueries(operations,businessCapabilities(current,access||{}),parsed);}
    id=parsed.operation;args=parsed.args;
   }
   const operation=resolve(id);
   // ACTION requires a separate, server-owned execution authority and confirmed
   // intent. Neither a tool argument nor the human's existing permission grants it.

   const current=loadConfig?await loadConfig():config||{};
   if(operation.kind==='ACTION'&&current.ai_action_authorizations?.[id]!==true)throw new AssistantError('action_not_authorized',403);
   if(!capabilityConnected(current,id))throw new AssistantError('capability_disconnected',403);
   if(!operation.authorized(access||{}))throw new AssistantError(operation.deniedCode,403);
   try{
    if(args===undefined)throw new AssistantError('tool_arguments_invalid',400);
    operation.validate(args);
   }catch(error){
    if(enveloped&&error.code==='tool_arguments_invalid')return {error:'tool_arguments_invalid',not_business_evidence:true,no_evidence:true,operation:id,operation_label:operation.label,parameters:operation.tool.parameters,instruction:'Encode a valid JSON object with this exact schema. Preserve only explicit, supported filters. Null optional scope filters mean the current authorized scope. No business read or action occurred.'};
    throw error;
   }
   signal?.throwIfAborted();
   // caller is the authenticated human client, never the service-role client.
   return readFactory&&id===finishedGoodsRead.id?readFactory(args,signal):operation.execute(caller,args,signal,sessionId);
  },
  format(id,evidence){return resolve(id).format?.(evidence)||null;},
 };
}

export async function businessAccess(caller){
 const unique=[...new Set(operations.map(o=>o.permission))];
 const {data,error}=await caller.rpc('native_assistant_permissions',{p_codes:unique});
 if(error||!data||typeof data!=='object'||Array.isArray(data))throw new AssistantError('admin_required',403);
 const permissions=Object.fromEntries(unique.map(permission=>[permission,data[permission]===true]));
 return {permissions,factory:permissions['factory_finished_goods.view']===true};
}

// Explicit existing members only. Never derive blanket access from module IDs.
export function modulePolicyMembers(id){
 const members=operations.filter(o=>o.kind==='READ'&&o.policyGroup===id);
 if(!members.length)throw new AssistantError('tool_not_allowed',403);
 return members.map(o=>o.id);
}
