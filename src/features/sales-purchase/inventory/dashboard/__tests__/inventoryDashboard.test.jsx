import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeInventoryItem } from "../../inventoryItemModel.js";
import { projectInventoryDashboard } from "../inventoryDashboardProjection.js";

const mocks = vi.hoisted(() => ({ load: vi.fn(), subscribe: vi.fn(() => () => {}) }));
vi.mock("../inventoryDashboardService.js", () => ({ loadInventoryDashboard: mocks.load }));
vi.mock("../../../../../services/inventoryRevalidation.js", () => ({ subscribeInventoryRevalidation: mocks.subscribe }));
import useInventoryDashboardRead from "../useInventoryDashboardRead.js";

const outlet = { id: "outlet-1", name: "QA Outlet" };
const otherOutlet = { id: "outlet-2", name: "Other Outlet" };
const item = normalizeInventoryItem({ id: "item-1", name: "Rice", status: "active", categoryId: "cat-1", linkedOutletIds: [outlet.id], outletConfigs: [{ outletId: outlet.id, parLevel: 10, isActive: true }] });
const evidence = (state, outletId = outlet.id) => ({ outlet_id: outletId, item_id: item.id, state });
const base = { items: [item], groups: [], checks: [], orders: [], movements: [], waste: [], stockEvidence: [evidence("unverified")] };

describe("Inventory Dashboard truthful read projection", () => {
  it("preserves explicit archived identity without treating it as active", () => {
    expect(normalizeInventoryItem({ status: "archived", is_active: false }).status).toBe("archived");
    expect(normalizeInventoryItem({ status: "archived", is_active: false }).isActive).toBe(false);
    expect(normalizeInventoryItem({ status: "inactive", is_active: false }).status).toBe("inactive");
  });
  it("presents the complete server-owned evidence states without recomputing counts", () => {
    const unknown = projectInventoryDashboard(base, [outlet], "2026-09-28");
    expect(unknown.stock).toEqual({ belowPar: 0, sufficient: 0, changed: 0, unverified: 1 });
    expect(unknown.outletRows[0].status).toBe("Unverified");
    const low = projectInventoryDashboard({ ...base, stockEvidence: [evidence("below_par")] }, [outlet], "2026-09-28");
    expect(low.stock).toEqual({ belowPar: 1, sufficient: 0, changed: 0, unverified: 0 });
    expect(low.outletRows[0].status).toBe("Below Par at Last Check");
    const sufficient = projectInventoryDashboard({ ...base, stockEvidence: [evidence("sufficient")] }, [outlet], "2026-09-28");
    expect(sufficient.stock).toEqual({ belowPar: 0, sufficient: 1, changed: 0, unverified: 0 });
    expect(sufficient.outletRows[0].status).toBe("Sufficient at Last Check");
  });

  it("keeps movement evidence secondary and never infers stock from a recent-activity row", () => {
    const movement = { id: "movement-1", itemId: item.id, outletId: outlet.id, quantity: 2, date: "2026-09-28", dateTime: "2026-09-28T11:00:00Z" };
    const changed = projectInventoryDashboard({ ...base, stockEvidence: [evidence("changed")], movements: [movement] }, [outlet], "2026-09-28");
    expect(changed.stock).toEqual({ belowPar: 0, sufficient: 0, changed: 1, unverified: 0 });
    expect(changed.outletRows[0].status).toBe("Changed Since Check");
    const unchanged = projectInventoryDashboard({ ...base, stockEvidence: [evidence("below_par")], movements: [movement] }, [outlet], "2026-09-28");
    expect(unchanged.stock.belowPar).toBe(1);
    const sharedItem = normalizeInventoryItem({ ...item, linkedOutletIds: [outlet.id, otherOutlet.id], outletConfigs: [
      { outletId: outlet.id, parLevel: 10, isActive: true }, { outletId: otherOutlet.id, parLevel: 10, isActive: true },
    ] });
    const elsewhere = projectInventoryDashboard({ ...base, items: [sharedItem], stockEvidence: [evidence("below_par"), evidence("changed", otherOutlet.id)], movements: [{ ...movement, outletId: otherOutlet.id }] }, [outlet, otherOutlet], "2026-09-28");
    expect(elsewhere.outletRows[0].stock.belowPar).toBe(1);
    expect(elsewhere.outletRows[0].stock.changed).toBe(0);
    expect(elsewhere.outletRows[1].stock.changed).toBe(1);
    expect(elsewhere.outletRows[1].stock.sufficient).toBe(0);
  });

  it("does not fabricate a current balance from server uncertainty", () => {
    expect(projectInventoryDashboard(base, [outlet], "2026-09-28").stock.changed).toBe(0);
    expect(projectInventoryDashboard({ ...base, stockEvidence: [evidence("unverified")] }, [outlet], "2026-09-28").stock.unverified).toBe(1);
  });

  it("retains Unverified from the latest server result rather than falling back to an older count", () => {
    const projected = projectInventoryDashboard({ ...base, stockEvidence: [evidence("unverified")] }, [outlet], "2026-09-28");
    expect(projected.stock.unverified).toBe(1);
    expect(projected.stock.sufficient).toBe(0);
  });

  it("reports wastage as a count rather than fabricated RM and leaves no-due completion unavailable", () => {
    const projected = projectInventoryDashboard({ ...base, waste: [{ id: "waste-1", outletId: outlet.id, value: 0 }] }, [outlet], "2026-09-28");
    expect(projected.outletRows[0].wasteCount).toBe(1);
    expect(projected.checkCompletion).toBeNull();
  });

  it("excludes retired groups from the operational Dashboard summary", () => {
    const group = { id: "retired", outletId: outlet.id, status: "inactive" };
    expect(projectInventoryDashboard({ ...base, groups: [group] }, [outlet], "2026-09-28").groups).toEqual([]);
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
