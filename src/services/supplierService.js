import { supabase } from "../lib/supabase";

export const supplierService = {
  async listActiveSuppliers() {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id,name,category,is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;

    return data ?? [];
  },
};
