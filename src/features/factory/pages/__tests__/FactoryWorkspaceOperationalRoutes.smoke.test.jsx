import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import { malaysiaBusinessDateInput } from "../../utils/factoryDates.js";
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

const plannedJob = {
  ...job,
  id: "job-0",
  job_order_no: "JO260809-00",
  status: "planned",
  planned_date: "2026-08-10",
  priority: "High",
};

const inProgressJob = {
  ...job,
  id: "job-2",
  job_order_no: "JO260809-02",
  status: "in_progress",
  start_time: "09:00:00",
  started_at: "2026-08-09T09:00:00+08:00",
  production_operator_name: "Isaac",
};

const completedJob = {
  ...job,
  id: "job-3",
  job_order_no: "JO260809-03",
  status: "completed",
  completed_at: "2026-08-09T11:00:00+08:00",
  produced_quantity: 10,
};

const completedProduction = {
  id: "production-1",
  job_order_id: completedJob.id,
  job_order_no: completedJob.job_order_no,
  batch_no: "PB260809-01",
  product_name: "Sambal",
  production_date: "2026-08-09",
  end_date: "2026-08-09",
  end_time: "11:00:00",
  completed_at: "2026-08-09T11:00:00+08:00",
  operator_name: "Isaac",
  actual_produced_qty: 10,
  good_output_qty: 9,
  wastage_qty: 1,
  uom: "kg",
  material_usage: [{ id: "usage-1", raw_material_name: "Chili", raw_material_id: "rm-1", standard_usage: 5, actual_usage: 5.5, variance_qty: 0.5, variance_percent: 10, unit_cost: 4, uom: "kg" }],
};

const receiving = { id: "receiving-1", receiving_no: "R260809-01", batch_no: "R260809-01", received_date: "2026-08-09", raw_material_name: "Chili", supplier_name: "Spice Supply", status: "completed", items_count: 1, total_qty: 8, uom: "kg", unit_cost: 4, raw_material_id: "rm-1", items: [{ raw_material_id: "rm-1", received_qty: 8, uom: "kg" }] };
const dispatch = { id: "dispatch-1", dispatch_no: "D260809-01", dispatch_date: "2026-08-09", customer_name: "Outlet A", status: "draft", items_count: 1, total_qty: 3, uom: "packs", created_by_name: "Isaac", items: [{ finished_good_id: "sku-1", quantity: 3, packaging_type: "Pack" }] };
const rawStockCheck = { id: "rm-check-1", check_no: "RMSC-260809-01", status: "submitted", created_at: "2026-08-09T10:00:00+08:00", items: [{ id: "rm-check-item-1", raw_material_name: "Chili", system_qty: 8, physical_qty: 6, variance_status: "Critical", count_status: "counted" }] };
const productStockCheck = { id: "fg-check-1", check_no: "FGSC260809-01", status: "submitted", created_at: "2026-08-09T10:00:00+08:00", items: [{ id: "fg-check-item-1", product_name: "Sambal", system_qty: 10, physical_qty: 9, variance_qty: -1, variance_status: "Variance", count_status: "counted" }] };

const data = {
  jobOrders: [plannedJob, job, inProgressJob, completedJob], rawMaterials: [{ id: "rm-1", name: "Chili", name_en: "Chili", material_code: "CHI", uom: "kg", current_balance: 8, status: "active" }],
  rawMaterialCategories: [], rawMaterialMovements: [], receivings: [receiving], receivingBatches: [receiving],
  factorySuppliers: [{ id: "supplier-1", name: "Spice Supply" }], factoryCustomers: [{ id: "customer-1", name: "Outlet A" }], storageLocations: [{ id: "storage-1", name: "Dry Store A" }],
  productions: [completedProduction], finishedGoods: [{ id: "sku-1", product_name: "Sambal", product_family_name: "Sambal", product_code: "SKU-1", pack_size_qty: 500, pack_size_uom: "g", current_balance: 10, status: "active" }],
  finishedGoodCategories: [], productFamilies: [], productMovements: [{ id: "product-movement-1", reference_no: "PB260809-01", product_name: "Sambal", movement_type: "Production In", quantity: 9, uom: "packs", movement_date: "2026-08-09" }], finishedGoodDispatches: [dispatch],
  rawStockChecks: [rawStockCheck], productStockChecks: [productStockCheck],
  recipes: [{ id: "recipe-1", product_name: "Sambal", status: "active", version: "v1", yield_quantity: 10, uom: "kg", items: [{ raw_material_id: "rm-1", quantity_used: 5, uom: "kg" }] }], sops: [{ id: "sop-1", product_name: "Sambal", status: "active", version: "v1" }], qcChecklistTemplates: [], auditLogs: [], accessIssues: [],
};

