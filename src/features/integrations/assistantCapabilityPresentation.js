import {reconcileBusinessModules,businessWorkspaceLabels as workspaceLabels} from './businessModuleProjection.js';
import {moduleSectionOrder} from '../../../config/modules.ts';
import {assistantKnowledgeSources} from './assistantKnowledgeSources.js';

export const capabilityStatuses={connected:'Enabled',disabled:'Disabled',partial:'Partially enabled',unsupported:'Not supported',unavailable:'Unavailable'};
// Normalized business inventory. Navigation and machine grants never grant Native execution.
export function capabilityInventory(capabilities=[]){
 return reconcileBusinessModules().business.map(module=>{
  const operations=capabilities.filter(operation=>operation.module_id===module.id||operation.related_module_ids?.includes(module.id));
  const sources=assistantKnowledgeSources.filter(source=>source.module_ids.some(id=>id===module.id||module.linkedEntries.some(entry=>entry.kind!=='external'&&entry.module.id===id)));
  const workspace=module.workspace,domain=module.section;
  const enabled=operations.filter(operation=>operation.connection_enabled===true&&(operation.kind!=='ACTION'||operation.ai_execution_enabled===true)).length;
  const unknown=operations.some(operation=>typeof operation.connection_enabled!=='boolean');
  return {id:module.id,label:module.label,module,workspace,workspaceLabel:workspaceLabels[workspace],domain,domainKey:`${workspace}:${domain}`,operations,sources,status:!operations.length?'unsupported':unknown?'unavailable':enabled===operations.length?'connected':enabled?'partial':'disabled'};
 }).sort((a,b)=>Object.keys(workspaceLabels).indexOf(a.workspace)-Object.keys(workspaceLabels).indexOf(b.workspace)||(moduleSectionOrder.includes(a.domain)?moduleSectionOrder.indexOf(a.domain):999)-(moduleSectionOrder.includes(b.domain)?moduleSectionOrder.indexOf(b.domain):999)||a.label.localeCompare(b.label));
}
export function filterCapabilityInventory(rows,{query='',workspace='all',domain='all',status='all'}={}){
 const term=query.trim().toLocaleLowerCase();
 return rows.filter(row=>(workspace==='all'||row.workspace===workspace)&&(domain==='all'||row.domainKey===domain)&&(status==='all'||row.status===status)&&(!term||[row.label,row.id,row.workspaceLabel,row.domain,...row.operations.map(operation=>operation.label),...row.sources.map(source=>source.name)].join(' ').toLocaleLowerCase().includes(term)));
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
