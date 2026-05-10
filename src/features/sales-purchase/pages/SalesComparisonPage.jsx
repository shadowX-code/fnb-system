import { useEffect, useMemo, useState } from "react";
import { Download, Percent, Printer, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import { FieldLabel, OutletSelector, YearSelector } from "../../../components/forms/Selectors.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { months } from "../data/mockData.js";
import { getOutletTaxConfig, getPreviousPeriod, getSalesBreakdown, percentageChange, sumAbsoluteAmount, sumAmount, toCurrency, toPercent, toSignedCurrency } from "../utils/analytics.js";

const deliveryChannels = new Set(["GrabFood", "FoodPanda", "ShopeeFood"]);

function getChannelAmount(records, outletId, year, month, channelId) {
  return sumAmount(records.filter((record) => record.outlet_id === outletId && record.year === year && record.month === month && record.channel_id === channelId));
}

function getDeliverySales(store, outletId, year, month) {
  const channelIds = store.salesChannels.filter((channel) => deliveryChannels.has(channel.name)).map((channel) => channel.id);
  return sumAmount(store.salesRecords.filter((record) => record.outlet_id === outletId && record.year === year && record.month === month && channelIds.includes(record.channel_id)));
}

function getSstDeduction(store, outletId, year, month) {
  const adjustmentIds = store.salesChannels.filter((channel) => channel.type === "adjustment").map((channel) => channel.id);
  return sumAbsoluteAmount(store.salesRecords.filter((record) => record.outlet_id === outletId && record.year === year && record.month === month && adjustmentIds.includes(record.channel_id)));
}

function getDineInShare(store, outletId, year, month) {
  const dineIn = store.salesChannels.find((channel) => channel.name === "Dine In");
  const grossSales = getSalesBreakdown(store.salesRecords, store.salesChannels, outletId, month, year).grossSales;
  const dineInSales = dineIn ? getChannelAmount(store.salesRecords, outletId, year, month, dineIn.id) : 0;
  return grossSales ? (dineInSales / grossSales) * 100 : null;
}

function getRowValue(store, outletId, year, month, row) {
  if (row.type === "group") return null;
  const breakdown = getSalesBreakdown(store.salesRecords, store.salesChannels, outletId, month, year);
  if (row.kind === "gross") return breakdown.grossSales;
  if (row.kind === "net") return breakdown.netSales;
  if (row.kind === "sst") return getSstDeduction(store, outletId, year, month);
  if (row.kind === "delivery") return getDeliverySales(store, outletId, year, month);
  if (row.kind === "dine-in-share") return getDineInShare(store, outletId, year, month);
  if (row.kind === "channel-share") {
    const amount = getChannelAmount(store.salesRecords, outletId, year, month, row.channelId);
    return breakdown.grossSales ? (amount / breakdown.grossSales) * 100 : null;
  }
  if (row.kind === "channel") return getChannelAmount(store.salesRecords, outletId, year, month, row.channelId);
  return 0;
}

function hasSalesData(store, outletId, year, month) {
  return store.salesRecords.some((record) => record.outlet_id === outletId && record.year === year && record.month === month);
}

function getComparisonContext({ compareWith, month, year }) {
  if (compareWith === "Previous Year") return { label: "YoY", description: `vs ${monthLabel(month)} ${year - 1}`, month, year: year - 1, valid: true };
  if (compareWith === "Previous Month") {
    if (month === 1) return { label: "MoM", description: "vs previous month", valid: false };
    const previous = getPreviousPeriod(month, year);
    return { label: "MoM", description: `vs ${monthLabel(previous.month)} ${previous.year}`, month: previous.month, year: previous.year, valid: true };
  }
  if (month <= 3) return { label: "3M Avg", description: "vs 3-month average", valid: false };
  return { label: "3M Avg", description: "vs 3-month average", valid: true };
}

function getComparisonValue(store, outletId, year, month, row, compareWith) {
  const context = getComparisonContext({ compareWith, month, year });
  if (!context.valid) return null;
  if (compareWith === "3-Month Average") {
    const values = [1, 2, 3].map((offset) => getRowValue(store, outletId, year, month - offset, row)).filter((value) => value !== null && Number.isFinite(value));
    return values.length === 3 ? values.reduce((total, value) => total + value, 0) / 3 : null;
  }
  if (!hasSalesData(store, outletId, context.year, context.month)) return null;
  return getRowValue(store, outletId, context.year, context.month, row);
}

function formatRowValue(row, value) {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "-";
  if (row.isPercent) return toPercent(value);
  return value < 0 ? toSignedCurrency(value) : toCurrency(value);
}

function formatVariance(row, current, comparison) {
  if (comparison === null || comparison === undefined || !Number.isFinite(comparison) || comparison === 0 || current === null || current === undefined) return "-";
  if (row.isPercent) {
    const diff = current - comparison;
    return `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}pp`;
  }
  const change = percentageChange(current, comparison);
  return `${change >= 0 ? "+" : ""}${toPercent(change)}`;
}

function monthLabel(month) {
  return months.find((item) => item.value === month)?.label ?? "";
}

function isSstEnabledInAnyVisibleMonth(store, outletId, year, visibleMonths) {
  return visibleMonths.some((month) => getOutletTaxConfig(store.outletTaxConfigs, outletId, month.value, year, "SST").enabled);
}

function buildRows(store, viewMode, outletId, year, visibleMonths) {
  const active = store.salesChannels.filter((channel) => channel.status === "active" && channel.type !== "total");
  const channels = active.filter((channel) => channel.type === "channel");
  const showSst = isSstEnabledInAnyVisibleMonth(store, outletId, year, visibleMonths);
  const adjustments = active.filter((channel) => channel.type === "adjustment" && (showSst || !["SST Deduction", "SST", "SST (-)"].includes(channel.name)));
  const dineIn = channels.filter((channel) => ["Dine In", "Takeaway"].includes(channel.name));
  const delivery = channels.filter((channel) => deliveryChannels.has(channel.name));
  const custom = channels.filter((channel) => !["Dine In", "Takeaway"].includes(channel.name) && !deliveryChannels.has(channel.name));

  if (viewMode === "Summary") {
    return [
      { id: "gross-sales", label: "Gross Sales", kind: "gross" },
      ...(showSst ? [{ id: "sst-deduction", label: "SST Deduction", kind: "sst" }] : []),
      { id: "net-sales", label: "Net Sales", kind: "net", highlight: true },
      { id: "delivery-sales", label: "Delivery Sales", kind: "delivery" },
      { id: "dine-in-share", label: "Dine In %", kind: "dine-in-share", isPercent: true, note: "Based on Gross Sales" },
    ];
  }

  if (viewMode === "Channel Mix") {
    return channels.map((channel) => ({
      id: `mix-${channel.id}`,
      label: `${channel.name} %`,
      kind: "channel-share",
      channelId: channel.id,
      isPercent: true,
      note: "Based on Gross Sales",
    }));
  }

  return [
    { id: "group-sales", type: "group", label: "Sales Channels" },
    ...dineIn.map((channel) => ({ id: channel.id, label: channel.name, kind: "channel", channelId: channel.id, group: "Sales Channels" })),
    ...(custom.length ? [{ id: "group-custom", type: "group", label: "Custom Channels" }] : []),
    ...custom.map((channel) => ({ id: channel.id, label: channel.name, kind: "channel", channelId: channel.id, group: "Custom Channels" })),
    { id: "group-delivery", type: "group", label: "Delivery Platforms" },
    ...delivery.map((channel) => ({ id: channel.id, label: channel.name, kind: "channel", channelId: channel.id, group: "Delivery Platforms" })),
    { id: "group-adjustments", type: "group", label: "Adjustments" },
    ...adjustments.map((channel) => ({ id: channel.id, label: channel.name, kind: "channel", channelId: channel.id, group: "Adjustments" })),
    { id: "group-summary", type: "group", label: "Summary" },
    { id: "gross-sales", label: "Gross Sales", kind: "gross", highlight: true, group: "Summary" },
    { id: "net-sales", label: "Net Sales", kind: "net", highlight: true, group: "Summary" },
  ];
}

function currentMonthFor(store, outletId, year) {
  return Math.max(
    ...store.salesRecords.filter((record) => record.outlet_id === outletId && record.year === year).map((record) => record.month),
    1,
  );
}

function getContribution(row, total, grossTotal) {
  if (row.type === "group" || row.isPercent || !grossTotal || total === null || total === undefined) return null;
  return (total / grossTotal) * 100;
}

function buildBusinessInsights({ compareLabel, compareWith, currentNetSales, netComparison, currentDelivery, deliveryComparison, currentDineInShare, bestChannel, bestChannelShare, viewMode }) {
  const netChange = netComparison ? percentageChange(currentNetSales, netComparison) : null;
  const deliveryChange = deliveryComparison ? percentageChange(currentDelivery, deliveryComparison) : null;
  const insights = [];

  if (netChange !== null && deliveryChange !== null) {
    if (netChange > deliveryChange + 3) {
      insights.push({
        title: "Core sales are improving faster than delivery",
        description: `Net Sales is outpacing delivery, pointing to stronger outlet-level recovery.`,
        metric: `${toPercent(netChange)} Net Sales growth`,
        action: "Monitor dine-in repeatability next month.",
        priority: "success",
        tone: "success",
      });
    } else if (deliveryChange > netChange + 5) {
      insights.push({
        title: "Delivery is carrying more of the growth",
        description: `Delivery is growing faster than Net Sales, which can pressure platform margins.`,
        metric: `${toPercent(deliveryChange)} delivery growth`,
        action: "Review platform margin.",
        priority: "warning",
        tone: "warning",
      });
    } else {
      insights.push({
        title: "Sales growth is balanced across channels",
        description: `Net Sales and delivery are moving in a similar range; channel mix looks stable.`,
        metric: `${toPercent(netChange)} Net Sales vs ${toPercent(deliveryChange)} delivery`,
        action: "No immediate escalation needed.",
        priority: "info",
        tone: "info",
      });
    }
  } else {
    insights.push({
      title: "Comparison baseline is limited",
        description: `${compareWith} needs more baseline data. Missing comparisons stay as dashes.`,
      metric: "Baseline unavailable",
      action: "Use more saved months before treating the variance as directional.",
      priority: "info",
      tone: "info",
    });
  }

  if (bestChannel) {
    insights.push({
      title: `${bestChannel.channel.name} remains the dominant channel`,
      description: `${bestChannel.channel.name} contributes ${toPercent(bestChannelShare)} of current Gross Sales.`,
      metric: `${toPercent(bestChannelShare)} contribution`,
      action: bestChannelShare > 70 ? "Check channel dependency." : "Monitor channel balance.",
      priority: bestChannelShare > 70 ? "warning" : "info",
      tone: bestChannelShare > 70 ? "warning" : "info",
    });
  }

  if (currentDineInShare !== null) {
    insights.push({
      title: currentDineInShare > 70 ? "Dine-in is still the core engine" : "Dine-in mix needs attention",
      description: `Dine In represents ${toPercent(currentDineInShare)} of Gross Sales.`,
      metric: `${toPercent(currentDineInShare)} dine-in mix`,
      action: currentDineInShare > 70 ? "Maintain service quality." : "Review outlet traffic.",
      priority: currentDineInShare > 70 ? "success" : "warning",
      tone: currentDineInShare > 70 ? "success" : "warning",
    });
  }

  if (viewMode === "Channel Mix") {
    insights.push({
      title: "Channel Mix uses Gross Sales as the base",
      description: "Percentages exclude SST deduction effects, so the mix view is focused on demand source rather than final Net Sales.",
      metric: "Gross Sales basis",
      action: "Use Net Sales rows for final monthly performance.",
      priority: "info",
      tone: "info",
    });
  }

  const rank = { critical: 4, high: 4, warning: 3, medium: 3, info: 2, success: 1 };
  return insights.sort((a, b) => (rank[b.priority] ?? 0) - (rank[a.priority] ?? 0));
}

function InsightPanel({ insights }) {
  const toneClass = {
    critical: "border-rose-200 bg-rose-50/70 text-rose-900",
    high: "border-rose-200 bg-rose-50/70 text-rose-900",
    warning: "border-amber-200 bg-amber-50/70 text-amber-900",
    medium: "border-amber-200 bg-amber-50/70 text-amber-900",
    info: "border-blue-200 bg-blue-50/70 text-blue-900",
    success: "border-emerald-200 bg-emerald-50/70 text-emerald-900",
  };
  const badgeClass = {
    critical: "bg-rose-100 text-rose-700",
    high: "bg-rose-100 text-rose-700",
    warning: "bg-amber-100 text-amber-700",
    medium: "bg-amber-100 text-amber-700",
    info: "bg-blue-100 text-blue-700",
    success: "bg-emerald-100 text-emerald-700",
  };

  return (
    <Card title="Sales Intelligence" description="Business interpretation based on the selected baseline and view mode.">
      <div className="space-y-2.5 p-4">
        {insights.map((insight, index) => (
          <div key={`${insight.title}-${index}`} className={`rounded-xl border p-3 text-sm ${toneClass[insight.priority] ?? toneClass.info}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${badgeClass[insight.priority] ?? badgeClass.info}`}>
                  {insight.priority ?? "info"}
                </span>
                <div className="mt-2 text-sm font-bold leading-5">{insight.title}</div>
              </div>
            </div>
            {insight.metric ? <div className="mt-2 text-[13px] font-bold">{insight.metric}</div> : null}
            <p className="mt-1 text-xs leading-5 opacity-90">{insight.description}</p>
            {insight.action ? (
              <p className="mt-1 text-xs font-semibold opacity-90">{insight.action}</p>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function SalesCell({ row, cell, compareWith, year }) {
  const isPositive = cell.variance !== "-" && !cell.variance.startsWith("-");
  const comparisonLabel = compareWith === "Previous Year" ? `vs ${cell.month.label} ${year - 1}` : compareWith === "Previous Month" ? "vs previous month" : "vs 3-month average";

  return (
    <div className="group relative flex justify-end">
      <button type="button" className="rounded-lg px-2 py-1 text-right transition hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/20">
        <span className={cell.current < 0 ? "block font-semibold text-rose-600" : "block font-semibold text-text-primary"}>{formatRowValue(row, cell.current)}</span>
        <span className={`mt-1 block text-[11px] font-bold ${cell.variance === "-" ? "text-text-muted" : isPositive ? "text-emerald-600" : "text-rose-600"}`}>{cell.variance}</span>
      </button>
      <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-56 rounded-2xl border border-border bg-white p-3 text-left text-xs shadow-xl group-hover:block">
        <div className="font-bold text-text-primary">{row.label} · {cell.month.label} {year}</div>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <span className="text-text-secondary">Current</span>
            <span className="font-bold text-text-primary">{formatRowValue(row, cell.current)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-text-secondary">Comparison</span>
            <span className="font-bold text-text-primary">{formatRowValue(row, cell.comparison)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-text-secondary">Variance</span>
            <span className={`font-bold ${cell.variance === "-" ? "text-text-muted" : isPositive ? "text-emerald-600" : "text-rose-600"}`}>{cell.variance}</span>
          </div>
        </div>
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 font-semibold text-text-secondary">{comparisonLabel}</div>
      </div>
    </div>
  );
}

function SalesMatrix({ rows, visibleMonths, selectedMonth, compareWith, compareLabel, year, highlightedRows }) {
  return (
    <div className="max-h-[640px] overflow-auto">
      <table className="w-full min-w-[980px] border-collapse text-sm">
        <thead className="sticky top-0 z-30 border-b border-slate-300 bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="sticky left-0 top-0 z-40 w-56 bg-slate-50 px-3 py-2.5 text-left">Metric / Channel</th>
            {visibleMonths.map((month) => (
              <th key={month.value} className={`top-0 px-3 py-2.5 text-right ${month.value === selectedMonth ? "bg-primary/10 text-primary" : "bg-slate-50"}`}>
                <div className="flex flex-col items-end gap-1">
                  <span>{month.label}</span>
                  {month.value === selectedMonth ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold normal-case text-primary">Current</span> : null}
                </div>
              </th>
            ))}
            <th className="top-0 bg-slate-50 px-3 py-2.5 text-right">Total</th>
            <th className="top-0 bg-slate-50 px-3 py-2.5 text-right">Average</th>
            <th className="top-0 bg-slate-50 px-3 py-2.5 text-right">Contribution</th>
            <th className="top-0 bg-slate-50 px-3 py-2.5 text-right">vs {compareLabel}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-white">
          {rows.map((row) => {
            if (row.type === "group") {
              return (
                <tr key={row.id} className="bg-slate-50/90">
                  <td className="sticky left-0 z-20 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-text-secondary">{row.label}</td>
                  <td colSpan={visibleMonths.length + 4} className="bg-slate-50 px-3 py-2" />
                </tr>
              );
            }
            const totalVariance = row.isPercent ? "-" : formatVariance(row, row.total, row.totalComparison);
            const isHighlighted = highlightedRows.has(row.id) || highlightedRows.has(row.kind) || highlightedRows.has(row.label);
            const isSoftNegative = row.kind === "sst" || row.label.toLowerCase().includes("sst");
            return (
              <tr key={row.id} className={`transition hover:bg-slate-50/70 ${row.highlight ? "bg-blue-50/40" : ""} ${isHighlighted ? "ring-2 ring-inset ring-primary/20" : ""}`}>
                <td className={`sticky left-0 z-20 px-3 py-2.5 ${row.highlight ? "bg-blue-50" : "bg-white"}`}>
                  <div className={`font-semibold ${row.highlight ? "text-primary" : isSoftNegative ? "text-rose-500/80" : "text-text-primary"}`}>{row.label}</div>
                  {row.note ? <div className="mt-1 text-xs text-text-secondary">{row.note}</div> : null}
                </td>
                {row.cells.map((cell) => (
                  <td key={cell.month.value} className={`px-3 py-2.5 text-right ${cell.month.value === selectedMonth ? "bg-primary/5" : ""}`}>
                    <SalesCell row={row} cell={cell} compareWith={compareWith} year={year} />
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right font-bold">{formatRowValue(row, row.total)}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-text-secondary">{formatRowValue(row, row.average)}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-text-secondary">{row.contribution === null ? "-" : toPercent(row.contribution)}</td>
                <td className="px-3 py-2.5 text-right">
                  <span className={`font-semibold ${totalVariance === "-" ? "text-text-muted" : totalVariance.startsWith("-") ? "text-rose-600" : "text-emerald-600"}`}>{totalVariance}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function SalesComparisonPage({ store, ui }) {
  const filters = usePeriodFilters(store);
  const [compareWith, setCompareWith] = useState("Previous Year");
  const [viewMode, setViewMode] = useState("Summary");
  const [highlightedRows, setHighlightedRows] = useState(() => new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 180);
    return () => window.clearTimeout(timer);
  }, [compareWith, filters.outletId, filters.year, viewMode]);

  const selectedMonth = currentMonthFor(store, filters.outletId, filters.year);
  const visibleMonths = useMemo(
    () => months.filter((month) => hasSalesData(store, filters.outletId, filters.year, month.value)),
    [filters.outletId, filters.year, store],
  );
  const compareLabel = getComparisonContext({ compareWith, month: selectedMonth, year: filters.year }).label;
  const rows = useMemo(() => buildRows(store, viewMode, filters.outletId, filters.year, visibleMonths), [filters.outletId, filters.year, store, viewMode, visibleMonths]);

  const netRow = { id: "net-sales", label: "Net Sales", kind: "net" };
  const grossRow = { id: "gross-sales", label: "Gross Sales", kind: "gross" };
  const deliveryRow = { id: "delivery-sales", label: "Delivery Sales", kind: "delivery" };
  const dineInShareRow = { id: "dine-in-share", label: "Dine In %", kind: "dine-in-share", isPercent: true };

  const currentNetSales = getRowValue(store, filters.outletId, filters.year, selectedMonth, netRow);
  const currentGrossSales = getRowValue(store, filters.outletId, filters.year, selectedMonth, grossRow);
  const currentDelivery = getRowValue(store, filters.outletId, filters.year, selectedMonth, deliveryRow);
  const currentDineInShare = getRowValue(store, filters.outletId, filters.year, selectedMonth, dineInShareRow);
  const netComparison = getComparisonValue(store, filters.outletId, filters.year, selectedMonth, netRow, compareWith);
  const grossComparison = getComparisonValue(store, filters.outletId, filters.year, selectedMonth, grossRow, compareWith);
  const deliveryComparison = getComparisonValue(store, filters.outletId, filters.year, selectedMonth, deliveryRow, compareWith);
  const dineInComparison = getComparisonValue(store, filters.outletId, filters.year, selectedMonth, dineInShareRow, compareWith);

  const metricTrend = (row, current, comparison) => formatVariance(row, current, comparison);
  const sparkline = (row) =>
    visibleMonths.slice(-6).map((month) => {
      const value = getRowValue(store, filters.outletId, filters.year, month.value, row) || 0;
      return {
        label: month.label,
        value: Math.abs(value),
        display: formatRowValue(row, value),
        current: month.value === selectedMonth,
      };
    });

  const grossTotalForVisibleMonths = visibleMonths.reduce((sum, month) => sum + (getRowValue(store, filters.outletId, filters.year, month.value, grossRow) || 0), 0);

  const tableRows = rows.map((row) => {
    if (row.type === "group") return row;
    const cells = visibleMonths.map((month) => {
      const current = getRowValue(store, filters.outletId, filters.year, month.value, row);
      const comparison = getComparisonValue(store, filters.outletId, filters.year, month.value, row, compareWith);
      const variance = formatVariance(row, current, comparison);
      return { month, current, comparison, variance };
    });
    const values = cells.map((cell) => cell.current).filter((value) => value !== null && Number.isFinite(value));
    const total = row.isPercent ? null : values.reduce((sum, value) => sum + value, 0);
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const totalComparison = row.isPercent
      ? null
      : visibleMonths.reduce((sum, month) => {
          const comparison = getComparisonValue(store, filters.outletId, filters.year, month.value, row, compareWith);
          return sum + (Number(comparison) || 0);
        }, 0);
    const contribution = getContribution(row, total, grossTotalForVisibleMonths);
    return { ...row, cells, total, average, totalComparison, contribution };
  });

  const bestChannel = store.salesChannels
    .filter((channel) => channel.type === "channel")
    .map((channel) => ({
      channel,
      amount: getChannelAmount(store.salesRecords, filters.outletId, filters.year, selectedMonth, channel.id),
    }))
    .sort((a, b) => b.amount - a.amount)[0];
  const bestChannelRow = bestChannel ? { id: bestChannel.channel.id, label: bestChannel.channel.name, kind: "channel", channelId: bestChannel.channel.id } : null;
  const bestChannelComparison = bestChannelRow ? getComparisonValue(store, filters.outletId, filters.year, selectedMonth, bestChannelRow, compareWith) : null;
  const bestChannelShare = currentGrossSales && bestChannel ? (bestChannel.amount / currentGrossSales) * 100 : 0;

  const insights = buildBusinessInsights({
    compareLabel,
    compareWith,
    currentNetSales,
    netComparison,
    currentDelivery,
    deliveryComparison,
    currentDineInShare,
    bestChannel,
    bestChannelShare,
    viewMode,
  });

  const hasVisibleData = visibleMonths.length > 0 && tableRows.some((row) => row.type !== "group");

  function highlightRows(ids) {
    setHighlightedRows(new Set(ids));
  }

  return (
    <div className="space-y-4">
      <PageHeader
        section="Sales"
        title="Sales Comparison"
        description="Compare sales performance by month, channel, and selected baseline."
      />

      <FilterBar compact>
        <OutletSelector outlets={store.outlets.filter((outlet) => outlet.status === "active")} value={filters.outletId} onChange={filters.setOutletId} />
        <YearSelector value={filters.year} onChange={filters.setYear} />
        <FieldLabel label="Compare With">
          <select className="control" value={compareWith} onChange={(event) => setCompareWith(event.target.value)}>
            <option>Previous Year</option>
            <option>Previous Month</option>
            <option>3-Month Average</option>
          </select>
        </FieldLabel>
        <FieldLabel label="View Mode">
          <select className="control" value={viewMode} onChange={(event) => setViewMode(event.target.value)}>
            <option>Summary</option>
            <option>Detailed</option>
            <option>Channel Mix</option>
          </select>
        </FieldLabel>
      </FilterBar>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <MetricCard icon={Wallet} label="Net Sales" value={toCurrency(currentNetSales)} helper={`${compareLabel}: ${netComparison ? toCurrency(netComparison) : "-"}`} trend={metricTrend(netRow, currentNetSales, netComparison)} sparklineData={sparkline(netRow)} />
        </div>
        <MetricCard icon={TrendingUp} label="Delivery Sales" value={toCurrency(currentDelivery)} helper={`${compareLabel}: ${deliveryComparison ? toCurrency(deliveryComparison) : "-"}`} trend={metricTrend(deliveryRow, currentDelivery, deliveryComparison)} sparklineData={sparkline(deliveryRow)} onClick={() => highlightRows(["channel-grabfood", "channel-foodpanda", "channel-shopeefood", "delivery"])} />
        <MetricCard icon={Percent} label="Dine In Mix" value={currentDineInShare === null ? "-" : toPercent(currentDineInShare)} helper="Based on Gross Sales" trend={metricTrend(dineInShareRow, currentDineInShare, dineInComparison)} sparklineData={sparkline(dineInShareRow)} onClick={() => highlightRows(["channel-dine-in", "dine-in-share"])} />
        <MetricCard
          icon={bestChannelComparison && bestChannel?.amount < bestChannelComparison ? TrendingDown : TrendingUp}
          label="Best Channel"
          value={bestChannel?.channel.name ?? "-"}
          helper={bestChannel ? `${toCurrency(bestChannel.amount)} · ${toPercent(bestChannelShare)} contribution` : "No data"}
          trend={bestChannelRow ? metricTrend(bestChannelRow, bestChannel.amount, bestChannelComparison) : "-"}
          sparklineData={bestChannelRow ? sparkline(bestChannelRow) : undefined}
          onClick={() => highlightRows(bestChannelRow ? [bestChannelRow.id] : [])}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card
          title="Monthly Sales Matrix"
          description={`${viewMode} view. ${viewMode === "Channel Mix" ? "Channel Mix percentages are based on Gross Sales." : "Gross and Net Sales are system calculated from Sales Input."}`}
          action={
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Badge tone="info">{compareLabel}</Badge>
              <button className="btn-secondary h-9" type="button" onClick={() => ui.notify({ title: "Export queued", message: "Sales comparison CSV is being prepared." })}>
                <Download size={15} /> CSV
              </button>
              <button className="btn-secondary h-9" type="button" onClick={() => ui.notify({ title: "PDF queued", message: "Sales comparison PDF export is mocked." })}>
                <Download size={15} /> PDF
              </button>
              <button className="btn-secondary h-9" type="button" onClick={() => window.print()}>
                <Printer size={15} /> Print
              </button>
            </div>
          }
        >
          {loading ? (
            <div className="space-y-2.5 p-4">
              {[1, 2, 3, 4].map((item) => <div key={item} className="h-10 animate-pulse rounded-xl bg-slate-50" />)}
            </div>
          ) : hasVisibleData ? (
            <SalesMatrix rows={tableRows} visibleMonths={visibleMonths} selectedMonth={selectedMonth} compareWith={compareWith} compareLabel={compareLabel} year={filters.year} highlightedRows={highlightedRows} />
          ) : (
            <div className="p-4">
              <EmptyState title="No sales data found" description="Try another outlet, year, or save sales records for this period first." />
            </div>
          )}
        </Card>

        <InsightPanel insights={insights} />
      </div>
    </div>
  );
}
