import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

function mapSupplier(supplier) {
  const isActive = supplier.is_active ?? supplier.status !== "inactive";
  return {
    id: supplier.id,
    name: supplier.name,
    category: supplier.category,
    default_category_id: supplier.default_category_id ?? supplier.category_id ?? "",
    is_active: Boolean(isActive),
    status: isActive ? "active" : "inactive",
    created_at: supplier.created_at,
    updated_at: supplier.updated_at,
  };
}

export const supplierService = {
  async listSuppliers() {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id,name,category,default_category_id,is_active,status,created_at,updated_at")
      .order("name", { ascending: true });

    throwSupabaseError("suppliers.list", error);

    return (data ?? []).map(mapSupplier);
  },

  async listActiveSuppliers() {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id,name,category,default_category_id,is_active,status,created_at,updated_at")
      .eq("is_active", true)
      .order("name", { ascending: true });

    throwSupabaseError("suppliers.list_active", error);

    return (data ?? []).map(mapSupplier);
  },

  async saveSupplier(supplier) {
    const payload = {
      name: supplier.name?.trim(),
      category: supplier.category || null,
      default_category_id: supplier.default_category_id || null,
      is_active: supplier.status ? supplier.status === "active" : supplier.is_active !== false,
      status: supplier.status ?? (supplier.is_active === false ? "inactive" : "active"),
      updated_at: new Date().toISOString(),
    };

    const query = supplier.id
      ? supabase.from("suppliers").update(payload).eq("id", supplier.id)
      : supabase.from("suppliers").insert(payload);

    const { data, error } = await query
      .select("id,name,category,default_category_id,is_active,status,created_at,updated_at")
      .single();

    throwSupabaseError("suppliers.save", error);

    await auditLogService.createAuditLog({
      action: supplier.id ? "supplier_updated" : "supplier_created",
      module: "suppliers",
      target: data.name,
      description: supplier.id ? "Supplier updated." : "Supplier created.",
      after: data,
    }).catch(() => {});

    return mapSupplier(data);
  },

  async deactivateSupplier(supplier) {
    const saved = await this.saveSupplier({ ...supplier, status: "inactive", is_active: false });
    await auditLogService.createAuditLog({
      action: "supplier_deactivated",
      module: "suppliers",
      target: saved.name,
      description: "Supplier deactivated.",
      after: saved,
    }).catch(() => {});

    return saved;
  },
};
