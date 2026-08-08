import { useMemo } from "react";
import useFactoryMasterData from "./useFactoryMasterData.js";
import useFactoryPermissions from "./useFactoryPermissions.js";

const includesText = (value, search) => !search || String(value || "").toLowerCase().includes(String(search).toLowerCase());

function toFinishedGoodRow(product, productions, productMovements) {
  const productKey = String(product.product_name || "").toLowerCase();
  const productProductions = productions.filter((row) => String(row.product_name || "").toLowerCase() === productKey);
  const movements = productMovements.filter((row) => row.finished_good_id === product.id || String(row.product_name || "").toLowerCase() === productKey);
  const lastProduction = [...productProductions].sort((a, b) => new Date(b.production_date || b.created_at || 0) - new Date(a.production_date || a.created_at || 0))[0];
  const lastMovement = [...movements].sort((a, b) => new Date(b.movement_date || b.created_at || 0) - new Date(a.movement_date || a.created_at || 0))[0];
  return { ...product, last_production_date: lastProduction?.production_date || "", last_movement_date: lastMovement?.movement_date || "", production_count: productProductions.length, movement_count: movements.length, batch_count: new Set(productProductions.map((production) => production.batch_no).filter(Boolean)).size, latest_batch_no: lastProduction?.batch_no || "" };
}

export default function useFactoryFinishedGoodsQuery({ filters }) {
  const { finishedGoods, finishedGoodCategories, productFamilies, productions, productMovements } = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const permitted = can("factory_finished_goods.view");
  return useMemo(() => {
    if (!permitted) return { rows: [], groups: [], loading: false, error: "Some Finished Goods data is hidden by your current role.", errorKind: "permission", retry: () => {} };
    const rows = finishedGoods.map((product) => toFinishedGoodRow(product, productions, productMovements)).filter((row) => {
      const productText = `${row.product_family_name} ${row.product_name} ${row.product_name_en} ${row.product_name_cn} ${row.product_name_bm} ${row.product_code} ${row.variant_name}`;
      const stockStatus = Number(row.current_balance || 0) <= 0 ? "out_of_stock" : "in_stock";
      return includesText(productText, filters.product) && (!filters.category || row.category_id === filters.category) && (!filters.status || row.status === filters.status || stockStatus === filters.status);
    });
    const categoryById = new Map(finishedGoodCategories.map((category) => [category.id, category]));
    const groups = productFamilies.map((family) => ({ ...family, groupKey: family.id, product_group_name: family.name_en, category: family.category || categoryById.get(family.category_id)?.name || "No category", skus: rows.filter((row) => row.product_family_id === family.id), active_sku_count: rows.filter((row) => row.product_family_id === family.id && row.status === "active").length, isStandalone: false }));
    rows.filter((row) => !row.product_family_id).forEach((sku) => groups.push({ id: `__sku_${sku.id}`, groupKey: `__sku_${sku.id}`, product_group_name: sku.product_name_en || sku.product_name || sku.product_code || "Unassigned Finished Good", name_cn: sku.product_name_cn || "", name_bm: sku.product_name_bm || "", category: sku.category || "No category", category_id: sku.category_id || "", status: sku.status || "active", skus: [sku], active_sku_count: sku.status === "active" ? 1 : 0, isStandalone: true }));
    const visibleGroups = groups.filter((group) => {
      const groupNameMatches = includesText(`${group.product_group_name} ${group.name_cn || ""} ${group.name_bm || ""}`, filters.product);
      const matchesCategory = !filters.category || group.category_id === filters.category || group.skus.some((sku) => sku.category_id === filters.category);
      const matchesStatus = !filters.status || group.status === filters.status || group.skus.some((sku) => sku.status === filters.status || (Number(sku.current_balance || 0) <= 0 ? "out_of_stock" : "in_stock") === filters.status);
      return (groupNameMatches || group.skus.length > 0) && matchesCategory && matchesStatus && (group.skus.length > 0 || !filters.product || groupNameMatches);
    });
    return { rows, groups: visibleGroups, loading: false, error: "", errorKind: "", retry: () => {} };
  }, [filters, finishedGoods, finishedGoodCategories, permitted, productFamilies, productions, productMovements]);
}
