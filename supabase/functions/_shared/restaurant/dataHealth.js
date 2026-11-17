import {buildAlerts,getNetSales,getOutletTaxConfig,sumAmount} from "./analytics.js";
function getSalesRecordRows(store, outletId, month, year) {
  return store.salesRecords.filter((record) => record.outlet_id === outletId && record.month === month && record.year === year);
}

function getSalesChannelKey(record) {
  return record.channel_id || String(record.channel_name ?? "").trim().toLowerCase();
}

function countUniqueSalesChannels(rows) {
  return new Set(rows.map(getSalesChannelKey).filter(Boolean)).size;
}

function getLatestUpdatedRecord(rows) {
  return [...rows].sort((a, b) => new Date(a.updated_at || a.created_at || 0) - new Date(b.updated_at || b.created_at || 0)).at(-1);
}

function getPurchaseRecordRows(store, outletId, month, year) {
  return store.purchaseRecords.filter((record) => record.outlet_id === outletId && record.month === month && record.year === year);
}

function getStatus({ salesScore, purchaseScore, warnings, hasAnyData }) {
  if (!hasAnyData) return { label: "Draft", tone: "neutral" };
  if (warnings.length) return { label: "Incomplete", tone: "danger" };
  if (salesScore === 100 && purchaseScore === 100) return { label: "Source checks complete", tone: "success" };
  return { label: "Draft", tone: "warning" };
}


export function buildDataHealth(store,filters){
  const salesRows = getSalesRecordRows(store, filters.outletId, filters.month, filters.year);
  const purchaseRows = getPurchaseRecordRows(store, filters.outletId, filters.month, filters.year);
  const opexRow = (store.operatingExpenses ?? []).find((record) => record.outlet_id === filters.outletId && Number(record.month) === Number(filters.month) && Number(record.year) === Number(filters.year));
  const netSales = getNetSales(store.salesRecords, filters.outletId, filters.month, filters.year, store.salesChannels);
  const totalPurchase = sumAmount(purchaseRows);
  const hasAnyData = salesRows.length > 0 || purchaseRows.length > 0;
  const sstConfig = getOutletTaxConfig(store.outletTaxConfigs, filters.outletId, filters.month, filters.year, "SST");
  const sstEnabled = Boolean(sstConfig.enabled);

  const alerts = buildAlerts({
    outletId: filters.outletId,
    month: filters.month,
    year: filters.year,
    salesRecords: store.salesRecords,
    salesChannels: store.salesChannels,
    purchaseRecords: store.purchaseRecords,
    suppliers: store.suppliers,
    outletTaxConfigs: store.outletTaxConfigs,
    specialMonths: store.specialMonths,
  });

  const highRiskOperationalAlerts = alerts.filter((alert) => ["critical", "high"].includes(alert.priority));
  const uniqueSalesChannelCount = countUniqueSalesChannels(salesRows);
  const latestSalesRecord = getLatestUpdatedRecord(salesRows);
  const sstRecord = salesRows.find((record) => {
    const name = store.salesChannels.find((channel) => channel.id === record.channel_id)?.name;
    return ["SST Deduction", "SST", "SST (-)"].includes(name);
  });
  const hasSst = Boolean(sstRecord && Number(sstRecord.amount || 0) > 0);
  const purchaseEmptyRows = purchaseRows.filter((record) => !record.supplier_id || !record.category_id || record.amount === "" || record.amount === null || record.amount === undefined);

  const warnings = [
    !hasAnyData ? "No records entered for this month." : null,
    !salesRows.length ? "No saved sales data found for this month." : null,
    !purchaseRows.length ? "No saved purchase data found for this month." : null,
    !opexRow ? "Operating expense evidence missing; EBITDA remains unavailable." : null,
    sstEnabled && !hasSst && salesRows.length ? "SST deduction missing." : null,
    purchaseRows.length && !salesRows.length ? "Purchase exists but sales data is missing." : null,
    purchaseRows.length && salesRows.length && netSales <= 0 ? "Net sales is zero while purchases exist. Please review." : null,
    purchaseEmptyRows.length ? `${purchaseEmptyRows.length} supplier rows incomplete.` : null,
  ].filter(Boolean);

  const salesScore = !salesRows.length
    ? 0
    : Math.max(0, Math.round(100 - (purchaseRows.length && netSales <= 0 ? 25 : 0) - (sstEnabled && !hasSst ? 10 : 0)));
  const purchaseScore = !purchaseRows.length
    ? 0
    : Math.max(0, Math.round(100 - purchaseEmptyRows.length * 15));
  const overallScore = Math.round(salesScore * 0.45 + purchaseScore * 0.45 + (warnings.length ? 0 : 10));
  const monthStatus = getStatus({ salesScore, purchaseScore, warnings, hasAnyData });

return {salesRows,purchaseRows,opexRow,netSales,totalPurchase,hasAnyData,sstConfig,sstEnabled,alerts,highRiskOperationalAlerts,uniqueSalesChannelCount,latestSalesRecord,sstRecord,hasSst,purchaseEmptyRows,warnings,salesScore,purchaseScore,overallScore,monthStatus};
}
