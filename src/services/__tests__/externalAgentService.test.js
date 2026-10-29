import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), functions: { invoke: vi.fn() } }));
vi.mock("../../lib/supabase.ts", () => ({ supabase: mocks }));
import { externalAgentService } from "../externalAgentService.js";
beforeEach(() => vi.clearAllMocks());
it("separates ordinary management reads from explicit one-time issuance", async () => {
  mocks.rpc.mockResolvedValue({ data: { connections: [] }, error: null });
  await externalAgentService.list();
  expect(mocks.rpc).toHaveBeenLastCalledWith("external_agents_admin_data", { p_identity_id: null });
  await externalAgentService.rotate("agent", "prior", "request");
  expect(mocks.rpc).toHaveBeenLastCalledWith("external_agents_rotate_credential", { p_identity_id: "agent", p_expected_credential_id: "prior", p_request_id: "request", p_validity_days: 90 });
});
it("never logs raw credential-operation errors", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "SENSITIVE_CREDENTIAL" } });
  await expect(externalAgentService.rotate("agent", "prior", "request")).rejects.not.toThrow("SENSITIVE_CREDENTIAL");
  expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
});

it("uses bounded server operations for registration, enable state and individual grants", async () => {
 mocks.rpc.mockResolvedValue({data:{},error:null});
 await externalAgentService.register("request","Agent","Provider","factory_mesti",["read_tool"]);
 expect(mocks.rpc).toHaveBeenLastCalledWith("external_agents_register",{p_request_id:"request",p_name:"Agent",p_provider:"Provider",p_adapter_key:"factory_mesti",p_tool_ids:["read_tool"],p_validity_days:90});
 await externalAgentService.setEnabled("agent",false,true);
 expect(mocks.rpc).toHaveBeenLastCalledWith("external_agents_set_enabled",{p_identity_id:"agent",p_enabled:false,p_expected_enabled:true});
 await externalAgentService.setCapability("agent","read_tool",false,true);
 expect(mocks.rpc).toHaveBeenLastCalledWith("external_agents_set_capability",{p_identity_id:"agent",p_tool_id:"read_tool",p_granted:false,p_expected_granted:true});
});
