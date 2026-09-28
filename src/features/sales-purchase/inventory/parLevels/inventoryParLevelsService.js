import {supabase} from "../../../../lib/supabase.ts";
import {readCompleteInventoryRows} from "../../../../services/inventoryCompleteRead.js";
import {normalizeInventoryItem,isUuid,outletConfigForItem,uniqueIds,buildOutletConfig,mapRemoteCategory,mapRemoteInventoryItem} from "../inventoryItemModel.js";
export async function persistRemoteParLevelConfig(item, outletId, patch) {
  const normalized = normalizeInventoryItem(item);
  if (!isUuid(normalized.id) || !isUuid(outletId)) throw new Error("Valid item and outlet are required.");
  const existing = outletConfigForItem(normalized, outletId);
  const payload = {
    inventory_item_id: normalized.id,
    outlet_id: outletId,
    par_level: Object.prototype.hasOwnProperty.call(patch, "parLevel")
      ? (patch.parLevel === "" || patch.parLevel === null || patch.parLevel === undefined ? null : Number(patch.parLevel))
      : (existing.parLevel === "" || existing.parLevel === null || existing.parLevel === undefined ? null : Number(existing.parLevel)),
    storage_location: Object.prototype.hasOwnProperty.call(patch, "storageLocation") ? (patch.storageLocation || null) : (existing.storageLocation || null),
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  if (payload.par_level !== null && (!Number.isFinite(payload.par_level) || payload.par_level < 0)) throw new Error("Par Level must be a non-negative number.");

  const configResult = await supabase
    .from("inventory_item_outlets")
    .upsert(payload, { onConflict: "inventory_item_id,outlet_id" })
    .select("*")
    .single();
  if (configResult.error) throw configResult.error;

  if (Object.prototype.hasOwnProperty.call(patch, "supplierIds")) {
    const supplierIds = uniqueIds(patch.supplierIds || []).filter(isUuid);
    const deleteResult = await supabase
      .from("inventory_item_outlet_suppliers")
      .delete()
      .eq("inventory_item_outlet_id", configResult.data.id);
    if (deleteResult.error) throw deleteResult.error;
    if (supplierIds.length) {
      const supplierPayload = supplierIds.map((supplierId) => ({
        inventory_item_outlet_id: configResult.data.id,
        supplier_id: supplierId,
        updated_at: new Date().toISOString(),
      }));
      const supplierResult = await supabase
        .from("inventory_item_outlet_suppliers")
        .insert(supplierPayload);
      if (supplierResult.error) throw supplierResult.error;
    }
  }

  return {
    ...buildOutletConfig(normalized, outletId, existing),
    id: configResult.data.id,
    parLevel: configResult.data.par_level === null || configResult.data.par_level === undefined ? "" : Number(configResult.data.par_level),
    storageLocation: configResult.data.storage_location || "",
    supplierIds: Object.prototype.hasOwnProperty.call(patch, "supplierIds") ? uniqueIds(patch.supplierIds || []) : existing.supplierIds,
    updatedAt: configResult.data.updated_at || new Date().toISOString(),
  };
}

export async function loadInventoryParLevels(outletIds) {
 const [items,categories,links,supplierLinks]=await Promise.all([
  readCompleteInventoryRows('inventory_items'),
  readCompleteInventoryRows('inventory_categories',{order:'sort_order'}),
  readCompleteInventoryRows('inventory_item_outlets',{select:'*, outlets:outlet_id(*)'}),
  readCompleteInventoryRows('inventory_item_outlet_suppliers')
 ]);
 const allowed=new Set(outletIds);
 const scopedLinks=links.data.filter(row=>allowed.has(row.outlet_id));
 const categoryRows=categories.data.map(mapRemoteCategory);
 const categoryById=new Map(categoryRows.map(row=>[row.id,row]));
 const supplierIdsByConfigId=new Map();
 supplierLinks.data.forEach(row=>{const ids=supplierIdsByConfigId.get(row.inventory_item_outlet_id)||[];ids.push(row.supplier_id);supplierIdsByConfigId.set(row.inventory_item_outlet_id,ids);});
 const configsByItem=new Map();
 scopedLinks.forEach(row=>{const rows=configsByItem.get(row.inventory_item_id)||[];rows.push(row);configsByItem.set(row.inventory_item_id,rows);});
 return {categories:categoryRows,items:items.data.map(row=>mapRemoteInventoryItem(row,configsByItem.get(row.id)||[],categoryById,supplierIdsByConfigId))};
}
