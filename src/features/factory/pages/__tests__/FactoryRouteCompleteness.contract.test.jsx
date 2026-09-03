import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { salesPurchaseRoutes } from "../../../../app/routes.jsx";
import { getSidebarSections, moduleRegistry } from "../../../../../config/modules.ts";
import { factoryService } from "../../../../services/factoryService.js";
import { emptyFactoryDashboardAnalytics } from "../../utils/factoryDashboardQuery.js";

const emptyFactoryData = {
  jobOrders: [], rawMaterials: [], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [],
  factorySuppliers: [], factoryCustomers: [], storageLocations: [], productions: [], finishedGoods: [], finishedGoodCategories: [], productFamilies: [],
  productMovements: [], finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [], recipes: [], sops: [], qcChecklistTemplates: [],
  equipment: [], equipmentCategories: [], mestiCleaningRequirements: [], mestiEquipmentCleaningRequirements: [], mestiCalibrationRequirements: [], auditLogs: [], accessIssues: [],
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
  vi.spyOn(factoryService, "listMestiEquipmentCleaningDay").mockResolvedValue([]);
  vi.spyOn(factoryService, "listMestiEquipmentCleaningMonth").mockResolvedValue([]);
  vi.spyOn(factoryService, "listMestiCalibrationSchedule").mockResolvedValue([]);
  vi.spyOn(factoryService, "listMestiCalibrationRecords").mockResolvedValue([]);
  vi.spyOn(factoryService, "listMestiFinishedProductStorageControl").mockResolvedValue({ rows: [], totalCount: 0, page: 1, pageSize: 20 });
  vi.spyOn(factoryService, "listMestiFinishedProductStorageControlFilterOptions").mockResolvedValue({ finished_goods: [], packaging_skus: [], storage_locations: [] });
  vi.spyOn(factoryService, "listMestiHealthDeclarations").mockResolvedValue([]);
  vi.spyOn(factoryService, "listMestiHealthDeclarationOptions").mockResolvedValue({ employees: [] });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Factory route completeness contract", () => {
  it("exposes one unified Health Declaration MeSTI route with Employee as its default workflow", () => {
    const items = getSidebarSections("factory").find((section) => section.label === "MeSTI")?.items || [];
    expect(items.filter((item) => item.label === "Health Declaration")).toEqual([{ id: "factory_mesti_health_declaration", label: "Health Declaration" }]);
    expect(salesPurchaseRoutes.find((route) => route.id === "factory_mesti_health_declaration")).toMatchObject({ permission: "factory_mesti_health_declaration.view", props: { initialTab: "mesti-health-declaration" } });
  });

  it("exposes Finished Product Storage Control once in the Factory MeSTI navigation with the canonical read route", () => {
    const items = getSidebarSections("factory").find((section) => section.label === "MeSTI")?.items || [];
    expect(items.filter((item) => item.label === "Finished Product Storage Control")).toEqual([
      { id: "factory_mesti_finished_product_storage_control", label: "Finished Product Storage Control" },
    ]);
    expect(salesPurchaseRoutes.find((route) => route.id === "factory_mesti_finished_product_storage_control")).toMatchObject({
      permission: "factory_mesti_cleaning.view",
      props: { initialTab: "mesti-finished-product-storage-control" },
    });
  });

  it("resolves every registered Factory route to its own labeled page instead of the generic Dashboard fallback", async () => {
    expect(factoryModules).toHaveLength(27);
    expect(factoryRoutes).toHaveLength(27);

    for (const module of factoryModules) {
      const route = factoryRoutes.find((candidate) => candidate.id === module.id);
      expect(route, `${module.id} must remain registered in salesPurchaseRoutes`).toBeTruthy();
      expect(module.route).toMatch(/^\/factory\//);
      expect(route.props.initialTab, `${module.id} must expose an initialTab`).toEqual(expect.any(String));

      setup();
      const RouteComponent = route.component;
      const view = render(<RouteComponent {...route.props} auth={auth} ui={ui} />);
      await screen.findByRole("heading", { level: 1, name: new RegExp(canonicalHeadingLabel(module), "i") }, { timeout: 5000 });
      if (module.id !== "factory_dashboard") expect(screen.queryByRole("heading", { level: 1, name: "Factory Dashboard" })).toBeNull();
      view.unmount();
      vi.restoreAllMocks();
    }
  }, 60000);
});
