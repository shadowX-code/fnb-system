import { months } from "../data/mockData";

export function toCurrency(value) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: Math.abs(Number(value || 0)) < 100 ? 2 : 0,
  }).format(Number(value) || 0);
}

export function toSignedCurrency(value) {
  const amount = Number(value) || 0;
  if (amount < 0) return `(${toCurrency(Math.abs(amount))})`;
  return toCurrency(amount);
}

export function toPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(digits)}%`;
}

export function monthLabel(month) {
  return months.find((item) => item.value === Number(month))?.label ?? "";
}

export function getPreviousPeriod(month, year) {
  if (Number(month) === 1) return { month: 12, year: Number(year) - 1 };
  return { month: Number(month) - 1, year: Number(year) };
}

export function sumAmount(records) {
  return records.reduce((total, record) => total + Number(record.amount || 0), 0);
}

export function percentageChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export function getSalesRecords(records, outletId, month, year) {
  return records.filter(
    (record) =>
      record.outlet_id === outletId &&
      record.month === month &&
      record.year === year,
  );
}

export function getSalesBreakdown(records, channels, outletId, month, year) {
  const periodRecords = getSalesRecords(records, outletId, month, year);
  const getType = (channelId) => channels.find((channel) => channel.id === channelId)?.type ?? "channel";
  const grossSales = sumAmount(periodRecords.filter((record) => getType(record.channel_id) === "channel"));
  const adjustmentTotal = sumAmount(periodRecords.filter((record) => getType(record.channel_id) === "adjustment"));
  const netSales = grossSales + adjustmentTotal;

  return {
    grossSales,
    adjustmentTotal,
    totalDeduction: Math.abs(Math.min(adjustmentTotal, 0)),
    netSales,
  };
}

export function getNetSales(records, outletId, month, year, channels = []) {
  return getSalesBreakdown(records, channels, outletId, month, year).netSales;
}

export function getPurchaseTotal(records, outletId, month, year) {
  return sumAmount(
    records.filter((record) => record.outlet_id === outletId && record.month === month && record.year === year),
  );
}

export function getMonthlyPurchaseEfficiency({ salesRecords, salesChannels = [], purchaseRecords, outletId, month, year }) {
  const netSales = getNetSales(salesRecords, outletId, month, year, salesChannels);
  const totalPurchase = getPurchaseTotal(purchaseRecords, outletId, month, year);
  const cogsMargin = netSales ? (totalPurchase / netSales) * 100 : null;
  const grossProfitEstimate = netSales - totalPurchase;
  const previous = getPreviousPeriod(month, year);
  const previousNetSales = getNetSales(salesRecords, outletId, previous.month, previous.year, salesChannels);
  const previousPurchase = getPurchaseTotal(purchaseRecords, outletId, previous.month, previous.year);
  const salesChange = percentageChange(netSales, previousNetSales);
  const purchaseChange = percentageChange(totalPurchase, previousPurchase);

  return {
    month,
    year,
    netSales,
    totalPurchase,
    cogsMargin,
    grossProfitEstimate,
    previousNetSales,
    previousPurchase,
    salesChange,
    purchaseChange,
  };
}

export function getCogsStatus(cogsMargin) {
  if (cogsMargin === null || cogsMargin === undefined || !Number.isFinite(cogsMargin)) {
    return { label: "-", tone: "neutral", severity: "empty" };
  }
  if (cogsMargin > 40) return { label: "High Risk", tone: "danger", severity: "high" };
  if (cogsMargin > 35) return { label: "Watch", tone: "warning", severity: "medium" };
  return { label: "Healthy", tone: "success", severity: "low" };
}

export function getSupplierPurchaseAmount(records, outletId, supplierId, month, year) {
  return sumAmount(
    records.filter(
      (record) =>
        record.outlet_id === outletId &&
        record.supplier_id === supplierId &&
        record.month === month &&
        record.year === year,
    ),
  );
}

export function getRecentSupplierAverage(records, outletId, supplierId, month, year, periods = 3) {
  const values = [];
  let cursorMonth = Number(month);
  let cursorYear = Number(year);

  for (let index = 0; index < periods; index += 1) {
    const previous = getPreviousPeriod(cursorMonth, cursorYear);
    values.push(getSupplierPurchaseAmount(records, outletId, supplierId, previous.month, previous.year));
    cursorMonth = previous.month;
    cursorYear = previous.year;
  }

  const populated = values.filter((value) => value > 0);
  return populated.length ? populated.reduce((total, value) => total + value, 0) / populated.length : 0;
}

export function getPurchaseRowAnalysis({
  row,
  purchaseRecords,
  salesRecords,
  salesChannels = [],
  outletId,
  month,
  year,
}) {
  const amountIsMissing = row.amount === "" || row.amount === null || row.amount === undefined;
  const currentAmount = Number(row.amount) || 0;
  const previous = getPreviousPeriod(month, year);
  const previousAmount = getSupplierPurchaseAmount(purchaseRecords, outletId, row.supplier_id, previous.month, previous.year);
  const threeMonthAverage = getRecentSupplierAverage(purchaseRecords, outletId, row.supplier_id, month, year);
  const changePercent = percentageChange(currentAmount, previousAmount);
  const averageChangePercent = percentageChange(currentAmount, threeMonthAverage);
  const currentSales = getNetSales(salesRecords, outletId, month, year, salesChannels);
  const previousSales = getNetSales(salesRecords, outletId, previous.month, previous.year, salesChannels);
  const salesChange = percentageChange(currentSales, previousSales);

  if (amountIsMissing) {
    return {
      previousAmount,
      threeMonthAverage,
      changePercent: 0,
      averageChangePercent: 0,
      status: "Missing",
      severity: "missing",
      reason: "Amount is blank",
    };
  }

  if (!previousAmount && currentAmount > 0) {
    return {
      previousAmount,
      threeMonthAverage,
      changePercent,
      averageChangePercent,
      status: "New",
      severity: "info",
      reason: "No previous month purchase",
    };
  }

  if (previousAmount && changePercent > 50) {
    return {
      previousAmount,
      threeMonthAverage,
      changePercent,
      averageChangePercent,
      status: "High Risk",
      severity: "danger",
      reason: "More than 50% above previous month",
    };
  }

  if (salesChange <= 0 && changePercent > 20) {
    return {
      previousAmount,
      threeMonthAverage,
      changePercent,
      averageChangePercent,
      status: "Warning",
      severity: "warning",
      reason: "Purchase rose while sales did not grow",
    };
  }

  if ((previousAmount && changePercent > 30) || (threeMonthAverage && averageChangePercent > 25)) {
    return {
      previousAmount,
      threeMonthAverage,
      changePercent,
      averageChangePercent,
      status: "Warning",
      severity: "warning",
      reason: previousAmount && changePercent > 30 ? "More than 30% above previous month" : "Above 3-month average",
    };
  }

  return {
    previousAmount,
    threeMonthAverage,
    changePercent,
    averageChangePercent,
    status: currentAmount > 0 ? "Normal" : "Missing",
    severity: currentAmount > 0 ? "success" : "missing",
    reason: currentAmount > 0 ? "Within normal range" : "Amount is zero",
  };
}

export function buildMonthlySummary({ salesRecords, salesChannels = [], purchaseRecords, outletId, year }) {
  return months.map(({ value }) => {
    const { grossSales, adjustmentTotal, totalDeduction, netSales } = getSalesBreakdown(salesRecords, salesChannels, outletId, value, year);
    const efficiency = getMonthlyPurchaseEfficiency({
      salesRecords,
      salesChannels,
      purchaseRecords,
      outletId,
      month: value,
      year,
    });

    return {
      month: value,
      grossSales,
      adjustmentTotal,
      totalDeduction,
      netSales,
      totalPurchase: efficiency.totalPurchase,
      cogsMargin: efficiency.cogsMargin ?? 0,
      profitMargin: efficiency.cogsMargin === null ? 0 : 100 - efficiency.cogsMargin,
      grossProfitEstimate: efficiency.grossProfitEstimate,
      salesChange: efficiency.salesChange,
      purchaseChange: efficiency.purchaseChange,
    };
  });
}

export function getCategoryName(categories, id) {
  return categories.find((category) => category.id === id)?.name ?? "Others";
}

export function getSupplierName(suppliers, id) {
  return suppliers.find((supplier) => supplier.id === id)?.name ?? "Supplier";
}

export function buildAlerts({
  outletId,
  month,
  year,
  salesRecords,
  salesChannels = [],
  purchaseRecords,
  suppliers,
  threshold = { cogsHighRisk: 40 },
}) {
  const currentPurchases = purchaseRecords.filter(
    (record) => record.outlet_id === outletId && record.month === month && record.year === year,
  );
  const currentSales = getNetSales(salesRecords, outletId, month, year, salesChannels);
  const currentPurchaseTotal = sumAmount(currentPurchases);
  const previous = getPreviousPeriod(month, year);
  const previousSales = getNetSales(salesRecords, outletId, previous.month, previous.year, salesChannels);
  const previousPurchaseTotal = getPurchaseTotal(purchaseRecords, outletId, previous.month, previous.year);
  const alerts = [];

  currentPurchases.forEach((record) => {
    const supplierName = getSupplierName(suppliers, record.supplier_id);
    const analysis = getPurchaseRowAnalysis({
      row: record,
      purchaseRecords,
      salesRecords,
      salesChannels,
      outletId,
      month,
      year,
    });

    const currentSales = getNetSales(salesRecords, outletId, month, year, salesChannels);
    const previousSalesForSupplier = getNetSales(salesRecords, outletId, previous.month, previous.year, salesChannels);
    const supplierSalesChange = percentageChange(currentSales, previousSalesForSupplier);

    if (analysis.previousAmount && analysis.changePercent > 50 && supplierSalesChange < 5) {
      alerts.push({
        id: `alert-high-risk-${record.id}`,
        alert_type: "supplier_purchase_high_risk",
        severity: "high",
        title: `${supplierName} +${analysis.changePercent.toFixed(0)}%`,
        description: "Supplier purchase is more than 50% above previous month.",
        outlet_id: outletId,
        month,
        year,
        related_supplier_id: record.supplier_id,
        current_value: Number(record.amount),
        comparison_value: analysis.previousAmount,
        percentage_change: analysis.changePercent,
        status: "open",
        created_at: new Date().toISOString(),
      });
    } else if (analysis.previousAmount && analysis.changePercent > 30 && supplierSalesChange < 5) {
      alerts.push({
        id: `alert-supplier-spike-sales-flat-${record.id}`,
        alert_type: "supplier_spike_sales_flat",
        severity: "medium",
        title: `${supplierName} Supplier Spike`,
        description: "Supplier purchase grew more than 30% while Net Sales did not grow meaningfully.",
        outlet_id: outletId,
        month,
        year,
        related_supplier_id: record.supplier_id,
        current_value: Number(record.amount),
        comparison_value: analysis.previousAmount,
        percentage_change: analysis.changePercent,
        status: "open",
        created_at: new Date().toISOString(),
      });
    } else if (analysis.previousAmount && analysis.changePercent > 30) {
      alerts.push({
        id: `alert-prev-${record.id}`,
        alert_type: "supplier_purchase_spike",
        severity: supplierSalesChange >= 5 ? "low" : "medium",
        title: `${supplierName} +${analysis.changePercent.toFixed(0)}%`,
        description:
          supplierSalesChange >= 5
            ? "Supplier purchase is higher, but Net Sales also grew, so review level is moderate."
            : "Supplier purchase is more than 30% above previous month.",
        outlet_id: outletId,
        month,
        year,
        related_supplier_id: record.supplier_id,
        current_value: Number(record.amount),
        comparison_value: analysis.previousAmount,
        percentage_change: analysis.changePercent,
        status: "open",
        created_at: new Date().toISOString(),
      });
    }

    if (analysis.threeMonthAverage && analysis.averageChangePercent > 25) {
      alerts.push({
        id: `alert-avg-${record.id}`,
        alert_type: "supplier_purchase_average_spike",
        severity: "medium",
        title: "Supplier Cost Spike",
        description: `${supplierName} is above recent 3-month average.`,
        outlet_id: outletId,
        month,
        year,
        related_supplier_id: record.supplier_id,
        current_value: Number(record.amount),
        comparison_value: analysis.threeMonthAverage,
        percentage_change: analysis.averageChangePercent,
        status: "open",
        created_at: new Date().toISOString(),
      });
    }
  });

  const salesChange = percentageChange(currentSales, previousSales);
  const purchaseChange = percentageChange(currentPurchaseTotal, previousPurchaseTotal);
  if (purchaseChange > 20 && salesChange < 5) {
    alerts.push({
      id: `alert-sales-purchase-${outletId}-${year}-${month}`,
      alert_type: "sales_down_purchase_up",
      severity: "high",
      title: "Purchase Up, Sales Flat",
      description: "Total purchase increased by more than 20% while Net Sales grew less than 5%.",
      outlet_id: outletId,
      month,
      year,
      current_value: currentPurchaseTotal,
      comparison_value: previousPurchaseTotal,
      percentage_change: purchaseChange,
      status: "open",
      created_at: new Date().toISOString(),
    });
  }

  if (previousSales && salesChange < -15) {
    alerts.push({
      id: `alert-sales-drop-${outletId}-${year}-${month}`,
      alert_type: "sales_drop",
      severity: "medium",
      title: "Sales Drop >15%",
      description: "Net sales dropped more than 15% against previous period.",
      outlet_id: outletId,
      month,
      year,
      current_value: currentSales,
      comparison_value: previousSales,
      percentage_change: salesChange,
      status: "open",
      created_at: new Date().toISOString(),
    });
  }

  const sstRecord = salesRecords.find(
    (record) =>
      record.outlet_id === outletId &&
      record.month === month &&
      record.year === year &&
      record.channel_id === "channel-sst",
  );
  if (sstRecord && Math.abs(Number(sstRecord.amount)) > currentSales * 0.04) {
    alerts.push({
      id: `alert-sst-${outletId}-${year}-${month}`,
      alert_type: "sst_unusual",
      severity: "low",
      title: "SST / Adjustment Unusual",
      description: "Negative adjustment is larger than the normal first-stage review threshold.",
      outlet_id: outletId,
      month,
      year,
      current_value: Number(sstRecord.amount),
      comparison_value: currentSales * 0.04,
      percentage_change: 0,
      status: "open",
      created_at: new Date().toISOString(),
    });
  }

  const cogsMargin = currentSales ? (currentPurchaseTotal / currentSales) * 100 : 0;
  if (cogsMargin > threshold.cogsHighRisk) {
    alerts.push({
      id: `alert-cogs-${outletId}-${year}-${month}`,
      alert_type: "cogs_margin_high",
      severity: "high",
      title: "COGS Margin High",
      description: `COGS margin is above the ${threshold.cogsHighRisk}% control range.`,
      outlet_id: outletId,
      month,
      year,
      current_value: cogsMargin,
      comparison_value: threshold.cogsHighRisk,
      percentage_change: cogsMargin - threshold.cogsHighRisk,
      status: "open",
      created_at: new Date().toISOString(),
    });
  } else if (cogsMargin > 35) {
    alerts.push({
      id: `alert-cogs-watch-${outletId}-${year}-${month}`,
      alert_type: "cogs_margin_watch",
      severity: "medium",
      title: "COGS Margin Watch",
      description: "COGS margin is between 35% and 40%; review cost efficiency.",
      outlet_id: outletId,
      month,
      year,
      current_value: cogsMargin,
      comparison_value: 35,
      percentage_change: cogsMargin - 35,
      status: "open",
      created_at: new Date().toISOString(),
    });
  }

  return alerts;
}
