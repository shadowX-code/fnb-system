import {expect,it} from 'vitest';
import {businessCapabilities} from '../../../supabase/functions/native-assistant/business.js';
import {capabilityResources,filterCapabilityResources} from './assistantCapabilityPresentation.js';
it('joins canonical owners without duplicating multi-module source entries or inventing operations',()=>{
 const rows=capabilityResources(businessCapabilities({factory_reads_enabled:true},{factory:true}));
 expect(rows).toHaveLength(5);
 expect(rows.filter(row=>row.domain==='factory')).toHaveLength(2);
 expect(rows.filter(row=>row.domain==='crew')).toHaveLength(1);
 expect(rows.filter(row=>row.domain==='hr')).toHaveLength(1);
 expect(rows.filter(row=>row.domain==='marketing')).toHaveLength(1);
 expect(rows.filter(row=>row.type==='source').every(row=>row.status==='unavailable'&&!row.operations.length)).toBe(true);
 expect(rows.find(row=>row.domain==='hr').modules).toHaveLength(2);
});
it('combines search, canonical domain, type and actual availability without changing totals',()=>{
 const rows=capabilityResources(businessCapabilities({factory_reads_enabled:true},{factory:false}));
 expect(filterCapabilityResources(rows,{status:'connected'})).toHaveLength(0);
 expect(filterCapabilityResources(rows,{status:'denied'})).toHaveLength(1);
 expect(filterCapabilityResources(rows,{query:'SOP',domain:'factory',type:'source',status:'unavailable'})).toHaveLength(1);
 expect(filterCapabilityResources(rows,{query:'nonexistent'})).toHaveLength(0);
 expect(rows).toHaveLength(5);
});
it('missing or unresolved operation ownership never fabricates a callable resource',()=>{
 expect(capabilityResources([])).toHaveLength(4);
 expect(capabilityResources([{id:'fake',module_id:'not_a_module',kind:'ACTION',availability:'connected'}]).every(row=>row.type==='source')).toBe(true);
});
