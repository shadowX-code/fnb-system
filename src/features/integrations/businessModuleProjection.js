import {moduleRegistry,moduleWorkspace,workspaceLabels} from '../../../config/modules.ts';
import {canonicalRouteId} from '../../app/routeOwnership.js';
import factoryModules from '../../../config/factoryAgentModules.json';
import factoryActions from '../../../config/factoryAgentActions.json';
import hrActions from '../../../config/hrAgentActions.json';
import restaurantActions from '../../../config/restaurantAgentActions.json';

export const businessWorkspaceLabels={...workspaceLabels,platform:'Platform'};
// Presentation ownership only. Evidence: routeOwnership.js, routes.jsx and
// platform.md. These links never change navigation, permissions or executors.
const linked={
 crew_progress:['alias','crew_learning'],marketing_crm_legacy:['alias','marketing_campaigns'],
 marketing_brand_access:['alias','platform_organizations'],
 crew_feedback_follow_up:['permission','crew_customer_feedback'],
 inventory_categories:['permission','inventory_master'],inventory_uoms:['permission','inventory_master'],
 crew_leave_balance:['permission','crew_leave'],crew_leave_settings:['permission','crew_leave'],
 marketing_workspace:['permission',null],marketing_settings:['permission',null],guest_ai:['permission',null],
};
const platform=new Set(['roles','external_agents','ai_assistant','operations_network','platform_organizations','platform_customers','brands','audit-logs']);
const ids=new Set(moduleRegistry.map(m=>m.id));
const resolve=id=>ids.has(id)?id:moduleRegistry.find(m=>m.id.replaceAll('-','_')===id)?.id;
function externalOwners(module){
 const nav=module.id.match(/^(factory|hr|restaurant)_agent_nav_(.*)$/);
 if(nav)return [resolve(nav[2])].filter(Boolean);
 const action=module.id.match(/^(factory|hr|restaurant)_agent_action_(.*)$/);
 if(action){const actions={factory:factoryActions,hr:hrActions,restaurant:restaurantActions}[action[1]];return [...new Set(actions.filter(a=>a.key.split('.')[0]===action[2]).map(a=>resolve(a.module)).filter(Boolean))];}
 if(module.id.startsWith('factory_agent_'))return factoryModules.filter(m=>m.bindings?.some(b=>b.resource===module.id.slice('factory_agent_'.length))).map(m=>resolve(m.id)).filter(Boolean);
 return [];
}
export function reconcileBusinessModules(){
 const entries=moduleRegistry.map(module=>{
  if(/^(factory|hr|restaurant)_agent_/.test(module.id)||module.id==='factory_mesti_inspection')return {module,kind:'external',owners:externalOwners(module)};
  const canonical=canonicalRouteId(module.id);
  if(canonical!==module.id)return {module,kind:'alias',owners:[canonical]};
  if(linked[module.id])return {module,kind:linked[module.id][0],owners:linked[module.id][1]?[linked[module.id][1]]:[]};
  return {module,kind:'business',owners:[module.id]};
 });
 const business=entries.filter(e=>e.kind==='business').map(({module})=>({
  ...module,workspace:platform.has(module.id)?'platform':moduleWorkspace(module),section:platform.has(module.id)?'Platform Management':module.section,
  linkedEntries:entries.filter(e=>e.kind!=='business'&&e.owners.includes(module.id)),
 }));
 return {entries,business,counts:Object.fromEntries(['business','alias','permission','external','technical'].map(kind=>[kind,entries.filter(e=>e.kind===kind).length])),unmappedExternal:entries.filter(e=>e.kind==='external'&&!e.owners.length).map(e=>e.module.id)};
}
