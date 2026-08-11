import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tables: {},
  operations: [],
  notifications: [],
  archiveError: null,
  saveRecipe: vi.fn(),
  from: vi.fn(),
}));

vi.mock("../../../../lib/supabase.ts", () => ({
  supabase: {
    from: mocks.from,
  },
}));

vi.mock("../../../../services/inventoryLifecycleService.js", () => ({
  inventoryLifecycleService: {
    saveInventoryRecipe: mocks.saveRecipe,
  },
}));

vi.mock("../../../../services/productAnalyticsService.js", () => ({
  productAnalyticsService: {
    listReports: vi.fn().mockResolvedValue([]),
    listItemsByReportIds: vi.fn().mockResolvedValue([]),
  },
}));

import InventoryControlPage from "../InventoryControlPage.jsx";

const ids = {
  outlet: "00000000-0000-4000-8000-000000000001",
  category: "00000000-0000-4000-8000-000000000002",
  item: "00000000-0000-4000-8000-000000000003",
  recipe: "00000000-0000-4000-8000-000000000004",
  recipeItem: "00000000-0000-4000-8000-000000000005",
  menuCategory: "00000000-0000-4000-8000-000000000006",
};

const recipeRow = {
  id: ids.recipe,
  outlet_id: ids.outlet,
  recipe_code: "RCP-SAMBAL-001",
  recipe_name: "Sambal Noodles",
  recipe_name_en: "Sambal Noodles",
  recipe_name_cn: "叁巴面",
  menu_category: "Main Dish",
  selling_price: 12,
  serving_size: 1,
  status: "active",
};

function baseTables() {
  return {
    inventory_items: [{ id: ids.item, item_name: "Dried Chilli", sku_code: "RM-CHILLI", category_id: ids.category, unit: "kg", cost: 8, status: "active" }],
    inventory_categories: [{ id: ids.category, name: "Raw Materials", status: "active", sort_order: 1 }],
    inventory_uoms: [{ id: "uom-kg", code: "kg", display_name: "Kilogram", uom_type: "Weight", is_active: true, sort_order: 1 }],
    inventory_item_outlets: [{ id: "item-outlet-1", inventory_item_id: ids.item, outlet_id: ids.outlet, is_active: true, outlets: { id: ids.outlet, name: "KL Central", code: "KLC" } }],
    inventory_item_outlet_suppliers: [],
    inventory_stock_check_groups: [],
    inventory_stock_check_group_categories: [],
    inventory_stock_checks: [],
    inventory_stock_check_items: [],
    inventory_purchase_orders: [],
    inventory_purchase_order_items: [],
    inventory_purchase_receipts: [],
    inventory_purchase_receipt_items: [],
    inventory_movements: [],
    inventory_waste_records: [],
    inventory_menu_categories: [{ id: ids.menuCategory, name: "Main Dish", status: "active", sort_order: 1 }],
    inventory_recipes: [{ ...recipeRow }],
    inventory_recipe_items: [{ id: ids.recipeItem, recipe_id: ids.recipe, inventory_item_id: ids.item, quantity_used: 1.5, unit: "kg", wastage_percent: 2 }],
    employees: [],
    product_recipe_mappings: [],
  };
}

function createQuery(table) {
  const query = { table, operation: "read", payload: null, filters: [] };
  const builder = {};
  const execute = () => {
    if (query.operation === "update" && table === "inventory_recipes") {
      if (mocks.archiveError) return { data: null, error: mocks.archiveError };
      const id = query.filters.find((filter) => filter[0] === "id")?.[1];
      mocks.tables[table] = mocks.tables[table].map((row) => row.id === id ? { ...row, ...query.payload } : row);
      return { data: mocks.tables[table].find((row) => row.id === id) || null, error: null };
    }
    return { data: mocks.tables[table] || [], error: null };
  };
  builder.select = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.ilike = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.eq = vi.fn((key, value) => { query.filters.push([key, value]); return builder; });
  builder.update = vi.fn((payload) => { query.operation = "update"; query.payload = payload; mocks.operations.push({ table, kind: "update", payload }); return builder; });
  builder.single = vi.fn(async () => execute());
  builder.then = (resolve, reject) => Promise.resolve(execute()).then(resolve, reject);
  return builder;
}

