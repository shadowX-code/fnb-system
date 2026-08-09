import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../../context/FactoryNavigationContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryProductRecipesPage from "../FactoryProductRecipesPage.jsx";

const family = { id: "family-1", name_en: "Sambal", name_cn: "\u53c1\u5df4\u9171", status: "active" };
const material = { id: "material-1", name_en: "Chili", uom: "kg", status: "active" };
const draft = { id: "recipe-draft", product_family_id: family.id, product_name: family.name_en, version: "v1", status: "draft", yield_quantity: 10, uom: "kg", items: [{ id: "item-1", raw_material_id: material.id, raw_material_name: "Chili", quantity_used: 2, uom: "kg" }] };
const active = { ...draft, id: "recipe-active", version: "v2", status: "active" };

function renderPage(permissions) {
  const can = (permission) => permissions.includes(permission);
  return render(<FactoryPermissionsProvider permissionSet={permissions} can={can}><FactoryMasterDataProvider data={{ recipes: [draft, active], productFamilies: [family], finishedGoods: [{ id: "sku-1", product_family_id: family.id, uom: "kg" }], rawMaterials: [material], receivings: [{ raw_material_id: material.id, unit_cost: 5, uom: "kg" }] }}><FactoryNavigationProvider saveProductRecipe={vi.fn()} activateProductRecipe={vi.fn()} archiveProductRecipe={vi.fn()} restoreProductRecipe={vi.fn()} createProductRecipeNewVersion={vi.fn()} deleteProductRecipe={vi.fn()}><FactoryProductRecipesPage /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
}

afterEach(cleanup);

describe("FactoryProductRecipesPage", () => {
  it("renders grouped Draft and Active Recipes, opens detail, and exposes only permitted actions", () => {
    renderPage(["factory_product_recipes.view", "factory_product_recipes.edit"]);
    expect(screen.getByText("Product Recipes / BOM")).not.toBeNull();
    expect(screen.getByText("v1")).not.toBeNull(); expect(screen.getByText("v2")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Edit" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Activate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "View" })[0]);
    expect(screen.getByText("BOM Materials")).not.toBeNull();
  });

  it("keeps lifecycle and Create Recipe controls hidden for View-only users", () => {
    renderPage(["factory_product_recipes.view"]);
    expect(screen.queryByRole("button", { name: "Create Recipe" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Activate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });
});
