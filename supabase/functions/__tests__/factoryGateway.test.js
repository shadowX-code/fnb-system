// @vitest-environment node
import {expect,it,vi} from "vitest";
import {moduleRegistry,getPermissionDefinitions} from "../../../config/modules.ts";
import coverage from "../../../config/factoryAgentCoverage.json";
import modules from "../../../config/factoryAgentModules.json";
import {getSidebarSections,getPermissionGroups} from "../../../config/modules.ts";
import navigation from "../../../config/factoryAgentNavigation.json";
import projections from "../../../config/factoryAgentResources.json";
import {factoryResourceNames,factoryBusinessModules,factoryResourceTool,resourceArguments,safeResourceActions} from "../factory-mesti-mcp/resources.js";
import {createHandler} from "../factory-mesti-mcp/protocol.js";
it("matches all sidebar modules and active related route owners and exact sidebar sections, labels and ordering",()=>{
 const business=moduleRegistry.filter((m)=>m.workspace==="factory" && m.routable!==false && !m.agentNavigationOwner);
 expect(business).toHaveLength(33);expect(modules).toHaveLength(33);
 for(const module of business){const entry=modules.find((row)=>row.id===module.id);expect(entry).toMatchObject({label:module.label,section:module.section,sidebar:module.sidebar});expect(entry.explanation.length).toBeGreaterThan(20);for(const slug of navigation[module.id])expect(factoryResourceNames).toContain(slug);}
 const sections=getSidebarSections("factory");expect([...new Set(modules.map((m)=>m.section))]).toEqual(sections.map((s)=>s.label));
 for(const section of sections)expect(modules.filter((m)=>m.section===section.label&&m.sidebar).map((m)=>({id:m.id,label:m.label}))).toEqual(section.items);
 expect(factoryBusinessModules).toEqual(modules.map((m)=>m.id));
 expect(factoryResourceNames.toSorted()).toEqual(coverage.map((r)=>r.slug).toSorted());
 const visible=getPermissionGroups().flatMap((g)=>g.modules);
 for(const resource of coverage)expect(visible.some((m)=>m.key===`factory_agent_${resource.slug}`)).toBe(false);
 for(const module of modules){const entry=moduleRegistry.find((m)=>m.id===`factory_agent_nav_${module.id}`);expect(entry.permissions).toEqual(module.coverage==="unavailable"?{}:{view:true});expect(entry.permissionEditorHidden).toBe(true);expect(visible.some(m=>m.key===entry.id)).toBe(false);if(module.coverage!=="unavailable")expect(getPermissionDefinitions().some(p=>p.code===`${entry.id}.view`)).toBe(true);}
 expect(visible.some(m=>m.key==="factory_mesti_inspection")).toBe(false);expect(getPermissionDefinitions().some(p=>p.code==="factory_mesti_inspection.view")).toBe(true);
});
it("pins shared MeSTI rows to one business module and declares all report dependencies",()=>{
 for(const module of modules.filter((m)=>m.id.startsWith("factory_mesti_")&&m.id!=="factory_mesti_raw_material_control"))for(const binding of module.bindings){expect(binding.row_scope.module).toBeTruthy();expect(binding.fields).not.toContain("employee_id");expect(binding.fields).toContain("completion_result");}
 const reports=modules.find((m)=>m.id==="factory_job_orders");expect(reports.coverage).toBe("limited");expect(reports.bindings).toHaveLength(6);expect(reports.bindings.every((b)=>b.requires_modules.length>0)).toBe(true);
 for(const slug of ["dashboard","production_performance","traceability"]){const binding=modules.flatMap((m)=>m.bindings).find((b)=>b.resource===slug);expect(binding.requires_modules.length).toBeGreaterThan(2);for(const id of binding.requires_modules)expect(modules.some((m)=>m.id===id)).toBe(true);}
});
it("registers explicit safe projections without sensitive master or employee payloads",()=>{
 const banned=["employee_id","operator_name","operator_id","symptoms","health_status","phone","email","notes","remarks","receipt_path","public_token","session_hash","answers"];
 for(const projection of projections)for(const field of projection.fields)expect(banned).not.toContain(field);
});
it("uses bounded operations under the shared resource tool and never logs arbitrary IDs or search text",async()=>{
 const query={resource:"job_orders",action:"list",date_range:{from:"2026-10-01",to:"2026-10-31"},limit:1};
 expect(resourceArguments({queries:[query]},true).p_queries).toEqual([query]);
 for(const resource of ["employees","auth_users","arbitrary_table"])expect(()=>resourceArguments({queries:[{...query,resource}]},true)).toThrow();
 expect(safeResourceActions([{...query,search:"PRIVATE",sql:"select *"}])).toEqual([{resource:"job_orders",action:"list"}]);
 const read=vi.fn().mockResolvedValue({tools:[factoryResourceTool.name],resource_actions:[{resource:"job_orders",action:"list"}]});
 const request=new Request("https://example.test/mcp",{method:"POST",headers:{authorization:`Bearer fxm_${"a".repeat(43)}`,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:factoryResourceTool.name,arguments:{queries:[query,{...query,resource:"production_records"}]}}})});
 expect((await(await createHandler(read)(request)).json()).error.code).toBe(-32003);expect(read).toHaveBeenCalledTimes(1);
});
it("parses both deployed Edge entrypoints before delivery",async()=>{
 const {readFileSync}=await import('node:fs');
 const {transformWithEsbuild}=await import('vite');
 for(const path of ['../factory-mesti-mcp/index.ts','../external-agent-management/index.ts']){
  const source=readFileSync(new URL(path,import.meta.url),'utf8');
  expect((await transformWithEsbuild(source,path,{loader:'ts'})).code.length).toBeGreaterThan(0);
 }
});

