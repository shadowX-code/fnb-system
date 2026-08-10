import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import FactoryWorkspacePage from "../FactoryWorkspacePage.jsx";

const job = { id: "job-production", job_order_no: "JO-PRODUCTION", status: "in_progress", product_name: "Sambal", product_code: "SKU-1", finished_good_id: "sku-1", target_pack_qty: 20, target_production_qty: 10, target_quantity: 10, uom: "kg", production_date: "2026-08-09", start_time: "08:00:00", started_at: "2026-08-09T08:00:00+08:00", production_operator_name: "Isaac" };
const rawMaterial = { id: "rm-1", name: "Chili", name_en: "Chili", material_code: "CHI", uom: "kg", status: "active" };
const finishedGood = { id: "sku-1", product_name: "Sambal", product_family_name: "Sambal", product_code: "SKU-1", status: "active", pack_size_qty: 500, pack_size_uom: "g", shelf_life_days: 30, storage_location_id: "fg-1" };
const execution = { snapshotCreatedAt: "2026-08-09T08:00:00+08:00", sopId: "sop-snapshot", sopVersion: "v7", steps: [{ id: "step-1", sop_step_id: "old-step", step_no: 1, step_name: "Cook", description: "Cook the batch", sub_steps: [{ sequence_no: 1, instruction: "Heat gently" }], qc_results: [{ id: "qc-check", qc_name: "Seal check", qc_type: "checklist", is_required: true, checklist_result: "", remarks: "", instructions: "Check seal" }, { id: "qc-note", qc_name: "Operator note", qc_type: "remarks", is_required: false, remarks: "" }] }] };
const data = { jobOrders: [job], rawMaterials: [rawMaterial], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [], factorySuppliers: [], factoryCustomers: [], storageLocations: [{ id: "fg-1", location_name: "FG Store", location_type: "Finished Goods Area", status: "active" }], productions: [], finishedGoods: [finishedGood], finishedGoodCategories: [], productFamilies: [], productMovements: [], finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [], recipes: [{ id: "recipe-1", product_name: "Sambal", status: "active", version: "v1", yield_quantity: 10, uom: "kg", items: [{ raw_material_id: "rm-1", quantity_used: 5, uom: "kg" }] }], sops: [{ id: "new-active-sop", product_name: "Sambal", status: "active", version: "v99", title: "New SOP" }], qcChecklistTemplates: [], auditLogs: [], accessIssues: [] };
const permissions = ["factory_production.view", "factory_production.complete"];
const auth = { permissions, hasPermission: (key) => permissions.includes(key), profile: { id: "employee-1", nickname: "Isaac" } };
function deferred() { let resolve; let reject; const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; }); return { promise, resolve, reject }; }

