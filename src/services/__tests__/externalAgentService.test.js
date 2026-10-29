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
  expect(mocks.rpc).toHaveBeenLastCalledWith("external_agents_rotate_credential", { p_identity_id: "agent", p_expected_credential_id: "prior", p_request_id: "request" });
});
it("never logs raw credential-operation errors", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "SENSITIVE_CREDENTIAL" } });
  await expect(externalAgentService.rotate("agent", "prior", "request")).rejects.not.toThrow("SENSITIVE_CREDENTIAL");
  expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
});
