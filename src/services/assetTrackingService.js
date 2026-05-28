import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

const categoryBaseFields = "id,name,description,sort_order,is_active,created_at,updated_at";
const categoryFields = "id,name,description,sort_order,is_active,maintenance_enabled,created_at,updated_at";
const assetBaseFields = "id,outlet_id,category_id,name,description,unit,current_quantity,minimum_quantity,status,remark,created_by,updated_by,created_at,updated_at,category:asset_categories(id,name)";
const assetBaseConditionFields = "id,outlet_id,category_id,name,description,condition,unit,current_quantity,minimum_quantity,status,remark,created_by,updated_by,created_at,updated_at,category:asset_categories(id,name)";
const assetFields = "id,outlet_id,category_id,name,description,image_url,thumbnail_url,health_status,last_inspection_at,maintenance_override,condition,unit,current_quantity,minimum_quantity,status,remark,created_by,updated_by,created_at,updated_at,category:asset_categories(id,name,maintenance_enabled)";
const movementFields = "id,asset_id,outlet_id,movement_type,quantity_change,quantity_before,quantity_after,reason,remark,movement_date,created_by,created_at";
const maintenanceFields = "id,asset_id,outlet_id,date,maintenance_type,priority,issue,action_taken,vendor,cost,status,scheduled_date,completed_date,next_service_date,remark,photo_url,created_by,created_at,updated_at";
const inspectionFields = "id,outlet_id,inspection_date,checked_by,category_scope,status,summary,notes,remark,created_by,current_step,completion_percentage,last_edited_at,last_edited_by,draft_data,auto_saved,created_at,updated_at";
const inspectionItemFields = "id,inspection_id,asset_id,expected_quantity,counted_quantity,expected_qty,counted_qty,difference,condition,condition_status,condition_template_id,evidence_required,evidence_status,remark,created_at,asset:asset_items(id,name,category:asset_categories(id,name))";
const conditionFields = "id,category_id,name,severity,color,requires_photo,requires_remark,affects_health,triggers_alert,active,sort_order,created_at,updated_at";
const evidenceFields = "id,inspection_item_id,image_url,caption,created_at";
const assetConditionValues = new Set(["healthy", "needs_attention", "under_maintenance", "low_quantity", "damaged", "missing", "disposed"]);

function normalizeConditionValue(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const aliases = {
    good: "healthy",
    active: "healthy",
    healthy: "healthy",
    needs_attention: "needs_attention",
    attention: "needs_attention",
    needs_review: "needs_attention",
    review: "needs_attention",
    need_repair: "needs_attention",
    need_repairs: "needs_attention",
    damaged: "damaged",
    missing: "missing",
    under_maintenance: "under_maintenance",
    maintenance: "under_maintenance",
    low_quantity: "low_quantity",
    low: "low_quantity",
    disposed: "disposed",
    inactive: "disposed",
  };
  const mapped = aliases[normalized] || normalized;
  if (!assetConditionValues.has(mapped)) {
    console.warn("[AssetTracking] Unknown asset condition normalized to healthy", { value });
    return "healthy";
  }
  return mapped;
}

function isDataUrl(value) {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(String(value || ""));
}

function dataUrlExtension(value) {
  const match = String(value || "").match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/);
  const type = match?.[1] || "png";
  if (type === "jpeg") return "jpg";
  return type.split("+")[0];
}

async function uploadAssetImageIfNeeded(asset, userId) {
  if (!isDataUrl(asset.image_url)) return asset.image_url ?? "";
  const extension = dataUrlExtension(asset.image_url);
  const path = `${asset.outlet_id || "outlet"}/${asset.id || crypto.randomUUID()}-${Date.now()}.${extension}`;
  console.info("[AssetTracking] Uploading asset photo", { path, assetName: asset.name });
  const response = await fetch(asset.image_url);
  const blob = await response.blob();
  const { data, error } = await supabase.storage
    .from("asset-photos")
    .upload(path, blob, {
      contentType: blob.type || `image/${extension}`,
      upsert: true,
      metadata: { uploaded_by: userId || "" },
    });
  if (error) {
    console.error("[AssetTracking] Asset photo upload failed", error);
    throw new Error("Unable to upload asset photo. Please try again.");
  }
  const { data: publicUrlData } = supabase.storage.from("asset-photos").getPublicUrl(data.path);
  console.info("[AssetTracking] Asset photo uploaded", { path: data.path, publicUrl: publicUrlData.publicUrl });
  return publicUrlData.publicUrl;
}

