import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FactoryStorageLocationsPage from "../FactoryStorageLocationsPage.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../../context/FactoryNavigationContext.jsx";
import { factoryService } from "../../../../services/factoryService.js";

const location = { id: "loc-1", location_name: "Dry Store", location_code: "DS", location_type: "Dry Store", status: "active" };
function renderPage(permissionSet, storageLocations = [location]) {
  const can = (key) => permissionSet.includes(key);
  return render(<FactoryPermissionsProvider permissionSet={permissionSet} can={can}><FactoryMasterDataProvider data={{ storageLocations }}><FactoryNavigationProvider openCreateStorageLocation={vi.fn()} openEditStorageLocation={vi.fn()} archiveStorageLocation={vi.fn()}><FactoryStorageLocationsPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Storage Location permission rendering", () => {
  it("keeps Create, Edit, Delete, and Manage independent", () => {
    renderPage(["factory_storage_locations.view", "factory_storage_locations.create"]);
    expect(screen.getByRole("button", { name: /^location$/i })).not.toBeNull(); expect(screen.queryByRole("button", { name: "Edit" })).toBeNull(); expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });
  it("shows only the operation granted by Edit or Delete", () => {
    const edit = renderPage(["factory_storage_locations.view", "factory_storage_locations.edit"]); expect(screen.getByRole("button", { name: "Edit Location" })).not.toBeNull(); expect(screen.queryByRole("button", { name: "More row actions" })).toBeNull(); edit.unmount();
    renderPage(["factory_storage_locations.view", "factory_storage_locations.delete"]); fireEvent.click(screen.getByRole("button", { name: "More row actions" })); expect(screen.queryByRole("button", { name: "Edit" })).toBeNull(); expect(screen.getByRole("button", { name: "Archive" })).not.toBeNull();
  });

  it("loads one current-balance projection per permitted inventory family and opens a reconciled drill-down", async () => {
    const getLocationInventory = vi.spyOn(factoryService, "getLocationInventory").mockResolvedValue({
      rawMaterialBatches: [{ id: "raw-batch", storage_location_id: "loc-1", raw_material_id: "rm-1", internal_batch_no: "RM-01", uom: "kg", current_balance: 4, status: "active", raw_material: { id: "rm-1", name_en: "Chili", material_code: "CHI" } }],
      finishedGoodBatches: [{ id: "fg-batch", storage_location_id: "loc-1", finished_good_id: "fg-1", batch_no: "FG-01", current_balance: 6, finished_good: { id: "fg-1", product_code: "SAM-500", product_name: "Sambal 500g", uom: "Packs", product_family: { name_en: "Sambal" } } }],
    });
    renderPage(["factory_storage_locations.view", "factory_raw_inventory.view", "factory_finished_goods.view"]);
    await waitFor(() => expect(getLocationInventory).toHaveBeenCalledWith({ includeRawMaterials: true, includeFinishedGoods: true }));
    fireEvent.click(await screen.findByRole("button", { name: "1 RM · 1 FG" }));
    expect(screen.getByRole("heading", { name: "Location Inventory" })).not.toBeNull();
    expect(screen.getByText("Chili")).not.toBeNull();
    expect(screen.getByText("Sambal")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "1 batch" })[0]);
    expect(screen.getByText("RM-01")).not.toBeNull();
  });

  it("does not query or expose inventory when the role only manages Locations", () => {
    const getLocationInventory = vi.spyOn(factoryService, "getLocationInventory");
    renderPage(["factory_storage_locations.view"]);
    expect(getLocationInventory).not.toHaveBeenCalled();
    expect(screen.getByRole("columnheader", { name: "Inventory" })).not.toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
