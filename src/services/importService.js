import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

function salesKey(record) {
  return `${record.outlet_id}|${record.year}|${record.month}|${record.channel_id}`;
}

function purchaseKey(record) {
  return `${record.outlet_id}|${record.year}|${record.month}|${record.supplier_id}|${record.category_id}`;
}

const purchaseRecordSelect = `
  id,
  outlet_id,
  year,
  month,
  supplier_id,
  category_id,
  amount,
  remark,
  created_at,
  updated_at,
  supplier:suppliers(id,name),
  category:purchase_categories(id,name)
`;

const importBatchSelect = `
  id,
  import_type,
  outlet_id,
  year,
  month_start,
  month_end,
  source_filename,
  total_rows,
  created_count,
  updated_count,
  failed_count,
  warning_count,
  status,
  created_by,
  imported_by,
  imported_at,
  completed_at,
  failure_reason,
  created_at
`;

function salesPayload(record) {
  return {
    outlet_id: record.outlet_id,
    year: Number(record.year),
    month: Number(record.month),
    channel_id: record.channel_id,
    channel_name: record.channel_name,
    amount: Number(record.amount) || 0,
    remark: record.remark ?? "",
    updated_at: new Date().toISOString(),
  };
}

function purchasePayload(record) {
  return {
    outlet_id: record.outlet_id,
    year: Number(record.year),
    month: Number(record.month),
    supplier_id: record.supplier_id,
    category_id: record.category_id,
    amount: Number(record.amount) || 0,
    remark: record.remark ?? "",
    updated_at: new Date().toISOString(),
  };
}

