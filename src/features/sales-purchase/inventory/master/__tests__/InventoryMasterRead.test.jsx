import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateInventoryReads } from "../../../../../services/inventoryRevalidation.js";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../inventoryMasterService.js", async (importOriginal) => ({
  ...(await importOriginal()),
  loadInventoryMaster: mocks.load,
}));

import InventoryMasterPage from "../InventoryMasterPage.jsx";

const outlet = { id: "00000000-0000-4000-8000-000000000001", name: "QA Outlet", code: "QA" };
const category = { id: "00000000-0000-4000-8000-000000000002", name: "QA Category", status: "active", sortOrder: 1 };
const snapshot = (name) => ({
  categories: [category],
  uoms: [{ id: "00000000-0000-4000-8000-000000000003", code: "kg", displayName: "Kilogram", isActive: true, sortOrder: 1 }],
  items: [{ id: name, name, sku: name, categoryId: category.id, unit: "kg", status: "active", linkedOutletIds: [outlet.id], outletConfigs: [{ outletId: outlet.id, parLevel: 1 }] }],
  rawItemCount: 1,
  outletLinkCount: 1,
});
const auth = (id) => ({ user: { id }, profile: { role_outlet_access_type: "all" }, hasPermission: () => true });
const mount = (id) => <InventoryMasterPage auth={auth(id)} ui={{ notify: vi.fn() }} outlets={[outlet]} />;
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

beforeEach(() => mocks.load.mockReset());
afterEach(cleanup);

describe("Master Inventory scoped complete projection", () => {
  it("does not expose previous-scope rows or actions while a new scope is pending", async () => {
    const next = deferred();
    mocks.load.mockResolvedValueOnce(snapshot("Previous Item")).mockReturnValueOnce(next.promise);
    const view = render(mount("first-user"));
    await screen.findAllByText("Previous Item");
    view.rerender(mount("second-user"));
    expect(screen.queryAllByText("Previous Item")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Add Item" })).toBeNull();
    expect(screen.getByText(/Loading complete Master Inventory/)).toBeTruthy();
    next.resolve(snapshot("Current Item"));
    await screen.findAllByText("Current Item");
    expect(screen.queryAllByText("Previous Item")).toHaveLength(0);
  });

  it("retains verified same-scope rows while refreshing and rejects a late old-scope response", async () => {
    const oldRefresh = deferred();
    const newScope = deferred();
    mocks.load.mockResolvedValueOnce(snapshot("Verified Item"))
      .mockReturnValueOnce(oldRefresh.promise)
      .mockReturnValueOnce(newScope.promise);
    const view = render(mount("first-user"));
    await screen.findAllByText("Verified Item");
    invalidateInventoryReads({ source: "other-route" });
    await screen.findByText(/Showing the last verified complete read/);
    expect(screen.getAllByText("Verified Item").length).toBeGreaterThan(0);
    view.rerender(mount("second-user"));
    expect(screen.queryAllByText("Verified Item")).toHaveLength(0);
    oldRefresh.resolve(snapshot("Late Item"));
    await waitFor(() => expect(screen.queryAllByText("Late Item")).toHaveLength(0));
    newScope.resolve(snapshot("Current Item"));
    await screen.findAllByText("Current Item");
  });

  it("fails closed on an incomplete first read and retains verified data with an explicit refresh error", async () => {
    const incomplete = Object.assign(new Error("incomplete catalog"), { readState: "incomplete" });
    mocks.load.mockRejectedValueOnce(incomplete).mockResolvedValueOnce(snapshot("Verified Item")).mockRejectedValueOnce(new Error("read failed"));
    render(mount("first-user"));
    await screen.findByText(/Master Inventory unavailable or incomplete/);
    expect(screen.queryByRole("button", { name: "Add Item" })).toBeNull();
    screen.getByRole("button", { name: "Retry" }).click();
    await screen.findAllByText("Verified Item");
    invalidateInventoryReads({ source: "other-route" });
    await screen.findByText(/Showing the last verified Master Inventory read/);
    expect(screen.getAllByText("Verified Item").length).toBeGreaterThan(0);
  });
});
