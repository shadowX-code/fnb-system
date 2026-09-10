import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import { createJobOrdersListingBridge } from "../../hooks/jobOrdersListingBridge.js";
import FactoryWorkspacePage from "../FactoryWorkspacePage.jsx";

const draft = {
  id: "draft",
  job_order_no: "JO-DRAFT",
  status: "draft",
  product_family_key: "family:family-1",
  finished_good_id: "sku-1",
  product_name: "Sambal",
  product_code: "SKU-1",
  target_production_qty: 10,
  target_quantity: 10,
  target_pack_qty: 20,
  uom: "kg",
  priority: "Normal",
  planned_date: "2026-08-09",
};
const data = {
  jobOrders: [draft], rawMaterials: [], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [], factorySuppliers: [], factoryCustomers: [], storageLocations: [], productions: [],
  finishedGoods: [{ id: "sku-1", product_family_id: "family-1", product_family_name: "Sambal", product_name: "Sambal", product_code: "SKU-1", pack_size_qty: 500, pack_size_uom: "g", status: "active" }],
  finishedGoodCategories: [], productFamilies: [{ id: "family-1", name_en: "Sambal", status: "active" }], productMovements: [], finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [], recipes: [{ id: "recipe-1", product_family_id: "family-1", product_name: "Sambal", version: "v1", status: "active", yield_quantity: 10, uom: "kg", items: [] }], sops: [], qcChecklistTemplates: [], auditLogs: [], accessIssues: [],
};
const permissions = ["factory_job_orders.edit"];

function setup() {
  vi.spyOn(factoryService, "listFactoryData").mockResolvedValue(data);
  return vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [draft], summary: {}, totalCount: 1, page: 1, pageSize: 20 });
}

function mount() {
  return render(<FactoryWorkspacePage initialTab="job-orders" auth={{ permissions, hasPermission: (key) => permissions.includes(key) }} ui={{ notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) }} />);
}

function draftRow() {
  return screen.getByText("JO-DRAFT").closest("tr");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Factory Job Orders listing bridge", () => {
  it("keeps stable bridge methods while dispatching to the latest shared-listing actions", () => {
    const firstRetry = vi.fn();
    const firstSnapshot = vi.fn();
    const retryRef = { current: firstRetry };
    const snapshotRef = { current: firstSnapshot };
    const bridge = createJobOrdersListingBridge(retryRef, snapshotRef);
    const retry = bridge.retry;
    const updateLoadedSnapshot = bridge.updateLoadedSnapshot;
    const secondRetry = vi.fn();
    const secondSnapshot = vi.fn();
    retryRef.current = secondRetry;
    snapshotRef.current = secondSnapshot;

    retry("refresh");
    updateLoadedSnapshot("updater");

    expect(bridge.retry).toBe(retry);
    expect(bridge.updateLoadedSnapshot).toBe(updateLoadedSnapshot);
    expect(firstRetry).not.toHaveBeenCalled();
    expect(firstSnapshot).not.toHaveBeenCalled();
    expect(secondRetry).toHaveBeenCalledWith("refresh");
    expect(secondSnapshot).toHaveBeenCalledWith("updater");
  });

  it("does not issue another job-orders query or bridge retry on an ordinary Workspace rerender", async () => {
    const listing = setup();
    const view = mount();
    await screen.findByText("JO-DRAFT");

    view.rerender(<FactoryWorkspacePage initialTab="job-orders" auth={{ permissions: [...permissions], hasPermission: (key) => permissions.includes(key) }} ui={{ notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) }} />);

    expect(listing).toHaveBeenCalledTimes(1);
    expect(listing).toHaveBeenCalledWith(expect.objectContaining({ listing: "job-orders" }));
  });

  it("uses the bridge for one successful lifecycle retry and preserves the single Job Orders query authority", async () => {
    const listing = setup();
    vi.spyOn(factoryService, "releaseJobOrder").mockResolvedValue({});
    mount();
    await screen.findByText("JO-DRAFT");

    fireEvent.click(within(draftRow()).getByRole("button", { name: "Release" }));

    await waitFor(() => expect(factoryService.releaseJobOrder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    expect(listing.mock.calls.every(([request]) => request.listing === "job-orders")).toBe(true);
  });

  it("does not trigger a successful bridge retry after a rejected lifecycle mutation", async () => {
    const listing = setup();
    vi.spyOn(factoryService, "releaseJobOrder").mockRejectedValueOnce(new Error("release failed"));
    mount();
    await screen.findByText("JO-DRAFT");

    fireEvent.click(within(draftRow()).getByRole("button", { name: "Release" }));

    await waitFor(() => expect(factoryService.releaseJobOrder).toHaveBeenCalledTimes(1));
    expect(listing).toHaveBeenCalledTimes(1);
  });

  it("updates the loaded Job Orders snapshot through the bridge before its single save refresh", async () => {
    const listing = setup();
    let resolveRefresh;
    listing.mockReset()
      .mockResolvedValueOnce({ rows: [draft], summary: {}, totalCount: 1, page: 1, pageSize: 20 })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    const saved = { ...draft, target_production_qty: 12, target_quantity: 12, target_pack_qty: 24 };
    vi.spyOn(factoryService, "saveJobOrder").mockResolvedValue(saved);
    mount();
    await screen.findByText("JO-DRAFT");
    fireEvent.click(within(draftRow()).getByRole("button", { name: "More row actions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(factoryService.saveJobOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "draft", target_production_qty: 12, target_pack_qty: 24 })));
    await waitFor(() => expect(screen.getByText("12 kg")).not.toBeNull());
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    resolveRefresh({ rows: [saved], summary: {}, totalCount: 1, page: 1, pageSize: 20 });
  });
});
