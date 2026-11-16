import {AssistantError} from '../_shared/assistantError.js';
import {finishedGoodsRead} from '../_shared/factory/finishedGoodsRead.js';

// Composition of implemented module contracts, not a permission or grant store.
// Discovery never makes a module executable. No ACTION executor is registered.
const operations = [finishedGoodsRead];
export function validateBusinessArguments(id,args){
 const operation=operations.find(item=>item.id===id);
 if(!operation)throw new AssistantError('tool_not_allowed',403);
 return operation.validate(args);
}
export function capabilityConnected(config,id){return config.capability_connections?.[id]===true;}
export function businessOperation(id){const operation=operations.find(item=>item.id===id);if(!operation)throw new AssistantError('tool_not_allowed',403);return operation;}
export function businessCapabilities(config,access){
 return operations.map(operation=>({id:operation.id,module_id:operation.module_id,kind:operation.kind,version:operation.version,
  label:operation.label,scope:operation.scope,permission:operation.permission,
  connection_enabled:capabilityConnected(config,operation.id),test_supported:!!operation.testArguments,
  availability:!capabilityConnected(config,operation.id)?'disabled':operation.authorized(access)?'connected':'denied'}));
}
export function createBusinessDispatcher({caller,config,access,readFactory,loadConfig}={}){
 const capabilities=businessCapabilities(config||{},access||{});
 const resolve=id=>{const operation=operations.find(item=>item.id===id);if(!operation)throw new AssistantError('tool_not_allowed',403);return operation;};
 return {
  capabilities,
  tools:operations.filter(operation=>capabilities.find(item=>item.id===operation.id)?.availability==='connected').map(operation=>operation.tool),
  async execute(id,args,signal){
   const operation=resolve(id);
   // ACTION requires a separate, server-owned execution authority and confirmed
   // intent. Neither a tool argument nor the human's existing permission grants it.
   if(operation.kind!=='READ')throw new AssistantError('action_not_authorized',403);
   const current=loadConfig?await loadConfig():config||{};
   if(!capabilityConnected(current,id))throw new AssistantError('capability_disconnected',403);
   if(!operation.authorized(access||{}))throw new AssistantError(operation.deniedCode,403);
   operation.validate(args);signal?.throwIfAborted();
   // caller is the authenticated human client, never the service-role client.
   return readFactory?readFactory(args,signal):operation.execute(caller,args,signal);
  },
  format(id,evidence){return resolve(id).format?.(evidence)||null;},
 };
}