const auth = { permissions, hasPermission: (key) => permissions.includes(key), profile: { id: "employee-1", nickname: "Isaac" } };
const ui = { notify: vi.fn() };

function setup(response = data) {
  vi.spyOn(factoryService, "listFactoryData").mockResolvedValue(response);
  vi.spyOn(factoryService, "listFactoryListingPage").mockImplementation(({ listing }) => {
    const listings = {
      "job-orders": { rows: [job, completedJob], summary: {}, totalCount: 2 },
      "receiving-history": { rows: [receiving], summary: { documents: 1, items: 1, total_qty: 8 }, totalCount: 1 },
      "production-history": { rows: [completedProduction], summary: { completed_runs: 1, good_output: 9, wastage_qty: 1, high_variance: 1 }, totalCount: 1 },
      "dispatch-history": { rows: [dispatch], summary: { draft: 1, completed_today: 0, customers_today: 1 }, totalCount: 1 },
      "raw-stock-checks": { rows: [rawStockCheck], summary: { checks: 1, submitted: 1, critical_rows: 1 }, totalCount: 1 },
      "product-stock-checks": { rows: [productStockCheck], summary: { checks: 1, submitted: 1, variance_rows: 1 }, totalCount: 1 },
    };
    const result = listings[listing] || { rows: [], summary: {}, totalCount: 0 };
    return Promise.resolve({ ...result, page: 1, pageSize: 20 });
  });
  vi.spyOn(factoryService, "listOperationalJobOrders").mockResolvedValue({ jobs: [plannedJob, job, inProgressJob, completedJob], productions: [completedProduction], summary: { scheduled: 1, released: 1, inProgress: 1, completedToday: 1, outputByUom: [{ quantity: 9, uom: "kg" }], completionRate: 100 } });
  vi.spyOn(factoryService, "getRawMaterialReceivingNoPreview").mockResolvedValue("R260809-02");
  vi.spyOn(factoryService, "getFinishedGoodDispatchNoPreview").mockResolvedValue("D260809-02");
  vi.spyOn(factoryService, "getStockCheckNoPreview").mockResolvedValue("RMSC-260809-02");
  vi.spyOn(factoryService, "getFinishedGoodInventoryReconciliation").mockResolvedValue([]);
  vi.spyOn(factoryService, "getProductionExecution").mockResolvedValue({ steps: [], snapshotCreatedAt: "", sopId: "", sopVersion: "" });
  vi.spyOn(factoryService, "getRawMaterialBatchAvailability").mockResolvedValue([{ batch_balance_id: "batch-balance-1", raw_material_id: "rm-1", internal_batch_no: "RB260809-01", available_qty: 8, uom: "kg" }]);
  vi.spyOn(factoryService, "getProductionBatchNoPreview").mockResolvedValue("PB260809-02");
  vi.spyOn(factoryService, "getProductionByJobOrder").mockResolvedValue(completedProduction);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("FactoryWorkspacePage operational route smoke", () => {
  it.each([
    ["production-overview", "Production Overview", "JO260809-03"],
    ["raw-receiving", "Raw Material Receiving", "R260809-01"],
    ["production", "Production Records", "PB260809-01"],
    ["reports", "Factory Reports", "PB260809-01"],
    ["finished-goods-dispatch", "Finished Goods Dispatch", "D260809-01"],
    ["raw-stock-check", "Raw Material Stock Check", "RMSC-260809-01"],
    ["product-stock-check", "Product Stock Check", "FGSC260809-01"],
  ])("renders nonempty %s data paths", async (initialTab, title, reference) => {
    setup();
    render(<FactoryWorkspacePage initialTab={initialTab} auth={auth} ui={ui} />);
    expect((await screen.findAllByRole("heading", { name: title })).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(reference)).length).toBeGreaterThan(0);
  });

  it("opens Start Production and forwards the authoritative start intent through factoryService", async () => {
    setup();
    const start = vi.spyOn(factoryService, "startJobOrder").mockResolvedValue({ ...job, status: "in_progress" });
    render(<FactoryWorkspacePage initialTab="production-overview" auth={auth} ui={ui} />);

    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    expect(screen.getByRole("heading", { name: "Start Production" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start Production" }));

    await waitFor(() => expect(start).toHaveBeenCalledWith(job, expect.objectContaining({ production_date: expect.any(String) }), auth.profile));
    await waitFor(() => expect(factoryService.listOperationalJobOrders).toHaveBeenCalledTimes(2));
  });

  it("uses the Malaysia business date and production visibility semantics for the operational query", async () => {
    setup();
    render(<FactoryWorkspacePage initialTab="production-overview" auth={auth} ui={ui} />);

    await waitFor(() => expect(factoryService.listOperationalJobOrders).toHaveBeenCalledWith({
      date: malaysiaBusinessDateInput(),
      includeProductions: true,
    }));
  });

  it("does not request operational jobs for unrelated Factory routes", async () => {
    setup();
    render(<FactoryWorkspacePage initialTab="raw-receiving" auth={auth} ui={ui} />);
    await screen.findByText("Raw Material Receiving");
    expect(factoryService.listOperationalJobOrders).not.toHaveBeenCalled();
  });

  it("keeps production data optional when the current permission semantics do not grant production visibility", async () => {
    setup();
    const jobsOnly = { permissions: ["factory_job_orders.view"], hasPermission: (key) => key === "factory_job_orders.view" };
    render(<FactoryWorkspacePage initialTab="production-overview" auth={jobsOnly} ui={ui} />);

    await waitFor(() => expect(factoryService.listOperationalJobOrders).toHaveBeenCalledWith({
      date: malaysiaBusinessDateInput(),
      includeProductions: false,
    }));
  });

  it("renders representative scheduled, released, in-progress, and completed board cards from operational data", async () => {
    setup();
    render(<FactoryWorkspacePage initialTab="production-overview" auth={auth} ui={ui} />);

    for (const jobOrderNo of [plannedJob.job_order_no, job.job_order_no, inProgressJob.job_order_no, completedJob.job_order_no]) {
      expect((await screen.findAllByText(jobOrderNo)).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("Sambal").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Packaging SKU/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10 kg/).length).toBeGreaterThan(0);
    expect(screen.getByText("High")).not.toBeNull();
    expect(screen.getByText("Production QC")).not.toBeNull();
    expect(screen.getByText("No QC Required")).not.toBeNull();
    expect(screen.getByText("PB260809-01")).not.toBeNull();
    expect(screen.getByText("Output Qty")).not.toBeNull();
  });

  it("routes board actions into the workspace-owned Start, Complete, Result, and Job modal callbacks", async () => {
    setup();
    render(<FactoryWorkspacePage initialTab="production-overview" auth={auth} ui={ui} />);

    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    expect(screen.getByRole("heading", { name: "Start Production" })).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "×" }).at(-1));

    fireEvent.click(screen.getByRole("button", { name: "Complete Production" }));
    expect(await screen.findByRole("heading", { name: "Complete Production" })).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "×" }).at(-1));

    fireEvent.click(screen.getAllByRole("button", { name: "View Result" })[0]);
    await waitFor(() => expect(factoryService.getProductionByJobOrder).toHaveBeenCalledWith(completedJob.id));
    expect(await screen.findByRole("heading", { name: "Completed Job Order Result" })).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "×" }).at(-1));

    fireEvent.click(screen.getAllByRole("button", { name: "View" })[0]);
    expect(await screen.findByRole("heading", { name: "View Job Order" })).not.toBeNull();
  });

  it("refreshes the operational board through the workspace after a successful production completion", async () => {
    setup();
    const complete = vi.spyOn(factoryService, "completeProduction").mockResolvedValue({ id: "production-2" });
    render(<FactoryWorkspacePage initialTab="production-overview" auth={auth} ui={ui} />);

    fireEvent.click(await screen.findByRole("button", { name: "Complete Production" }));
    await screen.findByRole("heading", { name: "Complete Production" });
    await waitFor(() => expect(factoryService.getRawMaterialBatchAvailability).toHaveBeenCalledWith(["rm-1"], inProgressJob.id));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Complete Production" }).at(-1).disabled).toBe(false));
    fireEvent.click(screen.getAllByRole("button", { name: "Complete Production" }).at(-1));

    await waitFor(() => expect(complete).toHaveBeenCalledWith(expect.objectContaining({ job_order_id: inProgressJob.id })));
    await waitFor(() => expect(factoryService.listOperationalJobOrders).toHaveBeenCalledTimes(2));
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
