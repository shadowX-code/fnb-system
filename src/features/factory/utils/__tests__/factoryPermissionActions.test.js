import { describe, expect, it } from "vitest";
import {
  canArchiveActiveProductRecipe,
  canCreatePlanningJobOrder,
  canDeleteDraftProductRecipe,
  canEditFinishedGoods,
  canEditProductionPlanningPar,
  canOpenRawMaterialReceiving,
  productionSopActions,
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
    const viewOnly = canWith(["factory_product_recipes.view"]);
    const creator = canWith(["factory_product_recipes.create"]);
    const deleteOnly = canWith(["factory_product_recipes.delete"]);
    const editor = canWith(["factory_product_recipes.edit"]);
    const manager = canWith(["factory_product_recipes.manage"]);
    expect(viewOnly("factory_product_recipes.view")).toBe(true);
    expect(viewOnly("factory_product_recipes.create")).toBe(false);
    expect(creator("factory_product_recipes.create")).toBe(true);
    expect(creator("factory_product_recipes.manage")).toBe(false);
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

  it("keeps SOP Draft, lifecycle, archive, restore, and QC preset guards on their current exact permissions", () => {
    const viewOnly = canWith(["factory_production_sop.view"]);
    const editor = canWith(["factory_production_sop.edit"]);
    const deleter = canWith(["factory_production_sop.delete"]);
    const creator = canWith(["factory_production_sop.create"]);
    const manager = canWith(["factory_production_sop.manage"]);
    expect(productionSopActions(viewOnly, "draft")).toMatchObject({ edit: false, activate: false, deleteDraft: false, manageQcPresets: false });
    expect(productionSopActions(editor, "draft")).toMatchObject({ edit: true, activate: true, deleteDraft: false });
    expect(productionSopActions(deleter, "draft")).toMatchObject({ deleteDraft: true, activate: false });
    expect(productionSopActions(creator, "active")).toMatchObject({ newVersion: true, archive: false });
    expect(productionSopActions(deleter, "active")).toMatchObject({ archive: true, newVersion: false });
    expect(productionSopActions(editor, "archived")).toMatchObject({ restore: true });
    expect(productionSopActions(manager, "draft")).toMatchObject({ activate: true, manageQcPresets: true });
  });
});
