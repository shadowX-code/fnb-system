import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import FactoryWorkspacePage from "../FactoryWorkspacePage.jsx";

const permissions = [
  "factory_job_orders.view", "factory_job_orders.create", "factory_job_orders.edit", "factory_job_orders.cancel",
  "factory_production.view", "factory_production.complete", "factory_raw_receiving.view", "factory_raw_receiving.create",
  "factory_finished_goods_dispatch.view", "factory_finished_goods_dispatch.create", "factory_finished_goods_dispatch.edit", "factory_finished_goods_dispatch.complete", "factory_finished_goods_dispatch.delete",
  "factory_raw_stock_check.view", "factory_raw_stock_check.create", "factory_product_stock_check.view", "factory_product_stock_check.create",
  "factory_production_reports.view",
];

const job = {
  id: "job-1", job_order_no: "JO260809-01", status: "released", planned_date: "2026-08-09", production_date: "2026-08-09",
  finished_good_id: "sku-1", finished_good_name: "Sambal", product_name: "Sambal", product_code: "SKU-1",
  target_production_qty: 10, target_quantity: 10, uom: "kg", priority: "Normal", production_qc_status: "pending",
};

const data = {
  jobOrders: [job], rawMaterials: [{ id: "rm-1", name: "Chili", name_en: "Chili", material_code: "CHI", uom: "kg", current_balance: 8, status: "active" }],
  rawMaterialCategories: [], rawMaterialMovements: [], receivings: [{ id: "receiving-1", receiving_no: "R260809-01", raw_material_name: "Chili", status: "draft" }], receivingBatches: [],
  factorySuppliers: [{ id: "supplier-1", name: "Spice Supply" }], factoryCustomers: [{ id: "customer-1", name: "Outlet A" }], storageLocations: [{ id: "storage-1", name: "Dry Store A" }],
  productions: [], finishedGoods: [{ id: "sku-1", product_name: "Sambal", product_family_name: "Sambal", product_code: "SKU-1", pack_size_qty: 500, pack_size_uom: "g", current_balance: 10, status: "active" }],
  finishedGoodCategories: [], productFamilies: [], productMovements: [], finishedGoodDispatches: [{ id: "dispatch-1", dispatch_no: "D260809-01", dispatch_date: "2026-08-09", customer_name: "Outlet A", status: "draft", items: [] }],
  rawStockChecks: [{ id: "rm-check-1", check_no: "RMSC-260809-01", status: "draft", items: [] }], productStockChecks: [{ id: "fg-check-1", check_no: "FGSC260809-01", status: "draft", items: [] }],
  recipes: [], sops: [], qcChecklistTemplates: [], auditLogs: [], accessIssues: [],
};

const auth = { permissions, hasPermission: (key) => permissions.includes(key), profile: { id: "employee-1", nickname: "Isaac" } };
const ui = { notify: vi.fn() };

function setup(response = data) {
  vi.spyOn(factoryService, "listFactoryData").mockResolvedValue(response);
  vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [], summary: {}, totalCount: 0, page: 1, pageSize: 20 });
  vi.spyOn(factoryService, "listOperationalJobOrders").mockResolvedValue({ jobs: [job], productions: [], summary: { scheduled: 0, released: 1, inProgress: 0, completedToday: 0, outputByUom: [], completionRate: 0 } });
  vi.spyOn(factoryService, "getRawMaterialReceivingNoPreview").mockResolvedValue("R260809-02");
  vi.spyOn(factoryService, "getFinishedGoodDispatchNoPreview").mockResolvedValue("D260809-02");
  vi.spyOn(factoryService, "getStockCheckNoPreview").mockResolvedValue("RMSC-260809-02");
  vi.spyOn(factoryService, "getFinishedGoodInventoryReconciliation").mockResolvedValue([]);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("FactoryWorkspacePage operational route smoke", () => {
  it.each([
    ["production-overview", "Production Overview"],
    ["raw-receiving", "Raw Material Receiving"],
    ["production", "Production Records"],
    ["reports", "Factory Reports"],
    ["finished-goods-dispatch", "Finished Goods Dispatch"],
    ["raw-stock-check", "Raw Material Stock Check"],
    ["product-stock-check", "Product Stock Check"],
  ])("mounts %s with representative and empty Factory collections", async (initialTab, title) => {
    setup();
    const { rerender } = render(<FactoryWorkspacePage initialTab={initialTab} auth={auth} ui={ui} />);
    expect((await screen.findAllByRole("heading", { name: title })).length).toBeGreaterThan(0);

    setup({ ...data, jobOrders: [], rawMaterials: [], receivings: [], finishedGoods: [], finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [], productions: [] });
    rerender(<FactoryWorkspacePage initialTab={initialTab} auth={auth} ui={ui} />);
    expect(screen.getAllByRole("heading", { name: title }).length).toBeGreaterThan(0);
  });

  it("opens Start Production and forwards the authoritative start intent through factoryService", async () => {
    setup();
    const start = vi.spyOn(factoryService, "startJobOrder").mockResolvedValue({ ...job, status: "in_progress" });
    render(<FactoryWorkspacePage initialTab="production-overview" auth={auth} ui={ui} />);

    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    expect(screen.getByRole("heading", { name: "Start Production" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start Production" }));

    await waitFor(() => expect(start).toHaveBeenCalledWith(job, expect.objectContaining({ production_date: expect.any(String) }), auth.profile));
  });

  it("keeps lifecycle controls absent for a view-only operational user", async () => {
    setup();
    const viewOnly = { permissions: ["factory_production.view"], hasPermission: (key) => key === "factory_production.view" };
    render(<FactoryWorkspacePage initialTab="production-overview" auth={viewOnly} ui={ui} />);
    await screen.findByText("Production Overview");
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Complete Production/i })).toBeNull();
  });

  it("opens Receiving, Dispatch, and both Stock Check forms without a collection or helper failure", async () => {
    setup();
    const receiving = render(<FactoryWorkspacePage initialTab="raw-receiving" auth={auth} ui={ui} />);
    fireEvent.click(await screen.findByRole("button", { name: "Receive Raw Material" }));
    expect(screen.getByText("Save Draft")).not.toBeNull();
    expect(screen.getByText("Select Raw Material")).not.toBeNull();
    receiving.unmount();

    const dispatch = render(<FactoryWorkspacePage initialTab="finished-goods-dispatch" auth={auth} ui={ui} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Dispatch" }));
    expect(screen.getByText("Dispatch Items")).not.toBeNull();
    expect(screen.getByText("Save Draft")).not.toBeNull();
    dispatch.unmount();

    const rawCheck = render(<FactoryWorkspacePage initialTab="raw-stock-check" auth={auth} ui={ui} />);
    fireEvent.click(await screen.findByRole("button", { name: "New Stock Check" }));
    expect(screen.getByText("Save Draft")).not.toBeNull();
    rawCheck.unmount();

    const productCheck = render(<FactoryWorkspacePage initialTab="product-stock-check" auth={auth} ui={ui} />);
    fireEvent.click(await screen.findByRole("button", { name: "New Stock Check" }));
    expect(screen.getByText("Save Draft")).not.toBeNull();
  });
});
