export function mapRemoteInventoryItem(row = {}, configs = [], categoryById = new Map(), supplierIdsByConfigId = new Map()) {
  const category = categoryById.get(row.category_id) || row.inventory_categories || row.category || {};
  const linkedOutlets = configs
    .map((config) => normalizeOutletRecord(config.outlets || config.outlet || { id: config.outlet_id }))
    .filter((outlet) => outlet.id);
  const outletConfigs = configs.map((config) => ({
    id: config.id,
    inventoryItemId: config.inventory_item_id,
    outletId: config.outlet_id,
    parLevel: config.par_level === null || config.par_level === undefined ? "" : Number(config.par_level),
    storageLocation: config.storage_location || "",
    supplierIds: supplierIdsByConfigId.get(config.id) || [],
    isActive: config.is_active !== false,
    createdAt: config.created_at || "",
    updatedAt: config.updated_at || "",
  }));
  return normalizeInventoryItem({
    id: row.id,
    name: row.item_name || row.name || "Inventory item",
    sku: row.sku_code || row.sku || "",
    categoryId: row.category_id || "",
    categoryName: row.category_name || category?.name || "",
    categoryCode: row.category_code || category?.code || category?.category_code || "",
    unit: row.unit || row.uom_code || row.uom || "",
    cost: row.cost === null || row.cost === undefined ? "" : Number(row.cost),
    costUpdatedAt: row.cost_updated_at || "",
    costUpdatedBy: row.cost_updated_by || "",
    photo: row.photo_url || row.image_url || row.item_photo_url || row.photo || row.image || "",
    description: row.description || "",
    inventoryType: row.inventory_type || "",
    defaultSupplierId: row.default_supplier_id || "",
    status: row.status || "active",
    linkedOutletIds: uniqueIds(outletConfigs.map((config) => config.outletId)),
    linkedOutlets,
    outletConfigs,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  });
}

export function normalizeOutletRecord(outlet = {}) {
  const relatedOutlet = Array.isArray(outlet.outlets) ? outlet.outlets[0] : outlet.outlets;
  const source = relatedOutlet || outlet.outlet || outlet;
  const id = source?.id ?? outlet.outlet_id ?? outlet.outletId ?? outlet.id ?? "";
  const code =
    source?.code ??
    source?.outlet_code ??
    source?.shortCode ??
    source?.short_code ??
    source?.abbreviation ??
    outlet.code ??
    outlet.outlet_code ??
    outlet.shortCode ??
    outlet.short_code ??
    outlet.abbreviation ??
    "";
  const name =
    source?.name ??
    source?.outlet_name ??
    source?.outletName ??
    outlet.name ??
    outlet.outlet_name ??
    outlet.outletName ??
    "";
  return {
    ...outlet,
    ...source,
    id,
    code: String(code || "").trim(),
    name: String(name || "").trim(),
  };
}

export function normalizeInventoryItem(item = {}) {
  const rawCategoryRecord = item.category || item.inventory_categories || item.inventory_category || {};
  const categoryRecord = Array.isArray(rawCategoryRecord) ? rawCategoryRecord[0] || {} : rawCategoryRecord;
  const rawUomRecord = item.uom || item.inventory_uoms || item.inventory_uom || {};
  const uomRecord = Array.isArray(rawUomRecord) ? rawUomRecord[0] || {} : rawUomRecord;
  const linkedOutlets = (item.linkedOutlets || item.linked_outlets || [])
    .map(normalizeOutletRecord)
    .filter((outlet) => outlet.id);
  const linkedOutletIds = getLinkedOutletIds(item);
  const existingConfigs = new Map([...(item.outletConfigs || []), ...(item.outlet_configs || [])].map((config) => [config.outletId || config.outlet_id, config]));
  const id = item.id || "";
  const name = item.name ?? item.item_name ?? item.itemName ?? "Inventory item";
  const sku = item.sku ?? item.sku_code ?? item.skuCode ?? "";
  const categoryId = item.categoryId ?? item.category_id ?? categoryRecord.id ?? "";
  const categoryName = item.categoryName ?? item.category_name ?? categoryRecord.name ?? "";
  const categoryCode = item.categoryCode ?? item.category_code ?? categoryRecord.code ?? categoryRecord.category_code ?? "";
  const uomCode = item.unit ?? item.uomCode ?? item.uom_code ?? uomRecord.code ?? "";
  const photoUrl = item.photo_url ?? item.photoUrl ?? item.image_url ?? item.item_photo_url ?? item.photo ?? item.image ?? "";
  const rawCost = item.cost ?? item.defaultCost ?? item.default_cost ?? "";
  const cost = rawCost === "" || rawCost === null || rawCost === undefined ? "" : Number(rawCost);
  const description = item.description ?? "";
  const rawActiveFlag = item.isActive ?? item.is_active;
  const rawStatus = String(item.status ?? "").toLowerCase();
  // Preserve an explicitly archived lifecycle state. The active flag controls
  // availability, but must not relabel historical archived records as inactive.
  const status = rawStatus === "archived" ? "archived" : rawActiveFlag === false ? "inactive" : rawStatus || "active";
  const isActive = rawActiveFlag === false ? false : !["inactive", "archived", "deleted"].includes(status);
  const createdAt = item.createdAt ?? item.created_at ?? "";
  const updatedAt = item.updatedAt ?? item.updated_at ?? "";
  return {
    ...item,
    id,
    name,
    item_name: name,
    sku,
    sku_code: sku,
    description,
    categoryId,
    category_id: categoryId,
    categoryName,
    category_name: categoryName,
    categoryCode,
    category_code: categoryCode,
    unit: uomCode,
    uomCode,
    uom_code: uomCode,
    cost: Number.isFinite(cost) ? cost : "",
    defaultCost: Number.isFinite(cost) ? cost : "",
    costUpdatedAt: item.costUpdatedAt ?? item.cost_updated_at ?? "",
    cost_updated_at: item.costUpdatedAt ?? item.cost_updated_at ?? "",
    costUpdatedBy: item.costUpdatedBy ?? item.cost_updated_by ?? "",
    cost_updated_by: item.costUpdatedBy ?? item.cost_updated_by ?? "",
    status,
    isActive,
    is_active: isActive,
    photo: photoUrl,
    photo_url: photoUrl,
    linkedOutlets,
    linked_outlets: linkedOutlets,
    linkedOutletIds,
    linked_outlet_ids: linkedOutletIds,
    outletConfigs: linkedOutletIds.map((outletId) => buildOutletConfig(item, outletId, existingConfigs.get(outletId))),
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  };
}

