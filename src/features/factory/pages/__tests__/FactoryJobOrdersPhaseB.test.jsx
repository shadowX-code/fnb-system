import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import FactoryWorkspacePage from "../FactoryWorkspacePage.jsx";

const rows = [
  { id: "draft", job_order_no: "JO-DRAFT", status: "draft", product_family_key: "family:family-1", finished_good_id: "sku-1", product_name: "Sambal", product_code: "SKU-1", target_production_qty: 10, target_quantity: 10, target_pack_qty: 20, uom: "kg", priority: "Normal", planned_date: "2026-08-09" },
  { id: "planned", job_order_no: "JO-PLANNED", status: "planned", product_name: "Sambal", product_code: "SKU-1", target_production_qty: 10, uom: "kg", planned_date: "2026-08-09" },
  { id: "released", job_order_no: "JO-RELEASED", status: "released", product_name: "Sambal", product_code: "SKU-1", target_production_qty: 10, uom: "kg", planned_date: "2026-08-09" },
  { id: "in-progress", job_order_no: "JO-IN-PROGRESS", status: "in_progress", product_name: "Sambal", product_code: "SKU-1", target_production_qty: 10, uom: "kg", planned_date: "2026-08-09" },
  { id: "completed", job_order_no: "JO-COMPLETED", status: "completed", product_name: "Sambal", product_code: "SKU-1", target_production_qty: 10, uom: "kg", planned_date: "2026-08-09" },
];
const data = { jobOrders: rows, rawMaterials: [], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [], factorySuppliers: [], factoryCustomers: [], storageLocations: [], productions: [], finishedGoods: [{ id: "sku-1", product_family_id: "family-1", product_family_name: "Sambal", product_name: "Sambal", product_code: "SKU-1", pack_size_qty: 500, pack_size_uom: "g", status: "active" }], finishedGoodCategories: [], productFamilies: [], productMovements: [], finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [], recipes: [{ id: "recipe-1", product_family_id: "family-1", product_name: "Sambal", version: "v1", status: "active", yield_quantity: 10, uom: "kg", items: [] }], sops: [], qcChecklistTemplates: [], auditLogs: [], accessIssues: [] };
const keys = ["factory_job_orders.create", "factory_job_orders.edit", "factory_job_orders.delete", "factory_job_orders.cancel"];

