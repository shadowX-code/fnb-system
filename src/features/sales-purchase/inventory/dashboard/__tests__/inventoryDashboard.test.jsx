import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeInventoryItem } from "../../inventoryItemModel.js";
import { projectInventoryDashboard } from "../inventoryDashboardProjection.js";

const mocks = vi.hoisted(() => ({ load: vi.fn(), subscribe: vi.fn(() => () => {}) }));
vi.mock("../inventoryDashboardService.js", () => ({ loadInventoryDashboard: mocks.load }));
vi.mock("../../../../../services/inventoryRevalidation.js", () => ({ subscribeInventoryRevalidation: mocks.subscribe }));
import useInventoryDashboardRead from "../useInventoryDashboardRead.js";

const outlet = { id: "outlet-1", name: "QA Outlet" };
const item = normalizeInventoryItem({ id: "item-1", name: "Rice", status: "active", categoryId: "cat-1", linkedOutletIds: [outlet.id], outletConfigs: [{ outletId: outlet.id, parLevel: 10, isActive: true }] });
const base = { items: [item], groups: [], checks: [], orders: [], movements: [], waste: [] };
function check(actual, { skipped = false, submittedAt = "2026-09-28T10:00:00Z" } = {}) {
  return { id: submittedAt, outletId: outlet.id, status: "submitted", submittedAt, rows: [{ itemId: item.id, actualCount: actual, skipped }] };
}

describe("Inventory Dashboard truthful read projection", () => {
  it("preserves explicit archived identity without treating it as active", () => {
    expect(normalizeInventoryItem({ status: "archived", is_active: false }).status).toBe("archived");
    expect(normalizeInventoryItem({ status: "archived", is_active: false }).isActive).toBe(false);
    expect(normalizeInventoryItem({ status: "inactive", is_active: false }).status).toBe("inactive");
  });
  it("separates missing, low and sufficient submitted count evidence", () => {
    const unknown = projectInventoryDashboard(base, [outlet], "2026-09-28");
    expect(unknown.stock).toEqual({ low: 0, sufficient: 0, unverified: 1 });
    expect(unknown.outletRows[0].status).toBe("Unverified");
    const low = projectInventoryDashboard({ ...base, checks: [check(4)] }, [outlet], "2026-09-28");
    expect(low.stock).toEqual({ low: 1, sufficient: 0, unverified: 0 });
    const sufficient = projectInventoryDashboard({ ...base, checks: [check(10)] }, [outlet], "2026-09-28");
    expect(sufficient.stock).toEqual({ low: 0, sufficient: 1, unverified: 0 });
  });

  it("does not treat a later skipped count or missing count as an older verified count", () => {
    const previous = check(12, { submittedAt: "2026-09-27T10:00:00Z" });
    for (const current of [check("", { submittedAt: "2026-09-28T10:00:00Z" }), check(0, { skipped: true })]) {
      expect(projectInventoryDashboard({ ...base, checks: [previous, current] }, [outlet], "2026-09-28").stock.unverified).toBe(1);
    }
  });

  it("reports wastage as a count rather than fabricated RM and leaves no-due completion unavailable", () => {
    const projected = projectInventoryDashboard({ ...base, waste: [{ id: "waste-1", outletId: outlet.id, value: 0 }] }, [outlet], "2026-09-28");
    expect(projected.outletRows[0].wasteCount).toBe(1);
    expect(projected.checkCompletion).toBeNull();
  });
});

describe("Inventory Dashboard scope read", () => {
  beforeEach(() => { mocks.load.mockReset(); mocks.subscribe.mockClear(); });

  it("hides previous-scope data while loading and ignores its late response", async () => {
    let resolveA;
    let resolveB;
    mocks.load.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
    const hook = renderHook(({ ids }) => useInventoryDashboardRead({ outletIds: ids, actorId: "admin", enabled: true }), { initialProps: { ids: ["a"] } });
    hook.rerender({ ids: ["b"] });
    expect(hook.result.current.data).toBeNull();
    await act(async () => resolveA({ marker: "old" }));
    expect(hook.result.current.data).toBeNull();
    await act(async () => resolveB({ marker: "new" }));
    expect(hook.result.current.data).toEqual({ marker: "new" });
  });

  it("retains verified same-scope data during refresh but exposes a failed read as error", async () => {
    mocks.load.mockResolvedValueOnce({ marker: "verified" }).mockRejectedValueOnce(Object.assign(new Error("incomplete"), { readState: "incomplete" }));
    const hook = renderHook(() => useInventoryDashboardRead({ outletIds: ["a"], actorId: "admin", enabled: true }));
    await waitFor(() => expect(hook.result.current.data).toEqual({ marker: "verified" }));
    await act(async () => { await hook.result.current.refresh(); });
    expect(hook.result.current.state).toBe("error");
    expect(hook.result.current.completeness).toBe("incomplete");
  });
});
