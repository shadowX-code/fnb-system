export function canOpenRawMaterialReceiving(can) {
  return can("factory_raw_receiving.create");
}

export function canEditFinishedGoods(can) {
  return can("factory_finished_goods.edit");
}

export function canDeleteDraftProductRecipe(can) {
  return can("factory_product_recipes.delete");
}

export function canArchiveActiveProductRecipe(can) {
  return can("factory_product_recipes.edit") || can("factory_product_recipes.manage");
}

export function canCreatePlanningJobOrder(can) {
  return can("factory_job_orders.create");
}

export function canEditProductionPlanningPar(can) {
  return canEditFinishedGoods(can);
}

export function productionSopActions(can, status) {
  return {
    edit: status === "draft" && can("factory_production_sop.edit"),
    activate: status === "draft" && (can("factory_production_sop.edit") || can("factory_production_sop.manage")),
    deleteDraft: status === "draft" && can("factory_production_sop.delete"),
    newVersion: status === "active" && can("factory_production_sop.create"),
    archive: status === "active" && can("factory_production_sop.delete"),
    restore: status === "archived" && can("factory_production_sop.edit"),
    manageQcPresets: can("factory_production_sop.manage"),
  };
}
