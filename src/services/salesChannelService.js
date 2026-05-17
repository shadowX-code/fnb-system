import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

function inferType(channel) {
  const normalized = String(channel.type || channel.name || "").toLowerCase();
  if (normalized.includes("total") || normalized.includes("net sales")) return "total";
  if (normalized.includes("sst") || normalized.includes("deduction") || normalized.includes("refund") || normalized.includes("commission")) return "adjustment";
  return channel.type || "channel";
}

function mapSalesChannel(channel, index = 0) {
  const isActive = channel.is_active ?? channel.status !== "inactive";
  return {
    id: channel.id,
    name: channel.name,
    type: inferType(channel),
    sort_order: channel.sort_order ?? index + 1,
    is_active: Boolean(isActive),
    status: isActive ? "active" : "inactive",
    created_at: channel.created_at,
    updated_at: channel.updated_at,
  };
}

export const salesChannelService = {
  async listSalesChannels() {
    const { data, error } = await supabase
      .from("sales_channels")
      .select("id,name,type,sort_order,is_active,status,created_at,updated_at")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    throwSupabaseError("sales_channels.list", error);
    return (data ?? []).map(mapSalesChannel);
  },

  async listActiveSalesChannels() {
    const { data, error } = await supabase
      .from("sales_channels")
      .select("id,name,type,sort_order,is_active,status,created_at,updated_at")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    throwSupabaseError("sales_channels.list_active", error);

    return (data ?? []).map(mapSalesChannel);
  },

  async saveSalesChannel(channel) {
    const payload = {
      name: channel.name?.trim(),
      type: channel.type || "channel",
      sort_order: Number(channel.sort_order) || 0,
      is_active: channel.status ? channel.status === "active" : channel.is_active !== false,
      status: channel.status ?? (channel.is_active === false ? "inactive" : "active"),
      updated_at: new Date().toISOString(),
    };
    const query = channel.id
      ? supabase.from("sales_channels").update(payload).eq("id", channel.id)
      : supabase.from("sales_channels").insert(payload);
    const { data, error } = await query
      .select("id,name,type,sort_order,is_active,status,created_at,updated_at")
      .single();
    throwSupabaseError("sales_channels.save", error);
    await auditLogService.createAuditLog({
      action: channel.id ? "sales_channel_updated" : "sales_channel_created",
      module: "sales-settings",
      target: data.name,
      description: channel.id ? "Sales channel updated." : "Sales channel created.",
      after: data,
    }).catch(() => {});
    return mapSalesChannel(data);
  },
};
