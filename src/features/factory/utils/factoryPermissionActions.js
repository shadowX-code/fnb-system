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