export function getLinkedOutletIds(item = {}) {
  if (Array.isArray(item.linkedOutletIds)) return uniqueIds(item.linkedOutletIds);
  if (Array.isArray(item.linked_outlet_ids)) return uniqueIds(item.linked_outlet_ids);
  return uniqueIds([
    ...(item.linkedOutlets || []).map((outlet) => normalizeOutletRecord(outlet).id),
    ...(item.linked_outlets || []).map((outlet) => normalizeOutletRecord(outlet).id),
    ...(item.outletConfigs || []).map((config) => config.outletId),
    ...(item.outlet_configs || []).map((config) => config.outlet_id || config.outletId),
  ]);
}

export function uniqueIds(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function buildOutletConfig(item = {}, outletId, existing = {}) {
  const rawParLevel = existing.parLevel ?? existing.par_level ?? item.parLevel ?? item.par_level ?? null;
  const parLevel = rawParLevel === "" || rawParLevel === null || rawParLevel === undefined ? "" : Number(rawParLevel);
  return {
    id: existing.id || `${item.id || "draft"}_${outletId}`,
    inventoryItemId: existing.inventoryItemId || existing.inventory_item_id || item.id || "",
    outletId,
    parLevel,
    storageLocation: existing.storageLocation ?? existing.storage_location ?? "",
    supplierIds: uniqueIds(existing.supplierIds || existing.supplier_ids || []),
    isActive: existing.isActive ?? existing.is_active ?? true,
    createdAt: existing.createdAt || existing.created_at || item.createdAt || item.created_at || "",
    updatedAt: existing.updatedAt || existing.updated_at || item.updatedAt || item.updated_at || "",
  };
}

export function mapRemoteCategory(row = {}) {
  return {
    id: row.id,
    name: row.name || "Uncategorized",
    description: row.description || "",
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    status: row.status || "active",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || "",
  };
}

export function outletConfigForItem(item = {}, outletId) {
  if (!outletId) return buildOutletConfig(item, "");
  const existing = (item.outletConfigs || []).find((config) => config.outletId === outletId);
  return buildOutletConfig(item, outletId, existing);
}

export function isActiveInventoryItem(item = {}) {
  const normalized = normalizeInventoryItem(item);
  const status = String(normalized.status || "active").toLowerCase();
  return normalized.isActive !== false && !["inactive", "archived", "deleted"].includes(status);
}

export function categoryForItem(item = {}, categoryById = new Map()) {
  const category = categoryById.get(item.categoryId || item.category_id);
  if (category) return category;
  if (item.categoryName || item.category_name) {
    return {
      id: item.categoryId || item.category_id || canonical(item.categoryName || item.category_name) || "uncategorized",
      name: item.categoryName || item.category_name,
      code: item.categoryCode || item.category_code || "",
      sortOrder: 9999,
      status: "active",
    };
  }
  return null;
}

export function canonical(value = "") {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export function outletDisplayName(outlet = {}) {
  const normalized = normalizeOutletRecord(outlet);
  return normalized.name || normalized.code || normalized.id || "Unknown outlet";
}

export function outletDisplayCode(outlet = {}) {
  const normalized = normalizeOutletRecord(outlet);
  return normalized.code || normalized.name || normalized.id || "Outlet";
}
