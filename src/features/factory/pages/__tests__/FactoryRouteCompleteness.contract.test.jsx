import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { salesPurchaseRoutes } from "../../../../app/routes.jsx";
import { moduleRegistry } from "../../../../../config/modules.ts";
import { factoryService } from "../../../../services/factoryService.js";
import { emptyFactoryDashboardAnalytics } from "../../utils/factoryDashboardQuery.js";

const emptyFactoryData = {
  jobOrders: [], rawMaterials: [], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [],
  factorySuppliers: [], factoryCustomers: [], storageLocations: [], productions: [], finishedGoods: [], finishedGoodCategories: [], productFamilies: [],
  productMovements: [], finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [], recipes: [], sops: [], qcChecklistTemplates: [], auditLogs: [], accessIssues: [],
};
const factoryModules = moduleRegistry.filter((module) => module.workspace === "factory");
const factoryRoutes = salesPurchaseRoutes.filter((route) => route.id.startsWith("factory_"));
const auth = { permissions: [], hasPermission: () => true, profile: { id: "employee-1", nickname: "Isaac" } };
const ui = { notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) };
const canonicalHeadingLabel = (module) => module.label === "Production Reports" ? "Factory Reports" : module.label;

function setup() {
  vi.spyOn(factoryService, "listFactoryData").mockResolvedValue(emptyFactoryData);
  vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [], summary: {}, totalCount: 0, page: 1, pageSize: 20 });
  vi.spyOn(factoryService, "listProductMovementsPage").mockResolvedValue({ rows: [], summary: {}, totalCount: 0, page: 1, pageSize: 20 });
  vi.spyOn(factoryService, "listOperationalJobOrders").mockResolvedValue({ jobs: [], productions: [], summary: {} });
  vi.spyOn(factoryService, "getFactoryDashboardAnalytics").mockResolvedValue(emptyFactoryDashboardAnalytics());
  vi.spyOn(factoryService, "getProductionPlanningOpenJobOrderAggregate").mockResolvedValue({});
  vi.spyOn(factoryService, "listMestiCleaningDay").mockResolvedValue([]);
  vi.spyOn(factoryService, "listMestiCleaningMonth").mockResolvedValue([]);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Factory route completeness contract", () => {
  it("resolves every registered Factory route to its own labeled page instead of the generic Dashboard fallback", async () => {
    expect(factoryModules).toHaveLength(22);
    expect(factoryRoutes).toHaveLength(22);

    for (const module of factoryModules) {
      const route = factoryRoutes.find((candidate) => candidate.id === module.id);
      expect(route, `${module.id} must remain registered in salesPurchaseRoutes`).toBeTruthy();
      expect(module.route).toMatch(/^\/factory\//);
      expect(route.props.initialTab, `${module.id} must expose an initialTab`).toEqual(expect.any(String));

      setup();
      const RouteComponent = route.component;
      const view = render(<RouteComponent {...route.props} auth={auth} ui={ui} />);
      await screen.findByRole("heading", { level: 1, name: new RegExp(canonicalHeadingLabel(module), "i") });
      if (module.id !== "factory_dashboard") expect(screen.queryByRole("heading", { level: 1, name: "Factory Dashboard" })).toBeNull();
      view.unmount();
      vi.restoreAllMocks();
    }
  });
});
