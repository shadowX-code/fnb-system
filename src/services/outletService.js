import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

function mapOutlet(outlet) {
  const isActive = outlet.is_active ?? outlet.status !== "inactive";
  return {
    id: outlet.id,
    name: outlet.name,
    code: outlet.code ?? "",
    is_active: Boolean(isActive),
    status: isActive ? "active" : "inactive",
    location: outlet.location ?? outlet.address ?? "",
    address: outlet.address ?? outlet.location ?? "",
    created_at: outlet.created_at,
    updated_at: outlet.updated_at,
  };
}

export const outletService = {
  async listOutlets() {
    const { data, error } = await supabase
      .from("outlets")
      .select("id,name,code,is_active,status,location,address,created_at,updated_at")
      .order("name", { ascending: true });

    throwSupabaseError("outlets.list", error);
    return (data ?? []).map(mapOutlet);
  },

  async listActiveOutlets() {
    const { data, error } = await supabase
      .from("outlets")
      .select("id,name,code,is_active,status,location,address,created_at,updated_at")
      .eq("is_active", true)
      .order("name", { ascending: true });

    throwSupabaseError("outlets.list_active", error);

    return (data ?? []).map(mapOutlet);
  },

  async saveOutlet(outlet) {
    const payload = {
      name: outlet.name?.trim(),
      code: outlet.code?.trim() || null,
      location: outlet.location?.trim() || null,
      address: outlet.location?.trim() || outlet.address?.trim() || null,
      is_active: outlet.status ? outlet.status === "active" : outlet.is_active !== false,
      status: outlet.status ?? (outlet.is_active === false ? "inactive" : "active"),
      updated_at: new Date().toISOString(),
    };

    const query = outlet.id
      ? supabase.from("outlets").update(payload).eq("id", outlet.id)
      : supabase.from("outlets").insert(payload);

    const { data, error } = await query
      .select("id,name,code,is_active,status,location,address,created_at,updated_at")
      .single();

    throwSupabaseError("outlets.save", error);
    await auditLogService.createAuditLog({
      action: outlet.id ? "outlet_updated" : "outlet_created",
      module: "management",
      target: data.name,
      description: outlet.id ? "Outlet updated." : "Outlet created.",
      after: data,
    }).catch(() => {});
    console.info("[Supabase:outlets.save] Saved to Supabase", { outletId: data.id, name: data.name });
    return mapOutlet(data);
  },

  async deactivateOutlet(outlet) {
    return this.saveOutlet({ ...outlet, status: "inactive", is_active: false });
  },
};
