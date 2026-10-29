import { describe, expect, it, vi } from "vitest";
import { resourceArguments, factoryResourceTool as resourceTool, safeResourceActions } from "../factory-mesti-mcp/resources.js";
import { createHandler } from "../factory-mesti-mcp/protocol.js";
const range={from:"2026-10-01",to:"2026-10-31"};
const query=(resource="requirements",action="list",extra={})=>({resource,action,date_range:range,...extra});
const call=(queries)=>new Request("https://example.test/mcp",{method:"POST",headers:{authorization:`Bearer fxm_${"a".repeat(43)}`,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:resourceTool.name,arguments:{queries}}})});
describe("bounded resource read protocol",()=>{
 it("accepts each supported operation with its own explicit argument contract",()=>{
  for(const q of [query(),query("statuses","read",{id:"id"}),query("evidence","search",{search:"evidence"}),query("occurrences","filter",{filters:{record_status:"completed"}})]) expect(resourceArguments({queries:[q]},false).p_queries).toEqual([q]);
 });
 it.each([
  [{...query(),sql:"select *"}], [query("production")], [query("requirements","execute")],
  [query("requirements","list",{filters:{record_status:"active"}})], [query("requirements","search",{search:""})],

  [query("requirements","read",{id:"id",limit:2})], [query("requirements","list",{id:"id"})],
  [query("requirements","list",{limit:101})], [query("requirements","list",{limit:1.5})],
  [query("requirements","list",{date_range:{from:"2026-10-01",to:"2026-11-01"}})],
  [query("requirements","list",{date_range:{from:"2026-02-30",to:"2026-03-01"}})],
  [query("requirements","list",{module:"payroll"})], [query("requirements","list",{include:["evidence"]})],
  Array.from({length:6},()=>query()),
 ])("rejects unrestricted, hidden-field, mutation and unbounded requests",(queries)=>{
  expect(()=>resourceArguments({queries},false)).toThrow();
 });
 it("denies the entire mixed-resource batch before data reads when one operation is ungranted",async()=>{
  const read=vi.fn().mockResolvedValue({authorized:true,tools:[resourceTool.name],resource_actions:[{resource:"requirements",action:"list"}]});
  const result=await (await createHandler(read)(call([query(),query("evidence")]))).json();
  expect(result.error.code).toBe(-32003);expect(read).toHaveBeenCalledTimes(1);expect(JSON.stringify(result)).not.toContain("items");
 });
 it("returns resource results and audits only safe resource/action names",async()=>{
  const read=vi.fn().mockResolvedValueOnce({authorized:true,tools:[resourceTool.name],resource_actions:[{resource:"requirements",action:"search"}]}).mockResolvedValueOnce({results:[{resource:"requirements",items:[]}]});const observe=vi.fn();
  await createHandler(read,{observe})(call([query("requirements","search",{search:"PRIVATE_SEARCH_TEXT"})]));
  expect(read.mock.calls[1][1]).toBe(resourceTool.name);expect(observe.mock.calls[0][1].resource_actions).toEqual([{resource:"requirements",action:"search"}]);expect(JSON.stringify(observe.mock.calls[0][1])).not.toContain("PRIVATE_SEARCH_TEXT");
  expect(safeResourceActions([{resource:"symptoms",action:"read"},{resource:"evidence",action:"sql"}])).toEqual([]);
 });
});
