import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import FactoryWorkspacePage from "../FactoryWorkspacePage.jsx";

const workspaceData = {
  jobOrders: [], rawMaterials: [], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [],
  factorySuppliers: [], factoryCustomers: [], storageLocations: [], productions: [], finishedGoods: [{ id: "sku-500", product_code: "SKU-500", product_family_name: "Sambal", pack_size_qty: 500, pack_size_uom: "g" }],
  finishedGoodCategories: [], productFamilies: [], productMovements: [], finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [],
  recipes: [], sops: [], qcChecklistTemplates: [], auditLogs: [], accessIssues: [],
};

afterEach(() => vi.restoreAllMocks());

describe("FactoryWorkspacePage Job Order route smoke", () => {
  it("renders packaging SKU pack sizes through the legacy job-order route", async () => {
    vi.spyOn(factoryService, "listFactoryData").mockResolvedValue(workspaceData);
    vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({
      rows: [{ id: "job-1", job_order_no: "JO260809-01", planned_date: "2026-08-09", finished_good_name: "Sambal", product_name_cn: "叁巴", product_code: "SKU-500", pack_size_qty: 500, pack_size_uom: "g", target_production_qty: 10, uom: "kg", target_pack_qty: 20, status: "planned", production_qc_status: "pending", created_by_name: "Isaac" }],
      summary: {}, totalCount: 1, page: 1, pageSize: 20,
    });

    render(<FactoryWorkspacePage initialTab="job-orders" auth={{ permissions: ["factory_job_orders.view"], hasPermission: (key) => key === "factory_job_orders.view" }} ui={{ notify: vi.fn() }} />);

    expect(await screen.findByText("500 g")).not.toBeNull();
    expect(screen.getByText("JO260809-01")).not.toBeNull();
  });
});
