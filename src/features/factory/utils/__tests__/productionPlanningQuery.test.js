import { describe, expect, it, vi } from "vitest";
import {
  emptyProductionPlanningOpenJobs,
  loadProductionPlanningAggregate,
  shouldLoadProductionPlanningAggregate,
} from "../productionPlanningQuery.js";

function stateHarness(initial = emptyProductionPlanningOpenJobs()) {
  let value = initial;
  const setState = vi.fn((next) => { value = typeof next === "function" ? next(value) : next; });
  return { get value() { return value; }, setState };
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

describe("Production Planning aggregate query contract", () => {
  it("loads the existing aggregate service result and records loading before success", async () => {
    const state = stateHarness();
    const getAggregate = vi.fn().mockResolvedValue({ aggregates: [{ packagingSkuId: "sku-1", openJobOrderQty: 8 }], diagnostics: { invalidQuantityCount: 0 } });
    const load = loadProductionPlanningAggregate({ canView: true, getAggregate, isCurrent: () => true, setState: state.setState, isPermissionError: () => false });
    expect(state.value.loading).toBe(true);
    await load;
    expect(getAggregate).toHaveBeenCalledTimes(1);
    expect(state.value).toEqual({ aggregates: [{ packagingSkuId: "sku-1", openJobOrderQty: 8 }], diagnostics: { invalidQuantityCount: 0 }, hasLoaded: true, loading: false, error: "", errorKind: "" });
  });

  it("retries the same read after a transient failure and replaces the failed state", async () => {
    const state = stateHarness();
    const getAggregate = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValueOnce({ aggregates: [{ packagingSkuId: "sku-2" }], diagnostics: {} });
    const options = { canView: true, getAggregate, isCurrent: () => true, setState: state.setState, isPermissionError: () => false, onError: vi.fn() };
    await loadProductionPlanningAggregate(options);
    expect(state.value).toMatchObject({ hasLoaded: false, loading: false, errorKind: "load", error: "Unable to load the latest Production Planning data." });
    await loadProductionPlanningAggregate(options);
    expect(getAggregate).toHaveBeenCalledTimes(2);
    expect(state.value).toMatchObject({ aggregates: [{ packagingSkuId: "sku-2" }], hasLoaded: true, error: "", errorKind: "" });
  });

  it("clears protected state and closes the Job Order modal on permission denial", async () => {
    const state = stateHarness({ aggregates: [{ packagingSkuId: "sku-1" }], diagnostics: { invalidQuantityCount: 0 }, hasLoaded: true, loading: false, error: "", errorKind: "" });
    const onPermissionDenied = vi.fn();
    await loadProductionPlanningAggregate({ canView: true, getAggregate: vi.fn().mockRejectedValue({ code: "42501" }), isCurrent: () => true, setState: state.setState, isPermissionError: (error) => error.code === "42501", onPermissionDenied });
    expect(state.value).toEqual({ aggregates: [], diagnostics: {}, hasLoaded: false, loading: false, error: "Some Production Planning data is hidden by your current role.", errorKind: "permission" });
    expect(onPermissionDenied).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale response and respects the Production Planning route gate", async () => {
    const state = stateHarness({ aggregates: [{ packagingSkuId: "fresh" }], diagnostics: {}, hasLoaded: true, loading: false, error: "", errorKind: "" });
    const next = deferred();
    const result = loadProductionPlanningAggregate({ canView: true, getAggregate: vi.fn(() => next.promise), isCurrent: () => false, setState: state.setState, isPermissionError: () => false });
    next.resolve({ aggregates: [{ packagingSkuId: "stale" }], diagnostics: {} });
    await expect(result).resolves.toMatchObject({ kind: "stale" });
    expect(state.value.aggregates).toEqual([{ packagingSkuId: "fresh" }]);

    const deniedState = stateHarness();
    const getAggregate = vi.fn();
    await loadProductionPlanningAggregate({ canView: false, getAggregate, isCurrent: () => true, setState: deniedState.setState, isPermissionError: () => false });
    expect(getAggregate).not.toHaveBeenCalled();
    expect(deniedState.value.errorKind).toBe("permission");
    expect(shouldLoadProductionPlanningAggregate("production-planning")).toBe(true);
    expect(shouldLoadProductionPlanningAggregate("dashboard")).toBe(false);
  });
});
