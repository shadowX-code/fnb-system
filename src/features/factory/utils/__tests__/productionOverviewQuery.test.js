import { describe, expect, it, vi } from "vitest";
import {
  emptyProductionOverviewState,
  loadProductionOverview,
  operationalJobOrdersRequest,
  shouldLoadProductionOverview,
} from "../productionOverviewQuery.js";

function stateHarness(initial = emptyProductionOverviewState()) {
  let value = initial;
  const setState = vi.fn((next) => { value = typeof next === "function" ? next(value) : next; });
  return { get value() { return value; }, setState };
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

describe("Production Overview operational query contract", () => {
  it("preserves the current Malaysia-date request and production visibility semantics", () => {
    const view = (key) => key === "factory_production.view";
    const complete = (key) => key === "factory_production.complete";
    const neither = () => false;
    expect(operationalJobOrdersRequest({ date: "2026-08-09", can: view })).toEqual({ date: "2026-08-09", includeProductions: true });
    expect(operationalJobOrdersRequest({ date: "2026-08-09", can: complete })).toEqual({ date: "2026-08-09", includeProductions: true });
    expect(operationalJobOrdersRequest({ date: "2026-08-09", can: neither })).toEqual({ date: "2026-08-09", includeProductions: false });
    expect(shouldLoadProductionOverview("production-overview")).toBe(true);
    expect(shouldLoadProductionOverview("production")).toBe(true);
    expect(shouldLoadProductionOverview("job-orders")).toBe(false);
  });

  it("maps jobs, productions, and summary through loading to success", async () => {
    const state = stateHarness();
    const getOperationalJobs = vi.fn().mockResolvedValue({ jobs: [{ id: "job-1" }], productions: [{ id: "production-1" }], summary: { released: 1 } });
    const load = loadProductionOverview({ getOperationalJobs, isCurrent: () => true, setState: state.setState, isPermissionError: () => false });
    expect(state.value.loading).toBe(true);
    await expect(load).resolves.toMatchObject({ kind: "success" });
    expect(state.value).toEqual({ jobs: [{ id: "job-1" }], productions: [{ id: "production-1" }], summary: { released: 1 }, hasLoaded: true, loading: false, error: "", errorKind: "" });
  });

  it("preserves ordinary error, permission denial, retry, and stale response behavior", async () => {
    const state = stateHarness();
    const getOperationalJobs = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ jobs: [{ id: "recovered" }], productions: [], summary: {} });
    const options = { getOperationalJobs, isCurrent: () => true, setState: state.setState, isPermissionError: () => false, onError: vi.fn() };
    await expect(loadProductionOverview(options)).resolves.toMatchObject({ kind: "error" });
    expect(state.value).toMatchObject({ hasLoaded: false, loading: false, errorKind: "load", error: "Unable to load the latest operational Job Orders." });
    await expect(loadProductionOverview(options)).resolves.toMatchObject({ kind: "success" });
    expect(state.value.jobs).toEqual([{ id: "recovered" }]);

    const permissionState = stateHarness({ jobs: [{ id: "visible" }], productions: [], summary: {}, hasLoaded: true, loading: false, error: "", errorKind: "" });
    const onPermissionDenied = vi.fn();
    await expect(loadProductionOverview({ getOperationalJobs: vi.fn().mockRejectedValue({ code: "42501" }), isCurrent: () => true, setState: permissionState.setState, isPermissionError: (error) => error.code === "42501", onPermissionDenied })).resolves.toMatchObject({ kind: "permission" });
    expect(permissionState.value).toEqual({ jobs: [], productions: [], summary: {}, hasLoaded: false, loading: false, error: "Some Production Overview data is hidden by your current role.", errorKind: "permission" });
    expect(onPermissionDenied).toHaveBeenCalledTimes(1);

    const staleState = stateHarness({ jobs: [{ id: "fresh" }], productions: [], summary: {}, hasLoaded: true, loading: false, error: "", errorKind: "" });
    const pending = deferred();
    const stale = loadProductionOverview({ getOperationalJobs: vi.fn(() => pending.promise), isCurrent: () => false, setState: staleState.setState, isPermissionError: () => false });
    pending.resolve({ jobs: [{ id: "stale" }], productions: [], summary: {} });
    await expect(stale).resolves.toMatchObject({ kind: "stale" });
    expect(staleState.value.jobs).toEqual([{ id: "fresh" }]);
  });
});
