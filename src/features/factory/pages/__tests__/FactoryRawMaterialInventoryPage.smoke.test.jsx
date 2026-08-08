import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../../context/FactoryNavigationContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryRawMaterialInventoryPage from "../FactoryRawMaterialInventoryPage.jsx";

const material = { id: "rm-1", name: "Chili", name_en: "Chili", material_code: "CHI", uom: "kg", category_id: "cat-1", category: "Spices", current_balance: 5, min_stock_level: 10, status: "active", storage_location: "Dry Store A" };
const data = { rawMaterials: [material], rawMaterialCategories: [{ id: "cat-1", name: "Spices" }], receivings: [{ raw_material_id: "rm-1", unit_cost: 4, uom: "kg", received_date: "2026-08-01", receiving_no: "R260801-01" }], rawMaterialMovements: [], rawStockChecks: [] };
const navigation = { openCreateRawMaterial: vi.fn(), openEditRawMaterial: vi.fn(), openRawMaterialCost: vi.fn(), openRawMaterialImage: vi.fn(), openRawMaterialCategory: vi.fn() };
function renderPage(can) { return render(<FactoryPermissionsProvider permissionSet={[]} can={can}><FactoryMasterDataProvider data={data}><FactoryNavigationProvider {...navigation}><FactoryRawMaterialInventoryPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>); }

describe("FactoryRawMaterialInventoryPage smoke", () => {
  it("renders inventory, filters it, uses the image fallback, and opens detail without edit access", () => {
    renderPage((key) => key === "factory_raw_inventory.view");
    expect(screen.getByText("Chili")).not.toBeNull(); expect(screen.getAllByText("Low Stock").length).toBeGreaterThan(0); expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search material/code"), { target: { value: "missing" } }); expect(screen.getByText("No raw materials")).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search material/code"), { target: { value: "Chili" } }); fireEvent.click(screen.getByRole("button", { name: "Detail" }));
    expect(screen.getByText("Material Record")).not.toBeNull(); expect(screen.getByText("Dry Store A")).not.toBeNull();
  });
});
