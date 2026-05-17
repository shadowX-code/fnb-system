import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

function mapPurchaseCategory(category, index = 0) {
  const isActive = category.is_active ?? category.status !== "inactive";
  return {
    id: category.id,
    name: category.name,
    sort_order: category.sort_order ?? index + 1,
    is_active: Boolean(isActive),
    status: isActive ? "active" : "inactive",
    created_at: category.created_at,
    updated_at: category.updated_at,
  };
}

export const purchaseCategoryService = {
  async listPurchaseCategories() {
    const { data, error } = await supabase
      .from("purchase_categories")
      .select("id,name,sort_order,is_active,status,created_at,updated_at")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    throwSupabaseError("purchase_categories.list", error);

    return (data ?? []).map(mapPurchaseCategory);
  },

  async listActivePurchaseCategories() {
    const { data, error } = await supabase
      .from("purchase_categories")
      .select("id,name,sort_order,is_active,status,created_at,updated_at")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    throwSupabaseError("purchase_categories.list_active", error);

    return (data ?? []).map(mapPurchaseCategory);
  },

  async savePurchaseCategory(category) {
    const payload = {
      name: category.name?.trim(),
      sort_order: Number(category.sort_order) || 0,
      is_active: category.status ? category.status === "active" : category.is_active !== false,
      status: category.status ?? (category.is_active === false ? "inactive" : "active"),
      updated_at: new Date().toISOString(),
    };

    const query = category.id
      ? supabase.from("purchase_categories").update(payload).eq("id", category.id)
      : supabase.from("purchase_categories").insert(payload);

    const { data, error } = await query
      .select("id,name,sort_order,is_active,status,created_at,updated_at")
      .single();

    throwSupabaseError("purchase_categories.save", error);

    await auditLogService.createAuditLog({
      action: category.id ? "purchase_category_updated" : "purchase_category_created",
      module: "purchase-categories",
      target: data.name,
      description: category.id ? "Purchase category updated." : "Purchase category created.",
      after: data,
    }).catch(() => {});

    return mapPurchaseCategory(data);
  },

  async getPurchaseCategoryUsage(categoryId) {
    const [supplierResult, purchaseResult] = await Promise.all([
      supabase
        .from("suppliers")
        .select("id", { count: "exact", head: true })
        .eq("default_category_id", categoryId)
        .eq("is_active", true),
      supabase
        .from("purchase_records")
        .select("id", { count: "exact", head: true })
        .eq("category_id", categoryId),
    ]);

    throwSupabaseError("purchase_categories.usage.suppliers", supplierResult.error);
    throwSupabaseError("purchase_categories.usage.purchase_records", purchaseResult.error);

    const activeSupplierCount = supplierResult.count ?? 0;
    const purchaseRecordCount = purchaseResult.count ?? 0;

    return {
      activeSupplierCount,
      purchaseRecordCount,
      isInUse: activeSupplierCount > 0 || purchaseRecordCount > 0,
    };
  },

  async getPurchaseCategoryUsageMap(categoryIds = []) {
    const entries = await Promise.all(
      categoryIds.map(async (categoryId) => [categoryId, await this.getPurchaseCategoryUsage(categoryId)]),
    );
    return Object.fromEntries(entries);
  },

  async updatePurchaseCategorySortOrder(categories = []) {
    const updates = categories.map((category, index) => ({
      id: category.id,
      sort_order: index + 1,
      updated_at: new Date().toISOString(),
    }));

    for (const update of updates) {
      const { error } = await supabase
        .from("purchase_categories")
        .update({ sort_order: update.sort_order, updated_at: update.updated_at })
        .eq("id", update.id);

      throwSupabaseError("purchase_categories.reorder", error);
    }

    await auditLogService.createAuditLog({
      action: "purchase_category_reordered",
      module: "purchase-categories",
      target: "Purchase Categories",
      description: "Purchase category sort order updated.",
      after: updates,
    }).catch(() => {});

    return this.listPurchaseCategories();
  },

  async setPurchaseCategoryActive(category, isActive) {
    return this.savePurchaseCategory({
      ...category,
      status: isActive ? "active" : "inactive",
      is_active: isActive,
    });
  },

  async deletePurchaseCategory(category) {
    const usage = await this.getPurchaseCategoryUsage(category.id);
    if (usage.isInUse) {
      throw new Error("This category is in use. Deactivate it instead.");
    }

    const { error } = await supabase
      .from("purchase_categories")
      .delete()
      .eq("id", category.id);

    throwSupabaseError("purchase_categories.delete", error);

    await auditLogService.createAuditLog({
      action: "purchase_category_deleted",
      module: "purchase-categories",
      target: category.name,
      description: "Purchase category deleted.",
      before: category,
    }).catch(() => {});

    return true;
  },
};
