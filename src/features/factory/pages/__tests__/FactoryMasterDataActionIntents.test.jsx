import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../../context/FactoryNavigationContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryCustomersPage from "../FactoryCustomersPage.jsx";
import FactoryFinishedGoodsPage from "../FactoryFinishedGoodsPage.jsx";
import FactoryRawMaterialInventoryPage from "../FactoryRawMaterialInventoryPage.jsx";
import FactoryStorageLocationsPage from "../FactoryStorageLocationsPage.jsx";
import FactorySuppliersPage from "../FactorySuppliersPage.jsx";

const supplier = { id: "supplier-1", supplier_name: "Fresh Farm", supplier_code: "FF", contact_person: "Aisha Rahman", phone: "+60 12-345 6789", status: "active" };
const customer = { id: "customer-1", customer_name: "Outlet One", customer_code: "O1", customer_type: "outlet", contact_person: "Mei Tan", phone: "+60 13-456 7890", status: "active" };
const location = { id: "location-1", location_name: "Dry Store", location_code: "DS", location_type: "Dry", status: "active" };
const material = { id: "material-1", name: "Chili", name_en: "Chili", material_code: "CHI", category: "Spices", uom: "kg", current_balance: 5, min_stock_level: 1, status: "active", image_url: "https://example.test/chili.png" };
const sku = { id: "sku-1", product_family_id: "family-1", product_family_name: "Sambal", product_name: "Sambal", product_name_en: "Sambal", product_code: "SAM-500", current_balance: 1, status: "active" };

