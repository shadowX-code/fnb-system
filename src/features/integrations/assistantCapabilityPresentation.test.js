import {it,expect} from 'vitest';
import {moduleRegistry} from '../../../config/modules.ts';
import {businessCapabilities} from '../../../supabase/functions/native-assistant/business.js';
import {reconcileBusinessModules} from './businessModuleProjection.js';
import {capabilityInventory,filterCapabilityInventory,capabilityTableRows} from './assistantCapabilityPresentation.js';
const operations=businessCapabilities({capability_connections:{read_factory_finished_goods:true}},{factory:true});
it('accounts for all registry entries without counting aliases or external authorities as business modules',()=>{
 const r=reconcileBusinessModules();expect(r.entries).toHaveLength(moduleRegistry.length);expect(r.counts).toEqual({business:128,alias:12,permission:8,external:138,technical:0});
 expect(new Set(r.entries.map(e=>e.module.id)).size).toBe(286);expect(new Set(r.business.map(m=>m.id)).size).toBe(128);
 expect(r.unmappedExternal).toEqual(['factory_agent_mesti_review','factory_mesti_inspection']);
 const rows=capabilityInventory(operations);expect(rows).toHaveLength(128);expect(rows.flatMap(r=>r.operations)).toHaveLength(7);
 expect(rows.some(r=>/^(factory|hr|restaurant)_agent_/.test(r.id))).toBe(false);
});
it('uses Platform ownership without rewriting route metadata and preserves distinct embedded business lifecycles',()=>{
 const rows=capabilityInventory();for(const id of ['roles','external_agents','brands','platform_organizations','platform_customers','ai_assistant','operations_network','audit-logs'])expect(rows.find(r=>r.id===id).workspace).toBe('platform');
 expect(moduleRegistry.find(m=>m.id==='external_agents').workspace).toBe('restaurant');
 for(const id of ['crew_cash_deposit','employee_employment_documents','employment_contract_templates','factory_job_orders','factory_job_order_records','factory_production_reports'])expect(rows.some(r=>r.id===id)).toBe(true);
 expect(rows.find(r=>r.id==='crew_roster').module.linkedEntries.map(e=>e.module.id)).toEqual(expect.arrayContaining(['duty-roster','outlet_duty_roster']));
});
it('filters and collapses normalized inventory; external operations cannot become Native connectivity',()=>{
 const rows=capabilityInventory([...operations,{id:'external',module_id:'factory_agent_finished_goods',availability:'connected'}]);
 expect(filterCapabilityInventory(rows,{status:'connected'}).map(r=>r.id)).toEqual(['factory_finished_goods']);
 expect(filterCapabilityInventory(rows,{workspace:'platform',query:'AI Integrations'}).map(r=>r.id)).toEqual(['external_agents']);
 expect(capabilityTableRows(rows).filter(r=>!r.group)).toHaveLength(128);
 expect(capabilityTableRows(rows,new Set(['workspace:factory'])).some(r=>r.id==='factory_finished_goods')).toBe(false);
});