function inventoryReads() {
  return mocks.from.mock.calls.filter(([table]) => table === "inventory_items").length;
}

function renderRecipes({ permissions = ["inventory_recipes.view", "inventory_recipes.manage", "inventory_recipes.export"] } = {}) {
  const ui = { notify: vi.fn((entry) => mocks.notifications.push(entry)) };
  render(
    <InventoryControlPage
      initialTab="recipes"
      store={{ outlets: [{ id: ids.outlet, name: "KL Central", code: "KLC" }], suppliers: [] }}
      auth={{
        user: { id: "user-1", email: "recipe@example.test" },
        profile: { id: "user-1", role_id: "role-1", role_outlet_access_type: "selected", role_outlet_ids: [ids.outlet] },
        hasPermission: (key) => permissions.includes(key),
      }}
      ui={ui}
    />,
  );
  return ui;
}

async function waitForRecipePage() {
  await screen.findByRole("heading", { name: "Recipe BOM Setup" });
  await screen.findAllByText("Sambal Noodles");
}

function recipeRowElement() {
  return screen.queryAllByText("Sambal Noodles").find((element) => element.closest("tr"))?.closest("tr");
}

function setField(label, value) {
  const labelNode = screen.getAllByText(label, { selector: "div" }).find((node) => node.parentElement?.querySelector("input"));
  fireEvent.change(labelNode.parentElement.querySelector("input"), { target: { value } });
}

async function fillNewRecipe() {
  fireEvent.click(screen.getByRole("button", { name: "Add Recipe" }));
  await screen.findByRole("heading", { name: "Add Recipe" });
  setField("Recipe Code", "RCP-NEW-001");
  setField("Recipe Name EN", "New Sambal");
  setField("Recipe Name CN", "新叁巴");
  setField("Selling Price", "18");
  fireEvent.click(screen.getByRole("button", { name: "Add Ingredient" }));
  const ingredientLabel = screen.getByText("Inventory Item");
  fireEvent.click(within(ingredientLabel.parentElement).getByRole("button"));
  setField("Qty Used", "2");
}

beforeEach(() => {
  mocks.tables = baseTables();
  mocks.operations.length = 0;
  mocks.notifications.length = 0;
  mocks.archiveError = null;
  mocks.from.mockImplementation(createQuery);
  mocks.from.mockClear();
  mocks.saveRecipe.mockReset();
  mocks.saveRecipe.mockResolvedValue({ recipe: { ...recipeRow }, items: [] });
});

afterEach(cleanup);

