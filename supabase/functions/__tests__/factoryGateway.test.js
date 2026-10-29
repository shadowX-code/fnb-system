// @vitest-environment node
import {expect,it,vi} from "vitest";
import {moduleRegistry} from "../../../config/modules.ts";
import coverage from "../../../config/factoryAgentCoverage.json";
import navigation from "../../../config/factoryAgentNavigation.json";
import projections from "../../../config/factoryAgentResources.json";
import {factoryResourceNames,factoryResourceTool,resourceArguments,safeResourceActions} from "../factory-mesti-mcp/resources.js";
import {createHandler} from "../factory-mesti-mcp/protocol.js";
it("covers every actual Factory business route with implemented resources and one View Records permission",()=>{
 const business=moduleRegistry.filter((m)=>m.workspace==="factory" && m.routable!==false);
 expect(business.length).toBeGreaterThan(25);
 for(const module of business){expect(navigation[module.id],module.id).toBeTruthy();for(const slug of navigation[module.id])expect(factoryResourceNames).toContain(slug);}
 expect(new Set(factoryResourceNames).size).toBe(coverage.length);
 for(const resource of coverage){const module=moduleRegistry.find((m)=>m.id===`factory_agent_${resource.slug}`);expect(module.permissions).toEqual({view:true});}
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
