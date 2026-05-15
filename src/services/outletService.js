import { supabase } from "../lib/supabase";

export const outletService = {
  async listActiveOutlets() {
    const { data, error } = await supabase
      .from("outlets")
      .select("id,name,code,is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;

    return (data ?? []).map((outlet) => ({
      id: outlet.id,
      name: outlet.name,
      code: outlet.code,
      is_active: outlet.is_active,
      status: outlet.is_active ? "active" : "inactive",
      location: "",
    }));
  },
};
