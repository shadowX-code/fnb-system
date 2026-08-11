import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProductRecipeDetailModal from "../../modals/recipes/ProductRecipeDetailModal.jsx";
import ProductRecipeModal from "../../modals/recipes/ProductRecipeModal.jsx";

const family = { id: "family-1", name_en: "Sambal", name_cn: "\u53c1\u5df4\u9171", status: "active", category: "Sauces" };
const sku = { id: "sku-1", product_family_id: family.id, product_name_en: family.name_en, uom: "kg", status: "active" };
const material = { id: "material-1", material_code: "CHI", name_en: "Chili", name: "Chili", uom: "kg", status: "active", category: "Spices" };
const receiving = { id: "receiving-1", raw_material_id: material.id, unit_cost: 5, uom: "kg", received_date: "2026-08-01", receiving_no: "R260801-01" };
const draftRecipe = {
  id: "recipe-1",
  product_family_id: family.id,
  finished_good_id: sku.id,
  product_name: family.name_en,
  version: "v2",
  status: "draft",
  yield_quantity: 10,
  uom: "kg",
  remarks: "Current draft notes",
  items: [{ id: "item-1", raw_material_id: material.id, raw_material_name: material.name_en, quantity_used: 2, uom: "kg", wastage_percent: 5, remarks: "Trim loss", sort_order: 1 }],
};

afterEach(() => cleanup());

describe("Product Recipe editor and detail contracts", () => {
  it("preserves the current editor payload for Finished Good, output, BOM rows, status, and remarks", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ProductRecipeModal
        initialValue={draftRecipe}
        productFamilies={[family]}
        finishedGoods={[sku]}
        rawMaterials={[material]}
        receivings={[receiving]}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: draftRecipe.id,
      product_family_id: family.id,
      finished_good_id: sku.id,
      product_name: family.name_en,
      recipe_name: family.name_en,
      version: "v2",
      yield_quantity: 10,
      uom: "kg",
      status: "draft",
      remarks: "Current draft notes",
      items: [expect.objectContaining({
        raw_material_id: material.id,
        quantity_used: 2,
        uom: "kg",
        wastage_percent: 5,
        remarks: "Trim loss",
        sort_order: 1,
      })],
    })));
  });

  it("keeps BOM row add/remove behavior and receiving-cost presentation intact", () => {
    render(
      <ProductRecipeModal
        initialValue={draftRecipe}
        productFamilies={[family]}
        finishedGoods={[sku]}
        rawMaterials={[material]}
        receivings={[receiving]}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getAllByText("RM5.00 / kg").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Add Material" }));
    expect(screen.getAllByText("Raw Material").length).toBeGreaterThan(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.getAllByText("Raw Material").length).toBeGreaterThan(0);
  });

  it("keeps duplicate BOM rows in the current payload and surfaces missing or incompatible material contracts", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const duplicateRecipe = { ...draftRecipe, items: [...draftRecipe.items, { ...draftRecipe.items[0], id: "item-2", sort_order: 2 }] };
    const duplicateView = render(<ProductRecipeModal initialValue={duplicateRecipe} productFamilies={[family]} finishedGoods={[sku]} rawMaterials={[material]} receivings={[receiving]} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ items: expect.arrayContaining([
      expect.objectContaining({ id: "item-1", raw_material_id: material.id }),
      expect.objectContaining({ id: "item-2", raw_material_id: material.id }),
    ]) })));
    duplicateView.unmount();

    render(<ProductRecipeModal initialValue={{ ...draftRecipe, items: [{ ...draftRecipe.items[0], raw_material_id: "", quantity_used: 2, uom: "L" }] }} productFamilies={[family]} finishedGoods={[sku]} rawMaterials={[material]} receivings={[receiving]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));
    expect(screen.getByText("Every material row needs a raw material and standard quantity greater than 0.")).not.toBeNull();
  });

  it("retains a rejected save request ID for unchanged retry and replaces it after persisted intent changes", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("rejected")).mockResolvedValue(undefined);
    render(<ProductRecipeModal initialValue={draftRecipe} productFamilies={[family]} finishedGoods={[sku]} rawMaterials={[material]} receivings={[receiving]} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const firstId = onSave.mock.calls[0][0].requestId;
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/i);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save Recipe" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0].requestId).toBe(firstId);
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(3));
    expect(onSave.mock.calls[2][0].requestId).not.toBe(firstId);
  });

  it("renders active and draft read-only Recipe details without lifecycle controls", () => {
    const activeView = render(<ProductRecipeDetailModal recipe={{ ...draftRecipe, status: "active", product_name_cn: family.name_cn }} receivings={[receiving]} onClose={vi.fn()} />);
    expect(screen.getAllByText("Sambal").length).toBeGreaterThan(0);
    expect(screen.getByText("Active")).not.toBeNull();
    expect(screen.getByText("Standard Output")).not.toBeNull();
    expect(screen.getByText("Chili")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Activate" })).toBeNull();
    activeView.unmount();

    render(<ProductRecipeDetailModal recipe={draftRecipe} receivings={[receiving]} onClose={vi.fn()} />);
    expect(screen.getByText("Draft")).not.toBeNull();
    expect(screen.getByText("v2")).not.toBeNull();
    expect(screen.getAllByText("10 kg").length).toBeGreaterThan(0);
  });
});
