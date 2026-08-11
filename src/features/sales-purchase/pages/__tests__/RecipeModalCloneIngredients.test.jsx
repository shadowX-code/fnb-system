import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecipeModal } from "../InventoryControlPage.jsx";

const outletById = new Map([["outlet-a", { name: "KL Central" }], ["outlet-b", { name: "PJ Hub" }]]);
const items = [
  { id: "item-a", name: "Dried Chilli", unit: "kg", cost: 8, status: "active", linkedOutletIds: ["outlet-a"] },
  { id: "item-b", name: "Coconut Milk", unit: "ltr", cost: 6, status: "active", linkedOutletIds: ["outlet-b"] },
];
const sourceRecipe = {
  id: "recipe-source",
  outletId: "outlet-a",
  recipeCode: "RCP-SOURCE",
  recipeNameEn: "Source Sambal",
  recipeNameCn: "源叁巴",
  sellingPrice: 18,
  ingredients: [
    { id: "source-a", itemId: "item-a", quantityUsed: 2, unit: "kg", wastagePercent: 3, remark: "Roast first" },
    { id: "source-b", itemId: "item-b", quantityUsed: 1, unit: "ltr", wastagePercent: 0, remark: "Full fat" },
  ],
};

function mount({ recipe, existingRecipes = [sourceRecipe] } = {}) {
  const onSave = vi.fn();
  render(<RecipeModal recipe={recipe} outletId="outlet-a" outlet={outletById.get("outlet-a")} items={items} menuCategories={[{ id: "category", name: "Main Dish", status: "active" }]} existingRecipes={existingRecipes} outletById={outletById} onClose={vi.fn()} onSave={onSave} />);
  return { onSave };
}

function cloneSourceRecipe() {
  fireEvent.click(screen.getByRole("button", { name: "Clone Ingredients" }));
  expect(screen.getByRole("heading", { name: "Clone Ingredients" })).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText("Search recipe name or code"), { target: { value: "source" } });
  fireEvent.click(screen.getByRole("button", { name: /Source Sambal/ }));
  expect(screen.getByText("Cost RM22.48")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clone 2 Ingredients" }));
}

afterEach(cleanup);

describe("RecipeModal Clone Ingredients", () => {
  it("searches a canonical existing recipe and clones only its ingredient rows into the unsaved current form", () => {
    const { onSave } = mount();
    cloneSourceRecipe();
    expect(screen.getByText("2 ingredients cloned; 1 unavailable for this outlet.")).toBeTruthy();
    expect(screen.getByDisplayValue("Roast first")).toBeTruthy();
    expect(screen.getByDisplayValue("Full fat")).toBeTruthy();
    expect(screen.getByText("This cloned ingredient is not active or linked to the current outlet. Replace or remove it before saving.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("skips duplicate ingredient items and leaves cloned rows editable before the existing save flow", () => {
    const { onSave } = mount();
    cloneSourceRecipe();
    const quantityInput = screen.getByDisplayValue("2");
    fireEvent.change(quantityInput, { target: { value: "4" } });
    expect(screen.getByDisplayValue("4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clone Ingredients" }));
    fireEvent.click(screen.getByRole("button", { name: /Source Sambal/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clone 2 Ingredients" }));
    expect(screen.getByText("0 ingredients cloned; 2 duplicates skipped.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("blocks the existing save callback while an incompatible cloned ingredient remains", () => {
    const { onSave } = mount();
    cloneSourceRecipe();
    fireEvent.change(screen.getByPlaceholderText("RCP-CURRY-001"), { target: { value: "RCP-CLONE-001" } });
    fireEvent.change(screen.getByPlaceholderText("Classic Dry Curry Noodle"), { target: { value: "Cloned Sambal" } });
    fireEvent.change(screen.getByPlaceholderText("经典干咖喱面"), { target: { value: "克隆叁巴" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("This cloned ingredient is not active or linked to the current outlet. Replace or remove it before saving.")).toBeTruthy();
  });

  it("does not offer the current recipe as its own clone source", () => {
    mount({ recipe: sourceRecipe, existingRecipes: [sourceRecipe] });
    expect(screen.getByRole("button", { name: "Clone Ingredients" }).disabled).toBe(true);
  });
});
