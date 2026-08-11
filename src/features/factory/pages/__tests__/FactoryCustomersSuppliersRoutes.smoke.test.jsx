import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import FactoryWorkspacePage from "../FactoryWorkspacePage.jsx";

const factoryData = {
  jobOrders: [], rawMaterials: [], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [],
  factorySuppliers: [{ id: "supplier-1", supplier_name: "Fresh Farm", supplier_code: "FF", status: "active" }],
  factoryCustomers: [{ id: "customer-1", customer_name: "Outlet One", customer_code: "O1", customer_type: "Outlet", status: "active" }],
  storageLocations: [], productions: [], finishedGoods: [], finishedGoodCategories: [], productFamilies: [], productMovements: [],
  finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [], recipes: [], sops: [], qcChecklistTemplates: [], auditLogs: [], accessIssues: [],
};

function mount(tab, permission) {
  vi.spyOn(factoryService, "listFactoryData").mockResolvedValue(factoryData);
  return render(<FactoryWorkspacePage initialTab={tab} auth={{ permissions: [permission], hasPermission: (key) => key === permission }} ui={{ notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) }} />);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Factory Customers and Suppliers route smoke", () => {
  it.each([
    ["suppliers", "factory_suppliers.view", "Suppliers", "Fresh Farm"],
    ["customers", "factory_customers.view", "Customers", "Outlet One"],
  ])("renders the permission-allowed %s route without falling back to Dashboard across an ordinary rerender", async (tab, permission, title, rowLabel) => {
    const view = mount(tab, permission);
    await screen.findByRole("heading", { name: title });
    expect(screen.getByText(rowLabel)).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Factory Dashboard" })).toBeNull();
    view.rerender(<FactoryWorkspacePage initialTab={tab} auth={{ permissions: [permission], hasPermission: (key) => key === permission }} ui={{ notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) }} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: title })).not.toBeNull());
    expect(screen.queryByRole("heading", { name: "Factory Dashboard" })).toBeNull();
  });
});
