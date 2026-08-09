import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/supabase.ts", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock("../auditLogService", () => ({ auditLogService: { createAuditLog: mocks.createAuditLog } }));

import { factoryService } from "../factoryService.js";

const order = { id: "11111111-1111-4111-8111-111111111111", job_order_no: "JO260809-01" };
const employee = { id: "22222222-2222-4222-8222-222222222222", nickname: "Isaac" };
const startInfo = { production_date: "2026-08-09", start_time: "09:30", remarks: "Line ready" };

describe("Factory Job Order Start trusted RPC contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts only through factory_start_job_order with server-derived actor fields", async () => {
    mocks.rpc.mockResolvedValue({ error: null });

    await factoryService.startJobOrder(order, startInfo, employee);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("factory_start_job_order", {
      p_job_order_id: order.id,
      p_operator_id: null,
      p_operator_name: null,
      p_production_date: "2026-08-09",
      p_start_time: "09:30",
      p_remarks: "Line ready",
      p_started_by: null,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not call a lifecycle RPC when the local employee preflight cannot resolve", async () => {
    await expect(factoryService.startJobOrder(order, startInfo, {})).rejects.toThrow("Current employee could not be resolved");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("surfaces authoritative already-started errors without a fallback mutation", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "Only Released Job Orders can start Production.", code: "P0001" } });

    await expect(factoryService.startJobOrder(order, startInfo, employee)).rejects.toThrow("Only Released Job Orders can start Production.");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
