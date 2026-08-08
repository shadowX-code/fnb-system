import { describe, expect, it } from "vitest";
import {
  canArchiveActiveProductRecipe,
  canCreatePlanningJobOrder,
  canDeleteDraftProductRecipe,
  canEditFinishedGoods,
  canEditProductionPlanningPar,
  canOpenRawMaterialReceiving,
} from "../factoryPermissionActions.js";

function canWith(permissionSet) {
  return (permission) => permissionSet.includes(permission);
}

describe("Factory permission action presentation", () => {
  it("keeps Raw Material Receiving available to View users while gating Receive Raw Material on Create", () => {
    const viewOnly = canWith(["factory_raw_receiving.view"]);
    const creator = canWith(["factory_raw_receiving.view", "factory_raw_receiving.create"]);
    expect(viewOnly("factory_raw_receiving.view")).toBe(true);
    expect(canOpenRawMaterialReceiving(viewOnly)).toBe(false);
    expect(canOpenRawMaterialReceiving(creator)).toBe(true);
  });

  it("gates Finished Good edit controls on the exact Edit permission", () => {
    const viewOnly = canWith(["factory_finished_goods.view"]);
    const editor = canWith(["factory_finished_goods.view", "factory_finished_goods.edit"]);
    expect(viewOnly("factory_finished_goods.view")).toBe(true);
    expect(canEditFinishedGoods(viewOnly)).toBe(false);
    expect(canEditFinishedGoods(editor)).toBe(true);
  });

  it("keeps Draft Delete separate from Active Archive for Product Recipes", () => {
    const deleteOnly = canWith(["factory_product_recipes.delete"]);
    const editor = canWith(["factory_product_recipes.edit"]);
    const manager = canWith(["factory_product_recipes.manage"]);
    expect(canDeleteDraftProductRecipe(deleteOnly)).toBe(true);
    expect(canArchiveActiveProductRecipe(deleteOnly)).toBe(false);
    expect(canArchiveActiveProductRecipe(editor)).toBe(true);
    expect(canArchiveActiveProductRecipe(manager)).toBe(true);
  });

  it("uses Job Order Create and Finished Good Edit independently for Planning actions", () => {
    const jobCreator = canWith(["factory_job_orders.create"]);
    const finishedGoodEditor = canWith(["factory_finished_goods.edit"]);
    expect(canCreatePlanningJobOrder(jobCreator)).toBe(true);
    expect(canEditProductionPlanningPar(jobCreator)).toBe(false);
    expect(canCreatePlanningJobOrder(finishedGoodEditor)).toBe(false);
    expect(canEditProductionPlanningPar(finishedGoodEditor)).toBe(true);
  });
});
