import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFactoryPagedQuery } from "../FactoryPagination.jsx";

const deferred = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const payload = (rows, totalCount = rows.length, page = 1) => ({ rows, summary: { total: totalCount }, totalCount, page, pageSize: 20 });

describe("useFactoryPagedQuery", () => {
  it("loads authoritative rows and summary", async () => {
    const loadPage = vi.fn().mockResolvedValue(payload([{ id: "one" }], 1));
    const { result } = renderHook(() => useFactoryPagedQuery({ storageKey: "test-load", querySignature: "initial", loadPage }));
    await waitFor(() => expect(result.current[0].hasLoaded).toBe(true));
    expect(result.current[0]).toMatchObject({ rows: [{ id: "one" }], summary: { total: 1 }, loadedTotal: 1, loadedPage: 1, loading: false });
  });
  it("never lets an older filter request overwrite the newer result", async () => {
    const first = deferred(); const second = deferred(); const loadPage = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(({ signature }) => useFactoryPagedQuery({ storageKey: "test-stale", querySignature: signature, loadPage }), { initialProps: { signature: "old" } });
    rerender({ signature: "new" }); second.resolve(payload([{ id: "new" }])); await waitFor(() => expect(result.current[0].rows).toEqual([{ id: "new" }])); first.resolve(payload([{ id: "old" }])); await act(async () => {});
    expect(result.current[0].rows).toEqual([{ id: "new" }]);
  });
  it("keeps a sanitized transient error and replaces it after retry", async () => {
    const loadPage = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(payload([{ id: "recovered" }]));
    const { result } = renderHook(() => useFactoryPagedQuery({ storageKey: "test-retry", querySignature: "x", loadPage, mapError: () => ({ kind: "load", message: "Unable to load records." }) }));
    await waitFor(() => expect(result.current[0].error).toBe("Unable to load records.")); act(() => result.current[1].retry()); await waitFor(() => expect(result.current[0].rows).toEqual([{ id: "recovered" }]));
  });
  it("clears protected data on an authoritative permission denial", async () => {
    const loadPage = vi.fn().mockResolvedValueOnce(payload([{ id: "visible" }])).mockRejectedValueOnce({ code: "42501" });
    const { result } = renderHook(() => useFactoryPagedQuery({ storageKey: "test-permission", querySignature: "one", loadPage, shouldClearOnError: (error) => error.code === "42501", mapError: () => ({ kind: "permission", message: "Data hidden." }) }));
    await waitFor(() => expect(result.current[0].hasLoaded).toBe(true)); act(() => result.current[1].retry()); await waitFor(() => expect(result.current[0].errorKind).toBe("permission")); expect(result.current[0]).toMatchObject({ rows: [], summary: {}, loadedTotal: 0, hasLoaded: false, loading: false, error: "Data hidden." });
  });
});