function renderPage(Page, { permissions, data, navigation }) {
  const can = (permission) => permissions.includes(permission);
  return render(<FactoryPermissionsProvider permissionSet={permissions} can={can}><FactoryMasterDataProvider data={data}><FactoryNavigationProvider {...navigation}><Page /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
}

function expectStatusBadge(label) {
  expect(screen.getAllByText(label).some((element) => element.classList.contains("badge"))).toBe(true);
}

afterEach(cleanup);

describe("Factory master-data action intents", () => {
  it("renders compact master table hierarchy with contact details, canonical statuses, and clean fallbacks", () => {
    const supplierView = renderPage(FactorySuppliersPage, { permissions: ["factory_suppliers.view"], data: { factorySuppliers: [supplier, { ...supplier, id: "supplier-2", supplier_name: "No Contact", supplier_code: null, contact_person: null, phone: null, status: "archived" }] }, navigation: {} });
    expect(screen.getByRole("columnheader", { name: "Contact Person" })).not.toBeNull(); expect(screen.getByRole("columnheader", { name: "Phone" })).not.toBeNull(); expect(screen.getByText("Fresh Farm")).not.toBeNull(); expect(screen.getByText("FF")).not.toBeNull(); expect(screen.getByText("Aisha Rahman")).not.toBeNull(); expect(screen.getByText("+60 12-345 6789")).not.toBeNull(); expectStatusBadge("Active"); expectStatusBadge("Archived"); expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2); supplierView.unmount();

    const customerView = renderPage(FactoryCustomersPage, { permissions: ["factory_customers.view"], data: { factoryCustomers: [customer] }, navigation: {} });
    expect(screen.getByRole("columnheader", { name: "Type" })).not.toBeNull(); expect(screen.getByRole("columnheader", { name: "Contact Person" })).not.toBeNull(); expect(screen.getByText("Outlet")).not.toBeNull(); expect(screen.getByText("Mei Tan")).not.toBeNull(); expect(screen.getByText("+60 13-456 7890")).not.toBeNull(); expectStatusBadge("Active"); customerView.unmount();

    renderPage(FactoryStorageLocationsPage, { permissions: ["factory_storage_locations.view"], data: { storageLocations: [location] }, navigation: {} });
    expect(screen.getByText("Dry Store")).not.toBeNull(); expect(screen.getByText("DS")).not.toBeNull(); expect(screen.getByText("Dry")).not.toBeNull(); expectStatusBadge("Active");
  });

  it("keeps Supplier, Customer, and Storage create/edit/archive identities at bounded navigation actions", () => {
    const supplierNav = { openCreateSupplier: vi.fn(), openEditSupplier: vi.fn(), archiveSupplier: vi.fn() };
    const supplierView = renderPage(FactorySuppliersPage, { permissions: ["factory_suppliers.view", "factory_suppliers.create", "factory_suppliers.edit", "factory_suppliers.delete"], data: { factorySuppliers: [supplier] }, navigation: supplierNav });
    fireEvent.click(screen.getByRole("button", { name: /create supplier/i })); fireEvent.click(screen.getByRole("button", { name: "More row actions" })); fireEvent.click(screen.getByRole("button", { name: "Edit" })); fireEvent.click(screen.getByRole("button", { name: "More row actions" })); fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(supplierNav.openCreateSupplier).toHaveBeenCalledTimes(1); expect(supplierNav.openEditSupplier).toHaveBeenCalledWith(supplier); expect(supplierNav.archiveSupplier).toHaveBeenCalledWith(supplier); supplierView.unmount();

    const customerNav = { openCreateCustomer: vi.fn(), openEditCustomer: vi.fn(), archiveCustomer: vi.fn() };
    const customerView = renderPage(FactoryCustomersPage, { permissions: ["factory_customers.view", "factory_customers.create", "factory_customers.edit", "factory_customers.delete"], data: { factoryCustomers: [customer] }, navigation: customerNav });
    fireEvent.click(screen.getByRole("button", { name: /create customer/i })); fireEvent.click(screen.getByRole("button", { name: "More row actions" })); fireEvent.click(screen.getByRole("button", { name: "Edit" })); fireEvent.click(screen.getByRole("button", { name: "More row actions" })); fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(customerNav.openCreateCustomer).toHaveBeenCalledTimes(1); expect(customerNav.openEditCustomer).toHaveBeenCalledWith(customer); expect(customerNav.archiveCustomer).toHaveBeenCalledWith(customer); customerView.unmount();

    const storageNav = { openCreateStorageLocation: vi.fn(), openEditStorageLocation: vi.fn(), archiveStorageLocation: vi.fn() };
    renderPage(FactoryStorageLocationsPage, { permissions: ["factory_storage_locations.view", "factory_storage_locations.create", "factory_storage_locations.edit", "factory_storage_locations.delete"], data: { storageLocations: [location] }, navigation: storageNav });
    fireEvent.click(screen.getByRole("button", { name: /^location$/i })); fireEvent.click(screen.getByRole("button", { name: "More row actions" })); fireEvent.click(screen.getByRole("button", { name: "Edit" })); fireEvent.click(screen.getByRole("button", { name: "More row actions" })); fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(storageNav.openCreateStorageLocation).toHaveBeenCalledTimes(1); expect(storageNav.openEditStorageLocation).toHaveBeenCalledWith(location); expect(storageNav.archiveStorageLocation).toHaveBeenCalledWith(location);
  });

  it("keeps Finished Good and Raw Material action visibility tied to exact permissions and forwards exact records", () => {
    const rawNav = { openCreateRawMaterial: vi.fn(), openEditRawMaterial: vi.fn(), openRawMaterialCost: vi.fn(), openRawMaterialImage: vi.fn(), openRawMaterialCategory: vi.fn() };
    const rawView = renderPage(FactoryRawMaterialInventoryPage, { permissions: ["factory_raw_inventory.view", "factory_raw_inventory.create", "factory_raw_inventory.edit"], data: { rawMaterials: [material], rawMaterialCategories: [], receivings: [], rawMaterialMovements: [], rawStockChecks: [] }, navigation: rawNav });
    fireEvent.click(screen.getByRole("button", { name: /^Raw Material$/ })); fireEvent.click(screen.getAllByRole("button", { name: "Category" })[0]); fireEvent.click(screen.getByRole("button", { name: "More row actions" })); fireEvent.click(screen.getByRole("button", { name: "Edit" })); fireEvent.click(screen.getAllByText("Missing Cost").find((element) => element.closest("button"))); fireEvent.click(screen.getByRole("img", { name: "Chili" }));
    expect(rawNav.openCreateRawMaterial).toHaveBeenCalledTimes(1); expect(rawNav.openRawMaterialCategory).toHaveBeenCalledTimes(1); expect(rawNav.openEditRawMaterial).toHaveBeenCalledWith(expect.objectContaining({ id: material.id })); expect(rawNav.openRawMaterialCost).toHaveBeenCalledWith(expect.objectContaining({ id: material.id })); expect(rawNav.openRawMaterialImage).toHaveBeenCalledWith(expect.objectContaining({ id: material.id })); rawView.unmount();

    const finishedNav = { openCreateFinishedGood: vi.fn(), openFinishedGoodCategory: vi.fn() };
    renderPage(FactoryFinishedGoodsPage, { permissions: ["factory_finished_goods.view", "factory_finished_goods.create"], data: { finishedGoods: [sku], productFamilies: [{ id: "family-1", name_en: "Sambal", status: "active" }], finishedGoodCategories: [], recipes: [], receivings: [], productions: [], productMovements: [], productionCosts: [] }, navigation: finishedNav });
    fireEvent.click(screen.getByRole("button", { name: /create finished good/i })); fireEvent.click(screen.getAllByRole("button", { name: "Category" })[0]);
    expect(finishedNav.openCreateFinishedGood).toHaveBeenCalledTimes(1); expect(finishedNav.openFinishedGoodCategory).toHaveBeenCalledTimes(1);
  });

  it("does not render master-data mutation controls with View permission alone", () => {
    const nav = { openCreateRawMaterial: vi.fn(), openRawMaterialCategory: vi.fn() };
    renderPage(FactoryRawMaterialInventoryPage, { permissions: ["factory_raw_inventory.view"], data: { rawMaterials: [material], rawMaterialCategories: [], receivings: [], rawMaterialMovements: [], rawStockChecks: [] }, navigation: nav });
    expect(screen.queryByRole("button", { name: /^Raw Material$/ })).toBeNull(); expect(screen.getAllByRole("button", { name: "Category" }).length).toBe(1); expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
