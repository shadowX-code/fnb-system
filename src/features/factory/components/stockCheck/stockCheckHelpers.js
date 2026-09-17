import { finishedGoodLabel, packSizeText, quantity, rawMaterialLabel } from "../../utils/factoryFormatters.js";

const stockCheckCriticalPercent = 5;

export function stockCheckVariance(systemQty, physicalQty) {
  const system = Number(systemQty || 0);
  const physical = Number(physicalQty || 0);
  const variance = physical - system;
  const variancePercent = system > 0 ? (variance / system) * 100 : null;
  const absVariance = Math.abs(variance);
  const absPercent = Math.abs(Number(variancePercent || 0));
  const status = absVariance === 0
    ? "Normal"
    : system > 0 && absPercent >= stockCheckCriticalPercent
      ? "Critical"
      : system <= 0
        ? "Critical"
        : "Variance";
  return { variance, variancePercent, status };
}

export function stockCheckDifferenceLabel(variance, { skipped = false, hasCount = true, uom = "Packs" } = {}) {
  if (skipped) return "Skipped";
  if (!hasCount) return "Not counted";
  const amount = Math.abs(Number(variance || 0));
  const unit = uom || "Packs";
  if (variance < 0) return `Missing ${quantity(amount, unit)}`;
  if (variance > 0) return `Extra ${quantity(amount, unit)}`;
  return "Matched";
}

export function stockVarianceTone(status) {
  if (status === "Critical") return "danger";
  if (status === "Warning" || status === "Variance") return "warning";
  return "success";
}

export function setStockCheckCountStatus(rows, countStatus) {
  return rows.map((row) => ({
    ...row,
    count_status: countStatus,
    // A skip excludes a row from the snapshot; it never means a zero count.
    // Keep an entered draft quantity so returning to Counted is lossless.
    batch_allocations: countStatus === "skip" ? [] : row.batch_allocations || [],
    positive_adjustment_confirmed: countStatus === "skip" ? false : Boolean(row.positive_adjustment_confirmed),
    positive_adjustment_batch_balance_id: countStatus === "skip" ? "" : row.positive_adjustment_batch_balance_id || "",
    positive_adjustment_batch_no: countStatus === "skip" ? "" : row.positive_adjustment_batch_no || "",
  }));
}

export function finishedGoodStockCheckIdentity(row, sku) {
  const primary = finishedGoodLabel(sku)
    || row?.product_family_name
    || row?.item_name
    || "Finished Good";
  const secondary = [
    row?.product_code || sku?.product_code,
    packSizeText({
      pack_size_qty: row?.pack_size_qty ?? sku?.pack_size_qty,
      pack_size_uom: row?.pack_size_uom || sku?.pack_size_uom,
    }),
  ].filter(Boolean).join(" · ");
  return { primary, secondary };
}

export function positiveAdjustmentBatchLabel(row) {
  if (!row?.positive_adjustment_batch_balance_id) return "Reconciliation Batch to be created on approval";
  const batchNo = row.positive_adjustment_batch_no || "selected";
  const isReconciliationBatch = String(row.positive_adjustment_batch_source_type || "").toLowerCase() === "adjustment"
    || /^ADJ-FGSC\d{6}-\d+$/.test(batchNo);
  return isReconciliationBatch
    ? `Reconciliation Batch ${batchNo}`
    : `Existing batch ${batchNo}`;
}

export function buildStockCheckRows(stockType, stockItems, initialValue, categoryId = "") {
  if (initialValue?.items?.length) {
    return initialValue.items.map((item) => {
      const stockItem = stockItems.find((candidate) => candidate.id === item.raw_material_id || candidate.id === item.finished_good_id) || {};
      return ({
      id: item.id,
      raw_material_id: item.raw_material_id || "",
      finished_good_id: item.finished_good_id || "",
      item_name: item.item_name || "",
      system_qty: initialValue.status === "draft"
        ? Number(stockItems.find((stockItem) => stockItem.id === item.raw_material_id || stockItem.id === item.finished_good_id)?.current_balance ?? item.system_qty ?? 0)
        : item.system_qty,
      physical_qty: item.variance_status === "Skipped" || item.count_status === "pending" ? "" : item.physical_qty,
      count_status: item.variance_status === "Skipped" || item.count_status === "skip" ? "skip" : item.variance_status === "Pending" || item.count_status === "pending" ? "pending" : "counted",
      variance_reason: item.variance_reason || "",
      batch_allocations: item.batch_allocations || [],
      positive_adjustment_confirmed: Boolean(item.positive_adjustment_confirmed),
      positive_adjustment_batch_balance_id: item.positive_adjustment_batch_balance_id || "",
      positive_adjustment_batch_no: item.positive_adjustment_batch_no || "",
      positive_adjustment_batch_source_type: item.positive_adjustment_batch_source_type || "",
      product_family_name: item.product_family_name || stockItem.product_family_name || "",
      product_code: item.product_code || stockItem.product_code || "",
      packaging_type: item.packaging_type || stockItem.packaging_type || "",
      pack_size_qty: item.pack_size_qty ?? stockItem.pack_size_qty ?? null,
      pack_size_uom: item.pack_size_uom || stockItem.pack_size_uom || "",
      base_qty: item.base_qty ?? stockItem.base_qty ?? null,
      base_uom: item.base_uom || stockItem.base_uom || "",
      uom: stockType === "product" ? "Packs" : item.uom || "",
    });
    });
  }
  return stockItems.filter((item) => item.status === "active" && (stockType === "raw" ? item.category_id === categoryId : !categoryId || item.category_id === categoryId)).map((item) => ({
    id: `${stockType}-${item.id}`,
    raw_material_id: stockType === "raw" ? item.id : "",
    finished_good_id: stockType === "product" ? item.id : "",
    item_name: stockType === "raw" ? rawMaterialLabel(item) : item.product_name,
    system_qty: Number(item.current_balance || 0),
    physical_qty: "",
    count_status: stockType === "product" ? "skip" : "counted",
    variance_reason: "",
    batch_allocations: [],
    positive_adjustment_confirmed: false,
    positive_adjustment_batch_balance_id: "",
    positive_adjustment_batch_no: "",
    positive_adjustment_batch_source_type: "",
    product_family_name: item.product_family_name || "",
    product_code: item.product_code || "",
    packaging_type: item.packaging_type || "",
    pack_size_qty: item.pack_size_qty ?? null,
    pack_size_uom: item.pack_size_uom || "",
    base_qty: item.base_qty ?? null,
    base_uom: item.base_uom || "",
    uom: stockType === "product" ? "Packs" : item.uom || "",
  }));
}