function setup() {
  vi.spyOn(factoryService, "listFactoryData").mockResolvedValue(data);
  const listing = vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows, summary: {}, totalCount: rows.length, page: 1, pageSize: 20 });
  ["releaseJobOrder", "deleteJobOrder", "cancelJobOrder"].forEach((method) => vi.spyOn(factoryService, method).mockResolvedValue({}));
  vi.spyOn(factoryService, "getJobOrderNoPreview").mockResolvedValue("JO-NEW");
  vi.spyOn(factoryService, "saveJobOrder").mockResolvedValue({ id: "created" });
  return listing;
}
function row(jobNo) { return screen.getByText(jobNo).closest("tr"); }
function mount(confirm = vi.fn().mockResolvedValue(true)) { return render(<FactoryWorkspacePage initialTab="job-orders" auth={{ permissions: keys, hasPermission: (key) => keys.includes(key) }} ui={{ notify: vi.fn(), confirm }} />); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Factory Job Orders Phase B", () => {
  async function fillCreate() {
    fireEvent.click(screen.getByRole("button", { name: "Create Job Order" }));
    fireEvent.click(screen.getByRole("button", { name: "Finished Good *" }));
    fireEvent.click(screen.getAllByText("Sambal").at(-1));
    fireEvent.click(screen.getByRole("button", { name: "Packaging SKU *" }));
    fireEvent.click(screen.getByRole("button", { name: /SKU-1/ }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "10" } });
  }

  it("creates through the modal with its current service payload, closes, and refreshes once", async () => {
    const listing = setup(); mount(); await screen.findByText("JO-DRAFT");
    await fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "Schedule Job Order" }));
    await waitFor(() => expect(factoryService.saveJobOrder).toHaveBeenCalledTimes(1));
    expect(factoryService.saveJobOrder).toHaveBeenCalledWith(expect.objectContaining({ product_family_key: "family:family-1", finished_good_id: "sku-1", product_name: "Sambal", target_pack_qty: 20, target_production_qty: 10, target_quantity: 10, uom: "kg", status: "draft", priority: "Normal" }));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("heading", { name: "Create Job Order" })).toBeNull();
    expect(factoryService.releaseJobOrder).not.toHaveBeenCalled(); expect(factoryService.deleteJobOrder).not.toHaveBeenCalled(); expect(factoryService.cancelJobOrder).not.toHaveBeenCalled();
  });

  it("keeps create modal open and does not refresh when save rejects", async () => {
    const listing = setup(); factoryService.saveJobOrder.mockRejectedValueOnce(new Error("save failed")); mount(); await screen.findByText("JO-DRAFT");
    await fillCreate(); fireEvent.click(screen.getByRole("button", { name: "Schedule Job Order" }));
    await waitFor(() => expect(factoryService.saveJobOrder).toHaveBeenCalledTimes(1));
    expect(listing).toHaveBeenCalledTimes(1); expect(screen.getByRole("heading", { name: "Create Job Order" })).not.toBeNull();
  });

  it("edits the eligible Draft through the current modal and one workspace refresh", async () => {
    const listing = setup(); mount(); await screen.findByText("JO-DRAFT");
    fireEvent.click(within(row("JO-DRAFT")).getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Edit Job Order" })).not.toBeNull();
    expect(screen.getByRole("spinbutton").value).toBe("10");
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(factoryService.saveJobOrder).toHaveBeenCalledTimes(1));
    expect(factoryService.saveJobOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "draft", job_order_no: "JO-DRAFT", product_family_key: "family:family-1", finished_good_id: "sku-1", product_name: "Sambal", target_pack_qty: 24, target_production_qty: 12, target_quantity: 12, uom: "kg", status: "draft", priority: "Normal" }));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("heading", { name: "Edit Job Order" })).toBeNull();
    expect(factoryService.releaseJobOrder).not.toHaveBeenCalled(); expect(factoryService.deleteJobOrder).not.toHaveBeenCalled(); expect(factoryService.cancelJobOrder).not.toHaveBeenCalled();
  });
  it("releases Draft through the workspace confirmation and exactly one listing refresh", async () => {
    const listing = setup(); mount();
    await screen.findByText("JO-DRAFT");
    fireEvent.click(within(row("JO-DRAFT")).getByRole("button", { name: "Release" }));
    await waitFor(() => expect(factoryService.releaseJobOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "draft" })));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    expect(factoryService.releaseJobOrder).toHaveBeenCalledTimes(1);
    expect(factoryService.deleteJobOrder).not.toHaveBeenCalled();
    expect(factoryService.cancelJobOrder).not.toHaveBeenCalled();
  });

  it("releases Planned with factory_job_orders.edit through one workspace mutation and refresh", async () => {
    const listing = setup(); mount();
    await screen.findByText("JO-PLANNED");
    fireEvent.click(within(row("JO-PLANNED")).getByRole("button", { name: "Release" }));
    await waitFor(() => expect(factoryService.releaseJobOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "planned" })));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    expect(factoryService.releaseJobOrder).toHaveBeenCalledTimes(1);
  });

  it("deletes only the eligible Draft through workspace confirmation and refresh", async () => {
    const listing = setup(); mount();
    await screen.findByText("JO-DRAFT");
    fireEvent.click(within(row("JO-DRAFT")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(factoryService.deleteJobOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "draft" })));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    expect(factoryService.deleteJobOrder).toHaveBeenCalledTimes(1);
  });

  it("cancels eligible Planned and Released orders through one workspace-owned mutation each", async () => {
    const listing = setup(); mount();
    await screen.findByText("JO-PLANNED");
    fireEvent.click(within(row("JO-PLANNED")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(factoryService.cancelJobOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "planned" })));
    fireEvent.click(within(row("JO-RELEASED")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(factoryService.cancelJobOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "released" })));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(3));
    expect(factoryService.cancelJobOrder).toHaveBeenCalledTimes(2);
  });

  it("keeps Release, Delete and Cancel unavailable for their ineligible statuses and missing keys", async () => {
    setup();
    render(<FactoryWorkspacePage initialTab="job-orders" auth={{ permissions: [], hasPermission: () => false }} ui={{ notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) }} />);
    await screen.findByText("JO-DRAFT");
    ["JO-DRAFT", "JO-PLANNED", "JO-RELEASED", "JO-IN-PROGRESS", "JO-COMPLETED"].forEach((jobNo) => {
      expect(within(row(jobNo)).queryByRole("button", { name: "Release" })).toBeNull();
      expect(within(row(jobNo)).queryByRole("button", { name: "Delete" })).toBeNull();
      expect(within(row(jobNo)).queryByRole("button", { name: "Cancel" })).toBeNull();
    });
  });

  it("does not refresh or report success when a release mutation rejects", async () => {
    const listing = setup();
    factoryService.releaseJobOrder.mockRejectedValueOnce(new Error("release failed"));
    const notify = vi.fn(); mount(vi.fn().mockResolvedValue(true));
    await screen.findByText("JO-DRAFT");
    fireEvent.click(within(row("JO-DRAFT")).getByRole("button", { name: "Release" }));
    await waitFor(() => expect(factoryService.releaseJobOrder).toHaveBeenCalledTimes(1));
    expect(listing).toHaveBeenCalledTimes(1);
  });

  it("keeps the Draft visible and does not refresh when delete rejects", async () => {
    const listing = setup();
    factoryService.deleteJobOrder.mockRejectedValueOnce(new Error("delete failed"));
    mount(); await screen.findByText("JO-DRAFT");
    fireEvent.click(within(row("JO-DRAFT")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(factoryService.deleteJobOrder).toHaveBeenCalledTimes(1));
    expect(listing).toHaveBeenCalledTimes(1);
    expect(screen.getByText("JO-DRAFT")).not.toBeNull();
  });

  it("keeps the Planned order visible and does not refresh when cancel rejects", async () => {
    const listing = setup();
    factoryService.cancelJobOrder.mockRejectedValueOnce(new Error("cancel failed"));
    mount(); await screen.findByText("JO-PLANNED");
    fireEvent.click(within(row("JO-PLANNED")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(factoryService.cancelJobOrder).toHaveBeenCalledTimes(1));
    expect(listing).toHaveBeenCalledTimes(1);
    expect(screen.getByText("JO-PLANNED")).not.toBeNull();
  });
});
