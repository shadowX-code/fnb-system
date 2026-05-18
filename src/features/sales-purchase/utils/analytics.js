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

function toPeriodKey(month, year) {
  return `${Number(year)}-${String(Number(month)).padStart(2, "0")}`;
}

export function getOutletTaxConfig(configs = [], outletId, month, year, taxType = "SST") {
  const period = toPeriodKey(month, year);
  const matches = configs
    .filter((config) => config.outlet_id === outletId && config.tax_type === taxType)
    .filter((config) => config.effective_from <= period)
    .filter((config) => !config.effective_until || config.effective_until >= period)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));

  const config = matches[0];
  if (!config) {
    return {
      enabled: false,
      rate: 0,
      effective_from: null,
      effective_until: null,
      tax_type: taxType,
      missing: true,
    };
  }

  return {
    ...config,
    enabled: Boolean(config.enabled),
    rate: Number(config.rate) || 0,
    missing: false,
  };
}

export function getPreviousPeriod(month, year) {
  if (Number(month) === 1) return { month: 12, year: Number(year) - 1 };
  return { month: Number(month) - 1, year: Number(year) };
}

export function sumAmount(records) {
  return records.reduce((total, record) => total + Number(record.amount || 0), 0);
}

export function sumAbsoluteAmount(records) {
  return records.reduce((total, record) => total + Math.abs(Number(record.amount || 0)), 0);
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
  const adjustmentTotal = sumAbsoluteAmount(periodRecords.filter((record) => getType(record.channel_id) === "adjustment"));
  const netSales = grossSales - adjustmentTotal;

  return {
    grossSales,
    adjustmentTotal,
    totalDeduction: adjustmentTotal,
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
    return { label: "-", tone: "neutral", severity: "empty", priority: "low" };
  }
  if (cogsMargin > 50) return { label: "Urgent Review", tone: "danger", severity: "critical", priority: "critical" };
  if (cogsMargin > 45) return { label: "Critical", tone: "danger", severity: "critical", priority: "critical" };
  if (cogsMargin > 40) return { label: "High Risk", tone: "danger", severity: "high", priority: "high" };
  if (cogsMargin > 35) return { label: "Watch", tone: "warning", severity: "medium", priority: "medium" };
  return { label: "Healthy", tone: "success", severity: "low", priority: "low" };
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

  if (previousAmount && changePercent > 50 && salesChange < 5) {
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

  if (previousAmount && changePercent > 50) {
    return {
      previousAmount,
      threeMonthAverage,
      changePercent,
      averageChangePercent,
      status: "Warning",
      severity: "warning",
      reason: "Supplier spike is partly backed by sales growth",
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

const priorityRank = { critical: 4, high: 3, medium: 2, low: 1 };

function clampConfidence(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getSalesAmountByChannelName(records, channels, outletId, month, year, names) {
  const channelIds = channels.filter((channel) => names.includes(channel.name)).map((channel) => channel.id);
  return sumAmount(records.filter((record) => record.outlet_id === outletId && record.month === month && record.year === year && channelIds.includes(record.channel_id)));
}

function getSstRatio(records, channels, outletId, month, year) {
  const breakdown = getSalesBreakdown(records, channels, outletId, month, year);
  const sst = getSalesAmountByChannelName(records, channels, outletId, month, year, ["SST Deduction", "SST", "SST (-)"]);
  return breakdown.grossSales ? Math.abs(sst) / breakdown.grossSales : 0;
}

function getRecentSstRatioAverage(records, channels, outletId, month, year) {
  const values = [];
  let cursorMonth = month;
  let cursorYear = year;
  for (let index = 0; index < 3; index += 1) {
    const previous = getPreviousPeriod(cursorMonth, cursorYear);
    values.push(getSstRatio(records, channels, outletId, previous.month, previous.year));
    cursorMonth = previous.month;
    cursorYear = previous.year;
  }
  const populated = values.filter((value) => value > 0);
  return populated.length ? populated.reduce((total, value) => total + value, 0) / populated.length : 0;
}

function getCategoryPurchaseTotal(records, suppliers, supplierId, outletId, month, year) {
  const categoryId = suppliers.find((supplier) => supplier.id === supplierId)?.default_category_id;
  if (!categoryId) return 0;
  const supplierIds = suppliers.filter((supplier) => supplier.default_category_id === categoryId).map((supplier) => supplier.id);
  return sumAmount(records.filter((record) => record.outlet_id === outletId && record.month === month && record.year === year && supplierIds.includes(record.supplier_id)));
}

function createAlert({
  id,
  title,
  description,
  severity = "warning",
  priority = "medium",
  confidence_score = 60,
  outlet_id,
  month,
  year,
  alert_type,
  related_supplier_id,
  related_category_id,
  current_value = 0,
  comparison_value = 0,
  percentage_change = 0,
  suggested_action = "Review source records and compare against sales context before taking action.",
  status = "open",
  consecutive_months = 1,
}) {
  return {
    id,
    title,
    description,
    severity,
    priority,
    confidence_score: clampConfidence(confidence_score),
    outlet_id,
    month,
    year,
    alert_type,
    related_supplier_id,
    related_category_id,
    current_value,
    comparison_value,
    percentage_change,
    suggested_action,
    status,
    consecutive_months,
    created_at: new Date().toISOString(),
  };
}

function sortAlerts(alerts) {
  return [...alerts].sort((a, b) => {
    const priorityDiff = (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0);
    if (priorityDiff) return priorityDiff;
    return (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
  });
}

function countConsecutiveMonths({ month, year, predicate }) {
  let count = 0;
  let cursorMonth = month;
  let cursorYear = year;
  for (let index = 0; index < 6; index += 1) {
    if (!predicate(cursorMonth, cursorYear)) break;
    count += 1;
    const previous = getPreviousPeriod(cursorMonth, cursorYear);
    cursorMonth = previous.month;
    cursorYear = previous.year;
  }
  return count;
}

export function buildAlerts({
  outletId,
  month,
  year,
  outletTaxConfigs = [],
  salesRecords,
  salesChannels = [],
  purchaseRecords,
  suppliers,
  specialMonths = [],
}) {
  const currentPurchases = purchaseRecords.filter(
    (record) => record.outlet_id === outletId && record.month === month && record.year === year,
  );
  const currentSales = getNetSales(salesRecords, outletId, month, year, salesChannels);
  const currentBreakdown = getSalesBreakdown(salesRecords, salesChannels, outletId, month, year);
  const sstConfig = getOutletTaxConfig(outletTaxConfigs, outletId, month, year, "SST");
  const currentPurchaseTotal = sumAmount(currentPurchases);
  const previous = getPreviousPeriod(month, year);
  const previousSales = getNetSales(salesRecords, outletId, previous.month, previous.year, salesChannels);
  const previousPurchaseTotal = getPurchaseTotal(purchaseRecords, outletId, previous.month, previous.year);
  const salesChange = percentageChange(currentSales, previousSales);
  const purchaseChange = percentageChange(currentPurchaseTotal, previousPurchaseTotal);
  const specialMonth = specialMonths.find((item) => item.outlet_id === outletId && item.month === month && item.year === year);
  const alerts = [];

  currentPurchases.forEach((record) => {
    const supplier = suppliers.find((item) => item.id === record.supplier_id);
    const supplierName = supplier?.name ?? "Supplier";
    const analysis = getPurchaseRowAnalysis({
      row: record,
      purchaseRecords,
      salesRecords,
      salesChannels,
      outletId,
      month,
      year,
    });
    const categoryCurrent = getCategoryPurchaseTotal(purchaseRecords, suppliers, record.supplier_id, outletId, month, year);
    const categoryPrevious = getCategoryPurchaseTotal(purchaseRecords, suppliers, record.supplier_id, outletId, previous.month, previous.year);
    const categoryChange = percentageChange(categoryCurrent, categoryPrevious);
    const spikeAgainstBoth = analysis.previousAmount && analysis.changePercent > 30 && analysis.threeMonthAverage && analysis.averageChangePercent > 25;
    const salesBacked = salesChange >= 5;
    const categoryBacked = categoryChange >= 15;

    if (spikeAgainstBoth || (analysis.previousAmount && analysis.changePercent > 50)) {
      const severe = !salesBacked && !categoryBacked && analysis.changePercent > 50;
      alerts.push(createAlert({
        id: `alert-supplier-context-${record.id}`,
        alert_type: severe ? "supplier_purchase_high_risk" : "supplier_purchase_context_spike",
        severity: severe ? "danger" : salesBacked ? "info" : "warning",
        priority: severe ? "high" : salesBacked ? "low" : "medium",
        confidence_score: severe ? 82 : salesBacked ? 52 : 68,
        title: severe ? `${supplierName} High Risk Spike` : `${supplierName} Purchase Review`,
        description: salesBacked
          ? "Supplier purchase increased, but Net Sales also grew, so this is a lower-priority review."
          : categoryBacked
            ? "Supplier purchase increased while the category also moved up; review pricing and order quantity."
            : "Supplier purchase increased beyond both recent supplier baselines without matching sales growth.",
        outlet_id: outletId,
        month,
        year,
        related_supplier_id: record.supplier_id,
        related_category_id: supplier?.default_category_id,
        current_value: Number(record.amount),
        comparison_value: Math.max(analysis.previousAmount || 0, analysis.threeMonthAverage || 0),
        percentage_change: Math.max(analysis.changePercent || 0, analysis.averageChangePercent || 0),
        suggested_action: "Check invoice quantity, unit price, delivery timing, and whether the related category increased across other suppliers.",
      }));
    }
  });

  if (purchaseChange > 20 && salesChange < 5) {
    alerts.push(createAlert({
      id: `alert-sales-purchase-${outletId}-${year}-${month}`,
      alert_type: "sales_down_purchase_up",
      severity: "danger",
      priority: "high",
      confidence_score: purchaseChange > 35 && salesChange <= 0 ? 88 : 76,
      title: "Purchase Up, Sales Flat",
      description: "Total purchase increased by more than 20% while Net Sales grew less than 5%.",
      outlet_id: outletId,
      month,
      year,
      current_value: currentPurchaseTotal,
      comparison_value: previousPurchaseTotal,
      percentage_change: purchaseChange,
      suggested_action: "Review receiving, wastage, stock-up activity, supplier invoices, and sales mix before month lock.",
    }));
  }

  if (previousSales && salesChange < -15) {
    alerts.push(createAlert({
      id: `alert-sales-drop-${outletId}-${year}-${month}`,
      alert_type: "sales_drop",
      severity: specialMonth ? "info" : "warning",
      priority: specialMonth ? "low" : "medium",
      confidence_score: specialMonth ? 45 : 70,
      title: specialMonth ? "Sales Drop Contextualized" : "Sales Drop >15%",
      description: specialMonth
        ? `Net sales dropped more than 15%, but this month is flagged as ${specialMonth.flag}.`
        : "Net sales dropped more than 15% against previous period.",
      outlet_id: outletId,
      month,
      year,
      current_value: currentSales,
      comparison_value: previousSales,
      percentage_change: salesChange,
      suggested_action: specialMonth ? "Check whether the special-month flag explains the drop before escalating." : "Review traffic, operating hours, campaign activity, and channel performance.",
    }));
  }

  if (sstConfig.enabled && currentBreakdown.grossSales) {
    const expectedSst = currentBreakdown.grossSales * (Number(sstConfig.rate || 0) / 100);
    const actualSst = Math.abs(getSalesAmountByChannelName(salesRecords, salesChannels, outletId, month, year, ["SST Deduction", "SST", "SST (-)"]));
    const variancePercent = expectedSst ? (Math.abs(actualSst - expectedSst) / expectedSst) * 100 : 0;
    const signedVariance = expectedSst ? ((actualSst - expectedSst) / expectedSst) * 100 : 0;
    const priority = variancePercent > 30 ? "high" : variancePercent > 15 ? "medium" : "low";
    const severity = variancePercent > 30 ? "danger" : variancePercent > 5 ? "warning" : "info";
    if (variancePercent > 5) {
      alerts.push(createAlert({
        id: `alert-sst-${outletId}-${year}-${month}`,
        alert_type: "sst_variance_unusual",
        severity,
        priority,
        confidence_score: variancePercent > 30 ? 82 : variancePercent > 15 ? 68 : 54,
        title: "SST Variance Unusual",
        description: `Actual SST differs from the expected ${Number(sstConfig.rate || 0)}% outlet SST setting effective from ${sstConfig.effective_from}.`,
        outlet_id: outletId,
        month,
        year,
        current_value: actualSst,
        comparison_value: expectedSst,
        percentage_change: signedVariance,
        suggested_action: "Confirm SST deduction amount against taxable sales and outlet SST settings before month lock.",
      }));
    }
  }

  const cogsMargin = currentSales ? (currentPurchaseTotal / currentSales) * 100 : 0;
  const cogsStatus = getCogsStatus(cogsMargin);
  const consecutiveHighCogsMonths = countConsecutiveMonths({
    month,
    year,
    predicate: (cursorMonth, cursorYear) => {
      const sales = getNetSales(salesRecords, outletId, cursorMonth, cursorYear, salesChannels);
      const purchase = getPurchaseTotal(purchaseRecords, outletId, cursorMonth, cursorYear);
      return sales ? (purchase / sales) * 100 > 40 : false;
    },
  });
  if (cogsMargin > 35) {
    const critical = cogsMargin > 45 || consecutiveHighCogsMonths >= 3;
    alerts.push(createAlert({
      id: `alert-cogs-${outletId}-${year}-${month}`,
      alert_type: critical ? "cogs_margin_critical" : cogsMargin > 40 ? "cogs_margin_high" : "cogs_margin_watch",
      severity: critical || cogsMargin > 40 ? "danger" : "warning",
      priority: cogsMargin > 45 || consecutiveHighCogsMonths >= 3 ? "critical" : cogsMargin > 40 ? "high" : "medium",
      confidence_score: cogsMargin > 50 ? 95 : cogsMargin > 45 ? 90 : consecutiveHighCogsMonths >= 3 ? 88 : cogsMargin > 40 ? 78 : 62,
      title: cogsMargin > 50 ? "COGS Margin Urgent Review" : cogsStatus.label === "Watch" ? "COGS Margin Watch" : "COGS Margin High",
      description: cogsMargin > 50
        ? "COGS margin is above 50%; urgent review is required."
        : cogsMargin > 45
          ? "COGS margin is above 45%; this is critical unless explained by a planned stock-up."
          : cogsMargin > 40
            ? "COGS margin is above the normal control range."
            : "COGS margin is between 35% and 40%; monitor cost efficiency.",
      outlet_id: outletId,
      month,
      year,
      current_value: cogsMargin,
      comparison_value: cogsMargin > 40 ? 40 : 35,
      percentage_change: cogsMargin - (cogsMargin > 40 ? 40 : 35),
      suggested_action: "Review supplier invoices, category spikes, wastage, stock-up activity, and menu pricing before month lock.",
      consecutive_months: Math.max(1, consecutiveHighCogsMonths),
    }));
  }

  const deliverySales = getSalesAmountByChannelName(salesRecords, salesChannels, outletId, month, year, ["GrabFood", "FoodPanda", "ShopeeFood"]);
  const deliveryRatio = currentBreakdown.grossSales ? (deliverySales / currentBreakdown.grossSales) * 100 : 0;
  if (deliveryRatio > 45) {
    alerts.push(createAlert({
      id: `alert-delivery-dependency-${outletId}-${year}-${month}`,
      alert_type: "delivery_platform_dependency_high",
      severity: "info",
      priority: "medium",
      confidence_score: 72,
      title: "Delivery Platform Dependency High",
      description: "Delivery sales contribution is high. Review commission impact and dine-in strategy.",
      outlet_id: outletId,
      month,
      year,
      current_value: deliveryRatio,
      comparison_value: 45,
      percentage_change: deliveryRatio - 45,
      suggested_action: "Review platform commissions, dine-in campaigns, menu pricing, and channel mix profitability.",
    }));
  }

  const dineInValues = [2, 1, 0].map((offset) => getSalesAmountByChannelName(salesRecords, salesChannels, outletId, month - offset, year, ["Dine In"]));
  const deliveryValues = [2, 1, 0].map((offset) => getSalesAmountByChannelName(salesRecords, salesChannels, outletId, month - offset, year, ["GrabFood", "FoodPanda", "ShopeeFood"]));
  const dineInDeclining = month >= 3 && dineInValues.every((value) => value > 0) && dineInValues[0] > dineInValues[1] && dineInValues[1] > dineInValues[2];
  const deliveryRising = month >= 3 && deliveryValues.every((value) => value > 0) && deliveryValues[0] < deliveryValues[1] && deliveryValues[1] < deliveryValues[2];
  if (dineInDeclining && deliveryRising) {
    alerts.push(createAlert({
      id: `alert-dine-in-decline-${outletId}-${year}-${month}`,
      alert_type: "dine_in_sales_declining",
      severity: "warning",
      priority: deliveryRatio > 45 ? "high" : "medium",
      confidence_score: deliveryRatio > 45 ? 84 : 74,
      title: "Dine-in Sales Declining",
      description: "Dine-in is declining while delivery grows. Review outlet traffic, service, location or promotion strategy.",
      outlet_id: outletId,
      month,
      year,
      current_value: dineInValues[2],
      comparison_value: dineInValues[0],
      percentage_change: percentageChange(dineInValues[2], dineInValues[0]),
      suggested_action: "Compare dine-in traffic, service speed, local promotions, and delivery commission impact.",
    }));
  }

  return sortAlerts(alerts);
}
