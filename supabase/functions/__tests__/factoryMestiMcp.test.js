import { describe, expect, it, vi } from "vitest";
import { createHandler, malaysiaYesterday, toolArguments, tools, legacyTools } from "../factory-mesti-mcp/protocol.js";

const token = `fxm_${"a".repeat(43)}`;
const request = (message, options = {}) => new Request("https://example.test/mcp", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", ...options.headers },
  body: JSON.stringify(message),
});
const call = (name, args = {}) => ({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
describe("MeSTI Streamable HTTP", () => {
  it("defaults to yesterday in Malaysia across UTC/date/month boundaries", () => {
    expect(malaysiaYesterday(new Date("2026-10-28T16:01:00Z"))).toBe("2026-10-28");
    expect(malaysiaYesterday(new Date("2026-10-28T15:59:00Z"))).toBe("2026-10-27");
    expect(malaysiaYesterday(new Date("2026-02-28T16:01:00Z"))).toBe("2026-02-28");
  });
  it("publishes exactly five read-only tools and negotiates MCP", async () => {
    const read = vi.fn().mockResolvedValue({ authorized: true, tools: legacyTools.map((tool) => tool.name) });
    const handler = createHandler(read);
    const initialized = await (await handler(request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }))).json();
    expect(initialized.result.protocolVersion).toBe("2025-06-18");
    const listed = await (await handler(request({ jsonrpc: "2.0", id: 2, method: "tools/list" }))).json();
    expect(listed.result.tools).toHaveLength(5);
    expect(tools.every((tool) => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint)).toBe(true);
    expect((await handler(request({ jsonrpc: "2.0", method: "notifications/initialized" }))).status).toBe(202);
    expect((await handler(new Request("https://example.test/mcp", { headers: { authorization: `Bearer ${token}` } }))).status).toBe(405);
  });
  it("validates credentials before discovery and rejects browser origins", async () => {
    const read = vi.fn().mockRejectedValue(new Error("denied"));
    const handler = createHandler(read);
    expect((await handler(request({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).status).toBe(401);
    expect((await handler(request(call("get_mesti_daily_status"), { headers: { origin: "https://evil.test" } }))).status).toBe(403);
    expect((await handler(request(call("get_mesti_daily_status"), { headers: { authorization: "Bearer staff-jwt" } }))).status).toBe(401);
  });
  it("blocks mutation names, arbitrary scope, invalid dates and unbounded ranges", () => {
    expect(() => toolArguments("complete_mesti", {})).toThrow();
    expect(() => toolArguments("get_mesti_daily_status", { company_id: "other" })).toThrow();
    expect(() => toolArguments("get_mesti_daily_status", { date: "2026-02-30" })).toThrow();
    expect(() => toolArguments("list_mesti_exceptions", { date_range: { from: "2026-01-01", to: "2026-02-01" } })).toThrow();
    expect(() => toolArguments("get_mesti_evidence_details", { reference_id: "health_declaration:2026-10-28:../../raw" })).toThrow();
    expect(() => toolArguments("list_mesti_exceptions", { date_range: { from: "2026-10-01", to: "2026-10-02" }, severity: "urgent" })).toThrow();
    expect(toolArguments("get_mesti_evidence_details", { reference_id: "health_declaration:2026-10-28:coverage" })).toMatchObject({ p_from: "2026-10-28", p_to: "2026-10-28" });
  });
  it("returns unavailable on backend failure without leaking internal details", async () => {
    const read = vi.fn().mockResolvedValueOnce({ authorized: true, tools: legacyTools.map((tool) => tool.name) }).mockRejectedValueOnce(new Error("sensitive database error"));
    const response = await (await createHandler(read)(request(call("get_mesti_daily_status", { date: "2026-10-28" })))).json();
    expect(response.result.isError).toBe(true);
    expect(JSON.stringify(response)).not.toContain("sensitive");
    expect(read).toHaveBeenLastCalledWith(token, "get_mesti_daily_status", { p_from: "2026-10-28", p_to: "2026-10-28", p_severity: "all" });
  });
  it("rejects invalid JSON-RPC and unsupported versions", async () => {
    const handler = createHandler(vi.fn().mockResolvedValue({ authorized: true, tools: legacyTools.map((tool) => tool.name) }));
    expect((await handler(request([]))).status).toBe(400);
    expect((await handler(request(call("get_mesti_daily_status"), { headers: { "mcp-protocol-version": "bogus" } }))).status).toBe(400);
    const result = await (await handler(request({ jsonrpc: "2.0", id: 1, method: "resources/read" }))).json();
    expect(result.error.code).toBe(-32601);
  });
  it("records only bounded transport metadata and fails closed if access recording fails", async () => {
    const observe = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler(vi.fn().mockResolvedValue({ findings: [], tools: legacyTools.map((tool) => tool.name) }), { observe });
    const response = await handler(request(call("get_mesti_daily_status", { date: "2026-10-28" })));
    expect(response.status).toBe(200);
    expect(observe).toHaveBeenCalledWith(token, { method: "tools/call", tool: "get_mesti_daily_status", outcome: "success", reason: null }, expect.any(Request));
    await handler(request(call("SECRET_UNAPPROVED_TOOL")));
    expect(observe.mock.calls.at(-1)[1]).toMatchObject({ tool: "unsupported", outcome: "failed", reason: "tool_denied" });
    expect(JSON.stringify(observe.mock.calls.map((call) => call[1]))).not.toContain("SECRET_UNAPPROVED_TOOL");
    observe.mockRejectedValue(new Error("private detail"));
    expect((await handler(request({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).status).toBe(503);
  });
});

it("discovers only granted capabilities and rejects calls to removed capabilities before any data read", async () => {
 const read=vi.fn().mockResolvedValue({ authorized: true, tools: ["get_mesti_daily_status"] });
 const observe=vi.fn();const handler=createHandler(read,{observe});
 const listed=await (await handler(request({jsonrpc:"2.0",id:1,method:"tools/list"}))).json();
 expect(listed.result.tools.map((tool)=>tool.name)).toEqual(["get_mesti_daily_status"]);
 const denied=await (await handler(request(call("list_mesti_exceptions",{date_range:{from:"2026-10-28",to:"2026-10-28"}})))).json();
 expect(denied.error.code).toBe(-32003);
 expect(read.mock.calls.every((call)=>call[1]==="authorize")).toBe(true);
 expect(observe.mock.calls.at(-1)[1]).toMatchObject({outcome:"denied",reason:"capability_denied"});
});
it("fails closed without a canonical capability snapshot and on a grant revoked during a call", async () => {
 expect((await createHandler(vi.fn().mockResolvedValue({authorized:true}))(request({jsonrpc:"2.0",id:1,method:"tools/list"}))).status).toBe(401);
 const read=vi.fn().mockResolvedValueOnce({authorized:true,tools:["get_mesti_daily_status"]}).mockRejectedValueOnce(Object.assign(new Error("private details"),{code:"42501"}));
 const result=await (await createHandler(read)(request(call("get_mesti_daily_status")))).json();
 expect(result.error.code).toBe(-32003);expect(JSON.stringify(result)).not.toContain("private details");
});
