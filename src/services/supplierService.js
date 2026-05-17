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
    phone: supplier.phone ?? "",
    remark: supplier.remark ?? "",
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
      .select("id,name,category,default_category_id,phone,remark,is_active,status,created_at,updated_at")
      .order("name", { ascending: true });

    throwSupabaseError("suppliers.list", error);

    return (data ?? []).map(mapSupplier);
  },

  async listActiveSuppliers() {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id,name,category,default_category_id,phone,remark,is_active,status,created_at,updated_at")
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
      phone: supplier.phone?.trim() || null,
      remark: supplier.remark?.trim() || null,
      is_active: supplier.status ? supplier.status === "active" : supplier.is_active !== false,
      status: supplier.status ?? (supplier.is_active === false ? "inactive" : "active"),
      updated_at: new Date().toISOString(),
    };

    const query = supplier.id
      ? supabase.from("suppliers").update(payload).eq("id", supplier.id)
      : supabase.from("suppliers").insert(payload);

    const { data, error } = await query
      .select("id,name,category,default_category_id,phone,remark,is_active,status,created_at,updated_at")
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

  async setSupplierActive(supplier, isActive) {
    return this.saveSupplier({
      ...supplier,
      status: isActive ? "active" : "inactive",
      is_active: isActive,
    });
  },

  async getSupplierUsageMap(supplierIds = []) {
    if (!supplierIds.length) return {};

    const { data, error } = await supabase
      .from("purchase_records")
      .select("supplier_id,outlet_id,year,month,updated_at,created_at")
      .in("supplier_id", supplierIds);

    throwSupabaseError("suppliers.usage", error);

    const usageMap = Object.fromEntries(
      supplierIds.map((supplierId) => [
        supplierId,
        {
          outletIds: [],
          purchaseRecordCount: 0,
          latestPurchase: null,
        },
      ]),
    );

    (data ?? []).forEach((record) => {
      if (!record.supplier_id) return;
      const usage = usageMap[record.supplier_id] ?? {
        outletIds: [],
        purchaseRecordCount: 0,
        latestPurchase: null,
      };
      usage.purchaseRecordCount += 1;
      if (record.outlet_id && !usage.outletIds.includes(record.outlet_id)) {
        usage.outletIds.push(record.outlet_id);
      }

      const currentPeriodValue = Number(record.year || 0) * 100 + Number(record.month || 0);
      const latestPeriodValue = usage.latestPurchase
        ? Number(usage.latestPurchase.year || 0) * 100 + Number(usage.latestPurchase.month || 0)
        : -1;
      if (currentPeriodValue > latestPeriodValue) {
        usage.latestPurchase = {
          year: record.year,
          month: record.month,
          updated_at: record.updated_at ?? record.created_at,
        };
      }
      usageMap[record.supplier_id] = usage;
    });

    return usageMap;
  },

  async deleteSupplier(supplier) {
    const usageMap = await this.getSupplierUsageMap([supplier.id]);
    if ((usageMap[supplier.id]?.purchaseRecordCount ?? 0) > 0) {
      throw new Error("This supplier is already used in purchase records. Deactivate it instead.");
    }

    const { error } = await supabase
      .from("suppliers")
      .delete()
      .eq("id", supplier.id);

    throwSupabaseError("suppliers.delete", error);

    await auditLogService.createAuditLog({
      action: "supplier_deleted",
      module: "suppliers",
      target: supplier.name,
      description: "Supplier deleted.",
      before: supplier,
    }).catch(() => {});

    return true;
  },
};