describe("InventoryControlPage Recipe lifecycle", () => {
  it("mounts the real Recipes tab with a non-empty selector-filtered recipe list", async () => {
    renderRecipes();
    await waitForRecipePage();

    expect(screen.getByText("RCP-SAMBAL-001")).toBeTruthy();
    expect(within(recipeRowElement()).getByText("Active")).toBeTruthy();
    expect(within(recipeRowElement()).getByRole("button", { name: "1 ingredient" })).toBeTruthy();
    expect(screen.queryByText("No recipes set up yet.")).toBeNull();
    expect(screen.queryByText("Inventory Dashboard")).toBeNull();
  });

  it("paginates the post-filter Recipe BOM list with the shared Factory footer and resets after search", async () => {
    mocks.tables.inventory_recipes = Array.from({ length: 21 }, (_, index) => ({
      ...recipeRow,
      id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
      recipe_code: `RCP-PAGE-${String(index + 1).padStart(3, "0")}`,
      recipe_name: `Paged Recipe ${String(index + 1).padStart(2, "0")}`,
      recipe_name_en: `Paged Recipe ${String(index + 1).padStart(2, "0")}`,
    }));
    renderRecipes();
    await screen.findAllByText("Paged Recipe 01");
    expect(screen.getByText("Showing 1–20 of 21 records")).toBeTruthy();
    expect(screen.queryByText("Paged Recipe 21")).toBeNull();
    const paginationDesktop = screen.getByText("Showing 1–20 of 21 records").closest(".hidden");
    fireEvent.click(within(paginationDesktop).getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 21–21 of 21 records")).toBeTruthy();
    expect(screen.getAllByText("Paged Recipe 21").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText("Search recipe, outlet or ingredient"), { target: { value: "Paged Recipe 01" } });
    expect(screen.getByText("Showing 1–1 of 1 records")).toBeTruthy();
    expect(screen.getAllByText("Paged Recipe 01").length).toBeGreaterThan(0);
    expect(screen.queryByText("Paged Recipe 21")).toBeNull();
  });

  it("orchestrates page create through the trusted recipe service, one refresh, notification, and modal close", async () => {
    renderRecipes();
    await waitForRecipePage();
    const readsBeforeSave = inventoryReads();
    await fillNewRecipe();

    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));
    await waitFor(() => expect(mocks.saveRecipe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add Recipe" })).toBeNull());
    expect(mocks.saveRecipe).toHaveBeenCalledWith(expect.objectContaining({ recipe: expect.objectContaining({ outlet_id: ids.outlet, recipe_code: "RCP-NEW-001", recipe_name_en: "New Sambal", recipe_name_cn: "新叁巴", ingredients: [expect.objectContaining({ inventory_item_id: ids.item, quantity_used: 2, unit: "kg" })] }) }));
    expect(inventoryReads()).toBe(readsBeforeSave + 1);
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Recipe created" }));
    expect(mocks.operations.filter((entry) => entry.table === "inventory_recipes")).toHaveLength(0);
  });

  it("orchestrates edit for the loaded recipe identity through the same trusted service and closes after refresh", async () => {
    renderRecipes();
    await waitForRecipePage();
    const row = recipeRowElement();
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    await screen.findByRole("heading", { name: "Edit Recipe" });
    const recipeCodeLabel = screen.getAllByText("Recipe Code", { selector: "div" }).find((node) => node.parentElement?.querySelector("input"));
    expect(recipeCodeLabel.parentElement.querySelector("input").value).toBe("RCP-SAMBAL-001");
    setField("Selling Price", "15");
    const readsBeforeSave = inventoryReads();

    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));
    await waitFor(() => expect(mocks.saveRecipe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit Recipe" })).toBeNull());
    expect(mocks.saveRecipe).toHaveBeenCalledWith(expect.objectContaining({ recipe: expect.objectContaining({ id: ids.recipe, recipe_code: "RCP-SAMBAL-001", selling_price: 15 }) }));
    expect(inventoryReads()).toBe(readsBeforeSave + 1);
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Recipe updated" }));
  });

  it("archives through the canonical archive boundary once, refreshes, and notifies", async () => {
    renderRecipes();
    await waitForRecipePage();
    const readsBeforeArchive = inventoryReads();
    const row = recipeRowElement();
    fireEvent.click(within(row).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(mocks.operations.filter((entry) => entry.table === "inventory_recipes" && entry.kind === "update")).toHaveLength(1));
    await waitFor(() => expect(recipeRowElement()).toBeUndefined());
    expect(mocks.tables.inventory_recipes[0].status).toBe("inactive");
    expect(inventoryReads()).toBe(readsBeforeArchive + 1);
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Recipe archived" }));
  });

  it("keeps the recipe visible and usable when archive rejects, with no false success or refresh", async () => {
    mocks.archiveError = new Error("archive rejected");
    renderRecipes();
    await waitForRecipePage();
    const readsBeforeArchive = inventoryReads();
    const row = recipeRowElement();
    fireEvent.click(within(row).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(mocks.operations.filter((entry) => entry.table === "inventory_recipes" && entry.kind === "update")).toHaveLength(1));
    expect(recipeRowElement()).toBeTruthy();
    expect(within(recipeRowElement()).getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(inventoryReads()).toBe(readsBeforeArchive);
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Failed to archive Recipe", tone: "error" }));
    expect(mocks.notifications.some((entry) => entry.title === "Recipe archived")).toBe(false);
  });

  it("hides Recipe mutation controls for a view-only permission profile without invoking protected boundaries", async () => {
    renderRecipes({ permissions: ["inventory_recipes.view"] });
    await waitForRecipePage();
    expect(screen.queryByRole("button", { name: "Add Recipe" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(mocks.saveRecipe).not.toHaveBeenCalled();
    expect(mocks.operations.filter((entry) => entry.table === "inventory_recipes" && entry.kind === "update")).toHaveLength(0);
  });
});
