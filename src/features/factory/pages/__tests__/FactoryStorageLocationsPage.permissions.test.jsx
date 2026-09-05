import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FactoryStorageLocationsPage from "../FactoryStorageLocationsPage.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../../context/FactoryNavigationContext.jsx";

const location = { id: "loc-1", location_name: "Dry Store", location_code: "DS", location_type: "Dry Store", status: "active" };
function renderPage(permissionSet) {
  const can = (key) => permissionSet.includes(key);
  return render(<FactoryPermissionsProvider permissionSet={permissionSet} can={can}><FactoryMasterDataProvider data={{ storageLocations: [location] }}><FactoryNavigationProvider openCreateStorageLocation={vi.fn()} openEditStorageLocation={vi.fn()} archiveStorageLocation={vi.fn()}><FactoryStorageLocationsPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
}

describe("Storage Location permission rendering", () => {
  it("keeps Create, Edit, Delete, and Manage independent", () => {
    renderPage(["factory_storage_locations.view", "factory_storage_locations.create"]);
    expect(screen.getByRole("button", { name: /^location$/i })).not.toBeNull(); expect(screen.queryByRole("button", { name: "Edit" })).toBeNull(); expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });
  it("shows only the operation granted by Edit or Delete", () => {
    const edit = renderPage(["factory_storage_locations.view", "factory_storage_locations.edit"]); fireEvent.click(screen.getByRole("button", { name: "More row actions" })); expect(screen.getByRole("button", { name: "Edit" })).not.toBeNull(); expect(screen.queryByRole("button", { name: "Archive" })).toBeNull(); edit.unmount();
    renderPage(["factory_storage_locations.view", "factory_storage_locations.delete"]); fireEvent.click(screen.getByRole("button", { name: "More row actions" })); expect(screen.queryByRole("button", { name: "Edit" })).toBeNull(); expect(screen.getByRole("button", { name: "Archive" })).not.toBeNull();
  });
});
