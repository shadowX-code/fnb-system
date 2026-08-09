import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import FactoryWorkspacePage from "../FactoryWorkspacePage.jsx";

const workspaceData = {
  jobOrders: [], rawMaterials: [], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [],
  factorySuppliers: [], factoryCustomers: [], storageLocations: [], productions: [], finishedGoods: [
    { id: "sku-500", product_family_id: "family-1", product_code: "SKU-500", product_family_name: "Sambal", product_name: "Sambal", pack_size_qty: 500, pack_size_uom: "g", current_balance: 4, status: "active" },
    { id: "sku-1kg", product_family_id: "family-2", product_code: "SKU-1KG", product_family_name: "Curry", product_name: "Curry", pack_size_qty: 1, pack_size_uom: "kg", current_balance: 0, status: "active" },
  ],
  finishedGoodCategories: [], productFamilies: [], productMovements: [], finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [],
  recipes: [{ id: "recipe-1", product_family_id: "family-1", product_name: "Sambal", version: "v2", status: "active", yield_quantity: 10, uom: "kg", items: [] }], sops: [], qcChecklistTemplates: [], auditLogs: [], accessIssues: [],
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("FactoryWorkspacePage Job Order route smoke", () => {
  it("creates a Job Order through product and Packaging SKU selection without losing defaults", async () => {
    vi.spyOn(factoryService, "listFactoryData").mockResolvedValue(workspaceData);
    vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({
      rows: [{ id: "job-1", job_order_no: "JO260809-01", planned_date: "2026-08-09", finished_good_name: "Sambal", product_name_cn: "叁巴", product_code: "SKU-500", pack_size_qty: 500, pack_size_uom: "g", target_production_qty: 10, uom: "kg", target_pack_qty: 20, status: "planned", production_qc_status: "pending", created_by_name: "Isaac" }],
      summary: {}, totalCount: 1, page: 1, pageSize: 20,
    });

    vi.spyOn(factoryService, "getJobOrderNoPreview").mockResolvedValue("JO260809-02");
    render(<FactoryWorkspacePage initialTab="job-orders" auth={{ permissions: ["factory_job_orders.view", "factory_job_orders.create"], hasPermission: (key) => ["factory_job_orders.view", "factory_job_orders.create"].includes(key) }} ui={{ notify: vi.fn() }} />);

    expect(await screen.findByText("500 g")).not.toBeNull();
    expect(screen.getByText("JO260809-01")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Create Job Order/i }));
    fireEvent.click(screen.getByRole("button", { name: "Finished Good *" }));
    fireEvent.click(screen.getByText("Sambal"));
    fireEvent.click(screen.getByRole("button", { name: "Packaging SKU *" }));
    fireEvent.click(screen.getByRole("button", { name: /SKU-500/ }));

    expect(screen.getAllByText("500 g").length).toBeGreaterThan(0);
    expect(screen.getByText("v2")).not.toBeNull();
    expect(screen.getAllByText("kg").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Finished Good *" }));
    fireEvent.click(screen.getByText("Curry"));
    fireEvent.click(screen.getByRole("button", { name: "Packaging SKU *" }));
    fireEvent.click(screen.getByRole("button", { name: /SKU-1KG/ }));
    expect(screen.getAllByText("1 kg").length).toBeGreaterThan(0);
    expect(screen.getByText("No active recipe")).not.toBeNull();
  }, 15000);

  it("keeps the create modal stable when no Packaging SKU is available", async () => {
    vi.spyOn(factoryService, "listFactoryData").mockResolvedValue({ ...workspaceData, finishedGoods: [] });
    vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [], summary: {}, totalCount: 0, page: 1, pageSize: 20 });
    vi.spyOn(factoryService, "getJobOrderNoPreview").mockResolvedValue("JO260809-02");

    render(<FactoryWorkspacePage initialTab="job-orders" auth={{ permissions: ["factory_job_orders.view", "factory_job_orders.create"], hasPermission: (key) => ["factory_job_orders.view", "factory_job_orders.create"].includes(key) }} ui={{ notify: vi.fn() }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Create Job Order/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Finished Good *" }).textContent).toContain("Create a Finished Good first"));
    expect(screen.getByRole("button", { name: "Packaging SKU *" }).disabled).toBe(true);
  });
});
