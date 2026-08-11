import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import FactoryWorkspacePage from "../FactoryWorkspacePage.jsx";

const released = { id: "released", job_order_no: "JO-RELEASED", status: "released", product_name: "Sambal", product_code: "SKU-1", target_production_qty: 10, target_quantity: 10, uom: "kg", planned_date: "2026-08-09" };
const completed = { id: "completed", job_order_no: "JO-COMPLETED", status: "completed", product_name: "Sambal", product_code: "SKU-1", target_production_qty: 10, target_quantity: 10, uom: "kg", planned_date: "2026-08-09" };
const data = { jobOrders: [released], rawMaterials: [], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [], factorySuppliers: [], factoryCustomers: [], storageLocations: [], productions: [], finishedGoods: [], finishedGoodCategories: [], productFamilies: [], productMovements: [], finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [], recipes: [], sops: [], qcChecklistTemplates: [], auditLogs: [], accessIssues: [] };
const profile = { id: "employee-1", full_name: "Isaac Tan" };

function setup() {
  vi.spyOn(factoryService, "listFactoryData").mockResolvedValue(data);
  const listing = vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [released], summary: {}, totalCount: 1, page: 1, pageSize: 20 });
  vi.spyOn(factoryService, "startJobOrder").mockResolvedValue({});
  return listing;
}
function setupCompleted(production) {
  vi.spyOn(factoryService, "listFactoryData").mockResolvedValue({ ...data, jobOrders: [completed] });
  vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [completed], summary: {}, totalCount: 1, page: 1, pageSize: 20 });
  return vi.spyOn(factoryService, "getProductionByJobOrder").mockResolvedValue(production);
}
function mount(notify = vi.fn()) {
  return render(<FactoryWorkspacePage initialTab="job-orders" auth={{ permissions: ["factory_production.complete"], hasPermission: (key) => key === "factory_production.complete", profile }} ui={{ notify }} />);
}
async function openStart() {
  await screen.findByText("JO-RELEASED");
  fireEvent.click(within(screen.getByText("JO-RELEASED").closest("tr")).getByRole("button", { name: "Start Production" }));
  expect(screen.getByRole("heading", { name: "Start Production" })).not.toBeNull();
}
function submitStart() { return screen.getAllByRole("button", { name: "Start Production" }).find((button) => button.getAttribute("form") === "factory-start-production-form"); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Factory Job Orders Phase C Start Production", () => {
  it("starts a Released job through the workspace bridge and refreshes the listing once", async () => {
    const listing = setup(); mount(); await openStart();
    fireEvent.click(submitStart());
    await waitFor(() => expect(factoryService.startJobOrder).toHaveBeenCalledTimes(1));
    const [order, form, actualProfile] = factoryService.startJobOrder.mock.calls[0];
    expect(order).toEqual(released);
    expect(form).toEqual(expect.objectContaining({ production_date: expect.any(String), start_time: expect.any(String), remarks: "" }));
    expect(actualProfile).toEqual(profile);
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("heading", { name: "Start Production" })).toBeNull();
  });

  it("keeps the Start modal retryable without refresh or unhandled rejection when start rejects", async () => {
    const listing = setup();
    factoryService.startJobOrder.mockRejectedValueOnce(new Error("start failed"));
    const notify = vi.fn(); mount(notify); await openStart();
    fireEvent.click(submitStart());
    await waitFor(() => expect(factoryService.startJobOrder).toHaveBeenCalledTimes(1));
    expect(listing).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Start Production" })).not.toBeNull();
    expect(submitStart().disabled).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to start production", tone: "error" }));
  });

  it("opens the Workspace-owned completed result with one job-specific detail lookup", async () => {
    const detail = setupCompleted({ id: "production-1", batch_no: "PB-001", production_date: "2026-08-09", start_time: "08:00", end_date: "2026-08-09", end_time: "10:00", actual_pack_qty: 20, good_output_qty: 10, uom: "kg", operator_name: "Isaac Tan", notes: "QC passed" });
    mount(); await screen.findByText("JO-COMPLETED");
    fireEvent.click(within(screen.getByText("JO-COMPLETED").closest("tr")).getByRole("button", { name: "View" }));
    await waitFor(() => expect(detail).toHaveBeenCalledWith("completed"));
    expect(detail).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Completed Job Order Result" })).not.toBeNull();
    expect(screen.getByText("PB-001")).not.toBeNull(); expect(screen.getByText("QC passed")).not.toBeNull();
  });

  it("keeps completed result core data usable when optional result fields are absent", async () => {
    setupCompleted({ id: "production-optional", batch_no: "PB-OPTIONAL", actual_pack_qty: 4, good_output_qty: 2, uom: "kg" });
    mount(); await screen.findByText("JO-COMPLETED");
    fireEvent.click(within(screen.getByText("JO-COMPLETED").closest("tr")).getByRole("button", { name: "View" }));
    expect(await screen.findByRole("heading", { name: "Completed Job Order Result" })).not.toBeNull();
    expect(screen.getByText("PB-OPTIONAL")).not.toBeNull();
  });

  it("keeps the completed result closed and notifies without refresh when its detail lookup rejects", async () => {
    vi.spyOn(factoryService, "listFactoryData").mockResolvedValue({ ...data, jobOrders: [completed] });
    const listing = vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [completed], summary: {}, totalCount: 1, page: 1, pageSize: 20 });
    const detail = vi.spyOn(factoryService, "getProductionByJobOrder").mockRejectedValue(new Error("result failed"));
    const notify = vi.fn(); mount(notify); await screen.findByText("JO-COMPLETED");
    fireEvent.click(within(screen.getByText("JO-COMPLETED").closest("tr")).getByRole("button", { name: "View" }));
    await waitFor(() => expect(detail).toHaveBeenCalledWith("completed"));
    expect(detail).toHaveBeenCalledTimes(1); expect(listing).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Completed Job Order Result" })).toBeNull();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Unable to load production result", tone: "error" }));
  });
});
