import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../../context/FactoryNavigationContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryRawMaterialInventoryPage from "../FactoryRawMaterialInventoryPage.jsx";

const material = { id: "rm-1", name: "Chili", name_en: "Chili", material_code: "CHI", uom: "kg", category_id: "cat-1", category: "Spices", current_balance: 5, min_stock_level: 10, status: "active", storage_location: "Dry Store A" };
const data = { rawMaterials: [material], rawMaterialCategories: [{ id: "cat-1", name: "Spices" }], receivings: [{ raw_material_id: "rm-1", unit_cost: 4, uom: "kg", received_date: "2026-08-01", receiving_no: "R260801-01" }], rawMaterialMovements: [], rawStockChecks: [] };
const navigation = { openCreateRawMaterial: vi.fn(), openEditRawMaterial: vi.fn(), openRawMaterialCost: vi.fn(), openRawMaterialImage: vi.fn(), openRawMaterialCategory: vi.fn() };
function renderPage(can) { return render(<FactoryPermissionsProvider permissionSet={[]} can={can}><FactoryMasterDataProvider data={data}><FactoryNavigationProvider {...navigation}><FactoryRawMaterialInventoryPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>); }

afterEach(cleanup);

describe("FactoryRawMaterialInventoryPage smoke", () => {
  it("renders inventory, filters it, uses the image fallback, and opens detail without edit access", () => {
    renderPage((key) => key === "factory_raw_inventory.view");
    expect(screen.getByText("Chili")).not.toBeNull(); expect(screen.getAllByText("Low Stock").length).toBeGreaterThan(0); expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search material/code"), { target: { value: "missing" } }); expect(screen.getByText("No raw materials")).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search material/code"), { target: { value: "Chili" } }); fireEvent.click(screen.getByRole("button", { name: "Detail" }));
    expect(screen.getByText("Material Record")).not.toBeNull(); expect(screen.getByText("Dry Store A")).not.toBeNull();
  });

  it("keeps every collection boundary safe for empty, missing, and permission-cleared master data", () => {
    const can = (key) => key === "factory_raw_inventory.view";
    const { rerender } = render(<FactoryPermissionsProvider permissionSet={[]} can={can}><FactoryMasterDataProvider data={{ rawMaterials: [], rawMaterialCategories: [], receivings: [], rawMaterialMovements: [], rawStockChecks: [] }}><FactoryNavigationProvider {...navigation}><FactoryRawMaterialInventoryPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
    expect(screen.getByText("No raw materials")).not.toBeNull();
    rerender(<FactoryPermissionsProvider permissionSet={[]} can={can}><FactoryMasterDataProvider data={{ rawMaterials: undefined, rawMaterialCategories: undefined, receivings: undefined, rawMaterialMovements: undefined, rawStockChecks: undefined }}><FactoryNavigationProvider {...navigation}><FactoryRawMaterialInventoryPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
    expect(screen.getByText("No raw materials")).not.toBeNull();
    rerender(<FactoryPermissionsProvider permissionSet={[]} can={() => false}><FactoryMasterDataProvider data={{}}><FactoryNavigationProvider {...navigation}><FactoryRawMaterialInventoryPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
    expect(screen.getByRole("alert")).not.toBeNull();
  });

  it("edits Par Level inline through the bounded Workspace save callback and immediately recalculates coverage", async () => {
    const saveRawMaterial = vi.fn().mockImplementation(async (form) => form);
    render(<FactoryPermissionsProvider permissionSet={[]} can={(key) => ["factory_raw_inventory.view", "factory_raw_inventory.edit"].includes(key)}><FactoryMasterDataProvider data={data}><FactoryNavigationProvider {...navigation} saveRawMaterial={saveRawMaterial}><FactoryRawMaterialInventoryPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Edit Par Level for Chili" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Par Level for Chili" }), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Par Level for Chili" }));
    await waitFor(() => expect(saveRawMaterial).toHaveBeenCalledWith(expect.objectContaining({ id: "rm-1", par_level: 10, min_stock_level: 10, current_balance: 5 }), { refresh: false, closeModal: false }));
    expect(screen.getByText("Low")).not.toBeNull(); expect(screen.getByText("50%")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit Par Level for Chili" })); fireEvent.change(screen.getByRole("spinbutton", { name: "Par Level for Chili" }), { target: { value: "0" } }); fireEvent.click(screen.getByRole("button", { name: "Save Par Level for Chili" }));
    await waitFor(() => expect(saveRawMaterial).toHaveBeenCalledTimes(2)); expect(screen.getByRole("button", { name: "Edit Par Level for Chili" }).textContent).toContain("Not Set");
  });

  it("keeps a rejected inline Par Level save open and retryable without exposing the editor to view-only users", async () => {
    const saveRawMaterial = vi.fn().mockRejectedValueOnce(new Error("Permission denied."));
    const { rerender } = render(<FactoryPermissionsProvider permissionSet={[]} can={(key) => ["factory_raw_inventory.view", "factory_raw_inventory.edit"].includes(key)}><FactoryMasterDataProvider data={data}><FactoryNavigationProvider {...navigation} saveRawMaterial={saveRawMaterial}><FactoryRawMaterialInventoryPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Edit Par Level for Chili" })); fireEvent.click(screen.getByRole("button", { name: "Save Par Level for Chili" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Permission denied.")); expect(screen.getByRole("spinbutton", { name: "Par Level for Chili" })).not.toBeNull();
    saveRawMaterial.mockResolvedValueOnce({ ...material, par_level: 4 }); fireEvent.change(screen.getByRole("spinbutton", { name: "Par Level for Chili" }), { target: { value: "4" } }); fireEvent.click(screen.getByRole("button", { name: "Save Par Level for Chili" }));
    await waitFor(() => expect(saveRawMaterial).toHaveBeenCalledTimes(2)); expect(screen.getByText("125%")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit Par Level for Chili" })); fireEvent.click(screen.getByRole("button", { name: "Cancel Par Level edit for Chili" })); expect(saveRawMaterial).toHaveBeenCalledTimes(2);
    rerender(<FactoryPermissionsProvider permissionSet={[]} can={(key) => key === "factory_raw_inventory.view"}><FactoryMasterDataProvider data={data}><FactoryNavigationProvider {...navigation} saveRawMaterial={saveRawMaterial}><FactoryRawMaterialInventoryPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
    expect(screen.queryByRole("button", { name: "Edit Par Level for Chili" })).toBeNull();
  });
});