it("rejects a module-less or mismatched query for a module-scoped MCP grant before reading data",async()=>{
 const grant={resource:"evidence",action:"list",business_module:"factory_mesti_cleaning"};
 const read=vi.fn().mockResolvedValue({tools:[factoryResourceTool.name],resource_actions:[grant]});
 for(const business_module of [undefined,"factory_mesti_calibration"]){
 const q={resource:"evidence",action:"list",business_module,date_range:{from:"2026-10-01",to:"2026-10-01"}};
 const request=new Request("https://example.test/mcp",{method:"POST",headers:{authorization:`Bearer fxm_${"a".repeat(43)}`,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:factoryResourceTool.name,arguments:{queries:[q]}}})});
 expect((await(await createHandler(read)(request)).json()).error.code).toBe(-32003);
 }
 expect(read).toHaveBeenCalledTimes(2);
 expect(safeResourceActions([{...grant,filters:{secret:"sensitive"}}])).toEqual([grant]);
});
it("passes the exact authorized business module through the unified read-only MCP path",async()=>{
 const q={business_module:"factory_mesti_cleaning",resource:"evidence",action:"list",date_range:{from:"2026-10-01",to:"2026-10-01"}};
 const read=vi.fn().mockResolvedValueOnce({tools:[factoryResourceTool.name],resource_actions:[{...q,date_range:undefined}]}).mockResolvedValueOnce({results:[]});
 const request=new Request("https://example.test/mcp",{method:"POST",headers:{authorization:`Bearer fxm_${"a".repeat(43)}`,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:factoryResourceTool.name,arguments:{queries:[q]}}})});
 const response=await(await createHandler(read)(request)).json();expect(response.result.isError).toBe(false);expect(read.mock.calls[1][2]).toEqual({p_queries:[q]});
});

it('keeps the active human reporting route without a duplicate agent permission',()=>{
 const report=moduleRegistry.find(m=>m.id==='factory_production_reports');expect(report.agentNavigationOwner).toBe('factory_job_orders');expect(report.permissions.view).toBe(true);
 expect(modules.some(m=>m.id===report.id)).toBe(false);expect(moduleRegistry.some(m=>m.id==='factory_agent_nav_factory_production_reports')).toBe(false);
 for(const resource of ['production_records','material_usage','product_movements','receiving_costs'])expect(modules.find(m=>m.id==='factory_job_orders').bindings.find(b=>b.resource===resource).requires_modules.length).toBeGreaterThan(0);
});
