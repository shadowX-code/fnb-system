import {reconcileBusinessModules,businessWorkspaceLabels as workspaceLabels} from './businessModuleProjection.js';
import {moduleSectionOrder} from '../../../config/modules.ts';
import {assistantCoverageReview} from './assistantCoverageReview.js';

export const capabilityStatuses={connected:'Enabled',disabled:'Disabled',partial:'Partially enabled',unsupported:'Not supported',unavailable:'Unavailable'};
const businessModules = reconcileBusinessModules().business;
const moduleLabels = new Map(businessModules.map(module => [module.id, module.label]));

export function capabilityOwnerLabel(moduleId) {
 return moduleLabels.get(moduleId);
}

// A READ can be exposed by several modules, but its policy belongs to one owner.
export function capabilityInventory(capabilities = [],guidance = []) {
 return businessModules.map(module => {
  const owned = capabilities.filter(operation => operation.module_id === module.id);
  const shared = capabilities.filter(operation => operation.kind === 'READ' && operation.module_id !== module.id && operation.related_module_ids?.includes(module.id));
  const operations = [...owned, ...shared];
  const sources = [
   ...operations.filter(operation=>operation.knowledge).map(operation=>({id:operation.id,module_id:operation.module_id,...operation.knowledge})),
   ...guidance.filter(source=>source.module_id===module.id),
  ];
  const enabled = operations.filter(operation => operation.connection_enabled === true && (operation.kind !== 'ACTION' || operation.ai_execution_enabled === true)).length;
  const unknown = operations.some(operation => typeof operation.connection_enabled !== 'boolean' || (operation.kind === 'ACTION' && operation.connection_enabled && typeof operation.ai_execution_enabled !== 'boolean'));
  const status = !operations.length ? 'unsupported' : unknown ? 'unavailable' : enabled === operations.length ? 'connected' : enabled ? 'partial' : 'disabled';
  const sharedOwners = [...new Set(shared.map(operation => capabilityOwnerLabel(operation.module_id) || 'owner unavailable'))];
  const statusLabel = !owned.length && shared.length ? `${capabilityStatuses[status]} via ${sharedOwners.join(', ')}` : capabilityStatuses[status];
  const review = assistantCoverageReview[module.id];
  const workspace = module.workspace, domain = module.section;
  return {
   id: module.id, label: module.label, module, workspace, workspaceLabel: workspaceLabels[workspace], domain, domainKey: `${workspace}:${domain}`,
   operations, sources, sharedReadCount: shared.length, status, statusLabel,
   coverage: review || (operations.length ? {classification: shared.length ? 'shared' : 'partial'} : {classification: 'missing', missing: 'No Assistant operations are available for this module.'}),
   // Reviewed references add context in the drawer. They cannot confer module access.
   coverageReads: (review?.reads || []).map(id => capabilities.find(operation => operation.id === id && operation.kind === 'READ')).filter(Boolean),
  };
 }).sort((a,b) => Object.keys(workspaceLabels).indexOf(a.workspace)-Object.keys(workspaceLabels).indexOf(b.workspace)||(moduleSectionOrder.includes(a.domain)?moduleSectionOrder.indexOf(a.domain):999)-(moduleSectionOrder.includes(b.domain)?moduleSectionOrder.indexOf(b.domain):999)||a.label.localeCompare(b.label));
}
export function filterCapabilityInventory(rows,{query='',workspace='all',domain='all',status='all'}={}){
 const term=query.trim().toLocaleLowerCase();
 return rows.filter(row=>(workspace==='all'||row.workspace===workspace)&&(domain==='all'||row.domainKey===domain)&&(status==='all'||row.status===status)&&(!term||[row.label,row.id,row.workspaceLabel,row.domain,...row.operations.map(operation=>operation.label),...row.sources.map(source=>source.authority)].join(' ').toLocaleLowerCase().includes(term)));
}
export function capabilityTableRows(inventory,collapsed=new Set()){
 const result=[];
 for(const workspace of new Set(inventory.map(row=>row.workspace))){
  const modules=inventory.filter(row=>row.workspace===workspace),id=`workspace:${workspace}`;
  result.push({id,group:'workspace',label:modules[0].workspaceLabel,count:modules.length});
  if(collapsed.has(id))continue;
  for(const domainKey of new Set(modules.map(row=>row.domainKey))){
   const children=modules.filter(row=>row.domainKey===domainKey),key=`domain:${domainKey}`;
   result.push({id:key,group:'domain',label:children[0].domain,count:children.length});
   if(!collapsed.has(key))result.push(...children);
  }
 }
 return result;
}