async function uploadMaintenancePhotoIfNeeded(record, userId) {
  if (!isDataUrl(record.photo_url)) return record.photo_url ?? "";
  const extension = dataUrlExtension(record.photo_url);
  const path = `maintenance/${record.outlet_id || "outlet"}/${record.asset_id || "asset"}-${Date.now()}.${extension}`;
  const response = await fetch(record.photo_url);
  const blob = await response.blob();
  const { data, error } = await supabase.storage
    .from("asset-photos")
    .upload(path, blob, {
      contentType: blob.type || `image/${extension}`,
      upsert: true,
      metadata: { uploaded_by: userId || "" },
    });
  if (error) {
    console.error("[AssetTracking] Maintenance photo upload failed", error);
    throw new Error("Unable to upload maintenance photo. Please try again.");
  }
  const { data: publicUrlData } = supabase.storage.from("asset-photos").getPublicUrl(data.path);
  return publicUrlData.publicUrl;
}

function mapCategory(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    sort_order: Number(row.sort_order ?? 0),
    is_active: row.is_active !== false,
    maintenance_enabled: row.maintenance_enabled === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapAsset(row) {
  const maintenanceOverride = ["inherit", "enabled", "disabled"].includes(row.maintenance_override) ? row.maintenance_override : "inherit";
  const categoryMaintenanceEnabled = row.category?.maintenance_enabled === true;
  return {
    id: row.id,
    outlet_id: row.outlet_id,
    category_id: row.category_id,
    category_name: row.category?.name ?? "",
    maintenance_enabled: categoryMaintenanceEnabled,
    maintenance_override: maintenanceOverride,
    maintenance_allowed: maintenanceOverride === "enabled" || (maintenanceOverride === "inherit" && categoryMaintenanceEnabled),
    name: row.name,
    description: row.description ?? "",
    image_url: row.image_url ?? "",
    thumbnail_url: row.thumbnail_url ?? row.image_url ?? "",
    health_status: row.health_status ?? "healthy",
    last_inspection_at: row.last_inspection_at ?? null,
    condition: normalizeConditionValue(row.condition ?? (["damaged", "missing", "disposed"].includes(row.status) ? row.status : "healthy")),
    unit: row.unit ?? "unit",
    current_quantity: Number(row.current_quantity ?? 0),
    minimum_quantity: Number(row.minimum_quantity ?? 0),
    status: row.status === "archived" || row.status === "inactive" ? "archived" : "active",
    remark: row.remark ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isMissingOptionalAssetField(error) {
  const message = String(error?.message || error?.details || "");
  return error?.code === "42703" ||
    error?.code === "PGRST204" ||
    /asset_items\.(image_url|thumbnail_url|health_status|last_inspection_at|condition|maintenance_override)|asset_categories\.maintenance_enabled|'(image_url|thumbnail_url|health_status|last_inspection_at|condition|maintenance_enabled|maintenance_override)' column|column .* does not exist|relationship .*maintenance_enabled/i.test(message);
}

function withoutOptionalAssetFields(payload) {
  const { image_url, thumbnail_url, health_status, last_inspection_at, condition, maintenance_override, ...rest } = payload;
  return rest;
}

function isMissingCategoryMaintenanceField(error) {
  const message = String(error?.message || error?.details || "");
  return error?.code === "42703" ||
    error?.code === "PGRST204" ||
    /asset_categories\.maintenance_enabled|'maintenance_enabled' column|column .*maintenance_enabled.* does not exist/i.test(message);
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

function mapMaintenanceRecord(row) {
  const normalizedStatus = ["scheduled", "in_progress", "completed"].includes(row.status) ? row.status : "scheduled";
  return {
    id: row.id,
    asset_id: row.asset_id,
    outlet_id: row.outlet_id,
    date: row.scheduled_date ?? row.completed_date ?? row.date,
    maintenance_type: row.maintenance_type ?? "repair",
    priority: row.priority ?? "medium",
    issue: row.issue ?? "",
    action_taken: row.action_taken ?? "",
    vendor: row.vendor ?? "",
    cost: Number(row.cost ?? 0),
    status: normalizedStatus,
    scheduled_date: row.scheduled_date ?? row.date ?? null,
    completed_date: row.completed_date ?? null,
    next_service_date: row.next_service_date ?? null,
    remark: row.remark ?? "",
    photo_url: row.photo_url ?? "",
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isMissingMaintenanceTable(error) {
  const message = String(error?.message || error?.details || "");
  return error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /asset_maintenance_records|maintenance_type|priority|scheduled_date|completed_date|next_service_date/i.test(message);
}

function mapInspection(row, items = []) {
  const fallbackAssetForItem = (item) => ({
    id: item.asset_id ?? "",
    name: "Unknown Asset",
    category: { id: null, name: "Uncategorized" },
    category_name: "Uncategorized",
  });
  const normalizedItems = (items ?? []).map((item) => ({
    ...item,
    asset: item.asset ?? fallbackAssetForItem(item),
    evidence: item.evidence ?? [],
    condition: normalizeConditionValue(item.condition ?? item.condition_status),
    condition_status: normalizeConditionValue(item.condition_status ?? item.condition),
  }));
  return {
    id: row.id,
    outlet_id: row.outlet_id,
    inspection_date: row.inspection_date,
    checked_by: row.checked_by ?? "",
    category_scope: row.category_scope ?? {},
    summary: row.summary ?? {},
    notes: row.notes ?? row.remark ?? "",
    status: row.status ?? "completed",
    current_step: Number(row.current_step ?? 1),
    completion_percentage: Number(row.completion_percentage ?? row.summary?.completion_percentage ?? 0),
    created_by: row.created_by ?? null,
    last_edited_at: row.last_edited_at ?? row.updated_at,
    last_edited_by: row.last_edited_by ?? row.created_by ?? null,
    draft_data: row.draft_data ?? {},
    auto_saved: row.auto_saved === true,
    remark: row.remark ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    items: normalizedItems,
  };
}

function inspectionSortTime(row) {
  const inspectionDate = row?.inspection_date ? new Date(row.inspection_date).getTime() : 0;
  const createdAt = row?.created_at ? new Date(row.created_at).getTime() : 0;
  const updatedAt = row?.updated_at ? new Date(row.updated_at).getTime() : 0;
  return {
    inspectionDate: Number.isNaN(inspectionDate) ? 0 : inspectionDate,
    createdAt: Number.isNaN(createdAt) ? 0 : createdAt,
    updatedAt: Number.isNaN(updatedAt) ? 0 : updatedAt,
  };
}

function sortInspectionsNewestFirst(first, second) {
  const firstTime = inspectionSortTime(first);
  const secondTime = inspectionSortTime(second);
  return secondTime.inspectionDate - firstTime.inspectionDate ||
    secondTime.createdAt - firstTime.createdAt ||
    secondTime.updatedAt - firstTime.updatedAt;
}

function mapConditionTemplate(row) {
  return {
    id: row.id,
    category_id: row.category_id,
    name: row.name,
    severity: row.severity ?? "healthy",
    color: row.color ?? "emerald",
    requires_photo: row.requires_photo === true,
    requires_remark: row.requires_remark === true,
    affects_health: row.affects_health === true,
    triggers_alert: row.triggers_alert === true,
    active: row.active !== false,
    sort_order: Number(row.sort_order ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isMissingInspectionV2Field(error) {
  const message = String(error?.message || error?.details || "");
  return error?.code === "42703" ||
    error?.code === "PGRST204" ||
    /asset_condition_templates|asset_inspection_evidence|condition_template_id|evidence_required|evidence_status|expected_qty|counted_qty|summary|notes|current_step|completion_percentage|last_edited_at|last_edited_by|draft_data|auto_saved|asset_inspection_items\.condition|'condition' column/i.test(message);
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
    if (error && isMissingCategoryMaintenanceField(error)) {
      console.warn("Asset category maintenance flag is not available yet. Loading categories without maintenance workflow metadata.", error);
      let fallbackQuery = supabase
        .from("asset_categories")
        .select(categoryBaseFields)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (!includeInactive) fallbackQuery = fallbackQuery.eq("is_active", true);
      const { data: fallbackData, error: fallbackError } = await fallbackQuery;
      throwSupabaseError("asset_categories.list", fallbackError);
      return (fallbackData ?? []).map(mapCategory);
    }
    throwSupabaseError("asset_categories.list", error);
    return (data ?? []).map(mapCategory);
  },

  async saveCategory(category) {
    const payload = {
      name: category.name,
      description: category.description ?? "",
      sort_order: Number(category.sort_order ?? 0),
      is_active: category.is_active !== false,
      maintenance_enabled: category.maintenance_enabled === true,
      updated_at: new Date().toISOString(),
    };
    const query = category.id
      ? supabase.from("asset_categories").update(payload).eq("id", category.id)
      : supabase.from("asset_categories").insert(payload);
    let { data, error } = await query.select(categoryFields).single();
    if (error && isMissingCategoryMaintenanceField(error)) {
      const { maintenance_enabled, ...fallbackPayload } = payload;
      const fallbackQuery = category.id
        ? supabase.from("asset_categories").update(fallbackPayload).eq("id", category.id)
        : supabase.from("asset_categories").insert(fallbackPayload);
      const fallbackResult = await fallbackQuery.select(categoryBaseFields).single();
      data = fallbackResult.data;
      error = fallbackResult.error;
    }
    throwSupabaseError("asset_categories.save", error);
    await logAssetAudit(category.id ? "asset_category_edited" : "asset_category_created", "-", data.name, data);
    return mapCategory(data);
  },

  async reorderCategories(categories) {
    const updates = categories.map((category, index) => ({
      id: category.id,
      sort_order: index + 1,
      updated_at: new Date().toISOString(),
    }));
    const results = await Promise.all(updates.map((update) => supabase
      .from("asset_categories")
      .update({ sort_order: update.sort_order, updated_at: update.updated_at })
      .eq("id", update.id)
      .select(categoryFields)
      .single()));
    const failed = results.find((result) => result.error);
    if (failed?.error) throwSupabaseError("asset_categories.reorder", failed.error);
    await logAssetAudit("asset_category_order_updated", "-", "Asset category order updated", { count: updates.length });
    return results.map((result) => mapCategory(result.data));
  },

  async archiveCategory(category) {
    const { count, error: countError } = await supabase
      .from("asset_items")
      .select("id", { count: "exact", head: true })
      .eq("category_id", category.id);
    throwSupabaseError("asset_categories.archive_count", countError);
    let { data, error } = await supabase
      .from("asset_categories")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", category.id)
      .select(categoryFields)
      .single();
    if (error && isMissingCategoryMaintenanceField(error)) {
      const fallbackResult = await supabase
        .from("asset_categories")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", category.id)
        .select(categoryBaseFields)
        .single();
      data = fallbackResult.data;
      error = fallbackResult.error;
    }
    throwSupabaseError("asset_categories.archive", error);
    await logAssetAudit("asset_category_deactivated", "-", data.name, { linked_assets: count ?? 0 });
    return mapCategory(data);
  },

  async listConditionTemplates(categoryId = "") {
    const fallback = [
      { name: "Good", severity: "healthy", color: "emerald", requires_photo: false, requires_remark: false, affects_health: false, triggers_alert: false, active: true, sort_order: 1 },
      { name: "Damaged", severity: "high", color: "orange", requires_photo: true, requires_remark: true, affects_health: true, triggers_alert: true, active: true, sort_order: 2 },
      { name: "Missing", severity: "critical", color: "rose", requires_photo: true, requires_remark: true, affects_health: true, triggers_alert: true, active: true, sort_order: 3 },
    ];
    let query = supabase
      .from("asset_condition_templates")
      .select(conditionFields)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (categoryId) query = query.eq("category_id", categoryId);
    const { data, error } = await query;
    if (error && isMissingInspectionV2Field(error)) {
      console.warn("Asset condition template table is not available yet. Using default inspection conditions.", error);
      return fallback.map((row, index) => ({ ...row, id: `fallback-${row.name.toLowerCase()}`, category_id: categoryId || "", sort_order: index + 1 }));
    }
    throwSupabaseError("asset_condition_templates.list", error);
    return (data ?? []).map(mapConditionTemplate);
  },

  async saveConditionTemplate(condition) {
    const payload = {
      category_id: condition.category_id,
      name: condition.name,
      severity: condition.severity ?? "healthy",
      color: condition.color ?? "emerald",
      requires_photo: condition.requires_photo === true,
      requires_remark: condition.requires_remark === true,
      affects_health: condition.affects_health === true,
      triggers_alert: condition.triggers_alert === true,
      active: condition.active !== false,
      sort_order: Number(condition.sort_order ?? 0),
      updated_at: new Date().toISOString(),
    };
    const query = condition.id && !String(condition.id).startsWith("fallback-")
      ? supabase.from("asset_condition_templates").update(payload).eq("id", condition.id)
      : supabase.from("asset_condition_templates").insert(payload);
    const { data, error } = await query.select(conditionFields).single();
    throwSupabaseError("asset_condition_templates.save", error);
    await logAssetAudit(condition.id ? "asset_condition_edited" : "asset_condition_created", "-", data.name, data);
    return mapConditionTemplate(data);
  },

  async listAssets(outletId = "") {
    let query = supabase
      .from("asset_items")
      .select(assetFields)
      .order("name", { ascending: true });
    if (outletId && outletId !== "all") query = query.eq("outlet_id", outletId);
    const { data, error } = await query;
    if (error && isMissingOptionalAssetField(error)) {
      console.warn("Asset image fields are not available yet. Loading assets without optional image metadata.", error);
      let fallbackQuery = supabase
        .from("asset_items")
        .select(assetBaseFields)
        .order("name", { ascending: true });
      if (outletId && outletId !== "all") fallbackQuery = fallbackQuery.eq("outlet_id", outletId);
      const { data: fallbackData, error: fallbackError } = await fallbackQuery;
      throwSupabaseError("asset_items.list", fallbackError);
      return (fallbackData ?? []).map(mapAsset).filter((asset) => asset.status !== "archived");
    }
    throwSupabaseError("asset_items.list", error);
    return (data ?? []).map(mapAsset).filter((asset) => asset.status !== "archived");
  },

  async saveAsset(asset) {
    const userId = await currentUserId();
    const imageUrl = await uploadAssetImageIfNeeded(asset, userId);
    const condition = normalizeConditionValue(asset.condition);
    console.info("[AssetTracking] Saving asset", { assetId: asset.id || "new", name: asset.name, condition, hasImage: Boolean(imageUrl) });
    const payload = {
      outlet_id: asset.outlet_id,
      category_id: asset.category_id,
      name: asset.name,
      description: asset.description ?? "",
      image_url: imageUrl,
      thumbnail_url: isDataUrl(asset.thumbnail_url) ? imageUrl : (asset.thumbnail_url ?? imageUrl),
      health_status: asset.health_status ?? "healthy",
      maintenance_override: ["inherit", "enabled", "disabled"].includes(asset.maintenance_override) ? asset.maintenance_override : "inherit",
      condition,
      unit: asset.unit || "unit",
      current_quantity: Number(asset.current_quantity ?? 0),
      minimum_quantity: Number(asset.minimum_quantity ?? 0),
      status: asset.status === "archived" ? "archived" : "active",
      remark: asset.remark ?? "",
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    if (!asset.id) payload.created_by = userId;
    const query = asset.id
      ? supabase.from("asset_items").update(payload).eq("id", asset.id)
      : supabase.from("asset_items").insert(payload);
    let { data, error } = await query.select(assetFields).single();
    if (error && isMissingOptionalAssetField(error)) {
      const fallbackPayload = withoutOptionalAssetFields(payload);
      const fallbackQuery = asset.id
        ? supabase.from("asset_items").update(fallbackPayload).eq("id", asset.id)
        : supabase.from("asset_items").insert(fallbackPayload);
      const fallbackResult = await fallbackQuery.select(assetBaseFields).single();
      data = fallbackResult.data;
      error = fallbackResult.error;
    }
    throwSupabaseError("asset_items.save", error);
    await logAssetAudit(asset.id ? "asset_edited" : "asset_created", data.outlet_id, data.name, data);
    return mapAsset(data);
  },

  async updateAssetCondition(asset, conditionValue) {
    const userId = await currentUserId();
    const condition = normalizeConditionValue(conditionValue);
    let { data, error } = await supabase
      .from("asset_items")
      .update({ condition, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", asset.id)
      .select(assetFields)
      .single();
    if (error && isMissingOptionalAssetField(error)) {
      const fallbackResult = await supabase
        .from("asset_items")
        .update({ condition, updated_by: userId, updated_at: new Date().toISOString() })
        .eq("id", asset.id)
        .select(assetBaseConditionFields)
        .single();
      data = fallbackResult.data;
      error = fallbackResult.error;
    }
    throwSupabaseError("asset_items.condition_update", error);
    await logAssetAudit("asset_condition_updated", data.outlet_id, data.name, { condition });
    return mapAsset(data);
  },

  async archiveAsset(asset) {
    const userId = await currentUserId();
    let { data, error } = await supabase
      .from("asset_items")
      .update({ status: "archived", updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", asset.id)
      .select(assetFields)
      .single();
    if (error && isMissingOptionalAssetField(error)) {
      const fallbackResult = await supabase
        .from("asset_items")
        .update({ status: "archived", updated_by: userId, updated_at: new Date().toISOString() })
        .eq("id", asset.id)
        .select(assetBaseFields)
        .single();
      data = fallbackResult.data;
      error = fallbackResult.error;
    }
    throwSupabaseError("asset_items.archive", error);
    await logAssetAudit("asset_edited", data.outlet_id, `${data.name} archived`, data);
    return mapAsset(data);
  },

  async listMovementLogs(assetId = "", outletId = "") {
    let query = supabase
      .from("asset_movement_logs")
      .select(movementFields)
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (assetId) query = query.eq("asset_id", assetId);
    if (outletId && outletId !== "all") query = query.eq("outlet_id", outletId);
    const { data, error } = await query;
    throwSupabaseError("asset_movement_logs.list", error);
    return (data ?? []).map(mapMovement);
  },

  async listMaintenanceRecords(assetId = "", outletId = "") {
    let query = supabase
      .from("asset_maintenance_records")
      .select(maintenanceFields)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });
    if (assetId) query = query.eq("asset_id", assetId);
    if (outletId && outletId !== "all") query = query.eq("outlet_id", outletId);
    const { data, error } = await query;
    if (error && isMissingMaintenanceTable(error)) {
      console.warn("Asset maintenance records table is not available yet.", error);
      return [];
    }
    throwSupabaseError("asset_maintenance_records.list", error);
    return (data ?? []).map(mapMaintenanceRecord);
  },

  async saveMaintenanceRecord(asset, record) {
    const userId = await currentUserId();
    const photoUrl = await uploadMaintenancePhotoIfNeeded({ ...record, asset_id: asset.id, outlet_id: asset.outlet_id }, userId);
    const status = ["scheduled", "in_progress", "completed"].includes(record.status) ? record.status : "scheduled";
    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      asset_id: asset.id,
      outlet_id: asset.outlet_id,
      date: status === "completed"
        ? (record.completed_date || record.date || today)
        : (record.scheduled_date || record.date || today),
      maintenance_type: record.maintenance_type || "repair",
      priority: record.priority || "medium",
      issue: record.issue ?? "",
      action_taken: record.action_taken ?? "",
      vendor: record.vendor ?? "",
      cost: Number(record.cost || 0),
      status,
      scheduled_date: status === "completed" ? null : (record.scheduled_date || record.date || today),
      completed_date: status === "completed" ? (record.completed_date || today) : null,
      next_service_date: status === "completed" ? (record.next_service_date || null) : null,
      remark: record.remark ?? "",
      photo_url: photoUrl,
      updated_at: new Date().toISOString(),
    };
    const query = record.id
      ? supabase.from("asset_maintenance_records").update(payload).eq("id", record.id)
      : supabase.from("asset_maintenance_records").insert({ ...payload, created_by: userId });
    const { data, error } = await query.select(maintenanceFields).single();
    throwSupabaseError("asset_maintenance_records.save", error);

    let updatedCondition = null;
    if (payload.status === "in_progress") updatedCondition = "under_maintenance";
    if (payload.status === "completed" && record.set_condition_good === true) updatedCondition = "healthy";
    if (updatedCondition) {
      const { error: assetError } = await supabase
        .from("asset_items")
        .update({ condition: updatedCondition, updated_by: userId, updated_at: new Date().toISOString() })
        .eq("id", asset.id);
      throwSupabaseError("asset_maintenance_records.asset_condition", assetError);
    }

    await logAssetAudit("asset_maintenance_record_created", asset.outlet_id, asset.name, payload);
    return { record: mapMaintenanceRecord(data), condition: updatedCondition };
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
    let { data: updatedAsset, error: assetError } = await supabase
      .from("asset_items")
      .update({ current_quantity: after, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", asset.id)
      .select(assetFields)
      .single();
    if (assetError && isMissingOptionalAssetField(assetError)) {
      const fallbackResult = await supabase
        .from("asset_items")
        .update({ current_quantity: after, updated_by: userId, updated_at: new Date().toISOString() })
        .eq("id", asset.id)
        .select(assetBaseFields)
        .single();
      updatedAsset = fallbackResult.data;
      assetError = fallbackResult.error;
    }
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

  async listInspections(assetId = "", outletId = "") {
    let inspectionQuery = supabase
      .from("asset_inspections")
      .select(inspectionFields)
      .order("inspection_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("updated_at", { ascending: false });
    if (outletId && outletId !== "all") inspectionQuery = inspectionQuery.eq("outlet_id", outletId);
    const { data: inspections, error } = await inspectionQuery;
    if (error && isMissingInspectionV2Field(error)) {
      let fallbackInspectionQuery = supabase
        .from("asset_inspections")
        .select("id,outlet_id,inspection_date,checked_by,category_scope,status,remark,created_at,updated_at")
        .order("inspection_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("updated_at", { ascending: false });
      if (outletId && outletId !== "all") fallbackInspectionQuery = fallbackInspectionQuery.eq("outlet_id", outletId);
      const { data: fallbackInspections, error: fallbackError } = await fallbackInspectionQuery;
      throwSupabaseError("asset_inspections.list", fallbackError);
      const { data: fallbackItems, error: fallbackItemError } = await supabase
        .from("asset_inspection_items")
        .select("id,inspection_id,asset_id,expected_quantity,counted_quantity,difference,condition_status,remark,created_at,asset:asset_items(id,name,category:asset_categories(id,name))")
        .order("created_at", { ascending: false });
      throwSupabaseError("asset_inspection_items.list", fallbackItemError);
      const filteredItems = assetId ? (fallbackItems ?? []).filter((item) => item.asset_id === assetId) : (fallbackItems ?? []);
      const itemIds = filteredItems.map((item) => item.id).filter(Boolean);
      if (itemIds.length) {
        const { data: evidenceRows, error: evidenceError } = await supabase
          .from("asset_inspection_evidence")
          .select(evidenceFields)
          .in("inspection_item_id", itemIds);
        if (evidenceError && !isMissingInspectionV2Field(evidenceError)) throwSupabaseError("asset_inspection_evidence.list", evidenceError);
        const evidenceByItem = new Map();
        (evidenceRows ?? []).forEach((evidence) => {
          evidenceByItem.set(evidence.inspection_item_id, [...(evidenceByItem.get(evidence.inspection_item_id) ?? []), evidence]);
        });
        filteredItems.forEach((item) => {
          item.evidence = evidenceByItem.get(item.id) ?? [];
        });
      }
      const inspectionIds = new Set(filteredItems.map((item) => item.inspection_id));
      return (fallbackInspections ?? [])
        .filter((inspection) => !assetId || inspectionIds.has(inspection.id))
        .map((inspection) => mapInspection(inspection, filteredItems.filter((item) => item.inspection_id === inspection.id)))
        .sort(sortInspectionsNewestFirst);
    }
    throwSupabaseError("asset_inspections.list", error);

    let { data: items, error: itemError } = await supabase
      .from("asset_inspection_items")
      .select(inspectionItemFields)
      .order("created_at", { ascending: false });
    if (itemError && isMissingInspectionV2Field(itemError)) {
      const fallbackResult = await supabase
        .from("asset_inspection_items")
        .select("id,inspection_id,asset_id,expected_quantity,counted_quantity,difference,condition_status,remark,created_at,asset:asset_items(id,name,category:asset_categories(id,name))")
        .order("created_at", { ascending: false });
      items = fallbackResult.data;
      itemError = fallbackResult.error;
    }
    throwSupabaseError("asset_inspection_items.list", itemError);
    const filteredItems = assetId ? (items ?? []).filter((item) => item.asset_id === assetId) : (items ?? []);
    const itemIds = filteredItems.map((item) => item.id).filter(Boolean);
    if (itemIds.length) {
      const { data: evidenceRows, error: evidenceError } = await supabase
        .from("asset_inspection_evidence")
        .select(evidenceFields)
        .in("inspection_item_id", itemIds);
      if (evidenceError && !isMissingInspectionV2Field(evidenceError)) throwSupabaseError("asset_inspection_evidence.list", evidenceError);
      const evidenceByItem = new Map();
      (evidenceRows ?? []).forEach((evidence) => {
        evidenceByItem.set(evidence.inspection_item_id, [...(evidenceByItem.get(evidence.inspection_item_id) ?? []), evidence]);
      });
      filteredItems.forEach((item) => {
        item.evidence = evidenceByItem.get(item.id) ?? [];
      });
    }
    const inspectionIds = new Set(filteredItems.map((item) => item.inspection_id));
    return (inspections ?? [])
      .filter((inspection) => !assetId || inspectionIds.has(inspection.id))
      .map((inspection) => mapInspection(inspection, filteredItems.filter((item) => item.inspection_id === inspection.id)))
      .sort(sortInspectionsNewestFirst);
  },

  async submitInspection({ draftId = "", outletId, inspectionDate, checkedBy, categoryScope, remark, notes, rows, summary = {}, status = "completed", currentStep = 4, draftData = {}, autoSaved = false, applyCorrections = true }) {
    const userId = await currentUserId();
    console.info("[AssetTracking] Submit inspection payload", {
      draftId,
      outletId,
      inspectionDate,
      status,
      rowCount: rows.length,
      conditions: rows.map((row) => normalizeConditionValue(row.condition_status || row.condition)),
      summary,
    });
    const inspectionPayload = {
        outlet_id: outletId,
        inspection_date: inspectionDate,
        created_by: userId,
        checked_by: checkedBy,
        category_scope: categoryScope,
        status,
        summary,
        current_step: currentStep,
        completion_percentage: Number(summary.completion_percentage ?? 0),
        last_edited_at: new Date().toISOString(),
        last_edited_by: userId,
        draft_data: draftData,
        auto_saved: autoSaved,
        notes: notes ?? remark ?? "",
        remark: remark ?? "",
    };
    let query = draftId
      ? supabase.from("asset_inspections").update(inspectionPayload).eq("id", draftId)
      : supabase.from("asset_inspections").insert(inspectionPayload);
    let { data: inspection, error } = await query.select(inspectionFields).single();
    if (error && isMissingInspectionV2Field(error)) {
      const fallbackPayload = {
          outlet_id: outletId,
          inspection_date: inspectionDate,
          checked_by: checkedBy,
          category_scope: categoryScope,
          status,
          remark: remark ?? notes ?? "",
      };
      const fallbackQuery = draftId
        ? supabase.from("asset_inspections").update(fallbackPayload).eq("id", draftId)
        : supabase.from("asset_inspections").insert(fallbackPayload);
      const fallbackResult = await fallbackQuery
        .select("id,outlet_id,inspection_date,checked_by,category_scope,status,remark,created_at,updated_at")
        .single();
      inspection = fallbackResult.data;
      error = fallbackResult.error;
    }
    throwSupabaseError("asset_inspections.insert", error);

    if (status === "draft" || status === "in_progress" || status === "pending_review") {
      await logAssetAudit(autoSaved ? "asset_inspection_auto_saved" : "asset_inspection_draft_saved", outletId, `${inspectionDate} inspection draft`, {
        items_checked: rows.length,
        completion_percentage: summary.completion_percentage ?? 0,
      });
      return mapInspection(inspection, []);
    }

    if (draftId) {
      const { error: deleteEvidenceError } = await supabase
        .from("asset_inspection_items")
        .delete()
        .eq("inspection_id", draftId);
      if (deleteEvidenceError && !isMissingInspectionV2Field(deleteEvidenceError)) {
        throwSupabaseError("asset_inspection_items.clear_draft", deleteEvidenceError);
      }
    }

    const submissionRows = (rows ?? []).filter((row) => row?.asset?.id || row?.asset_id);
    const itemPayload = submissionRows.map((row) => {
      const assetId = row.asset?.id ?? row.asset_id;
      const expectedQuantity = Number(row.asset?.current_quantity ?? row.expected_quantity ?? row.expected_qty ?? 0);
      const countedQuantity = Number(row.counted_quantity || 0);
      return {
        inspection_id: inspection.id,
        asset_id: assetId,
        expected_quantity: expectedQuantity,
        counted_quantity: countedQuantity,
        expected_qty: expectedQuantity,
        counted_qty: countedQuantity,
        difference: countedQuantity - expectedQuantity,
        condition: normalizeConditionValue(row.condition_status || row.condition || "healthy"),
        condition_status: normalizeConditionValue(row.condition_status || row.condition || "healthy"),
        condition_template_id: row.condition_template_id && !String(row.condition_template_id).startsWith("fallback-") ? row.condition_template_id : null,
        evidence_required: row.evidence_required === true,
        evidence_status: row.evidence_required ? ((row.evidence || []).length ? "complete" : "pending") : "not_required",
        remark: row.remark ?? "",
      };
    });
    let { data: savedItems, error: itemError } = await supabase
      .from("asset_inspection_items")
      .insert(itemPayload)
      .select(inspectionItemFields);
    console.info("[AssetTracking] Inspection item insert response", {
      inspectionId: inspection.id,
      rows: itemPayload.length,
      error,
      itemError,
      conditions: itemPayload.map((item) => item.condition_status),
    });
    if (itemError && isMissingInspectionV2Field(itemError)) {
      const fallbackPayload = itemPayload.map((item) => ({
        inspection_id: item.inspection_id,
        asset_id: item.asset_id,
        expected_quantity: item.expected_quantity,
        counted_quantity: item.counted_quantity,
        difference: item.difference,
        condition_status: item.condition_status,
        remark: item.remark,
      }));
      const fallbackResult = await supabase
        .from("asset_inspection_items")
        .insert(fallbackPayload)
        .select("id,inspection_id,asset_id,expected_quantity,counted_quantity,difference,condition_status,remark,created_at,asset:asset_items(id,name,category:asset_categories(id,name))");
      savedItems = fallbackResult.data;
      itemError = fallbackResult.error;
    }
    throwSupabaseError("asset_inspection_items.insert", itemError);

    const evidencePayload = [];
    for (const savedItem of savedItems ?? []) {
      const sourceRow = submissionRows.find((row) => (row.asset?.id ?? row.asset_id) === savedItem.asset_id);
      for (const evidence of sourceRow?.evidence ?? []) {
        evidencePayload.push({
          inspection_item_id: savedItem.id,
          image_url: evidence.image_url,
          caption: evidence.caption ?? "",
        });
      }
    }
    if (evidencePayload.length) {
      const { error: evidenceError } = await supabase
        .from("asset_inspection_evidence")
        .insert(evidencePayload);
      if (evidenceError && !isMissingInspectionV2Field(evidenceError)) {
        throwSupabaseError("asset_inspection_evidence.insert", evidenceError);
      }
    }

    if (applyCorrections) {
      for (const item of itemPayload) {
        const asset = submissionRows.find((row) => (row.asset?.id ?? row.asset_id) === item.asset_id)?.asset;
        if (!asset) continue;
        const assetUpdate = {
          current_quantity: item.counted_quantity,
          condition: normalizeConditionValue(item.condition_status),
          last_inspection_at: inspectionDate,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        };
        console.info("[AssetTracking] Updating asset from inspection", {
          assetId: item.asset_id,
          condition: assetUpdate.condition,
          countedQuantity: item.counted_quantity,
          difference: item.difference,
        });
        const { error: assetError } = await supabase
          .from("asset_items")
          .update(assetUpdate)
          .eq("id", item.asset_id);
        if (assetError && !isMissingOptionalAssetField(assetError)) throwSupabaseError("asset_items.inspection_correction", assetError);
        if (assetError && isMissingOptionalAssetField(assetError)) {
          const { error: fallbackAssetError } = await supabase
            .from("asset_items")
            .update({ current_quantity: item.counted_quantity, updated_by: userId, updated_at: new Date().toISOString() })
            .eq("id", item.asset_id);
          throwSupabaseError("asset_items.inspection_correction", fallbackAssetError);
        }
        if (item.difference === 0) continue;
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

  async updateInspectionStatus(inspectionId, status) {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from("asset_inspections")
      .update({
        status,
        last_edited_at: new Date().toISOString(),
        last_edited_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inspectionId)
      .select(inspectionFields)
      .single();
    throwSupabaseError("asset_inspections.status", error);
    await logAssetAudit(`asset_inspection_${status}`, data.outlet_id, `${data.inspection_date} inspection`, data);
    return mapInspection(data, []);
  },

  async deleteInspection(inspectionId) {
    const { error } = await supabase
      .from("asset_inspections")
      .delete()
      .eq("id", inspectionId);
    throwSupabaseError("asset_inspections.delete", error);
  },
};