function mapPurchaseRecord(record) {
  return {
    id: record.id,
    outlet_id: record.outlet_id,
    year: record.year,
    month: record.month,
    supplier_id: record.supplier_id,
    supplier_name: record.supplier?.name ?? "",
    category_id: record.category_id,
    category_name: record.category?.name ?? "",
    amount: record.amount,
    remark: record.remark,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
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

function isMissingImportInfrastructure(error) {
  return error?.code === "42P01" || error?.code === "42703";
}

function isLocalBatch(batch) {
  return String(batch?.id ?? "").startsWith("local-");
}

async function createImportBatch({ importType, fileName, records, createdCount, updatedCount, failedCount, warningCount, status = "pending" }) {
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
    status,
    imported_at: null,
    completed_at: null,
  };
  const { data, error } = await supabase
    .from("import_batches")
    .insert(payload)
    .select(importBatchSelect)
    .single();

  if (isMissingImportInfrastructure(error)) {
    console.warn("[Supabase:import_batches.insert] import batch schema is missing or outdated. Import will continue without persisted batch history.", error);
    return {
      id: `local-${Date.now()}`,
      ...payload,
      created_by: null,
      created_at: new Date().toISOString(),
      migration_warning: "Import batch schema is missing or outdated. Apply migration 202605180001_import_integrity_safety.sql.",
    };
  }

  throwSupabaseError("import_batches.insert", error);
  return data;
}

async function updateImportBatch(batch, patch) {
  if (!batch?.id || isLocalBatch(batch)) return { ...batch, ...patch };
  const { data, error } = await supabase
    .from("import_batches")
    .update(patch)
    .eq("id", batch.id)
    .select(importBatchSelect)
    .single();

  if (isMissingImportInfrastructure(error)) {
    console.warn("[Supabase:import_batches.update] import batch schema is missing or outdated. Import will continue without persisted batch status.", error);
    return { ...batch, ...patch };
  }

  throwSupabaseError("import_batches.update", error);
  return data;
}

async function insertImportBatchRows(batch, rows) {
  if (!batch?.id || isLocalBatch(batch) || !rows.length) return;
  const payload = rows.map((row) => ({
    batch_id: batch.id,
    source_row: Number.isFinite(Number(row.source_row)) ? Number(row.source_row) : null,
    raw_row: row.raw_row ?? null,
    action: row.action,
    validation_result: row.validation_result,
    imported_record_id: row.imported_record_id ?? null,
    failure_reason: row.failure_reason ?? null,
  }));
  const { error } = await supabase.from("import_batch_rows").insert(payload);
  if (isMissingImportInfrastructure(error)) {
    console.warn("[Supabase:import_batch_rows.insert] import_batch_rows table is missing. Apply Sprint 4C migration to persist row-level import reports.", error);
    return;
  }
  throwSupabaseError("import_batch_rows.insert", error);
}

function buildRowDetails({ batch, records, savedRows, conflicts, keyFn, skippedRows = [], failedRows = [] }) {
  const savedByKey = new Map(savedRows.map((row) => [keyFn(row), row]));
  const importedRows = records.map((record) => {
    const key = keyFn(record);
    const saved = savedByKey.get(key);
    return {
      batch_id: batch.id,
      source_row: record.sourceRow,
      raw_row: record.rawRow ?? record,
      action: conflicts.has(key) ? "update" : "create",
      validation_result: saved ? "success" : "failed",
      imported_record_id: saved?.id ?? null,
      failure_reason: saved ? null : "Imported record was not returned by post-import verification.",
    };
  });
  const skipped = skippedRows.map((row) => ({
    batch_id: batch.id,
    source_row: row.row,
    raw_row: row.rawRow ?? null,
    action: "skip",
    validation_result: "skipped",
    failure_reason: row.message ?? "Skipped during import preview.",
  }));
  const failed = failedRows.map((row) => ({
    batch_id: batch.id,
    source_row: row.row,
    raw_row: row.rawRow ?? null,
    action: "failed",
    validation_result: "failed",
    failure_reason: row.message ?? "Validation failed.",
  }));
  return [...importedRows, ...skipped, ...failed];
}

function verifySavedRows(records, savedRows, keyFn) {
  const savedKeys = new Set(savedRows.map(keyFn));
  const missingKeys = records.filter((record) => !savedKeys.has(keyFn(record)));
  if (missingKeys.length) {
    throw new Error(`Post-import verification failed for ${missingKeys.length} row(s). No partial silent success was recorded.`);
  }
}

async function detectSalesConflictsForRecords(records) {
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
}

async function detectPurchaseConflictsForRecords(records) {
  const conflicts = new Map();
  const recordsWithSupplierIds = records.filter((record) => record.supplier_id && !String(record.supplier_id).startsWith("__new__:"));
  const periods = [...new Set(recordsWithSupplierIds.map((record) => `${record.outlet_id}|${record.year}|${record.month}`))];

  for (const period of periods) {
    const [outletId, year, month] = period.split("|");
    const supplierIds = [...new Set(recordsWithSupplierIds.filter((record) => record.outlet_id === outletId && String(record.year) === year && String(record.month) === month).map((record) => record.supplier_id))];
    if (!supplierIds.length) continue;
    const { data, error } = await supabase
      .from("purchase_records")
      .select(purchaseRecordSelect)
      .eq("outlet_id", outletId)
      .eq("year", Number(year))
      .eq("month", Number(month))
      .in("supplier_id", supplierIds);
    throwSupabaseError("imports.purchase_conflicts", error);
    (data ?? []).map(mapPurchaseRecord).forEach((record) => conflicts.set(purchaseKey(record), record));
  }

  return conflicts;
}

export const importService = {
  async listImportBatches() {
    const { data, error } = await supabase
      .from("import_batches")
      .select(importBatchSelect)
      .order("created_at", { ascending: false })
      .limit(50);

    if (isMissingImportInfrastructure(error)) {
      console.warn("[Supabase:import_batches.list] import batch schema is missing or outdated. Apply import batch migration to enable import history.", error);
      return [];
    }

    throwSupabaseError("import_batches.list", error);
    return data ?? [];
  },

  async listImportBatchRows(batchId) {
    if (!batchId || isLocalBatch({ id: batchId })) return [];
    const { data, error } = await supabase
      .from("import_batch_rows")
      .select("id,batch_id,source_row,raw_row,action,validation_result,imported_record_id,failure_reason,created_at")
      .eq("batch_id", batchId)
      .order("source_row", { ascending: true });

    if (isMissingImportInfrastructure(error)) {
      console.warn("[Supabase:import_batch_rows.list] import_batch_rows table is missing. Apply import history migration to enable row-level import details.", error);
      return [];
    }

    throwSupabaseError("import_batch_rows.list", error);
    return data ?? [];
  },

  async detectSalesConflicts(records) {
    return detectSalesConflictsForRecords(records);
  },

  async detectPurchaseConflicts(records) {
    return detectPurchaseConflictsForRecords(records);
  },

  async importSales({ fileName, records, conflicts, failedRows = [], skippedRows = [], warningCount = 0 }) {
    const createdCount = records.filter((record) => !conflicts.has(salesKey(record))).length;
    const updatedCount = records.length - createdCount;
    let batch = await createImportBatch({
      importType: "sales",
      fileName,
      records,
      createdCount,
      updatedCount,
      failedCount: failedRows.length,
      warningCount,
      status: "pending",
    });

    try {
      batch = await updateImportBatch(batch, { status: "validating" });
      const { data, error } = await supabase
        .from("sales_records")
        .upsert(records.map(salesPayload), { onConflict: "outlet_id,year,month,channel_id" })
        .select("id,outlet_id,year,month,channel_id,channel_name,amount,remark,created_at,updated_at");
      throwSupabaseError("imports.sales_upsert", error);
      const savedRows = data ?? [];
      verifySavedRows(records, savedRows, salesKey);
      const persistedRows = [...(await detectSalesConflictsForRecords(records)).values()];
      verifySavedRows(records, persistedRows, salesKey);
      await insertImportBatchRows(batch, buildRowDetails({ batch, records, savedRows, conflicts, keyFn: salesKey, skippedRows, failedRows }));
      batch = await updateImportBatch(batch, {
        status: failedRows.length ? "partial_failed" : "completed",
        imported_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      await auditLogService.createAuditLog({
        action: "sales_import_completed",
        module: "sales",
        target: fileName,
        outlet: batch.outlet_id || "Multiple outlets",
        description: "Sales import completed.",
        after: { batch_id: batch.id, createdCount, updatedCount, failedCount: failedRows.length, warningCount },
      }).catch(() => {});
      return { savedRows, batch, createdCount, updatedCount };
    } catch (error) {
      await updateImportBatch(batch, {
        status: "failed",
        imported_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        failure_reason: error.message,
      }).catch(() => {});
      await insertImportBatchRows(batch, records.map((record) => ({
        source_row: record.sourceRow,
        raw_row: record.rawRow ?? record,
        action: conflicts.has(salesKey(record)) ? "update" : "create",
        validation_result: "failed",
        failure_reason: error.message,
      }))).catch(() => {});
      await auditLogService.createAuditLog({
        action: "sales_import_failed",
        module: "sales",
        target: fileName,
        description: error.message,
        after: { batch_id: batch.id, createdCount, updatedCount, failedCount: records.length, warningCount },
      }).catch(() => {});
      throw error;
    }
  },

  async importPurchases({ fileName, records, conflicts, failedRows = [], skippedRows = [], warningCount = 0 }) {
    const createdCount = records.filter((record) => !conflicts.has(purchaseKey(record))).length;
    const updatedCount = records.length - createdCount;
    let batch = await createImportBatch({
      importType: "purchase",
      fileName,
      records,
      createdCount,
      updatedCount,
      failedCount: failedRows.length,
      warningCount,
      status: "pending",
    });

    try {
      batch = await updateImportBatch(batch, { status: "validating" });
      const { data, error } = await supabase
        .from("purchase_records")
        .upsert(records.map(purchasePayload), { onConflict: "outlet_id,year,month,supplier_id,category_id" })
        .select(purchaseRecordSelect);
      throwSupabaseError("imports.purchase_upsert", error);
      const savedRows = (data ?? []).map(mapPurchaseRecord);
      verifySavedRows(records, savedRows, purchaseKey);
      const persistedRows = [...(await detectPurchaseConflictsForRecords(records)).values()];
      verifySavedRows(records, persistedRows, purchaseKey);
      await insertImportBatchRows(batch, buildRowDetails({ batch, records, savedRows, conflicts, keyFn: purchaseKey, skippedRows, failedRows }));
      batch = await updateImportBatch(batch, {
        status: failedRows.length ? "partial_failed" : "completed",
        imported_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      await auditLogService.createAuditLog({
        action: "purchase_import_completed",
        module: "purchases",
        target: fileName,
        outlet: batch.outlet_id || "Multiple outlets",
        description: "Purchase import completed.",
        after: { batch_id: batch.id, createdCount, updatedCount, failedCount: failedRows.length, warningCount },
      }).catch(() => {});
      return { savedRows, batch, createdCount, updatedCount };
    } catch (error) {
      await updateImportBatch(batch, {
        status: "failed",
        imported_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        failure_reason: error.message,
      }).catch(() => {});
      await insertImportBatchRows(batch, records.map((record) => ({
        source_row: record.sourceRow,
        raw_row: record.rawRow ?? record,
        action: conflicts.has(purchaseKey(record)) ? "update" : "create",
        validation_result: "failed",
        failure_reason: error.message,
      }))).catch(() => {});
      await auditLogService.createAuditLog({
        action: "purchase_import_failed",
        module: "purchases",
        target: fileName,
        description: error.message,
        after: { batch_id: batch.id, createdCount, updatedCount, failedCount: records.length, warningCount },
      }).catch(() => {});
      throw error;
    }
  },
};
