import { describe, expect, it, vi } from "vitest";
import { emptyFactoryDashboardState, loadFactoryDashboardSnapshot } from "../factoryDashboardQuery.js";
import { dashboardProductAxisLabel, dashboardUomOptions, selectedDashboardUom, toggleDashboardActionFilter, visibleDashboardActions } from "../factoryDashboardState.js";

function stateHarness(initial = emptyFactoryDashboardState()) { let value = initial; const setState = vi.fn((next) => { value = typeof next === "function" ? next(value) : next; }); return { get value() { return value; }, setState }; }

describe("Factory Dashboard snapshot contracts", () => {
  it("maps a successful snapshot after entering loading", async () => {
    const state = stateHarness(); const snapshot = { filters: { month_start: "2026-08-01" }, kpis: {} }; const getSnapshot = vi.fn().mockResolvedValue(snapshot);
    const loading = loadFactoryDashboardSnapshot({ canView: true, getSnapshot, isCurrent: () => true, setState: state.setState, isPermissionError: () => false });
    expect(state.value.loading).toBe(true); await loading;
    expect(getSnapshot).toHaveBeenCalledTimes(1); expect(state.value).toEqual({ snapshot, hasLoaded: true, loading: false, error: "", errorKind: "" });
  });

  it("preserves a loaded snapshot for retryable errors, then accepts the same read on retry", async () => {
    const loaded = { filters: { month_start: "2026-07-01" }, kpis: { production_output: {} } }; const state = stateHarness({ snapshot: loaded, hasLoaded: true, loading: false, error: "", errorKind: "" });
    await loadFactoryDashboardSnapshot({ canView: true, getSnapshot: vi.fn().mockRejectedValue(new Error("temporary")), isCurrent: () => true, setState: state.setState, isPermissionError: () => false });
    expect(state.value).toMatchObject({ snapshot: loaded, hasLoaded: true, errorKind: "load" });
    const retry = vi.fn().mockResolvedValue({ filters: { month_start: "2026-08-01" }, kpis: {} });
    await loadFactoryDashboardSnapshot({ canView: true, getSnapshot: retry, isCurrent: () => true, setState: state.setState, isPermissionError: () => false });
    expect(retry).toHaveBeenCalledTimes(1); expect(state.value).toMatchObject({ hasLoaded: true, errorKind: "", snapshot: { filters: { month_start: "2026-08-01" } } });
  });

  it("clears analytics for a permission-denied snapshot", async () => {
    const state = stateHarness({ snapshot: { filters: { month_start: "2026-07-01" }, kpis: {} }, hasLoaded: true, loading: false, error: "", errorKind: "" });
    await loadFactoryDashboardSnapshot({ canView: true, getSnapshot: vi.fn().mockRejectedValue({ code: "42501" }), isCurrent: () => true, setState: state.setState, isPermissionError: (error) => error.code === "42501" });
    expect(state.value).toMatchObject({ hasLoaded: false, errorKind: "permission", snapshot: { action_required: [] } });
  });

  it("ignores stale responses and never requests data without Dashboard View", async () => {
    const state = stateHarness({ ...emptyFactoryDashboardState(), snapshot: { filters: { month_start: "2026-08-01" } }, hasLoaded: true });
    await expect(loadFactoryDashboardSnapshot({ canView: true, getSnapshot: vi.fn().mockResolvedValue({ filters: { month_start: "2026-07-01" } }), isCurrent: () => false, setState: state.setState, isPermissionError: () => false })).resolves.toMatchObject({ kind: "stale" });
    expect(state.value.snapshot.filters.month_start).toBe("2026-08-01");
    const denied = stateHarness(); const getSnapshot = vi.fn(); await loadFactoryDashboardSnapshot({ canView: false, getSnapshot, isCurrent: () => true, setState: denied.setState, isPermissionError: () => false }); expect(getSnapshot).not.toHaveBeenCalled(); expect(denied.value.errorKind).toBe("permission");
  });
});

describe("Factory Dashboard presentation state", () => {
  it("normalizes UOM populations, safely falls back, and maps product labels", () => {
    const options = dashboardUomOptions([{ uom: "KG" }, { uom: "kg" }, { uom: "L" }]); expect(options).toEqual(["kg", "l"]); expect(selectedDashboardUom(options, "l")).toBe("l"); expect(selectedDashboardUom(options, "packs")).toBe("kg"); expect(dashboardProductAxisLabel({ product: "Sambal", packaging_sku: "SKU-1" })).toBe("Sambal · SKU-1");
  });

  it("filters action rows by exact inventory status and toggles back to all", () => {
    const actions = [{ inventory_status: "low_stock" }, { inventory_status: "out_of_stock" }]; expect(visibleDashboardActions(actions, "low")).toEqual([actions[0]]); expect(visibleDashboardActions(actions, "all")).toEqual(actions); expect(toggleDashboardActionFilter("all", "low")).toBe("low"); expect(toggleDashboardActionFilter("low", "low")).toBe("all");
  });
});
