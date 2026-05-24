import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

const categoryFields = "id,name,description,sort_order,is_active,created_at,updated_at";
const assetFields = "id,outlet_id,category_id,name,description,unit,current_quantity,minimum_quantity,status,remark,created_by,updated_by,created_at,updated_at,category:asset_categories(id,name)";
const movementFields = "id,asset_id,outlet_id,movement_type,quantity_change,quantity_before,quantity_after,reason,remark,movement_date,created_by,created_at";
const inspectionFields = "id,outlet_id,inspection_date,checked_by,category_scope,status,remark,created_at,updated_at";
const inspectionItemFields = "id,inspection_id,asset_id,expected_quantity,counted_quantity,difference,condition_status,remark,created_at,asset:asset_items(id,name,category:asset_categories(id,name))";

function mapCategory(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    sort_order: Number(row.sort_order ?? 0),
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapAsset(row) {
  return {
    id: row.id,
    outlet_id: row.outlet_id,
    category_id: row.category_id,
    category_name: row.category?.name ?? "",
    name: row.name,
    description: row.description ?? "",
    unit: row.unit ?? "unit",
    current_quantity: Number(row.current_quantity ?? 0),
    minimum_quantity: Number(row.minimum_quantity ?? 0),
    status: row.status ?? "active",
    remark: row.remark ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapMovement(row) {
  return {
    id: row.id,
    asset_id: row.asset_id,
    outlet_id: row.outlet_id,
    movement_type: row.movement_type,
    quantity_change: Number(row.quantity_change ?? 0),
    quantity_before: Number(row.quantity_before ?? 0),
    quantity_after: Number(row.quantity_after ?? 0),
    reason: row.reason ?? "",
    remark: row.remark ?? "",
    movement_date: row.movement_date,
    created_at: row.created_at,
  };
}

function mapInspection(row, items = []) {
  return {
    id: row.id,
    outlet_id: row.outlet_id,
    inspection_date: row.inspection_date,
    checked_by: row.checked_by ?? "",
    category_scope: row.category_scope ?? {},
    status: row.status ?? "completed",
    remark: row.remark ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    items,
  };
}

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

async function logAssetAudit(action, outletId, target, after = {}) {
  await auditLogService.createAuditLog({
    action,
    module: "asset_tracking",
    target,
    description: target,
    outlet: outletId,
    after,
  }).catch(() => {});
}

export const assetTrackingService = {
  async listCategories({ includeInactive = true } = {}) {
    let query = supabase
      .from("asset_categories")
      .select(categoryFields)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (!includeInactive) query = query.eq("is_active", true);
    const { data, error } = await query;
    throwSupabaseError("asset_categories.list", error);
    return (data ?? []).map(mapCategory);
  },

  async saveCategory(category) {
    const payload = {
      name: category.name,
      description: category.description ?? "",
      sort_order: Number(category.sort_order ?? 0),
      is_active: category.is_active !== false,
      updated_at: new Date().toISOString(),
    };
    const query = category.id
      ? supabase.from("asset_categories").update(payload).eq("id", category.id)
      : supabase.from("asset_categories").insert(payload);
    const { data, error } = await query.select(categoryFields).single();
    throwSupabaseError("asset_categories.save", error);
    await logAssetAudit(category.id ? "asset_category_edited" : "asset_category_created", "-", data.name, data);
    return mapCategory(data);
  },

  async archiveCategory(category) {
    const { count, error: countError } = await supabase
      .from("asset_items")
      .select("id", { count: "exact", head: true })
      .eq("category_id", category.id);
    throwSupabaseError("asset_categories.archive_count", countError);
    const { data, error } = await supabase
      .from("asset_categories")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", category.id)
      .select(categoryFields)
      .single();
    throwSupabaseError("asset_categories.archive", error);
    await logAssetAudit("asset_category_deactivated", "-", data.name, { linked_assets: count ?? 0 });
    return mapCategory(data);
  },

  async listAssets(outletId = "") {
    let query = supabase
      .from("asset_items")
      .select(assetFields)
      .order("name", { ascending: true });
    if (outletId && outletId !== "all") query = query.eq("outlet_id", outletId);
    const { data, error } = await query;
    throwSupabaseError("asset_items.list", error);
    return (data ?? []).map(mapAsset);
  },

  async saveAsset(asset) {
    const userId = await currentUserId();
    const payload = {
      outlet_id: asset.outlet_id,
      category_id: asset.category_id,
      name: asset.name,
      description: asset.description ?? "",
      unit: asset.unit || "unit",
      current_quantity: Number(asset.current_quantity ?? 0),
      minimum_quantity: Number(asset.minimum_quantity ?? 0),
      status: asset.status ?? "active",
      remark: asset.remark ?? "",
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    if (!asset.id) payload.created_by = userId;
    const query = asset.id
      ? supabase.from("asset_items").update(payload).eq("id", asset.id)
      : supabase.from("asset_items").insert(payload);
    const { data, error } = await query.select(assetFields).single();
    throwSupabaseError("asset_items.save", error);
    await logAssetAudit(asset.id ? "asset_edited" : "asset_created", data.outlet_id, data.name, data);
    return mapAsset(data);
  },

  async archiveAsset(asset) {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from("asset_items")
      .update({ status: "inactive", updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", asset.id)
      .select(assetFields)
      .single();
    throwSupabaseError("asset_items.archive", error);
    await logAssetAudit("asset_edited", data.outlet_id, `${data.name} archived`, data);
    return mapAsset(data);
  },

  async listMovementLogs(assetId = "") {
    let query = supabase
      .from("asset_movement_logs")
      .select(movementFields)
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (assetId) query = query.eq("asset_id", assetId);
    const { data, error } = await query;
    throwSupabaseError("asset_movement_logs.list", error);
    return (data ?? []).map(mapMovement);
  },

  async adjustQuantity(asset, adjustment) {
    const quantity = Number(adjustment.quantity || 0);
    if (quantity <= 0) throw new Error("Enter a quantity greater than 0.");
    if (adjustment.type === "reduce" && !adjustment.reason) throw new Error("Select a reduce reason.");
    if (adjustment.reason === "other" && !String(adjustment.remark || "").trim()) throw new Error("Remark is required when reason is Other.");

    const before = Number(asset.current_quantity || 0);
    const after = adjustment.type === "add"
      ? before + quantity
      : adjustment.type === "reduce"
        ? before - quantity
        : quantity;
    if (after < 0) throw new Error("Quantity cannot be below 0.");

    const userId = await currentUserId();
    const { data: updatedAsset, error: assetError } = await supabase
      .from("asset_items")
      .update({ current_quantity: after, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", asset.id)
      .select(assetFields)
      .single();
    throwSupabaseError("asset_items.adjust_update", assetError);

    const movementPayload = {
      asset_id: asset.id,
      outlet_id: asset.outlet_id,
      movement_type: adjustment.type,
      quantity_change: adjustment.type === "reduce" ? -quantity : after - before,
      quantity_before: before,
      quantity_after: after,
      reason: adjustment.reason || adjustment.type,
      remark: adjustment.remark ?? "",
      movement_date: adjustment.date || new Date().toISOString().slice(0, 10),
      created_by: userId,
    };
    const { data: movement, error: movementError } = await supabase
      .from("asset_movement_logs")
      .insert(movementPayload)
      .select(movementFields)
      .single();
    throwSupabaseError("asset_movement_logs.adjust_insert", movementError);

    await logAssetAudit("asset_quantity_adjusted", asset.outlet_id, asset.name, movementPayload);
    return { asset: mapAsset(updatedAsset), movement: mapMovement(movement) };
  },

  async listInspections(assetId = "") {
    const { data: inspections, error } = await supabase
      .from("asset_inspections")
      .select(inspectionFields)
      .order("inspection_date", { ascending: false });
    throwSupabaseError("asset_inspections.list", error);

    const { data: items, error: itemError } = await supabase
      .from("asset_inspection_items")
      .select(inspectionItemFields)
      .order("created_at", { ascending: false });
    throwSupabaseError("asset_inspection_items.list", itemError);
    const filteredItems = assetId ? (items ?? []).filter((item) => item.asset_id === assetId) : (items ?? []);
    const inspectionIds = new Set(filteredItems.map((item) => item.inspection_id));
    return (inspections ?? [])
      .filter((inspection) => !assetId || inspectionIds.has(inspection.id))
      .map((inspection) => mapInspection(inspection, filteredItems.filter((item) => item.inspection_id === inspection.id)));
  },

  async submitInspection({ outletId, inspectionDate, checkedBy, categoryScope, remark, rows, applyCorrections = true }) {
    const userId = await currentUserId();
    const { data: inspection, error } = await supabase
      .from("asset_inspections")
      .insert({
        outlet_id: outletId,
        inspection_date: inspectionDate,
        checked_by: checkedBy,
        category_scope: categoryScope,
        status: "completed",
        remark: remark ?? "",
      })
      .select(inspectionFields)
      .single();
    throwSupabaseError("asset_inspections.insert", error);

    const itemPayload = rows.map((row) => ({
      inspection_id: inspection.id,
      asset_id: row.asset.id,
      expected_quantity: Number(row.asset.current_quantity || 0),
      counted_quantity: Number(row.counted_quantity || 0),
      difference: Number(row.counted_quantity || 0) - Number(row.asset.current_quantity || 0),
      condition_status: row.condition_status || "good",
      remark: row.remark ?? "",
    }));
    const { data: savedItems, error: itemError } = await supabase
      .from("asset_inspection_items")
      .insert(itemPayload)
      .select(inspectionItemFields);
    throwSupabaseError("asset_inspection_items.insert", itemError);

    if (applyCorrections) {
      for (const item of itemPayload.filter((entry) => entry.difference !== 0)) {
        const asset = rows.find((row) => row.asset.id === item.asset_id)?.asset;
        if (!asset) continue;
        const { error: assetError } = await supabase
          .from("asset_items")
          .update({ current_quantity: item.counted_quantity, updated_by: userId, updated_at: new Date().toISOString() })
          .eq("id", item.asset_id);
        throwSupabaseError("asset_items.inspection_correction", assetError);
        const { error: movementError } = await supabase.from("asset_movement_logs").insert({
          asset_id: item.asset_id,
          outlet_id: outletId,
          movement_type: "correction",
          quantity_change: item.difference,
          quantity_before: item.expected_quantity,
          quantity_after: item.counted_quantity,
          reason: "inspection",
          remark: `Inspection correction · ${inspectionDate}`,
          movement_date: inspectionDate,
          created_by: userId,
        });
        throwSupabaseError("asset_movement_logs.inspection_correction", movementError);
      }
    }

    await logAssetAudit("asset_inspection_submitted", outletId, `${inspectionDate} inspection`, {
      items_checked: rows.length,
      variance_count: itemPayload.filter((item) => item.difference !== 0).length,
      categories: categoryScope,
    });

    return mapInspection(inspection, savedItems ?? []);
  },
};
