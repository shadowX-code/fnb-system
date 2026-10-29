// @vitest-environment node
import {expect,it} from "vitest";
import {readFileSync} from "node:fs";
import modules from "../../../config/factoryAgentModules.json";
import {factoryResourceNames,resourceArguments,factoryResourceTool} from "../factory-mesti-mcp/resources.js";
const migration=readFileSync(new URL('../../migrations/20261029133257_factory_agent_read_coverage_completion.sql',import.meta.url),'utf8');
it('registers read coverage without issuing grants, keys, writes or new MCP mutation tools',()=>{
 expect(factoryResourceNames).toHaveLength(65);expect(modules.flatMap(m=>m.bindings)).toHaveLength(97);
 expect(migration).not.toMatch(/(?:insert into|update|delete from)\s+(?:public\.)?(?:role_permissions|factory_productions|factory_job_orders|machine_credentials|machine_identities)\b/i);
 expect(migration).not.toContain('factory_release_due_job_orders');
 expect(factoryResourceTool.annotations).toMatchObject({readOnlyHint:true,destructiveHint:false});
});
it('separates genuine capability gaps from privacy/history notes and attaches every report input to its source module',()=>{
 expect(modules.filter(m=>m.coverage==='available')).toHaveLength(30);
 expect(modules.filter(m=>m.coverage==='limited')).toHaveLength(3);
 expect(modules.filter(m=>m.coverage==='limited').every(m=>m.capability_limitation)).toBe(true);
 expect(modules.filter(m=>m.coverage==='available').every(m=>!m.capability_limitation)).toBe(true);
 for(const b of modules.find(m=>m.id==='factory_job_orders').bindings.filter(b=>['production_records','material_usage','product_movements','receiving_costs'].includes(b.resource)))expect(b.requires_modules).toHaveLength(1);
 const source=modules.find(m=>m.id==='factory_production_sop').bindings.find(b=>b.resource==='sop_material_bindings');expect(source.relationships.raw_material_id).toBe('factory_raw_inventory');
 for(const name of ['factory_mesti_food_processing_control','factory_mesti_finished_product_storage_control'])expect(modules.find(m=>m.id===name).bindings.some(b=>b.resource==='schedules')).toBe(true);
});
it('accepts bounded new resource operations and preserves the old review request shape',()=>{
 const q={resource:'production_pipeline',business_module:'factory_job_orders',action:'list',date_range:{from:'2026-10-28',to:'2026-10-28'},limit:1};
 expect(resourceArguments({queries:[q]},true).p_queries).toEqual([q]);
 expect(resourceArguments({queries:[{...q,business_module:undefined,resource:'mesti_review'}]},true).p_queries[0].resource).toBe('mesti_review');
 for(const bad of [{...q,limit:101},{...q,date_range:{from:'2026-09-01',to:'2026-10-28'}},{...q,action:'execute'}])expect(()=>resourceArguments({queries:[bad]},true)).toThrow();
});
it('reuses the live canonical projections and discloses unresolved evidence instead of fabricating it',()=>{
 for(const name of ['factory_mesti_food_processing_control','factory_mesti_finished_product_storage_control','factory_get_production_operational_pipeline_snapshot','factory_get_open_job_order_qty_by_sku'])expect(migration).toContain(name);
 expect(migration).toContain("original:=regexp_replace");expect(migration).toContain("Pinned SOP version cannot be resolved");expect(migration).toContain("batch projection is missing or ambiguous");
 expect(migration).toContain("'missing_required_modules'");expect(migration).toContain("'query_available'");
});

it('aligns MeSTI with completed-only canonical receiving and frozen Cleaning Method references',()=>{
 const alignment=readFileSync(new URL('../../migrations/20261029140834_factory_agent_mesti_evidence_alignment.sql',import.meta.url),'utf8');
 expect(alignment).toContain('factory_mesti_raw_material_control_receiving_report');expect(alignment).toContain('factory_mesti_raw_material_control_standards');
 expect(alignment).toContain("'issued_snapshot'");expect(alignment).toContain("'method_availability'");expect(alignment).not.toMatch(/perform public.factory_mesti_materialize|insert into public.factory_/);
 for(const module of modules.filter(m=>['factory_mesti_cleaning','factory_mesti_equipment_cleaning'].includes(m.id)))expect(module.bindings.find(b=>b.resource==='evidence').fields).toContain('cleaning_method_reference');
});
