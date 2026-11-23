import {it,expect} from 'vitest';
import {moduleRegistry} from '../../../config/modules.ts';
import {businessCapabilities} from '../../../supabase/functions/native-assistant/business.js';
import {reconcileBusinessModules} from './businessModuleProjection.js';
import {capabilityInventory,filterCapabilityInventory,capabilityTableRows} from './assistantCapabilityPresentation.js';
const operations=businessCapabilities({capability_connections:{read_factory_finished_goods:true}},{factory:true});
it('accounts for all registry entries without counting aliases or external authorities as business modules',()=>{
 const r=reconcileBusinessModules();expect(r.entries).toHaveLength(moduleRegistry.length);expect(r.counts).toEqual({business:129,alias:12,permission:8,external:138,technical:0});
 expect(new Set(r.entries.map(e=>e.module.id)).size).toBe(moduleRegistry.length);expect(new Set(r.business.map(m=>m.id)).size).toBe(129);
 expect(r.unmappedExternal).toEqual(['factory_agent_mesti_review','factory_mesti_inspection']);
 const rows=capabilityInventory(operations);expect(rows).toHaveLength(129);expect(new Set(rows.flatMap(r=>r.operations).map(o=>o.id)).size).toBe(112);
 expect(rows.some(r=>/^(factory|hr|restaurant)_agent_/.test(r.id))).toBe(false);
 expect(rows.find(r=>r.id==='space_station')).toMatchObject({workspace:'space_station',status:'unsupported',operations:[]});
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
 expect(capabilityTableRows(rows).filter(r=>!r.group)).toHaveLength(129);
 expect(capabilityTableRows(rows,new Set(['workspace:factory'])).some(r=>r.id==='factory_finished_goods')).toBe(false);
});

it('keeps reviewed coverage separate from administrator policy',async()=>{
 const {assistantCoverageReview}=await import('./assistantCoverageReview.js');
 expect(assistantCoverageReview.asset_tracking.classification).toBe('partial');
 expect(assistantCoverageReview.space_station.classification).toBe('not_applicable');
 const rows=capabilityInventory(operations);expect(rows.filter(r=>r.operations.length)).toHaveLength(116);
 for(const row of rows)expect(row.coverage.classification).toBeTruthy();
 for(const review of Object.values(assistantCoverageReview))expect(review.missing).toBeTruthy();
 for(const [id,review] of Object.entries(assistantCoverageReview)){
  const row=rows.find(r=>r.id===id);
  expect(row,id).toBeDefined();
  expect(row.coverage.classification,id).toBe(review.classification);
  expect(row.coverageReads.map(operation=>operation.id),id).toEqual(row.coverage.reads);
 }
 const enabled=capabilityInventory(operations.map(o=>({...o,connection_enabled:true,ai_execution_enabled:true})));
 expect(enabled.map(r=>r.coverage.classification)).toEqual(rows.map(r=>r.coverage.classification));
 expect(rows.find(r=>r.id==='crew_operations').status).toBe('disabled');
 expect(rows.find(r=>r.id==='finance_cash').status).toBe('unsupported');
 expect(enabled.find(r=>r.id==='recipe_intelligence').coverage.classification).toBe('partial');
});

it('shared-only policy follows the registered owner, independently of coverage references and the current user',()=>{
 const owner='read_factory_operational_pipeline';
 const data=businessCapabilities({capability_connections:{[owner]:true}},{});
 const rows=capabilityInventory(data);
 const job=rows.find(row=>row.id==='factory_job_orders');
 const dashboard=rows.find(row=>row.id==='factory_dashboard');
 expect(job.statusLabel).toBe('Enabled');
 expect(dashboard.statusLabel).toBe(`Enabled via ${job.label}`);
 expect(dashboard.sharedReadCount).toBe(1);
 expect(dashboard.coverageReads.length).toBeGreaterThan(dashboard.sharedReadCount);
 expect(dashboard.operations.map(o=>o.id)).toEqual([owner]);
 const off=capabilityInventory(businessCapabilities({},{})).find(row=>row.id===dashboard.id);
 expect(off.statusLabel).toBe(`Disabled via ${job.label}`);
 expect(off.coverage).toEqual(dashboard.coverage);
});
it('ACTION controls belong exclusively to the registered owner and never inherit a shared READ link',()=>{
 const rows=capabilityInventory(operations.map(o=>({...o,related_module_ids:o.kind==='ACTION'?['finance_cash']:o.related_module_ids})));
 const actions=rows.flatMap(row=>row.operations.filter(o=>o.kind==='ACTION').map(o=>({id:o.id,module:row.id,access:o.connection_enabled,execute:o.ai_execution_enabled})));
 expect(actions).toEqual(['prepare_marketing_draft','prepare_marketing_caption'].map(id=>({id,module:'marketing_calendar',access:false,execute:false})));
 expect(rows.find(row=>row.id==='finance_cash').status).toBe('unsupported');
});
