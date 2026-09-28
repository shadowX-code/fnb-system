import { supabase } from '../../../../lib/supabase.ts';
import { readCompleteInventoryRows } from '../../../../services/inventoryCompleteRead.js';
import { mapRemoteInventoryItem, normalizeInventoryItem, uniqueIds, mapRemoteCategory, outletConfigForItem, canonical, isUuid } from '../inventoryItemModel.js';

const debugLog = (...args) => { if (import.meta.env.DEV) console.log(...args); };
const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export function normalizeUom(uom = {}) {
  const code = String(uom.code ?? uom.uom_code ?? "").trim();
  return {
    id: uom.id || makeId("uom"),
    code,
    displayName: uom.displayName ?? uom.display_name ?? code,
    uomType: uom.uomType ?? uom.uom_type ?? "General",
    isActive: uom.isActive ?? uom.is_active ?? uom.status !== "inactive",
    sortOrder: Number(uom.sortOrder ?? uom.sort_order ?? 0),
    createdAt: uom.createdAt ?? uom.created_at ?? "",
    updatedAt: uom.updatedAt ?? uom.updated_at ?? "",
  };
}


export function mapRemoteUom(row = {}) {
  return normalizeUom({
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    uomType: row.uom_type,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}





export async function persistRemoteInventoryItem(item, userId, accessibleOutletIds = null) {
  const normalized = normalizeInventoryItem(item);
  const mode = isUuid(normalized.id) ? "edit" : "create";
  const itemPayload = {
    item_name: normalized.name,
    sku_code: normalized.sku || null,
    category_id: isUuid(normalized.categoryId) ? normalized.categoryId : null,
    unit: normalized.unit || null,
    cost: normalized.cost === "" || normalized.cost === null || normalized.cost === undefined ? null : Number(normalized.cost),
    photo_url: normalized.photo || normalized.photo_url || null,
    description: normalized.description || null,
    inventory_type: normalized.inventoryType || null,
    default_supplier_id: isUuid(normalized.defaultSupplierId) ? normalized.defaultSupplierId : null,
    status: normalized.status || "active",
    updated_by: userId || null,
  };
  if (itemPayload.cost !== null && (!Number.isFinite(itemPayload.cost) || itemPayload.cost < 0)) throw new Error("Cost must be a non-negative number.");
  if (item.costMetadataChanged === true) {
    itemPayload.cost_updated_at = new Date().toISOString();
    itemPayload.cost_updated_by = isUuid(item.costUpdatedBy || item.cost_updated_by) ? (item.costUpdatedBy || item.cost_updated_by) : null;
  }
  const debug = {
    mode,
    payload: itemPayload,
    itemId: normalized.id || null,
    selectedUom: normalized.unit || null,
    savedUnit: null,
    photoUrl: itemPayload.photo_url,
    linkedOutletIds: uniqueIds(normalized.linkedOutletIds || []),
    itemInsertResult: null,
    itemUpdateResult: null,
    outletLinksPayload: [],
    outletLinksResult: null,
    outletDeleteResult: null,
    error: null,
  };
  const selectedOutletIds = uniqueIds(normalized.linkedOutletIds || []).filter((outletId) => isUuid(outletId));
  const hasExplicitAccessibleScope = Array.isArray(accessibleOutletIds);
  const accessibleSet = hasExplicitAccessibleScope ? new Set(accessibleOutletIds) : null;
  const inScope = (outletId) => !accessibleSet || accessibleSet.has(outletId);
  const selectedOutletIdsInScope = selectedOutletIds.filter(inScope);
  const skippedSelectedOutOfScope = selectedOutletIds.filter((outletId) => !inScope(outletId));

  let savedItem = null;
  if (mode === "edit") {
    const result = await supabase
      .from("inventory_items")
      .update(itemPayload)
      .eq("id", normalized.id)
      .select("*")
      .single();
    debug.itemUpdateResult = { data: result.data, error: result.error };
    if (result.error) {
      debug.error = result.error;
      debugLog("[InventorySaveDebug]", debug);
      debugLog("[InventoryItemSaveDebug]", debug);
      throw result.error;
    }
    savedItem = result.data;
  } else {
    const result = await supabase
      .from("inventory_items")
      .insert({ ...itemPayload, created_by: userId || null })
      .select("*")
      .single();
    debug.itemInsertResult = { data: result.data, error: result.error };
    if (result.error) {
      debug.error = result.error;
      debugLog("[InventorySaveDebug]", debug);
      debugLog("[InventoryItemSaveDebug]", debug);
      throw result.error;
    }
    savedItem = result.data;
  }
  debug.savedUnit = savedItem?.unit || savedItem?.uom_code || null;

  const remoteItemId = savedItem.id;
  const { data: existingLinks, error: existingLinksError } = await supabase
    .from("inventory_item_outlets")
    .select("id,outlet_id")
    .eq("inventory_item_id", remoteItemId);
  if (existingLinksError) {
    debug.error = existingLinksError;
    debugLog("[InventorySaveDebug]", debug);
    debugLog("[InventoryItemSaveDebug]", debug);
    debugLog("[InventoryLinkedOutletsSaveDebug]", { itemId: remoteItemId, existingOutletIds: [], accessibleOutletIds: hasExplicitAccessibleScope ? accessibleOutletIds : null, selectedOutletIds, toAdd: [], toRemove: [], skippedOutOfScope: skippedSelectedOutOfScope, error: existingLinksError });
    throw existingLinksError;
  }
  const existingOutletIds = uniqueIds((existingLinks || []).map((row) => row.outlet_id).filter(Boolean));
  const existingOutletIdsInScope = existingOutletIds.filter(inScope);
  const toAdd = selectedOutletIdsInScope.filter((outletId) => !existingOutletIdsInScope.includes(outletId));
  const toRemove = existingOutletIdsInScope.filter((outletId) => !selectedOutletIdsInScope.includes(outletId));
  const skippedOutOfScope = uniqueIds([
    ...skippedSelectedOutOfScope,
    ...existingOutletIds.filter((outletId) => !inScope(outletId)),
  ]);

  debugLog("[InventoryLinkedOutletsSaveDebug]", {
    itemId: remoteItemId,
    existingOutletIds,
    accessibleOutletIds: hasExplicitAccessibleScope ? accessibleOutletIds : null,
    selectedOutletIds,
    toAdd,
    toRemove,
    skippedOutOfScope,
  });

  const configRows = selectedOutletIdsInScope
    .map((outletId) => {
      const config = outletConfigForItem(normalized, outletId);
      return {
        inventory_item_id: remoteItemId,
        outlet_id: outletId,
        par_level: config.parLevel === "" || config.parLevel === null || config.parLevel === undefined ? null : Number(config.parLevel),
        storage_location: config.storageLocation || null,
        is_active: true,
      };
    });
  debug.outletLinksPayload = configRows;

  if (toRemove.length) {
    const deleteResult = await supabase
      .from("inventory_item_outlets")
      .delete()
      .eq("inventory_item_id", remoteItemId)
      .in("outlet_id", toRemove);
    debug.outletDeleteResult = { data: deleteResult.data || null, error: deleteResult.error };
    if (deleteResult.error) {
      const error = new Error("Item saved, but outlet links failed.");
      error.cause = deleteResult.error;
      error.partialItemSaved = true;
      error.debug = debug;
      debug.error = deleteResult.error;
      debugLog("[InventorySaveDebug]", debug);
      debugLog("[InventoryItemSaveDebug]", debug);
      debugLog("[InventoryLinkedOutletsSaveDebug]", { itemId: remoteItemId, existingOutletIds, accessibleOutletIds: hasExplicitAccessibleScope ? accessibleOutletIds : null, selectedOutletIds, toAdd, toRemove, skippedOutOfScope, error: deleteResult.error });
      throw error;
    }
  } else {
    debug.outletDeleteResult = { data: null, error: null };
  }

  if (configRows.length) {
    const configResult = await supabase
      .from("inventory_item_outlets")
      .upsert(configRows, { onConflict: "inventory_item_id,outlet_id" });
    debug.outletLinksResult = { data: configResult.data || null, error: configResult.error };
    if (configResult.error) {
      const error = new Error("Item saved, but outlet links failed.");
      error.cause = configResult.error;
      error.partialItemSaved = true;
      error.debug = debug;
      debug.error = configResult.error;
      debugLog("[InventorySaveDebug]", debug);
      debugLog("[InventoryItemSaveDebug]", debug);
      debugLog("[InventoryLinkedOutletsSaveDebug]", { itemId: remoteItemId, existingOutletIds, accessibleOutletIds: hasExplicitAccessibleScope ? accessibleOutletIds : null, selectedOutletIds, toAdd, toRemove, skippedOutOfScope, error: configResult.error });
      throw error;
    }
  }

  const { data: savedConfigs, error: configsError } = await supabase
    .from("inventory_item_outlets")
    .select("*, outlets:outlet_id(*)")
    .eq("inventory_item_id", remoteItemId);
  if (configsError) {
    debug.error = configsError;
    debugLog("[InventorySaveDebug]", debug);
    debugLog("[InventoryItemSaveDebug]", debug);
    throw configsError;
  }
  debugLog("[InventorySaveDebug]", debug);
  debugLog("[InventoryItemSaveDebug]", debug);
  debugLog("[InventoryLinkedOutletsSaveDebug]", { itemId: remoteItemId, existingOutletIds, accessibleOutletIds: hasExplicitAccessibleScope ? accessibleOutletIds : null, selectedOutletIds, toAdd, toRemove, skippedOutOfScope, error: null });
  return mapRemoteInventoryItem(savedItem, savedConfigs || []);
}

export async function persistRemoteInventoryCategory(category) {
  const payload = {
    name: String(category.name || "").trim(),
    description: String(category.description || "").trim() || null,
    sort_order: Number(category.sortOrder ?? category.sort_order ?? 0) || 0,
    status: category.status || "active",
    updated_at: new Date().toISOString(),
  };
  if (!payload.name) throw new Error("Category name is required.");

  if (isUuid(category.id)) {
    const { data, error } = await supabase
      .from("inventory_categories")
      .update(payload)
      .eq("id", category.id)
      .select("*")
      .single();
    if (error) throw error;
    return mapRemoteCategory(data);
  }

  const { data, error } = await supabase
    .from("inventory_categories")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return mapRemoteCategory(data);
}

export async function countRemoteInventoryItemsForCategory(categoryId) {
  if (!isUuid(categoryId)) return 0;
  const { count, error } = await supabase
    .from("inventory_items")
    .select("id", { count: "exact", head: true })
    .eq("category_id", categoryId);
  if (error) throw error;
  return count || 0;
}

export async function persistRemoteInventoryUom(uom) {
  const normalized = normalizeUom(uom);
  const payload = {
    code: String(normalized.code || "").trim(),
    display_name: String(normalized.displayName || "").trim(),
    uom_type: String(normalized.uomType || "").trim() || "General",
    is_active: Boolean(normalized.isActive),
    sort_order: Number(normalized.sortOrder ?? 0) || 0,
    updated_at: new Date().toISOString(),
  };
  if (!payload.code || !payload.display_name || !payload.uom_type) throw new Error("UOM code, display name and type are required.");

  if (isUuid(normalized.id)) {
    const result = await supabase
      .from("inventory_uoms")
      .update(payload)
      .eq("id", normalized.id)
      .select("*")
      .single();
    debugLog("[UomSaveDebug]", { action: "update", payload, result: { data: result.data, error: result.error }, error: result.error });
    if (result.error) throw result.error;
    return mapRemoteUom(result.data);
  }

  const result = await supabase
    .from("inventory_uoms")
    .insert(payload)
    .select("*")
    .single();
  debugLog("[UomSaveDebug]", { action: "create", payload, result: { data: result.data, error: result.error }, error: result.error });
  if (result.error) throw result.error;
  return mapRemoteUom(result.data);
}

function isDuplicateUomCodeError(error) {
  const message = String(error?.message || error?.details || "");
  return error?.code === "23505" || message.includes("inventory_uoms_code_key");
}

export function uomSaveErrorMessage(error) {
  if (isDuplicateUomCodeError(error)) return "UOM code already exists. Please use another code.";
  return error?.message || "Please try again.";
}

export async function countRemoteInventoryItemsForUom(code) {
  const rawCode = String(code || "").trim();
  if (!rawCode) throw new Error("Cannot verify UOM usage without a code.");
  const { data } = await readCompleteInventoryRows("inventory_items", { select: "id,unit" });
  return data.filter((item) => canonical(item.unit) === canonical(rawCode)).length;
}






export async function loadInventoryMaster() {
  const [itemsResult, categoriesResult, uomsResult, itemOutletsResult, itemOutletSuppliersResult] = await Promise.all([
    readCompleteInventoryRows('inventory_items', { order: 'created_at', ascending: false }),
    readCompleteInventoryRows('inventory_categories', { order: 'sort_order' }),
    readCompleteInventoryRows('inventory_uoms', { order: 'sort_order' }),
    readCompleteInventoryRows('inventory_item_outlets', { select: '*, outlets:outlet_id(*)' }),
    readCompleteInventoryRows('inventory_item_outlet_suppliers'),
  ]);
  const categories = categoriesResult.data.map(mapRemoteCategory);
  const categoryById = new Map(categories.map(category => [category.id, category]));
  const supplierIdsByConfigId = new Map();
  itemOutletSuppliersResult.data.forEach(link => {
    const ids = supplierIdsByConfigId.get(link.inventory_item_outlet_id) || [];
    if (link.supplier_id) ids.push(link.supplier_id);
    supplierIdsByConfigId.set(link.inventory_item_outlet_id, uniqueIds(ids));
  });
  const configsByItem = new Map();
  itemOutletsResult.data.forEach(config => {
    const configs = configsByItem.get(config.inventory_item_id) || [];
    configs.push(config);
    configsByItem.set(config.inventory_item_id, configs);
  });
  return {
    categories,
    uoms: uomsResult.data.map(mapRemoteUom),
    items: itemsResult.data.map(item => mapRemoteInventoryItem(item, configsByItem.get(item.id) || [], categoryById, supplierIdsByConfigId)),
    rawItemCount: itemsResult.count,
    outletLinkCount: itemOutletsResult.count,
  };
}