function setup() {
  vi.spyOn(factoryService, "listFactoryData").mockResolvedValue(data);
  vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [], summary: {}, totalCount: 0, page: 1, pageSize: 20 });
  vi.spyOn(factoryService, "listOperationalJobOrders").mockResolvedValue({ jobs: [job], productions: [], summary: { inProgress: 1 } });
  vi.spyOn(factoryService, "getProductionExecution").mockResolvedValue(execution);
  vi.spyOn(factoryService, "getRawMaterialBatchAvailability").mockResolvedValue([{ batch_balance_id: "batch-1", raw_material_id: "rm-1", internal_batch_no: "RM-BATCH-1", available_qty: 5, uom: "kg" }]);
  vi.spyOn(factoryService, "getProductionBatchNoPreview").mockResolvedValue("PB-001");
}
function mount(ui = { notify: vi.fn() }) { return render(<FactoryWorkspacePage initialTab="production" auth={auth} ui={ui} />); }
async function openProcess() { await screen.findByText(job.job_order_no); fireEvent.click(within(screen.getByText(job.job_order_no).closest("tr")).getByRole("button", { name: "View Process" })); await screen.findByRole("heading", { name: "Production Process & QC" }); }
async function openComplete() { await screen.findByText(job.job_order_no); fireEvent.click(within(screen.getByText(job.job_order_no).closest("tr")).getByRole("button", { name: "Complete" })); await screen.findByRole("heading", { name: "Complete Production" }); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Factory Production Execution lifecycle", () => {
  it("renders the stored execution snapshot and QC instead of substituting the newer active SOP", async () => {
    setup(); mount(); await openProcess();
    expect(screen.getByText(/Production SOP · v7/)).not.toBeNull();
    expect(screen.getByText("Cook")).not.toBeNull(); expect(screen.getByText("Heat gently")).not.toBeNull(); expect(screen.getByText("Seal check")).not.toBeNull();
    expect(screen.queryByText("New SOP")).toBeNull();
    expect(factoryService.getProductionExecution).toHaveBeenCalledWith(job.id);
  });

  it("persists changed QC through its one RPC-backed service call with the snapped execution", async () => {
    setup(); const save = vi.spyOn(factoryService, "saveProductionQcProgress").mockResolvedValue({ ...execution, steps: [{ ...execution.steps[0], qc_results: [{ ...execution.steps[0].qc_results[0], checklist_result: "pass" }, execution.steps[0].qc_results[1]] }] });
    mount(); await openProcess(); fireEvent.click(screen.getByRole("button", { name: "Pass" })); fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(job.id, expect.objectContaining({ snapshotCreatedAt: execution.snapshotCreatedAt, sopId: "sop-snapshot", sopVersion: "v7", steps: expect.any(Array) }), "employee-1", "Isaac");
  });

  it("blocks completion until required snapped QC is complete, and delegates the exact legacy-safe payload only when no snapshot blocks it", async () => {
    setup(); factoryService.getProductionExecution.mockResolvedValue({ steps: [], snapshotCreatedAt: "", sopId: "", sopVersion: "" }); const complete = vi.spyOn(factoryService, "completeProduction").mockResolvedValue({ id: "production-1" });
    mount(); await openComplete(); await waitFor(() => expect(screen.getByRole("button", { name: "Complete Production" }).disabled).toBe(false)); fireEvent.click(screen.getByRole("button", { name: "Complete Production" }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ job_order_id: job.id, finished_good_id: "sku-1", product_name: "Sambal", production_date: expect.any(String), start_time: "08:00", actual_pack_qty: 20, actual_output_qty: 10, actual_produced_qty: 10, good_output_qty: 10, uom: "kg", material_usage: [expect.objectContaining({ raw_material_id: "rm-1", standard_usage: 5, actual_usage: 5, uom: "kg", allocations: [expect.objectContaining({ batch_balance_id: "batch-1", allocated_qty: 5 })] })] }));
  });

  it("keeps completion open and retryable when the trusted completion rejects", async () => {
    setup(); factoryService.getProductionExecution.mockResolvedValue({ steps: [], snapshotCreatedAt: "", sopId: "", sopVersion: "" }); const complete = vi.spyOn(factoryService, "completeProduction").mockRejectedValueOnce(new Error("trusted rejection")).mockResolvedValueOnce({ id: "production-retry" }); const notify = vi.fn(); mount({ notify }); await openComplete();
    await waitFor(() => expect(screen.getByRole("button", { name: "Complete Production" }).disabled).toBe(false)); fireEvent.click(screen.getByRole("button", { name: "Complete Production" }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1)); expect(screen.getByRole("heading", { name: "Complete Production" })).not.toBeNull(); expect(screen.getByRole("button", { name: "Complete Production" }).disabled).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to complete production", tone: "error" })); fireEvent.click(screen.getByRole("button", { name: "Complete Production" })); await waitFor(() => expect(complete).toHaveBeenCalledTimes(2)); expect(complete.mock.calls[0][0]).not.toHaveProperty("completion_request_id"); expect(complete.mock.calls[1][0]).not.toHaveProperty("completion_request_id");
  });

  it("prevents rapid duplicate completion submits while the Workspace-owned mutation is in flight", async () => {
    setup(); factoryService.getProductionExecution.mockResolvedValue({ steps: [], snapshotCreatedAt: "", sopId: "", sopVersion: "" }); const pending = deferred(); const complete = vi.spyOn(factoryService, "completeProduction").mockReturnValue(pending.promise); mount(); await openComplete();
    await waitFor(() => expect(screen.getByRole("button", { name: "Complete Production" }).disabled).toBe(false)); const submit = screen.getByRole("button", { name: "Complete Production" }); fireEvent.click(submit); fireEvent.click(submit);
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1)); expect(submit.disabled).toBe(true); pending.resolve({ id: "production-1" }); await waitFor(() => expect(screen.queryByRole("heading", { name: "Complete Production" })).toBeNull());
  });

  it("keeps the newer batch-availability response authoritative when an older material request resolves late", async () => {
    const first = deferred(); const second = deferred(); const manualData = { ...data, recipes: [], rawMaterials: [rawMaterial, { ...rawMaterial, id: "rm-2", name: "Garlic", name_en: "Garlic", material_code: "GAR" }] };
    setup(); factoryService.listFactoryData.mockResolvedValue(manualData); const availability = factoryService.getRawMaterialBatchAvailability.mockImplementation((ids) => ids[0] === "rm-1" ? first.promise : second.promise); mount(); await openComplete(); fireEvent.click(screen.getByRole("button", { name: "Add Material" }));
    const materialSelect = screen.getByRole("combobox"); fireEvent.change(materialSelect, { target: { value: "rm-1" } }); await waitFor(() => expect(availability).toHaveBeenCalledWith(["rm-1"], job.id)); fireEvent.change(materialSelect, { target: { value: "rm-2" } }); await waitFor(() => expect(availability).toHaveBeenCalledWith(["rm-2"], job.id));
    second.resolve([{ batch_balance_id: "new-batch", raw_material_id: "rm-2", internal_batch_no: "GAR-NEW", available_qty: 9, uom: "kg" }]); await waitFor(() => expect(screen.getByRole("button", { name: "Auto Allocate FEFO" }).disabled).toBe(false)); fireEvent.click(screen.getByRole("button", { name: "Auto Allocate FEFO" })); expect(await screen.findByText("GAR-NEW")).not.toBeNull(); first.resolve([{ batch_balance_id: "old-batch", raw_material_id: "rm-1", internal_batch_no: "CHI-OLD", available_qty: 1, uom: "kg" }]);
    await waitFor(() => expect(screen.queryByText("CHI-OLD")).toBeNull()); expect(screen.getByText("GAR-NEW")).not.toBeNull();
  });
});
