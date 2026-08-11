import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import FactoryWorkspacePage from "../FactoryWorkspacePage.jsx";

const rows = ["draft", "planned", "released", "in_progress", "completed"].map((status) => ({ id: `job-${status}`, job_order_no: `JO-${status}`, status, planned_date: "2026-08-09", product_name: "Sambal", product_code: "SKU-1", target_quantity: 10, target_production_qty: 10, uom: "kg", priority: "Normal" }));
const data = { jobOrders: rows, rawMaterials: [], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [], factorySuppliers: [], factoryCustomers: [], storageLocations: [], productions: [], finishedGoods: [], finishedGoodCategories: [], productFamilies: [], productMovements: [], finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [], recipes: [], sops: [], qcChecklistTemplates: [], auditLogs: [], accessIssues: [] };
const permissions = ["factory_job_orders.create", "factory_job_orders.edit", "factory_job_orders.delete", "factory_job_orders.cancel", "factory_production.view", "factory_production.complete"];

function setup() {
  vi.spyOn(factoryService, "listFactoryData").mockResolvedValue(data);
  return vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows, summary: {}, totalCount: rows.length, page: 1, pageSize: 20 });
}
function auth(keys = permissions) { return { permissions: keys, hasPermission: (key) => keys.includes(key), profile: { id: "employee-1" } }; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Factory Job Orders Phase A", () => {
  it("uses one job-orders listing request and maps the current search filter without rerender churn", async () => {
    const listing = setup();
    const view = render(<FactoryWorkspacePage initialTab="job-orders" auth={auth()} ui={{ notify: vi.fn() }} />);
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(1));
    expect(listing).toHaveBeenCalledWith(expect.objectContaining({
      listing: "job-orders",
      page: 1,
      pageSize: 20,
      filters: {
        search: "",
        status: "",
        scheduledDateFrom: "",
        scheduledDateTo: "",
        manufacturingDateFrom: "",
        manufacturingDateTo: "",
        finishedGood: "",
      },
    }));
    view.rerender(<FactoryWorkspacePage initialTab="job-orders" auth={auth()} ui={{ notify: vi.fn() }} />);
    expect(listing).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByPlaceholderText("JO no., product, SKU or batch"), { target: { value: "JO-planned" } });
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    expect(listing).toHaveBeenLastCalledWith(expect.objectContaining({ listing: "job-orders", page: 1, pageSize: 20, filters: expect.objectContaining({ search: "JO-planned" }) }));
  });

  it("renders the exact current permission and status action matrix", async () => {
    setup();
    render(<FactoryWorkspacePage initialTab="job-orders" auth={auth()} ui={{ notify: vi.fn() }} />);
    await screen.findByText("JO-draft");
    expect(screen.getAllByRole("button", { name: "Release" }).length).toBe(2);
    expect(screen.getAllByRole("button", { name: "Edit" }).length).toBe(2);
    expect(screen.getByRole("button", { name: "Delete" })).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Cancel" }).length).toBe(2);
    expect(screen.getByRole("button", { name: "Start Production" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "View Process" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Complete" })).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "View" }).length).toBeGreaterThan(0);
  });

  it("hides protected Job Order and Production actions without their exact permission keys while retaining completed View", async () => {
    setup();
    render(<FactoryWorkspacePage initialTab="job-orders" auth={auth([])} ui={{ notify: vi.fn() }} />);
    await screen.findByText("JO-completed");
    ["Create Job Order", "Release", "Edit", "Delete", "Cancel", "Start Production", "View Process", "Complete"].forEach((name) => expect(screen.queryByRole("button", { name })).toBeNull());
    expect(screen.getAllByRole("button", { name: "View" }).length).toBeGreaterThan(0);
  });
});
