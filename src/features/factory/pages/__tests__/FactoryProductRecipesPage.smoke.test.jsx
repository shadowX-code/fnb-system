import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../../context/FactoryNavigationContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryProductRecipesPage from "../FactoryProductRecipesPage.jsx";

const family = { id: "family-1", name_en: "Sambal", name_cn: "\u53c1\u5df4\u9171", status: "active" };
const otherFamily = { id: "family-3", name_en: "Other Sauce", name_cn: "", status: "active" };
const missingFamily = { id: "family-2", name_en: "Missing Recipe", name_cn: "", status: "active" };
const material = { id: "material-1", name_en: "Chili", uom: "kg", status: "active" };
const active = { id: "recipe-active", product_family_id: family.id, product_name: family.name_en, version: "v1", status: "active", yield_quantity: 10, uom: "kg", items: [{ id: "item-1", raw_material_id: material.id, raw_material_name: "Chili", quantity_used: 2, uom: "kg" }] };
const draft = { ...active, id: "recipe-draft", version: "v2", status: "draft" };
const otherRecipe = { ...active, id: "recipe-other", product_family_id: otherFamily.id, product_name: otherFamily.name_en };

function renderPage(permissions, receivings = [{ raw_material_id: material.id, unit_cost: 5, uom: "kg" }]) {
  const can = (permission) => permissions.includes(permission);
  return render(<FactoryPermissionsProvider permissionSet={permissions} can={can}><FactoryMasterDataProvider data={{ recipes: [draft, active, otherRecipe], productFamilies: [family, missingFamily, otherFamily], finishedGoods: [{ id: "sku-1", product_family_id: family.id, uom: "kg" }], rawMaterials: [material], receivings }}><FactoryNavigationProvider saveProductRecipe={vi.fn()} activateProductRecipe={vi.fn()} archiveProductRecipe={vi.fn()} restoreProductRecipe={vi.fn()} createProductRecipeNewVersion={vi.fn()} deleteProductRecipe={vi.fn()}><FactoryProductRecipesPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
}

afterEach(cleanup);

describe("FactoryProductRecipesPage", () => {
  it("renders product-first Recipe rows, version history, and only permitted actions", () => {
    renderPage(["factory_product_recipes.view", "factory_product_recipes.edit"]);
    expect(screen.getByText("Product Recipes / BOM")).not.toBeNull();
    expect(screen.queryByText("Recipe Records")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Product" })).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Standard Output" })).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Cost / kg" })).not.toBeNull();
    expect(screen.getAllByText("RM1.00/kg").length).toBeGreaterThan(0);
    expect(screen.getByText("Products with Recipe")).not.toBeNull();
    expect(screen.getByText("Missing Recipe")).not.toBeNull();
    expect(screen.getByText("v2")).not.toBeNull();
    expect(screen.getAllByText("v1")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 versions for Sambal" }));
    expect(screen.getByText("Version history")).not.toBeNull();
    expect(screen.getAllByText("v1")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Edit Recipe" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Activate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);
    expect(screen.getByText("BOM Materials")).not.toBeNull();
  });

  it("filters grouped recipes through the shared Factory filter bar and clears the active filter", () => {
    renderPage(["factory_product_recipes.view"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "v2" } });
    expect(screen.getByText("Filtered by")).not.toBeNull();
    expect(screen.getByText("v2")).not.toBeNull();
    expect(screen.queryByText("Other Sauce")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByText("Other Sauce")).not.toBeNull();
  });

  it("uses the canonical detail cost projection for Cost / kg and renders unavailable cost as muted dash", () => {
    renderPage(["factory_product_recipes.view"], []);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("keeps lifecycle and Create Recipe controls hidden for View-only users", () => {
    renderPage(["factory_product_recipes.view"]);
    expect(screen.queryByRole("button", { name: "Create Recipe" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Recipe" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Activate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });
});
