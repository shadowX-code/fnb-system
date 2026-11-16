import {moduleRegistry,moduleWorkspace,workspaceLabels} from '../../../config/modules.ts';
import {assistantKnowledgeSources} from './assistantKnowledgeSources.js';

export const capabilityStatuses={connected:'Connected',disabled:'Disabled',denied:'Access denied',partial:'Partial access',unavailable:'Not connected'};
export const capabilityResourceTypes={registered:'Registered capability',source:'Source only'};
// Pure presentation join; neither registers operations nor grants access.
export function capabilityResources(capabilities=[]){
 const resources=[];
 for(const module of moduleRegistry){
  const operations=capabilities.filter(operation=>operation.module_id===module.id);
  if(!operations.length)continue;
  const states=[...new Set(operations.map(operation=>Object.hasOwn(capabilityStatuses,operation.availability)?operation.availability:'unavailable'))];
  const domain=moduleWorkspace(module);
  resources.push({id:module.id,label:module.label,domain,domainLabel:workspaceLabels[domain],type:'registered',modules:[module],operations,sources:[],status:states.length===1?states[0]:'partial'});
 }
 for(const source of assistantKnowledgeSources){
  const modules=moduleRegistry.filter(module=>source.module_ids.includes(module.id));
  for(const domain of new Set(modules.map(moduleWorkspace)))resources.push({id:`source:${source.module_ids.join(':')}:${domain}`,label:source.name,domain,domainLabel:workspaceLabels[domain],type:'source',modules:modules.filter(module=>moduleWorkspace(module)===domain),operations:[],sources:[source],status:'unavailable'});
 }
 return resources.sort((a,b)=>Number(a.type==='source')-Number(b.type==='source')||a.domainLabel.localeCompare(b.domainLabel)||a.label.localeCompare(b.label));
}
export function filterCapabilityResources(resources,{query='',domain='all',type='all',status='all'}){
 const term=query.trim().toLocaleLowerCase();
 return resources.filter(resource=>(domain==='all'||resource.domain===domain)&&(type==='all'||resource.type===type)&&(status==='all'||resource.status===status)&&(!term||[resource.label,resource.domainLabel,...resource.modules.map(module=>module.label),...resource.operations.map(operation=>operation.label)].join(' ').toLocaleLowerCase().includes(term)));
}
