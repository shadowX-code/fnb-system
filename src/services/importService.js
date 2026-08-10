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

const importTypeAliases = {
  sales: ["sales", "sale", "Sales", "Sales Input", "sales input", "sales_input"],
  purchase: ["purchase", "purchases", "Purchase", "Purchases", "Purchase Input", "purchase input", "purchase_input"],
};

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

function buildHistoryRawRow(record) {
  const raw = record.rawRow && typeof record.rawRow === "object" ? { ...record.rawRow } : {};
  if (record.channel_name) {
    return {
      ...raw,
      Outlet: record.outletCode || record.outletName || raw.Outlet || "",
      Month: record.month ?? raw.Month ?? "",
      Year: record.year ?? raw.Year ?? "",
      Channel: record.channel_name,
      Amount: record.amount,
      imported_channel: record.channel_name,
      imported_amount: record.amount,
    };
  }
  if (record.supplier_name || record.category_name) {
    return {
      ...raw,
      Outlet: record.outletCode || record.outletName || raw.Outlet || "",
      Month: record.month ?? raw.Month ?? "",
      Year: record.year ?? raw.Year ?? "",
      Supplier: record.supplier_name || raw.Supplier || "",
      Category: record.category_name || raw.Category || "",
      Amount: record.amount,
      imported_amount: record.amount,
    };
  }
  return raw;
}

