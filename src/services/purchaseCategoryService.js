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
};
