import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../../context/FactoryNavigationContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryProductionPlanningPage from "../FactoryProductionPlanningPage.jsx";

const actions = { openPlanningJobOrderDraft: vi.fn(), openProductionPlanningPar: vi.fn() };

vi.mock("../../hooks/useProductionPlanningQuery.js", () => ({
  default: () => ({
    openJobs: {
      hasLoaded: true,
      loading: false,
      error: "",
      errorKind: "",
      aggregates: [{ packagingSkuId: "sku-1", openJobOrderQty: 2, openJobOrderCount: 1, countedJobOrderCount: 1, invalidJobOrderCount: 0 }],
      diagnostics: { missingPackagingSkuCount: 0, invalidQuantityCount: 0 },
    },
    retry: vi.fn(),
  }),
}));

describe("FactoryProductionPlanningPage data-bearing smoke", () => {
  it("renders an active Packaging SKU with open-job, Par, coverage, and bounded action paths", () => {
    render(
      <FactoryPermissionsProvider permissionSet={["factory_production_planning.view", "factory_job_orders.create", "factory_finished_goods.edit"]} can={(key) => ["factory_production_planning.view", "factory_job_orders.create", "factory_finished_goods.edit"].includes(key)}>
        <FactoryMasterDataProvider data={{
          finishedGoods: [{ id: "sku-1", product_family_id: "family-1", product_family_name: "Sambal", product_name: "Sambal", product_name_cn: "叁巴酱", product_code: "SAM-500", pack_size_qty: 500, pack_size_uom: "g", current_balance: 1, min_stock_level: 10, status: "active" }],
          finishedGoodCategories: [],
          recipes: [{ id: "recipe-1", product_family_id: "family-1", status: "active", version: "v1", yield_quantity: 10, uom: "kg", items: [] }],
        }}>
          <FactoryNavigationProvider {...actions}><FactoryProductionPlanningPage onNotify={vi.fn()} /></FactoryNavigationProvider>
        </FactoryMasterDataProvider>
      </FactoryPermissionsProvider>,
    );

    expect(screen.getAllByText("Sambal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SAM-500").length).toBeGreaterThan(0);
    expect(screen.getByText("1 open order")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Create Job Order" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Par" })[0]);
    expect(actions.openPlanningJobOrderDraft).toHaveBeenCalledWith(expect.objectContaining({ finished_good_id: "sku-1" }));
    expect(actions.openProductionPlanningPar).toHaveBeenCalledWith(expect.objectContaining({ id: "sku-1" }));
  });
});
