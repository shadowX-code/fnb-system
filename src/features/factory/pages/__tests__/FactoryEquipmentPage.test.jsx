import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FactoryEquipmentPage from "../FactoryEquipmentPage.jsx";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";

const equipment = { id: "equipment-1", equipment_code: "MIX-01", name: "Mixer 01", status: "active", category: { name: "Mixer" }, location: { location_name: "Cooking Room" } };

describe("FactoryEquipmentPage", () => {
  it("shows canonical code, category and Location and only exposes master actions with permission", () => {
    render(<FactoryPermissionsProvider permissionSet={["factory_equipment.view", "factory_equipment.create", "factory_equipment.edit", "factory_equipment.manage"]} can={() => true}><FactoryMasterDataProvider data={{ equipment: [equipment] }}><FactoryEquipmentPage onCreate={vi.fn()} onEdit={vi.fn()} onManageCategories={vi.fn()} /></FactoryMasterDataProvider></FactoryPermissionsProvider>);
    expect(screen.getByRole("heading", { name: "Equipment" })).toBeTruthy();
    expect(screen.getByText("MIX-01")).toBeTruthy();
    expect(screen.getByText("Cooking Room")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Equipment" })).toBeTruthy();
  });
});
