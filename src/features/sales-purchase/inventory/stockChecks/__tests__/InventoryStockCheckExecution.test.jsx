import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
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
afterEach(() => { cleanup(); mocks.load.mockReset(); mocks.persist.mockReset(); mocks.remove.mockReset(); window.history.replaceState(null, "", "/"); });

describe("Stock Check execution scoped read", () => {
  it.each([
    ["outletId=B&accountingMonth=2026-08", "Second Outlet", "August 2026"],
    ["outletId=B&date=2026-09-24", "Second Outlet", "Select Closing Month"],
    ["outletId=unavailable", "Select", "Select Closing Month"],
  ])("opens the existing closing setup with safe preselection (%s)", async (query, outlet, month) => {
    mocks.load.mockResolvedValue(snapshot("B"));
    window.history.replaceState(null, "", `/restaurant/inventory/stock-check?startClosingAudit=1&${query}`);
    render(<InventoryStockCheckPage auth={{ ...auth, profile: { role_outlet_access_type: "all" }, hasPermission: () => true }}
      ui={{ notify: vi.fn() }} outlets={[{ id: "A", name: "First Outlet" }, { id: "B", name: "Second Outlet" }]} />);
    const setup = within(await screen.findByRole("dialog", { name: "Audit Stock Check" }));
    expect(setup.getByRole("button", { name: "Audit Type" }).textContent).toContain("Month-End Closing");
    expect(setup.getByRole("button", { name: "Outlet" }).textContent).toBe(outlet);
    expect(setup.getByRole("button", { name: "Closing Month" }).textContent).toBe(month);
    expect(window.location.search).not.toContain("startClosingAudit");
    expect(mocks.persist).not.toHaveBeenCalled();
  });

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
    await waitFor(() => expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ id: "group", date: today }), expect.any(Array), "draft"));
    await screen.findByText("QA Item");
    const count = screen.getByRole("spinbutton");
    fireEvent.change(count, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(mocks.persist).toHaveBeenLastCalledWith(expect.objectContaining({ existingCheckId: "draft" }), [expect.objectContaining({ itemId: "item", actualCount: 8, expectedQty: 10, variance: 2 })], "draft"));
  });

  it("starts an Audit draft and renders the skip-reason flow", async () => {
    const data = {
      categories: [{ id: "category", name: "Frozen", status: "active" }],
      items: [{ id: "item", name: "QA Item", categoryId: "category", unit: "kg", status: "active", linkedOutletIds: ["A"], outletConfigs: [{ outletId: "A", parLevel: 10 }] }],
      groups: [], checks: [], orders: [], people: [], completeness: "complete",
    };
    mocks.load.mockResolvedValue(data);
    const audit = { id: "audit", outletId: "A", stockCheckType: "audit", status: "draft", rows: [],
      auditName: "Spot Check · 15 Oct 2026", date: "2026-10-15", createdAt: "2026-10-15T04:00:00Z" };
    mocks.persist.mockRejectedValueOnce(new Error("Lost response")).mockResolvedValue(audit);
    mocks.load.mockResolvedValueOnce(data).mockResolvedValue({ ...data, checks: [audit] });
    window.history.replaceState(null, "", "/restaurant/inventory/stock-check");
    render(<InventoryStockCheckPage auth={{ ...auth, profile: { role_outlet_access_type: "all" }, hasPermission: () => true }} ui={{ notify: vi.fn() }} outlets={[{ id: "A", name: "QA Outlet" }]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Audit Stock Check" }));
    fireEvent.click(screen.getByRole("button", { name: "Audit Type" }));
    fireEvent.click(await screen.findByRole("option", { name: "Spot Check" }));
    const setup = within(screen.getByRole("dialog", { name: "Audit Stock Check" }));
    expect(setup.queryByRole("textbox", { name: /audit name/i })).toBeNull();
    expect(setup.queryByPlaceholderText("Select date")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Frozen.*1 items/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start Audit" }));
    await waitFor(() => expect(mocks.persist).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start Audit" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Start Audit" }));
    expect(await screen.findByText("Count Started At (MYT)")).toBeTruthy();
    expect(screen.getByText("15 Oct 2026 · 12:00 PM")).toBeTruthy();
    expect(mocks.persist.mock.calls[0][3]).toBe(mocks.persist.mock.calls[1][3]);
    expect(mocks.persist.mock.calls[0][0]).not.toHaveProperty("date");
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    const skip = within(await screen.findByRole("dialog", { name: "Skip stock check item" }));
    expect(skip.getByRole("button", { name: "Skip Item" }).disabled).toBe(true);
    expect(skip.queryByRole("textbox")).toBeNull();
    fireEvent.click(skip.getByRole("button", { name: "Skip Reason" }));
    fireEvent.click(screen.getByRole("option", { name: "Other" }));
    expect(skip.getByRole("button", { name: "Skip Item" }).disabled).toBe(true);
    fireEvent.change(skip.getByRole("textbox", { name: "Explanation (required)" }), { target: { value: "  Delivery in progress  " } });
    fireEvent.click(skip.getByRole("button", { name: "Skip Item" }));
    expect(screen.getByText("Other: Delivery in progress")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Submit Audit Check" }));
    expect(mocks.persist).toHaveBeenLastCalledWith(expect.anything(), [
      expect.objectContaining({ skipped: true, skipReason: "Other: Delivery in progress", actualCount: "" }),
    ], "submitted", expect.any(String));
  });

  it("filters closing groups without losing counts, notes, expansion or full-roster validation", async () => {
    const item = { id: "item", name: "QA Item", categoryId: "category", unit: "kg", status: "active", linkedOutletIds: ["A"], outletConfigs: [{ outletId: "A", parLevel: 10 }] };
    const data = { ...snapshot("A"), groups: [],
      categories: [{ id: "category", name: "Dry Goods", sortOrder: 1, status: "active" }],
      items: [item, { ...item, id: "uncategorized", categoryId: "", name: "QA Uncategorised" }] };
    const year = new Date().getFullYear();
    let draft;
    mocks.load.mockImplementation(async () => ({ ...data, checks: draft ? [draft] : [] }));
    mocks.persist.mockImplementation(async (_group, rows, status) => {
      draft = { id: "audit", outletId: "A", stockCheckType: "audit", auditType: "Month-End Closing", status, rows,
        date: `${year}-11-02`, accountingMonth: `${year}-10-01`, auditName: `Month-End Closing · Oct ${year} · 2 Nov ${year}` };
      return draft;
    });
    window.history.replaceState(null, "", "/restaurant/inventory/stock-check");
    render(<InventoryStockCheckPage auth={{ ...auth, profile: { role_outlet_access_type: "all" }, hasPermission: () => true }} ui={{ notify: vi.fn() }} outlets={[{ id: "A", name: "QA Outlet" }]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Audit Stock Check" }));
    const setup = within(screen.getByRole("dialog", { name: "Audit Stock Check" }));
    expect(setup.queryByPlaceholderText("Select date")).toBeNull();
    expect(setup.queryByRole("button", { name: "Time" })).toBeNull();
    expect(setup.getByRole("button", { name: "Start Audit" }).disabled).toBe(true);
    fireEvent.click(setup.getByRole("button", { name: "Closing Month" }));
    fireEvent.click(setup.getByRole("gridcell", { name: "Oct" }));
    fireEvent.click(setup.getByRole("button", { name: "Start Audit" }));
    await waitFor(() => expect(mocks.persist).toHaveBeenCalledWith(
      expect.objectContaining({ closingMonth: `${year}-10` }),
      [expect.objectContaining({ itemId: "item", actualCount: "" }), expect.objectContaining({ itemId: "uncategorized", actualCount: "" })],
      "draft", expect.any(String),
    ));
    await screen.findByText("QA Uncategorised");
    expect(screen.getAllByRole("button", { name: "Skip" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Full" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submit Audit Check" }));
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    const countedRow = within(screen.getByRole("row", { name: /QA Item/ }));
    fireEvent.change(countedRow.getByRole("spinbutton"), { target: { value: "0" } });
    fireEvent.change(countedRow.getByPlaceholderText("Optional note"), { target: { value: "Verified shelf" } });
    const selectCategory = (name) => {
      fireEvent.click(screen.getByRole("button", { name: "Category" }));
      fireEvent.click(screen.getByRole("option", { name, exact: true }));
    };
    expect(screen.getByRole("button", { name: "Category" }).textContent).toContain("All Categories");
    fireEvent.click(screen.getByRole("button", { name: /Dry Goods.*1 item/ }));
    selectCategory("Uncategorized");
    expect(screen.queryByRole("button", { name: /Dry Goods.*1 item/ })).toBeNull();
    selectCategory("Dry Goods");
    expect(screen.getByRole("button", { name: /Dry Goods.*1 item/ }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /Dry Goods.*1 item/ }));
    const search = screen.getByRole("searchbox", { name: "Search item" });
    fireEvent.change(search, { target: { value: "QA Uncategorised" } });
    expect(screen.getByText("No items match these filters.")).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    const shownRow = within(screen.getByRole("row", { name: /QA Item/ }));
    expect(shownRow.getByRole("spinbutton").value).toBe("0");
    expect(shownRow.getByPlaceholderText("Optional note").value).toBe("Verified shelf");
    fireEvent.click(screen.getByRole("button", { name: "Submit Audit Check" }));
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Category" }).textContent).toContain("All Categories");
    const uncountedRow = within(screen.getByRole("row", { name: /QA Uncategorised/ }));
    fireEvent.click(uncountedRow.getByRole("button", { name: "Skip" }));
    const skip = within(screen.getByRole("dialog", { name: "Skip stock check item" }));
    fireEvent.click(skip.getByRole("button", { name: "Skip Reason" }));
    fireEvent.click(screen.getByRole("option", { name: "Cannot Access" }));
    expect(skip.queryByRole("textbox")).toBeNull();
    fireEvent.click(skip.getByRole("button", { name: "Skip Item" }));
    expect(uncountedRow.getByText("Cannot Access")).toBeTruthy();
    expect(uncountedRow.queryByRole("spinbutton")).toBeNull();
    selectCategory("Dry Goods");
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(mocks.persist).toHaveBeenLastCalledWith(expect.anything(), [
      expect.objectContaining({ itemId: "item", actualCount: 0, notes: "Verified shelf" }),
      expect.objectContaining({ itemId: "uncategorized", actualCount: "", skipped: true, skipReason: "Cannot Access" }),
    ], "draft", expect.any(String)));
    fireEvent.click(await screen.findByRole("button", { name: "Continue Audit" }));
    expect(await screen.findByText("Cannot Access")).toBeTruthy();
    selectCategory("Dry Goods");
    fireEvent.click(screen.getByRole("button", { name: "Submit Audit Check" }));
    expect(mocks.persist).toHaveBeenCalledTimes(2);
    const resumedRow = within(screen.getByRole("row", { name: /QA Uncategorised/ }));
    fireEvent.click(resumedRow.getByRole("button", { name: "Undo Skip" }));
    expect(resumedRow.getByRole("spinbutton").value).toBe("");
    fireEvent.change(resumedRow.getByRole("spinbutton"), { target: { value: "0" } });
    selectCategory("Dry Goods");
    const firstActual = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(firstActual, { target: { value: "0.0001" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Audit Check" }));
    expect(mocks.persist).toHaveBeenCalledTimes(2);
    fireEvent.change(firstActual, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Audit Check" }));
    await waitFor(() => expect(mocks.persist).toHaveBeenLastCalledWith(
      expect.objectContaining({ existingCheckId: "audit" }),
      [expect.objectContaining({ actualCount: 0, notes: "Verified shelf" }), expect.objectContaining({ actualCount: 0 })],
      "submitted", expect.any(String),
    ));
  });

});
