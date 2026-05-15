import { supabase } from "../lib/supabase";

export const purchaseCategoryService = {
  async listActivePurchaseCategories() {
    const { data, error } = await supabase
      .from("purchase_categories")
      .select("id,name,is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;

    return (data ?? []).map((category, index) => ({
      id: category.id,
      name: category.name,
      is_active: category.is_active,
      status: category.is_active ? "active" : "inactive",
      sort_order: index + 1,
    }));
  },
};
