import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), abort: vi.fn() }));
vi.mock("../../lib/supabase.ts", () => ({ supabase: { rpc: mocks.rpc } }));
import { factoryService } from "../factoryService.js";
beforeEach(() => vi.clearAllMocks());
describe("Monthly Production service contract", () => {
  it("uses one canonical RPC with abort ownership, without loading wide Production records", async () => {
    const snapshot = { month: "2026-09", today: "2026-10-09", days: [] };
    mocks.abort.mockResolvedValue({ data: snapshot, error: null });
    mocks.rpc.mockReturnValue({ abortSignal: mocks.abort });
    const signal = new AbortController().signal;
    expect(await factoryService.getProductionMonthlyPerformance("2026-09", { signal })).toEqual(snapshot);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("factory_get_production_monthly_performance", { p_month: "2026-09-01" });
    expect(mocks.abort).toHaveBeenCalledWith(signal);
  });
  it("rejects invalid months before issuing a request", async () => {
    await expect(factoryService.getProductionMonthlyPerformance("2026-13")).rejects.toThrow("valid month");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects incomplete/mismatched responses rather than displaying false zero output", async () => {
    mocks.rpc.mockResolvedValue({ data: { month: "2026-08", days: [] }, error: null });
    await expect(factoryService.getProductionMonthlyPerformance("2026-09")).rejects.toThrow("unavailable");
  });
  it("rejects missing contributing runs instead of showing a misleading empty drill-down", async () => {
    mocks.rpc.mockResolvedValue({ data: { month: "2026-09", today: "2026-10-09", days: [{ day: "2026-09-01", completed_runs: 2, records: [] }] }, error: null });
    await expect(factoryService.getProductionMonthlyPerformance("2026-09")).rejects.toThrow("Production detail is unavailable");
  });
});