function importRequestId(value) {
  if (value) return value;
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `import-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function importRequestPayload(importType, fileName, records) {
  const range = getPeriodRange(records);
  const outletIds = [...new Set(records.map((record) => record.outlet_id).filter(Boolean))];
  return {
    outlet_id: outletIds.length === 1 ? outletIds[0] : null,
    year: range.year,
    month_start: range.month_start,
    month_end: range.month_end,
    source_filename: fileName,
    targets: records.map((record) => (importType === "sales"
      ? [record.outlet_id, Number(record.year), Number(record.month), record.channel_id]
      : [record.outlet_id, Number(record.year), Number(record.month), record.supplier_name, record.category_name])),
  };
}

async function importTrustedRows({ importType, fileName, records, requestId: suppliedRequestId }) {
  const requestId = importRequestId(suppliedRequestId);
  const { data: started, error: startError } = await supabase.rpc("import_begin_request", {
    p_request_id: requestId,
    p_import_type: importType,
    p_payload: importRequestPayload(importType, fileName, records),
  });
  throwSupabaseError("imports.begin_request", startError);

  const rpcName = importType === "sales" ? "import_apply_sales_row" : "import_apply_purchase_row";
  const outcomes = await Promise.all(records.map(async (record) => {
    const { data, error } = await supabase.rpc(rpcName, {
      p_request_id: requestId,
      p_payload: {
        outlet_id: record.outlet_id,
        year: Number(record.year),
        month: Number(record.month),
        ...(importType === "sales"
          ? { channel_id: record.channel_id, channel_name: record.channel_name }
          : { supplier_id: record.supplier_id, category_id: record.category_id }),
        amount: Number(record.amount) || 0,
        remark: record.remark ?? "",
        source_row: record.sourceRow ?? null,
        raw_row: buildHistoryRawRow(record),
      },
    });
    throwSupabaseError(`imports.${importType}_row`, error);
    return { record, outcome: data ?? {} };
  }));

  const { data: finalized, error: finalizeError } = await supabase.rpc("import_finalize_batch", { p_request_id: requestId });
  throwSupabaseError("imports.finalize_batch", finalizeError);
  const successful = outcomes.filter(({ outcome }) => outcome.success);
  const savedRows = successful.map(({ record, outcome }) => ({ ...record, ...(outcome.record ?? {}) }));
  const batch = finalized?.batch ?? started?.batch;
  return {
    requestId,
    batch,
    savedRows,
    outcomes: outcomes.map(({ outcome }) => outcome),
    createdCount: Number(finalized?.created ?? 0),
    updatedCount: Number(finalized?.updated ?? 0),
    failedCount: Number(finalized?.failed ?? 0),
  };
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
  async preparePurchaseMasters({ requestId: suppliedRequestId, fileName, records, categories = [], suppliers = [] }) {
    const requestId = importRequestId(suppliedRequestId);
    const { error: beginError } = await supabase.rpc("import_begin_request", {
      p_request_id: requestId,
      p_import_type: "purchase",
      p_payload: importRequestPayload("purchase", fileName, records),
    });
    throwSupabaseError("imports.begin_purchase_preparation", beginError);
    const { data, error } = await supabase.rpc("import_prepare_purchase_masters", {
      p_request_id: requestId, p_categories: categories, p_suppliers: suppliers,
    });
    throwSupabaseError("imports.prepare_purchase_masters", error);
    return { requestId, ...(data ?? {}) };
  },
  async listImportBatches({ importType = "", outletId = "" } = {}) {
    let query = supabase
      .from("import_batches")
      .select(importBatchSelect)
      .order("created_at", { ascending: false })
      .limit(50);
    if (importType) query = query.in("import_type", importTypeAliases[importType] || [importType]);
    if (outletId) query = query.eq("outlet_id", outletId);
    const { data, error } = await query;

    if (isMissingImportInfrastructure(error)) {
      console.warn("[Supabase:import_batches.list] import batch schema is missing or outdated. Apply import batch migration to enable import history.", error);
      return [];
    }

    throwSupabaseError("import_batches.list", error);
    return data ?? [];
  },

  async listImportBatchRows(batchId, importType = "") {
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
    const rows = data ?? [];
    if (String(importType).toLowerCase() !== "sales") return rows;

    const recordIds = [...new Set(rows.map((row) => row.imported_record_id).filter(Boolean))];
    if (!recordIds.length) return rows;

    const { data: salesRecords, error: salesError } = await supabase
      .from("sales_records")
      .select("id,outlet_id,year,month,channel_id,channel_name,amount,remark")
      .in("id", recordIds);
    throwSupabaseError("import_batch_rows.sales_records", salesError);

    const salesById = new Map((salesRecords ?? []).map((record) => [record.id, record]));
    return rows.map((row) => {
      const record = salesById.get(row.imported_record_id);
      if (!record) return row;
      return {
        ...row,
        raw_row: {
          ...(row.raw_row ?? {}),
          Month: record.month,
          Year: record.year,
          Channel: record.channel_name,
          Amount: record.amount,
          imported_channel: record.channel_name,
          imported_amount: record.amount,
        },
      };
    });
  },

  async detectSalesConflicts(records) {
    return detectSalesConflictsForRecords(records);
  },

  async detectPurchaseConflicts(records) {
    return detectPurchaseConflictsForRecords(records);
  },

  async importSales({ fileName, records, requestId }) {
    const result = await importTrustedRows({ importType: "sales", fileName, records, requestId });
    await auditLogService.createAuditLog({
      action: "sales_import_completed", module: "sales", target: fileName,
      outlet: result.batch?.outlet_id || "Multiple outlets", description: "Sales import completed.",
      after: { batch_id: result.batch?.id, request_id: result.requestId, createdCount: result.createdCount, updatedCount: result.updatedCount, failedCount: result.failedCount },
    }).catch(() => {});
    return result;
  },

  async importPurchases({ fileName, records, requestId }) {
    const result = await importTrustedRows({ importType: "purchase", fileName, records, requestId });
    await auditLogService.createAuditLog({
      action: "purchase_import_completed", module: "purchases", target: fileName,
      outlet: result.batch?.outlet_id || "Multiple outlets", description: "Purchase import completed.",
      after: { batch_id: result.batch?.id, request_id: result.requestId, createdCount: result.createdCount, updatedCount: result.updatedCount, failedCount: result.failedCount },
    }).catch(() => {});
    return result;
  },
};
