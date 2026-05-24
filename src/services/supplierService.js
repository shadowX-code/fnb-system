import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

const supplierSelect = "id,name,category,default_category_id,phone,remark,is_active,status,created_at,updated_at,supplier_outlets(outlet_id)";
const fallbackSupplierSelect = "id,name,category,default_category_id,is_active,status,created_at,updated_at";

export function formatSupplierName(name) {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function isMissingOptionalSupplierField(error) {
  return error?.code === "42703" && /suppliers\.(phone|remark)|column .*suppliers\.(phone|remark)|column .*phone|column .*remark/i.test(error.message ?? "");
}

function mapSupplier(supplier) {
  const isActive = supplier.is_active ?? supplier.status !== "inactive";
  return {
    id: supplier.id,
    name: supplier.name,
    category: supplier.category,
    default_category_id: supplier.default_category_id ?? supplier.category_id ?? "",
    phone: supplier.phone ?? "",
    remark: supplier.remark ?? "",
    outletIds: (supplier.supplier_outlets ?? []).map((row) => row.outlet_id).filter(Boolean),
    assignedOutletIds: (supplier.supplier_outlets ?? []).map((row) => row.outlet_id).filter(Boolean),
    is_active: Boolean(isActive),
    status: isActive ? "active" : "inactive",
    created_at: supplier.created_at,
    updated_at: supplier.updated_at,
  };
}

export const supplierService = {
  async listSuppliers() {
    const result = await supabase
      .from("suppliers")
      .select(supplierSelect)
      .order("name", { ascending: true });

    if (isMissingOptionalSupplierField(result.error)) {
      console.warn("[Supabase:suppliers.list] Optional phone/remark columns missing. Falling back until migration is applied.", result.error);
      const { data, error } = await supabase
        .from("suppliers")
        .select(fallbackSupplierSelect)
        .order("name", { ascending: true });
      throwSupabaseError("suppliers.list_fallback", error);
      return (data ?? []).map(mapSupplier);
    }

    const { data, error } = result;
    throwSupabaseError("suppliers.list", error);

    return (data ?? []).map(mapSupplier);
  },

  async listActiveSuppliers() {
    const result = await supabase
      .from("suppliers")
      .select(supplierSelect)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (isMissingOptionalSupplierField(result.error)) {
      console.warn("[Supabase:suppliers.list_active] Optional phone/remark columns missing. Falling back until migration is applied.", result.error);
      const { data, error } = await supabase
        .from("suppliers")
        .select(fallbackSupplierSelect)
        .eq("is_active", true)
        .order("name", { ascending: true });
      throwSupabaseError("suppliers.list_active_fallback", error);
      return (data ?? []).map(mapSupplier);
    }

    const { data, error } = result;
    throwSupabaseError("suppliers.list_active", error);

    return (data ?? []).map(mapSupplier);
  },

  async saveSupplier(supplier) {
    const outletIds = [...new Set((supplier.outletIds ?? supplier.assignedOutletIds ?? []).filter(Boolean))];
    if (!outletIds.length) throw new Error("Select at least one outlet for this supplier.");
    const payload = {
      name: formatSupplierName(supplier.name),
      category: supplier.category || null,
      default_category_id: supplier.default_category_id || null,
      phone: supplier.phone?.trim() || null,
      remark: supplier.remark?.trim() || null,
      is_active: supplier.status ? supplier.status === "active" : supplier.is_active !== false,
      status: supplier.status ?? (supplier.is_active === false ? "inactive" : "active"),
      updated_at: new Date().toISOString(),
    };

    async function executeSave(savePayload, selectColumns, scope) {
      const query = supplier.id
        ? supabase.from("suppliers").update(savePayload).eq("id", supplier.id)
        : supabase.from("suppliers").insert(savePayload);
      const { data, error } = await query.select(selectColumns).single();
      throwSupabaseError(scope, error);
      return data;
    }

    let data;
    try {
      data = await executeSave(payload, supplierSelect, "suppliers.save");
    } catch (error) {
      if (!isMissingOptionalSupplierField(error.cause)) throw error;
      console.warn("[Supabase:suppliers.save] Optional phone/remark columns missing. Saving base supplier fields until migration is applied.", error.cause);
      const { phone: _phone, remark: _remark, ...fallbackPayload } = payload;
      data = await executeSave(fallbackPayload, fallbackSupplierSelect, "suppliers.save_fallback");
    }

    await auditLogService.createAuditLog({
      action: supplier.id ? "supplier_updated" : "supplier_created",
      module: "suppliers",
      target: data.name,
      description: supplier.id ? "Supplier updated." : "Supplier created.",
      after: data,
    }).catch(() => {});

    const mapped = mapSupplier(data);
    await this.saveSupplierOutlets(mapped.id, outletIds);
    return { ...mapped, outletIds, assignedOutletIds: outletIds };
  },

  async saveSupplierOutlets(supplierId, outletIds = []) {
    const nextOutletIds = [...new Set(outletIds.filter(Boolean))];
    const { data: existingRows, error: existingError } = await supabase
      .from("supplier_outlets")
      .select("outlet_id")
      .eq("supplier_id", supplierId);
    throwSupabaseError("supplier_outlets.existing", existingError);

    const existingOutletIds = (existingRows ?? []).map((row) => row.outlet_id);
    const removedOutletIds = existingOutletIds.filter((outletId) => !nextOutletIds.includes(outletId));
    if (removedOutletIds.length) {
      const { data: linkedRecords, error: linkedError } = await supabase
        .from("purchase_records")
        .select("id,outlet_id")
        .eq("supplier_id", supplierId)
        .in("outlet_id", removedOutletIds)
        .limit(1);
      throwSupabaseError("supplier_outlets.removal_check", linkedError);
      if ((linkedRecords ?? []).length) {
        throw new Error("This supplier has purchase records in one of the selected outlets. Keep the outlet assigned and deactivate the supplier if needed.");
      }
      const { error: deleteError } = await supabase
        .from("supplier_outlets")
        .delete()
        .eq("supplier_id", supplierId)
        .in("outlet_id", removedOutletIds);
      throwSupabaseError("supplier_outlets.delete", deleteError);
    }

    const addedOutletIds = nextOutletIds.filter((outletId) => !existingOutletIds.includes(outletId));
    if (addedOutletIds.length) {
      const { error: insertError } = await supabase
        .from("supplier_outlets")
        .insert(addedOutletIds.map((outletId) => ({ supplier_id: supplierId, outlet_id: outletId })));
      throwSupabaseError("supplier_outlets.insert", insertError);
    }

    return nextOutletIds;
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

    const { data: assignmentRows, error: assignmentError } = await supabase
      .from("supplier_outlets")
      .select("supplier_id,outlet_id")
      .in("supplier_id", supplierIds);
    throwSupabaseError("suppliers.outlet_assignments", assignmentError);

    (assignmentRows ?? []).forEach((row) => {
      const usage = usageMap[row.supplier_id];
      if (usage && row.outlet_id && !usage.outletIds.includes(row.outlet_id)) {
        usage.outletIds.push(row.outlet_id);
      }
    });

    (data ?? []).forEach((record) => {
      if (!record.supplier_id) return;
      const usage = usageMap[record.supplier_id] ?? {
        outletIds: [],
        purchaseRecordCount: 0,
        latestPurchase: null,
      };
      usage.purchaseRecordCount += 1;
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
