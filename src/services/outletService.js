import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

function mapOutlet(outlet) {
  const isActive = outlet.is_active ?? outlet.status !== "inactive";
  return {
    id: outlet.id,
    name: outlet.name,
    code: outlet.code ?? "",
    public_feedback_token: outlet.public_feedback_token ?? "",
    logo_path: outlet.logo?.object_path ?? outlet.logo_path ?? "",
    logo_version: outlet.logo?.version ?? outlet.logo_version ?? "",
    is_active: Boolean(isActive),
    status: isActive ? "active" : "inactive",
    location: outlet.location ?? outlet.address ?? "",
    address: outlet.address ?? outlet.location ?? "",
    attendance_location_enabled: Boolean(outlet.attendance_location_enabled),
    attendance_latitude: outlet.attendance_latitude ?? "",
    attendance_longitude: outlet.attendance_longitude ?? "",
    attendance_radius_meters: outlet.attendance_radius_meters ?? 100,
    created_at: outlet.created_at,
    updated_at: outlet.updated_at,
  };
}

export const outletService = {
  logoPublicUrl(path, version) {
    if (!path) return "";
    const { data } = supabase.storage.from("outlet-logos").getPublicUrl(path);
    return data?.publicUrl ? `${data.publicUrl}?v=${version || ""}` : "";
  },

  async listOutlets() {
    const { data, error } = await supabase
      .from("outlets")
      .select("id,name,code,public_feedback_token,logo:outlet_logo_media!outlets_logo_media_id_fkey(object_path,updated_at),is_active,status,location,address,attendance_location_enabled,attendance_latitude,attendance_longitude,attendance_radius_meters,created_at,updated_at")
      .order("name", { ascending: true });

    throwSupabaseError("outlets.list", error);
    return (data ?? []).map(mapOutlet);
  },

  async listActiveOutlets() {
    const { data, error } = await supabase
      .from("outlets")
      .select("id,name,code,public_feedback_token,logo:outlet_logo_media!outlets_logo_media_id_fkey(object_path,updated_at),is_active,status,location,address,attendance_location_enabled,attendance_latitude,attendance_longitude,attendance_radius_meters,created_at,updated_at")
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
      attendance_location_enabled: outlet.attendance_location_enabled === true || outlet.attendance_location_enabled === "true",
      attendance_latitude: outlet.attendance_latitude === "" || outlet.attendance_latitude == null ? null : Number(outlet.attendance_latitude),
      attendance_longitude: outlet.attendance_longitude === "" || outlet.attendance_longitude == null ? null : Number(outlet.attendance_longitude),
      attendance_radius_meters: Number(outlet.attendance_radius_meters || 100),
      updated_at: new Date().toISOString(),
    };

    const query = outlet.id
      ? supabase.from("outlets").update(payload).eq("id", outlet.id)
      : supabase.from("outlets").insert(payload);

    const { data, error } = await query
      .select("id,name,code,public_feedback_token,logo:outlet_logo_media!outlets_logo_media_id_fkey(object_path,updated_at),is_active,status,location,address,attendance_location_enabled,attendance_latitude,attendance_longitude,attendance_radius_meters,created_at,updated_at")
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

  async uploadLogo(outletId, file) {
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error("Use a PNG, JPG, or WebP logo up to 2 MB.");
    const { data: prepared, error: prepareError } = await supabase.rpc("outlet_prepare_logo_upload", { p_outlet_id: outletId, p_filename: file.name, p_mime_type: file.type, p_size: file.size });
    throwSupabaseError("outlets.logo.prepare", prepareError);
    const { error: uploadError } = await supabase.storage.from(prepared.bucket).upload(prepared.object_path, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      await supabase.rpc("outlet_finalize_logo_remove", { p_media_id: prepared.id });
      throwSupabaseError("outlets.logo.upload", uploadError);
    }
    const { data, error } = await supabase.rpc("outlet_finalize_logo_upload", { p_media_id: prepared.id });
    throwSupabaseError("outlets.logo.finalize", error);
    return data;
  },

  async removeLogo(outletId) {
    const { data: prepared, error: prepareError } = await supabase.rpc("outlet_prepare_logo_remove", { p_outlet_id: outletId });
    throwSupabaseError("outlets.logo.remove", prepareError);
    if (!prepared?.removed) return prepared;
    const { error: deleteError } = await supabase.storage.from(prepared.bucket).remove([prepared.object_path]);
    throwSupabaseError("outlets.logo.delete", deleteError);
    const { error: finalizeError } = await supabase.rpc("outlet_finalize_logo_remove", { p_media_id: prepared.id });
    throwSupabaseError("outlets.logo.finalizeRemove", finalizeError);
    return prepared;
  },

  async deactivateOutlet(outlet) {
    return this.saveOutlet({ ...outlet, status: "inactive", is_active: false });
  },
};
