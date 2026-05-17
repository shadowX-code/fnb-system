import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

function salesKey(record) {
  return `${record.outlet_id}|${record.year}|${record.month}|${record.channel_id}`;
}

function purchaseKey(record) {
  return `${record.outlet_id}|${record.year}|${record.month}|${record.supplier_id}|${record.category_id}`;
}

function getPeriodRange(records) {
  const periods = records
    .map((record) => ({ year: Number(record.year), month: Number(record.month) }))
    .filter((period) => period.year && period.month)
    .sort((a, b) => (a.year - b.year) || (a.month - b.month));
  return {
    year: periods[0]?.year ?? null,
    month_start: periods[0]?.month ?? null,
    month_end: periods.at(-1)?.month ?? null,
  };
}

async function createImportBatch({ importType, fileName, records, createdCount, updatedCount, failedCount, warningCount }) {
  const range = getPeriodRange(records);
  const outletIds = [...new Set(records.map((record) => record.outlet_id).filter(Boolean))];
  const payload = {
    import_type: importType,
    outlet_id: outletIds.length === 1 ? outletIds[0] : null,
    year: range.year,
    month_start: range.month_start,
    month_end: range.month_end,
    source_filename: fileName,
    total_rows: records.length,
    created_count: createdCount,
    updated_count: updatedCount,
    failed_count: failedCount,
    warning_count: warningCount,
  };
  const { data, error } = await supabase
    .from("import_batches")
    .insert(payload)
    .select("id,import_type,outlet_id,year,month_start,month_end,source_filename,total_rows,created_count,updated_count,failed_count,warning_count,created_by,created_at")
    .single();

  throwSupabaseError("import_batches.insert", error);
  return data;
}

export const importService = {
  async listImportBatches() {
    const { data, error } = await supabase
      .from("import_batches")
      .select("id,import_type,outlet_id,year,month_start,month_end,source_filename,total_rows,created_count,updated_count,failed_count,warning_count,created_by,created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    throwSupabaseError("import_batches.list", error);
    return data ?? [];
  },

  async detectSalesConflicts(records) {
    const conflicts = new Map();
    const periods = [...new Set(records.map((record) => `${record.outlet_id}|${record.year}|${record.month}`))];

    for (const period of periods) {
      const [outletId, year, month] = period.split("|");
      const channelIds = [...new Set(records.filter((record) => record.outlet_id === outletId && String(record.year) === year && String(record.month) === month).map((record) => record.channel_id))];
      if (!channelIds.length) continue;
      const { data, error } = await supabase
        .from("sales_records")
        .select("id,outlet_id,year,month,channel_id,channel_name,amount,remark,created_at,updated_at")
        .eq("outlet_id", outletId)
        .eq("year", Number(year))
        .eq("month", Number(month))
        .in("channel_id", channelIds);
      throwSupabaseError("imports.sales_conflicts", error);
      (data ?? []).forEach((record) => conflicts.set(salesKey(record), record));
    }

    return conflicts;
  },

  async detectPurchaseConflicts(records) {
    const conflicts = new Map();
    const periods = [...new Set(records.map((record) => `${record.outlet_id}|${record.year}|${record.month}`))];

    for (const period of periods) {
      const [outletId, year, month] = period.split("|");
      const supplierIds = [...new Set(records.filter((record) => record.outlet_id === outletId && String(record.year) === year && String(record.month) === month).map((record) => record.supplier_id))];
      if (!supplierIds.length) continue;
      const { data, error } = await supabase
        .from("purchase_records")
        .select("id,outlet_id,year,month,supplier_id,supplier_name,category_id,category_name,amount,remark,created_at,updated_at")
        .eq("outlet_id", outletId)
        .eq("year", Number(year))
        .eq("month", Number(month))
        .in("supplier_id", supplierIds);
      throwSupabaseError("imports.purchase_conflicts", error);
      (data ?? []).forEach((record) => conflicts.set(purchaseKey(record), record));
    }

    return conflicts;
  },

  async importSales({ fileName, records, conflicts, failedCount = 0, warningCount = 0 }) {
    const savedRows = [];
    let createdCount = 0;
    let updatedCount = 0;

    for (const record of records) {
      const existing = conflicts.get(salesKey(record));
      if (existing) {
        const { data, error } = await supabase
          .from("sales_records")
          .update({ ...record, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .select("id,outlet_id,year,month,channel_id,channel_name,amount,remark,created_at,updated_at")
          .single();
        throwSupabaseError("imports.sales_update", error);
        savedRows.push(data);
        updatedCount += 1;
      } else {
        const { data, error } = await supabase
          .from("sales_records")
          .insert(record)
          .select("id,outlet_id,year,month,channel_id,channel_name,amount,remark,created_at,updated_at")
          .single();
        throwSupabaseError("imports.sales_insert", error);
        savedRows.push(data);
        createdCount += 1;
      }
    }

    const batch = await createImportBatch({ importType: "sales", fileName, records, createdCount, updatedCount, failedCount, warningCount });
    await auditLogService.createAuditLog({
      action: "sales_import_completed",
      module: "data-import",
      target: fileName,
      outlet: batch.outlet_id || "Multiple outlets",
      description: "Sales import completed.",
      after: { batch_id: batch.id, createdCount, updatedCount, failedCount, warningCount },
    }).catch(() => {});
    return { savedRows, batch, createdCount, updatedCount };
  },

  async importPurchases({ fileName, records, conflicts, failedCount = 0, warningCount = 0 }) {
    const savedRows = [];
    let createdCount = 0;
    let updatedCount = 0;

    for (const record of records) {
      const existing = conflicts.get(purchaseKey(record));
      if (existing) {
        const { data, error } = await supabase
          .from("purchase_records")
          .update({ ...record, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .select("id,outlet_id,year,month,supplier_id,supplier_name,category_id,category_name,amount,remark,created_at,updated_at")
          .single();
        throwSupabaseError("imports.purchase_update", error);
        savedRows.push(data);
        updatedCount += 1;
      } else {
        const { data, error } = await supabase
          .from("purchase_records")
          .insert(record)
          .select("id,outlet_id,year,month,supplier_id,supplier_name,category_id,category_name,amount,remark,created_at,updated_at")
          .single();
        throwSupabaseError("imports.purchase_insert", error);
        savedRows.push(data);
        createdCount += 1;
      }
    }

    const batch = await createImportBatch({ importType: "purchase", fileName, records, createdCount, updatedCount, failedCount, warningCount });
    await auditLogService.createAuditLog({
      action: "purchase_import_completed",
      module: "data-import",
      target: fileName,
      outlet: batch.outlet_id || "Multiple outlets",
      description: "Purchase import completed.",
      after: { batch_id: batch.id, createdCount, updatedCount, failedCount, warningCount },
    }).catch(() => {});
    return { savedRows, batch, createdCount, updatedCount };
  },
};
