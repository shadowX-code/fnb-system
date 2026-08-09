import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FactoryProductionSopPage from "../FactoryProductionSopPage.jsx";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../../context/FactoryNavigationContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";

const family = { id: "family-1", name_en: "Sambal", status: "active" };
const recipe = { id: "recipe-1", product_family_id: family.id, version: "v2", status: "active", yield_quantity: 10, uom: "kg", items: [] };
const draft = { id: "sop-draft", finished_good_id: family.id, product_name: "Sambal", version: "v2", status: "draft", effective_date: "2026-08-09", recipe_id: recipe.id, recipe_version: recipe.version, linked_recipe: recipe, steps: [{ id: "step-1", step_no: 1, step_name: "Cook", estimated_time_minutes: 10, qc_checks: [{ id: "qc-1", qc_name: "Temperature", qc_type: "checklist", checklist_template_id: "template-1", is_required: true }], ingredient_material_ids: [] }] };
const active = { ...draft, id: "sop-active", version: "v1", status: "active" };
const legacy = { id: "sop-legacy", product_name: "Legacy Sambal", version: "v1", status: "archived", steps: [{ id: "legacy-step", step_no: 1, process_name: "Cook", estimated_time_minutes: 8, qc_required: true, qc_label: "Legacy temperature", qc_target_value: "80C", ingredient_material_ids: [] }] };
const actions = { saveProductionSop: vi.fn(), activateProductionSop: vi.fn(), archiveProductionSop: vi.fn(), restoreProductionSop: vi.fn(), createProductionSopNewVersion: vi.fn(), deleteProductionSop: vi.fn(), createQcChecklistTemplate: vi.fn(), updateQcChecklistTemplate: vi.fn(), archiveQcChecklistTemplate: vi.fn(), restoreQcChecklistTemplate: vi.fn(), deleteQcChecklistTemplate: vi.fn() };

function renderPage(permissions) {
  return render(<FactoryPermissionsProvider permissionSet={permissions} can={(permission) => permissions.includes(permission)}><FactoryMasterDataProvider data={{ productFamilies: [family], recipes: [recipe], sops: [draft, active, legacy], qcChecklistTemplates: [{ id: "template-1", name: "Temperature", result_mode: "checklist", is_active: true }] }}><FactoryNavigationProvider {...actions}><FactoryProductionSopPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
}

afterEach(() => cleanup());

describe("FactoryProductionSopPage smoke", () => {
  it("renders Draft, Active, and legacy SOP records then opens detail and builder presentation", () => {
    renderPage(["factory_production_sop.view", "factory_production_sop.create", "factory_production_sop.edit", "factory_production_sop.delete", "factory_production_sop.manage"]);
    expect(screen.getByText("Sambal")).not.toBeNull();
    expect(screen.getByText("Legacy Sambal")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "View" })[0]);
    expect(screen.getByText("Legacy temperature")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Create SOP" }));
    expect(screen.getByText("Create Production SOP")).not.toBeNull();
  });

  it("keeps View-only SOP presentation read-only and hides lifecycle, builder, and QC management controls", () => {
    renderPage(["factory_production_sop.view"]);
    expect(screen.getByText("Production SOP Records")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Create SOP" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage QC Checks" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Activate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });
});
