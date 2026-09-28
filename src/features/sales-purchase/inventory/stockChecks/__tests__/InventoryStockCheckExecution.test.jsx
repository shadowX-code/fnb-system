import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), persist: vi.fn(), remove: vi.fn() }));
vi.mock("../inventoryStockCheckExecutionService.js", () => ({
  loadStockCheckExecution: mocks.load,
  persistRemoteStockCheck: mocks.persist,
  deleteRemoteStockCheckDraft: mocks.remove,
}));
import InventoryStockCheckPage, { useStockCheckExecutionData } from "../InventoryStockCheckPage.jsx";

const auth = { user: { id: "admin" } };
const snapshot = (name) => ({ items: [], categories: [], groups: [{ id: name, outletId: name }], checks: [], orders: [], people: [], completeness: "complete" });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
afterEach(() => { cleanup(); mocks.load.mockReset(); mocks.persist.mockReset(); mocks.remove.mockReset(); });

describe("Stock Check execution scoped read", () => {
  it("hides the previous outlet while a new scope is pending and ignores its late response", async () => {
    const first = deferred();
    const lateRefresh = deferred();
    const second = deferred();
    mocks.load.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => lateRefresh.promise).mockImplementationOnce(() => second.promise);
    const view = renderHook(({ ids }) => useStockCheckExecutionData(auth, ids), { initialProps: { ids: ["A"] } });
    await act(async () => first.resolve(snapshot("A")));
    expect(view.result.current[0].groups).toEqual([{ id: "A", outletId: "A" }]);
    let oldTask;
    act(() => { oldTask = view.result.current[3](); });
    view.rerender({ ids: ["B"] });
    expect(view.result.current[0].groups).toEqual([]);
    expect(view.result.current[2].state).toBe("loading");
    await act(async () => second.resolve(snapshot("B")));
    expect(view.result.current[0].groups).toEqual([{ id: "B", outletId: "B" }]);
    await act(async () => { lateRefresh.resolve(snapshot("stale A")); await oldTask; });
    expect(view.result.current[0].groups).toEqual([{ id: "B", outletId: "B" }]);
  });

  it("retains verified data during same-scope refresh, then atomically replaces it", async () => {
    const refresh = deferred();
    mocks.load.mockResolvedValueOnce(snapshot("A")).mockImplementationOnce(() => refresh.promise);
    const view = renderHook(() => useStockCheckExecutionData(auth, ["A"]));
    await waitFor(() => expect(view.result.current[2].state).toBe("ready"));
    let task;
    act(() => { task = view.result.current[3](); });
    expect(view.result.current[2].state).toBe("refreshing");
    expect(view.result.current[0].groups[0].id).toBe("A");
    await act(async () => { refresh.resolve(snapshot("updated")); await task; });
    expect(view.result.current[0].groups[0].id).toBe("updated");
  });

  it("fails closed on an incomplete scoped read", async () => {
    mocks.load.mockRejectedValue(Object.assign(new Error("Missing check page"), { readState: "incomplete" }));
    const view = renderHook(() => useStockCheckExecutionData(auth, ["A"]));
    await waitFor(() => expect(view.result.current[2].state).toBe("error"));
    expect(view.result.current[0].checks).toEqual([]);
    expect(view.result.current[2].completeness).toBe("incomplete");
  });

  it("starts, edits and saves a scheduled draft through the single lifecycle command", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const weekday = new Intl.DateTimeFormat("en-MY", { timeZone: "Asia/Kuala_Lumpur", weekday: "long" }).format(new Date());
    const data = {
      categories: [{ id: "category", name: "Frozen" }],
      items: [{ id: "item", name: "QA Item", categoryId: "category", unit: "kg", status: "active", linkedOutletIds: ["A"], outletConfigs: [{ outletId: "A", parLevel: 10 }] }],
      groups: [{ id: "group", outletId: "A", name: "Opening Count", shift: "Opening", status: "active", frequency: "custom", checkDays: [weekday], categoryIds: ["category"] }],
      checks: [], orders: [], people: [], completeness: "complete",
    };
    mocks.load.mockResolvedValue(data);
    mocks.persist.mockResolvedValue({ id: "draft", groupId: "group", outletId: "A", date: today, status: "draft", rows: [] });
    window.history.replaceState(null, "", "/restaurant/inventory/stock-check");
    render(<InventoryStockCheckPage auth={{ ...auth, profile: { role_outlet_access_type: "all" }, hasPermission: () => true }} ui={{ notify: vi.fn() }} outlets={[{ id: "A", name: "QA Outlet" }]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Audit Stock Check" }));
    expect((await screen.findByRole("dialog", { name: "Audit Stock Check" })).textContent).toContain("Notes");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const start = await screen.findByRole("button", { name: "Start Check" });
    fireEvent.click(start);
    await waitFor(() => expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ id: "group", date: today }), expect.any(Array), "draft", "admin", undefined));
    await screen.findByText("QA Item");
    const count = screen.getByRole("spinbutton");
    fireEvent.change(count, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(mocks.persist).toHaveBeenLastCalledWith(expect.objectContaining({ existingCheckId: "draft" }), [expect.objectContaining({ itemId: "item", actualCount: 8, expectedQty: 10, variance: 2 })], "draft", "admin", undefined));
  });
});
