import { useMemo } from "react";
import useFactoryMasterData from "./useFactoryMasterData.js";
import useFactoryPermissions from "./useFactoryPermissions.js";
import { filterFinishedGoods } from "../../../../supabase/functions/_shared/factory/finishedGoodsGroups.js";

function toFinishedGoodRow(product, productions, productMovements) {
  const productKey = String(product.product_name || "").toLowerCase();
  const productProductions = productions.filter((row) => String(row.product_name || "").toLowerCase() === productKey);
  const movements = productMovements.filter((row) => row.finished_good_id === product.id || String(row.product_name || "").toLowerCase() === productKey);
  const lastProduction = [...productProductions].sort((a, b) => new Date(b.production_date || b.created_at || 0) - new Date(a.production_date || a.created_at || 0))[0];
  const lastMovement = [...movements].sort((a, b) => new Date(b.movement_date || b.created_at || 0) - new Date(a.movement_date || a.created_at || 0))[0];
  return { ...product, last_production_date: lastProduction?.production_date || "", last_movement_date: lastMovement?.movement_date || "", production_count: productProductions.length, movement_count: movements.length, batch_count: new Set(productProductions.map((production) => production.batch_no).filter(Boolean)).size, latest_batch_no: lastProduction?.batch_no || "" };
}

export default function useFactoryFinishedGoodsQuery({ filters, tagSnapshot }) {
  const { finishedGoods, finishedGoodCategories, productFamilies, productions, productMovements } = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const permitted = can("factory_finished_goods.view");
  const products = Array.isArray(finishedGoods) ? finishedGoods : [];
  const categories = Array.isArray(finishedGoodCategories) ? finishedGoodCategories : [];
  const families = Array.isArray(productFamilies) ? productFamilies : [];
  const productionRows = Array.isArray(productions) ? productions : [];
  const movementRows = Array.isArray(productMovements) ? productMovements : [];
  return useMemo(() => {
    if (!permitted) return { rows: [], groups: [], loading: false, error: "Some Finished Goods data is hidden by your current role.", errorKind: "permission", retry: () => {} };
    const result = filterFinishedGoods(families, products.map(product => toFinishedGoodRow(product, productionRows, movementRows)), categories, filters, tagSnapshot);
    return { ...result, loading: false, error: "", errorKind: "", retry: () => {} };
  }, [categories, families, filters, movementRows, permitted, products, productionRows, tagSnapshot?.tags, tagSnapshot?.assignments]);
}
