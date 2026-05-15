import { supabase } from "../lib/supabase";

export const salesChannelService = {
  async listActiveSalesChannels() {
    const { data, error } = await supabase
      .from("sales_channels")
      .select("id,name,is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;

    return data ?? [];
  },
};
