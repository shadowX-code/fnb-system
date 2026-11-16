import {it,expect} from 'vitest';
import {moduleRegistry,moduleWorkspace} from '../../../config/modules.ts';
import {businessCapabilities} from '../../../supabase/functions/native-assistant/business.js';
import {capabilityInventory,filterCapabilityInventory,capabilityTableRows} from './assistantCapabilityPresentation.js';
const operations=businessCapabilities({capability_connections:{read_factory_finished_goods:true}},{factory:true});
it('reconciles every canonical module exactly once with its workspace and section',()=>{
 const rows=capabilityInventory(operations);
 expect(rows).toHaveLength(moduleRegistry.length);expect(new Set(rows.map(row=>row.id)).size).toBe(moduleRegistry.length);
 for(const module of moduleRegistry){const row=rows.find(row=>row.id===module.id);expect(row.workspace).toBe(moduleWorkspace(module));expect(row.domain).toBe(module.section);}
 expect(rows.filter(row=>row.operations.length)).toHaveLength(1);
 for(const [id,workspace] of [['factory_finished_goods','factory'],['crew_sop_library','crew'],['employee_employment_documents','hr'],['marketing_knowledge','marketing']])expect(rows.find(row=>row.id===id).workspace).toBe(workspace);
});
it('filters full inventory and collapses groups without losing modules',()=>{
 const rows=capabilityInventory(operations),factory=filterCapabilityInventory(rows,{workspace:'factory'});
 expect(factory.length).toBeGreaterThan(5);
 expect(filterCapabilityInventory(rows,{status:'connected'}).map(row=>row.id)).toEqual(['factory_finished_goods']);
 expect(filterCapabilityInventory(rows,{query:'employment',workspace:'hr'}).length).toBeGreaterThan(0);
 const table=capabilityTableRows(rows,new Set(['workspace:factory']));expect(table.some(row=>row.id==='factory_finished_goods')).toBe(false);expect(table.some(row=>row.id==='workspace:factory')).toBe(true);
 expect(capabilityTableRows(rows).filter(row=>!row.group)).toHaveLength(moduleRegistry.length);
});
it('does not synthesize operations from source metadata or unresolved contracts',()=>{
 expect(capabilityInventory([{id:'fake',module_id:'missing'}]).flatMap(row=>row.operations)).toEqual([]);
 expect(capabilityInventory().find(row=>row.id==='crew_sop_library').status).toBe('source');
 expect(capabilityInventory().find(row=>row.id==='factory_finished_goods').status).toBe('unsupported');
});
