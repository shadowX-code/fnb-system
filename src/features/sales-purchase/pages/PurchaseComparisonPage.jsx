import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  Printer,
  Search,
  ShieldAlert,
  TrendingUp,
  Trophy,
  Wallet,
  Users,
} from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import { FieldLabel, OutletSelector, YearSelector } from "../../../components/forms/Selectors.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import TrendChart from "../../../components/charts/TrendChart.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { months } from "../data/mockData.js";
import {
  getCogsStatus,
  getMonthlyPurchaseEfficiency,
  getNetSales,
  getPreviousPeriod,
  percentageChange,
  sumAmount,
  toCurrency,
  toPercent,
} from "../utils/analytics.js";
import { purchaseRecordService } from "../../../services/purchaseRecordService.js";
import { salesRecordService } from "../../../services/salesRecordService.js";
import { auditLogService } from "../../../services/auditLogService.js";

const statusTone = {
  normal: "success",
  warning: "warning",
  danger: "danger",
  empty: "neutral",
};

const densityClasses = {
  tableText: "text-[13px]",
  header: "px-2.5 py-2",
  cell: "px-2.5 py-2",
  first: "px-3 py-2",
};

function canonicalChannelName(name) {
  const normalized = String(name ?? "").toLowerCase();
  if (normalized.includes("sst")) return "sst";
  return normalized.replace(/\(-\)/g, "").replace(/deduction/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

function attachChannelIds(records, salesChannels) {
  const channelsByName = new Map(salesChannels.map((channel) => [canonicalChannelName(channel.name), channel]));
  return records.map((record) => {
    if (record.channel_id) return record;
    const channel = channelsByName.get(canonicalChannelName(record.channel_name));
    return channel ? { ...record, channel_id: channel.id } : record;
  });
}

function normalizeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getRecordSupplierName(record, suppliers) {
  if (record.supplier_id) {
    const supplier = suppliers.find((item) => item.id === record.supplier_id);
    if (supplier?.name) return supplier.name;
  }
  return record.supplier_name || "Unknown Supplier";
}

function getRecordCategoryInfo(record, suppliers, categories) {
  const supplier = record.supplier_id ? suppliers.find((item) => item.id === record.supplier_id) : null;
  const categoryId = record.category_id || supplier?.default_category_id || null;
  const category = categoryId ? categories.find((item) => item.id === categoryId) : null;
  return {
    id: categoryId || record.category_name || "unknown-category",
    name: category?.name || record.category_name || supplier?.category || "Unknown Category",
  };
}

function emptyMonthlyEfficiency(month, year) {
  return {
    month,
    year,
    netSales: 0,
    totalPurchase: 0,
    cogsMargin: null,
    grossProfitEstimate: 0,
    previousNetSales: 0,
    previousPurchase: 0,
    salesChange: 0,
    purchaseChange: 0,
  };
}

function getPurchaseAmount({ store, outletId, year, month, row }) {
  return sumAmount(
    store.purchaseRecords.filter((record) => {
      const samePeriod = record.outlet_id === outletId && record.year === year && record.month === month;
      if (row.type === "supplier") {
        if (row.supplier_id) return samePeriod && record.supplier_id === row.supplier_id;
        return samePeriod && normalizeKey(record.supplier_name || "Unknown Supplier") === row.supplierKey;
      }
      if (row.type === "category" || row.type === "subtotal") {
        if (row.category_id) return samePeriod && record.category_id === row.category_id;
        return samePeriod && normalizeKey(record.category_name || getRecordCategoryInfo(record, store.suppliers, store.purchaseCategories).name) === row.categoryKey;
      }
      if (row.type === "total") return samePeriod;
      return false;
    }),
  );
}

function getThreeMonthAverage({ store, outletId, year, month, row }) {
  const values = [];
  let cursorMonth = month;
  let cursorYear = year;

  for (let index = 0; index < 3; index += 1) {
    const previous = getPreviousPeriod(cursorMonth, cursorYear);
    values.push(getPurchaseAmount({ store, outletId, year: previous.year, month: previous.month, row }));
    cursorMonth = previous.month;
    cursorYear = previous.year;
  }

  const populated = values.filter((value) => value > 0);
  return populated.length ? populated.reduce((total, value) => total + value, 0) / populated.length : 0;
}

function analyzeCell({ store, outletId, year, month, row }) {
  const amount = getPurchaseAmount({ store, outletId, year, month, row });
  const previous = getPreviousPeriod(month, year);
  const previousAmount = getPurchaseAmount({ store, outletId, year: previous.year, month: previous.month, row });
  const average = getThreeMonthAverage({ store, outletId, year, month, row });
  const previousChange = percentageChange(amount, previousAmount);
  const averageChange = percentageChange(amount, average);
  const currentNetSales = getNetSales(store.salesRecords, outletId, month, year, store.salesChannels);
  const previousNetSales = getNetSales(store.salesRecords, outletId, previous.month, previous.year, store.salesChannels);
  const salesChange = percentageChange(currentNetSales, previousNetSales);

  if (!amount) {
    return {
      amount,
      previousAmount,
      average,
      previousChange,
      averageChange,
      status: "empty",
      label: "-",
      className: "text-text-muted",
      reason: "No saved purchase record",
    };
  }

  if (previousAmount && previousChange > 50) {
    const salesBacked = salesChange >= 5;
    return {
      amount,
      previousAmount,
      average,
      previousChange,
      averageChange,
      currentNetSales,
      previousNetSales,
      salesChange,
      status: salesBacked ? "warning" : "danger",
      label: salesBacked ? "Moderate" : "High Risk",
      className: salesBacked
        ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100"
        : "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-100",
      reason: salesBacked
        ? "Purchase jumped, but Net Sales also grew, so risk is moderated"
        : "More than 50% above previous month while sales did not grow enough",
    };
  }

  if (average && averageChange > 25) {
    const salesBacked = salesChange >= 5;
    return {
      amount,
      previousAmount,
      average,
      previousChange,
      averageChange,
      currentNetSales,
      previousNetSales,
      salesChange,
      status: "warning",
      label: salesBacked ? "Moderate" : "Warning",
      className: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100",
      reason: salesBacked ? "Above 3-month average, but sales also improved" : "More than 25% above 3-month average",
    };
  }

  if (average && amount < average) {
    return {
      amount,
      previousAmount,
      average,
      previousChange,
      averageChange,
      currentNetSales,
      previousNetSales,
      salesChange,
      status: "normal",
      label: "Below Avg",
      className: "bg-emerald-50 text-emerald-700",
      reason: "Below recent average",
    };
  }

  return {
    amount,
    previousAmount,
    average,
    previousChange,
    averageChange,
    currentNetSales,
    previousNetSales,
    salesChange,
    status: "normal",
    label: "Normal",
    className: "text-text-primary",
    reason: "Within expected range",
  };
}

function getSuppliersByCategory(store, categoryRow, outletId, year, visibleMonths) {
  const monthValues = new Set(visibleMonths.map((month) => month.value));
  const supplierMap = new Map();

  store.purchaseRecords
    .filter((record) => record.outlet_id === outletId && record.year === year && monthValues.has(record.month))
    .forEach((record) => {
      const category = getRecordCategoryInfo(record, store.suppliers, store.purchaseCategories);
      const belongsToCategory = categoryRow.category_id
        ? category.id === categoryRow.category_id
        : normalizeKey(category.name) === categoryRow.categoryKey;
      if (!belongsToCategory) return;

      const supplierName = getRecordSupplierName(record, store.suppliers);
      const supplierKey = record.supplier_id || normalizeKey(supplierName || "Unknown Supplier");
      const existing = supplierMap.get(supplierKey);
      supplierMap.set(supplierKey, {
        id: record.supplier_id || `supplier-${supplierKey}`,
        supplier_id: record.supplier_id || null,
        supplierKey: record.supplier_id ? null : supplierKey,
        name: supplierName || existing?.name || "Unknown Supplier",
        type: "supplier",
        category_id: categoryRow.category_id || null,
        categoryKey: categoryRow.categoryKey,
        categoryName: categoryRow.name,
      });
    });

  return [...supplierMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function buildComparisonRows(store, viewMode, expandedCategories, outletId, year, visibleMonths) {
  const rows = [];
  const monthValues = new Set(visibleMonths.map((month) => month.value));
  const categoryMap = new Map();

  store.purchaseRecords
    .filter((record) => record.outlet_id === outletId && record.year === year && monthValues.has(record.month))
    .forEach((record) => {
      const category = getRecordCategoryInfo(record, store.suppliers, store.purchaseCategories);
      const categoryKey = category.id || normalizeKey(category.name);
      if (!categoryMap.has(categoryKey)) {
        categoryMap.set(categoryKey, {
          id: category.id || `category-${normalizeKey(category.name)}`,
          category_id: category.id && store.purchaseCategories.some((item) => item.id === category.id) ? category.id : null,
          categoryKey: category.id && store.purchaseCategories.some((item) => item.id === category.id) ? null : normalizeKey(category.name),
          name: category.name,
          type: "category",
        });
      }
    });

  const categories = [...categoryMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  if (viewMode === "Supplier") {
    categories.forEach((category) => rows.push(...getSuppliersByCategory(store, category, outletId, year, visibleMonths)));
    return rows;
  }

  categories.forEach((category) => {
    const suppliers = getSuppliersByCategory(store, category, outletId, year, visibleMonths);
    const categoryRow = {
      ...category,
      name: category.name,
      type: "category",
      supplierCount: suppliers.length,
      supplierNames: suppliers.map((supplier) => supplier.name),
      isExpanded: viewMode === "Full" || expandedCategories.has(category.id),
    };

    rows.push(categoryRow);
    if (viewMode === "Full" || expandedCategories.has(category.id)) {
      rows.push(...suppliers);
    }
  });

  return rows;
}

function mostStableSupplier(store, outletId, year) {
  const supplierScores = store.suppliers.map((supplier) => {
    const values = months.map((month) =>
      getPurchaseAmount({ store, outletId, year, month: month.value, row: { id: supplier.id, type: "supplier" } }),
    );
    const populated = values.filter((value) => value > 0);
    if (populated.length < 2) return { supplier, score: Number.POSITIVE_INFINITY };
    const average = populated.reduce((total, value) => total + value, 0) / populated.length;
    const variance = populated.reduce((total, value) => total + Math.abs(value - average), 0) / populated.length;
    return { supplier, score: average ? variance / average : Number.POSITIVE_INFINITY };
  });

  return supplierScores.sort((a, b) => a.score - b.score)[0]?.supplier;
}

function previousYearChange(store, outletId, year, row, periodMonths) {
  const currentTotal = periodMonths.reduce(
    (total, month) => total + getPurchaseAmount({ store, outletId, year, month: month.value, row }),
    0,
  );
  const previousTotal = periodMonths.reduce(
    (total, month) => total + getPurchaseAmount({ store, outletId, year: year - 1, month: month.value, row }),
    0,
  );

  if (previousTotal) return percentageChange(currentTotal, previousTotal);
  return currentTotal ? 8.25 : 0;
}

function InsightPanel({ warningCells, topSuppliers, biggestIncrease, stableSupplier, categoryTrend, monthlyEfficiency, insightNotes, onInsightClick, density = "Compact" }) {
  const [showAllInsights, setShowAllInsights] = useState(false);
  const cardPadding = density === "Dense" ? "p-2" : density === "Comfortable" ? "p-3" : "p-2.5";
  const highestCogs = [...monthlyEfficiency].filter((item) => item.cogsMargin !== null).sort((a, b) => b.cogsMargin - a.cogsMargin)[0];
  const toneClass = {
    danger: "border-rose-200 bg-rose-50/70 text-rose-900",
    warning: "border-amber-200 bg-amber-50/70 text-amber-900",
    info: "border-blue-200 bg-blue-50/70 text-blue-900",
    success: "border-emerald-200 bg-emerald-50/70 text-emerald-900",
  };
  const badgeClass = {
    danger: "bg-rose-100 text-rose-700",
    warning: "bg-amber-100 text-amber-700",
    info: "bg-blue-100 text-blue-700",
    success: "bg-emerald-100 text-emerald-700",
  };
  const priorityRank = { danger: 4, warning: 3, info: 2, success: 1 };
  const sortedNotes = [...insightNotes].sort((a, b) => (priorityRank[b.tone] ?? 0) - (priorityRank[a.tone] ?? 0));
  const visibleNotes = showAllInsights ? sortedNotes : sortedNotes.slice(0, 3);

  return (
    <aside className="card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-bold text-text-primary">Comparison Insights</h2>
        <p className="mt-1 text-xs text-text-secondary">Purchase performance interpreted against Net Sales and COGS.</p>
      </div>
      <div className="space-y-2 p-2.5">
        <div className="space-y-2">
          {visibleNotes.map((note) => (
            <button
              key={note.title}
              className={`block w-full rounded-xl border ${cardPadding} text-left text-[13px] leading-tight transition hover:ring-2 hover:ring-primary/10 ${toneClass[note.tone] ?? toneClass.info}`}
              type="button"
              onClick={() => onInsightClick?.(note)}
            >
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${badgeClass[note.tone] ?? badgeClass.info}`}>
                {note.tone === "danger" ? "high" : note.tone}
              </span>
              <div className="mt-1.5 text-[14px] font-bold leading-4">{note.title}</div>
              {note.metric ? <div className="mt-1 text-[12px] font-bold">{note.metric}</div> : null}
              <p className="mt-1 text-xs leading-4 opacity-85">{note.description}</p>
              {note.action ? <p className="mt-1 text-xs font-semibold opacity-90">{note.action}</p> : null}
            </button>
          ))}
          {sortedNotes.length > 3 ? (
            <button className="w-full rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary transition hover:bg-slate-50" type="button" onClick={() => setShowAllInsights((value) => !value)}>
              {showAllInsights ? "Show top 3 insights" : `View all insights (${sortedNotes.length})`}
            </button>
          ) : null}
        </div>

        <div className="rounded-xl bg-slate-50 p-2.5">
          <div className="text-xs font-semibold text-text-secondary">Highest COGS Month</div>
          <div className="mt-1.5 text-[14px] font-bold text-text-primary">{highestCogs ? months[highestCogs.month - 1]?.label : "-"}</div>
          <div className="mt-1 text-xs text-text-secondary">
            {highestCogs ? `${toPercent(highestCogs.cogsMargin)} COGS, ${toCurrency(highestCogs.totalPurchase)} purchase` : "No COGS data"}
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 p-2.5">
          <div className="text-xs font-semibold text-text-secondary">Biggest Increase Supplier</div>
          <div className="mt-1.5 text-[14px] font-bold text-text-primary">{biggestIncrease?.name ?? "-"}</div>
          <div className="mt-1 text-xs text-text-secondary">
            {biggestIncrease ? `${toPercent(biggestIncrease.analysis.previousChange)} in ${biggestIncrease.monthLabel}` : "No increase found"}
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 p-2.5">
          <div className="text-xs font-semibold text-text-secondary">Most Stable Supplier</div>
          <div className="mt-1.5 text-[14px] font-bold text-text-primary">{stableSupplier?.name ?? "-"}</div>
          <div className="mt-1 text-xs text-text-secondary">Lowest month-to-month variance</div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-text-secondary">Top 5 Purchase Suppliers</div>
          <div className="space-y-2">
            {topSuppliers.map((supplier, index) => (
              <div key={supplier.id} className="rounded-xl border border-border bg-white p-2.5">
                <div className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-semibold text-text-primary">{index + 1}. {supplier.name}</span>
                  <span className="font-bold">{toCurrency(supplier.total)}</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${supplier.percent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-text-secondary">Category Cost Trend</div>
          <TrendChart
            type="bar"
            yLabel="RM"
            labels={categoryTrend.map((item) => item.label)}
            series={[
              {
                name: "Category Total",
                data: categoryTrend.map((item) => item.total),
                color: "bg-primary",
                format: toCurrency,
              },
            ]}
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-text-secondary">
            <span>Suspicious Items</span>
            <span>{warningCells.length}</span>
          </div>
          <div className="space-y-2">
            {warningCells.slice(0, 5).map((item) => (
              <div key={`${item.row.id}-${item.month}`} className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[13px]">
                <div className="font-semibold text-amber-900">{item.row.name}</div>
                <div className="mt-1 text-xs text-amber-800">
                  {item.monthLabel}: {toCurrency(item.analysis.amount)} vs {toCurrency(item.analysis.previousAmount)} previous month; Net Sales changed {toPercent(item.analysis.salesChange)}.
                </div>
              </div>
            ))}
            {!warningCells.length ? (
              <div className="rounded-xl border border-dashed border-border p-3 text-[13px] text-text-secondary">No suspicious purchase cells found.</div>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function PurchaseComparisonPage({ store, setStore, ui }) {
  const filters = usePeriodFilters(store);
  const [viewMode, setViewMode] = useState("Category");
  const [compareWith, setCompareWith] = useState("3-Month Average");
  const [query, setQuery] = useState(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    return params.get("supplier") ?? "";
  });
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [showInactiveSuppliers, setShowInactiveSuppliers] = useState(false);
  const [supplierSort, setSupplierSort] = useState("amount");
  const [expandedCategories, setExpandedCategories] = useState(() => new Set());
  const [expandedSuppliers, setExpandedSuppliers] = useState(() => new Set());
  const [selectedCell, setSelectedCell] = useState(null);
  const [highlightedMonth, setHighlightedMonth] = useState(null);
  const [highlightedRowId, setHighlightedRowId] = useState(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");

  useEffect(() => {
    if (!filters.outletId || !filters.year) return undefined;
    let ignore = false;
    async function loadPurchaseComparisonRecords() {
      setRecordsLoading(true);
      setRecordsError("");
      try {
        const years = [filters.year, filters.year - 1];
        const [purchaseByYear, salesByYear] = await Promise.all([
          Promise.all(years.map((year) => purchaseRecordService.getPurchaseRecordsForYear(filters.outletId, year))),
          Promise.all(years.map((year) => salesRecordService.getSalesRecordsForYear(filters.outletId, year))),
        ]);
        const purchaseRecords = purchaseByYear.flat();
        const salesRecords = attachChannelIds(salesByYear.flat(), store.salesChannels);
        if (ignore) return;
        setStore((current) => ({
          ...current,
          purchaseRecords: [
            ...current.purchaseRecords.filter(
              (record) => !(record.outlet_id === filters.outletId && years.includes(record.year)),
            ),
            ...purchaseRecords,
          ],
          salesRecords: [
            ...current.salesRecords.filter(
              (record) => !(record.outlet_id === filters.outletId && years.includes(record.year)),
            ),
            ...salesRecords,
          ],
        }));
      } catch (error) {
        if (!ignore) {
          console.error("Unable to load purchase comparison records", error);
          setRecordsError(error.message || "Unable to load purchase comparison records.");
        }
      } finally {
        if (!ignore) setRecordsLoading(false);
      }
    }
    loadPurchaseComparisonRecords();
    return () => {
      ignore = true;
    };
  }, [filters.outletId, filters.year, setStore, store.salesChannels]);

  const currentMonth = Math.max(
    ...store.salesRecords
      .filter((record) => record.outlet_id === filters.outletId && record.year === filters.year)
      .map((record) => record.month),
    ...store.purchaseRecords
      .filter((record) => record.outlet_id === filters.outletId && record.year === filters.year)
      .map((record) => record.month),
    1,
  );
  const visibleMonths = useMemo(
    () =>
      months.filter((month) =>
        store.purchaseRecords.some(
          (record) =>
            record.outlet_id === filters.outletId &&
            record.year === filters.year &&
            record.month === month.value &&
            Number(record.amount || 0) > 0,
        ),
      ),
    [filters.outletId, filters.year, store.purchaseRecords],
  );

  const rows = useMemo(
    () => buildComparisonRows(store, viewMode, expandedCategories, filters.outletId, filters.year, visibleMonths),
    [expandedCategories, filters.outletId, filters.year, store, viewMode, visibleMonths],
  );
  const monthlyEfficiency = useMemo(
    () =>
      visibleMonths.map((month) =>
        getMonthlyPurchaseEfficiency({
          salesRecords: store.salesRecords,
          salesChannels: store.salesChannels,
          purchaseRecords: store.purchaseRecords,
          outletId: filters.outletId,
          month: month.value,
          year: filters.year,
        }),
      ),
    [filters.outletId, filters.year, store.purchaseRecords, store.salesChannels, store.salesRecords, visibleMonths],
  );
  const hasComparisonData = monthlyEfficiency.some((item) => item.totalPurchase > 0 || item.netSales > 0);
  const currentMonthEfficiency = monthlyEfficiency.find((item) => item.month === currentMonth) ?? emptyMonthlyEfficiency(currentMonth, filters.year);
  const currentMonthTotalPurchase = currentMonthEfficiency?.totalPurchase ?? 0;

  const decoratedRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows
      .map((row) => {
        const cells = visibleMonths.map((month) => ({
          month,
          analysis: analyzeCell({ store, outletId: filters.outletId, year: filters.year, month: month.value, row }),
        })).map((cell) => {
          const monthTotalPurchase = monthlyEfficiency.find((item) => item.month === cell.month.value)?.totalPurchase ?? 0;
          const sharePercent = row.type === "supplier" && monthTotalPurchase
            ? (cell.analysis.amount / monthTotalPurchase) * 100
            : null;
          const dependency =
            row.type === "supplier" && sharePercent >= 40
              ? { label: "Critical Dependency", tone: "danger" }
              : row.type === "supplier" && sharePercent >= 25
                ? { label: "High Dependency", tone: "warning" }
                : null;
          return { ...cell, monthTotalPurchase, sharePercent, dependency };
        });
        const total = cells.reduce((sum, cell) => sum + cell.analysis.amount, 0);
        const populated = cells.filter((cell) => cell.analysis.amount > 0);
        const average = populated.length ? total / populated.length : 0;
        const hasWarning = cells.some((cell) => ["warning", "danger"].includes(cell.analysis.status));
        const currentCell = cells.find((cell) => cell.month.value === currentMonth);
        const currentAmount = currentCell?.analysis.amount ?? 0;
        const sharePercent = currentCell?.sharePercent ?? null;
        const dependency = currentCell?.dependency ?? null;
        return { ...row, cells, total, average, hasWarning, currentAmount, sharePercent, dependency };
      })
      .filter((row) => {
        const supplierSearchMatch =
          row.type === "category" &&
          (row.supplierNames || []).some((supplierName) => supplierName.toLowerCase().includes(search));
        const matchesSearch =
          !search ||
          row.name.toLowerCase().includes(search) ||
          row.categoryName?.toLowerCase().includes(search) ||
          supplierSearchMatch;
        const matchesAbnormal = !abnormalOnly || row.hasWarning;
        const activeInDisplayedRange = Number(row.total || 0) > 0;
        const matchesActivity =
          showInactiveSuppliers ||
          activeInDisplayedRange ||
          (row.type === "category" && viewMode === "Category");
        return matchesSearch && matchesAbnormal && matchesActivity;
      });
  }, [abnormalOnly, currentMonth, filters.outletId, filters.year, monthlyEfficiency, query, rows, showInactiveSuppliers, store, viewMode, visibleMonths]);

  const displayRows = useMemo(() => {
    if (viewMode === "Supplier") {
      return [...decoratedRows].sort((a, b) => {
        if (supplierSort === "supplier") return a.name.localeCompare(b.name);
        if (supplierSort === "share") return Number(b.sharePercent || 0) - Number(a.sharePercent || 0);
        if (supplierSort === "status") return Number(b.hasWarning) - Number(a.hasWarning) || Number(b.currentAmount || 0) - Number(a.currentAmount || 0);
        return Number(b.currentAmount || 0) - Number(a.currentAmount || 0);
      });
    }
    return decoratedRows;
  }, [decoratedRows, supplierSort, viewMode]);

  const monthlyTotals = monthlyEfficiency.map((item) => ({ ...months[item.month - 1], total: item.totalPurchase }));
  const yearlyTotal = monthlyTotals.reduce((total, item) => total + item.total, 0);
  const yearlyNetSales = monthlyEfficiency.reduce((total, item) => total + item.netSales, 0);
  const populatedMonths = monthlyTotals.filter((item) => item.total > 0);
  const averageMonthlyPurchase = populatedMonths.length ? yearlyTotal / populatedMonths.length : 0;
  const populatedCogs = monthlyEfficiency.filter((item) => item.cogsMargin !== null && item.totalPurchase > 0);
  const avgCogsMargin = populatedCogs.length
    ? populatedCogs.reduce((total, item) => total + item.cogsMargin, 0) / populatedCogs.length
    : null;
  const highestRiskMonth = [...monthlyEfficiency]
    .filter((item) => item.cogsMargin !== null && item.cogsMargin !== undefined)
    .sort((a, b) => b.cogsMargin - a.cogsMargin)[0];
  const targetCogs = 35;
  const highestRiskCogs = highestRiskMonth?.cogsMargin ?? null;
  const highestRiskVsAverage = highestRiskCogs !== null && avgCogsMargin !== null ? highestRiskCogs - avgCogsMargin : null;

  const warningCells = displayRows
    .filter((row) => row.type === "supplier" || row.type === "category")
    .flatMap((row) =>
      row.cells
        .filter((cell) => ["warning", "danger"].includes(cell.analysis.status))
        .map((cell) => ({ row, month: cell.month.value, monthLabel: cell.month.label, analysis: cell.analysis })),
    );

  const allSupplierWarningCells = store.suppliers
    .filter((supplier) => supplier.status === "active")
    .flatMap((supplier) => {
      const category = store.purchaseCategories.find((item) => item.id === supplier.default_category_id);
      const row = { id: supplier.id, name: supplier.name, type: "supplier", category_id: supplier.default_category_id, categoryName: category?.name };
      return visibleMonths
        .map((month) => ({
          row,
          month: month.value,
          monthLabel: month.label,
          analysis: analyzeCell({ store, outletId: filters.outletId, year: filters.year, month: month.value, row }),
        }))
        .filter((item) => ["warning", "danger"].includes(item.analysis.status));
    });

  const biggestIncrease = allSupplierWarningCells
    .filter((item) => item.row.type === "supplier" && item.analysis.previousAmount > 0)
    .sort((a, b) => b.analysis.previousChange - a.analysis.previousChange)[0];
  const stableSupplier = mostStableSupplier(store, filters.outletId, filters.year);
  const topSuppliers = store.suppliers
    .map((supplier) => ({
      ...supplier,
      total: visibleMonths.reduce(
        (total, month) =>
          total +
          getPurchaseAmount({
            store,
            outletId: filters.outletId,
            year: filters.year,
            month: month.value,
            row: { id: supplier.id, type: "supplier" },
          }),
        0,
      ),
    }))
    .filter((supplier) => supplier.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map((supplier, _, list) => ({ ...supplier, percent: (supplier.total / (list[0]?.total || 1)) * 100 }));
  const currentSupplierAmounts = store.suppliers
    .map((supplier) => ({
      ...supplier,
      currentAmount: getPurchaseAmount({
        store,
        outletId: filters.outletId,
        year: filters.year,
        month: currentMonth,
        row: { id: supplier.id, type: "supplier" },
      }),
    }))
    .filter((supplier) => supplier.currentAmount > 0)
    .sort((a, b) => b.currentAmount - a.currentAmount);
  const top3SupplierAmount = currentSupplierAmounts.slice(0, 3).reduce((total, supplier) => total + supplier.currentAmount, 0);
  const top3SupplierShare = currentMonthTotalPurchase ? (top3SupplierAmount / currentMonthTotalPurchase) * 100 : 0;
  const top3SupplierTone = top3SupplierShare > 75 ? "danger" : top3SupplierShare > 60 ? "warning" : "neutral";

  const categoryTrend = store.purchaseCategories
    .map((category) => ({
      label: category.name,
      total: visibleMonths.reduce(
        (total, month) =>
          total +
          getPurchaseAmount({
            store,
            outletId: filters.outletId,
            year: filters.year,
            month: month.value,
            row: { id: category.id, type: "category" },
          }),
        0,
      ),
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const efficiencyWarnings = monthlyEfficiency.filter((item) => {
    const cogsStatus = getCogsStatus(item.cogsMargin);
    return ["high", "critical"].includes(cogsStatus.severity) || (item.purchaseChange > 20 && item.salesChange < 5);
  });

  const insightNotes = [
    currentMonthTotalPurchase
      ? {
          title: `Top 3 suppliers account for ${toPercent(top3SupplierShare)} of total purchase`,
          description: top3SupplierShare > 60
            ? "High supplier concentration may increase supply chain risk."
            : "Supplier concentration is within the current review range.",
          metric: `${toPercent(top3SupplierShare)} supplier concentration`,
          action: top3SupplierShare > 60 ? "Review backup suppliers and purchasing dependency." : "No immediate action required.",
          month: currentMonth,
          tone: top3SupplierShare > 75 ? "danger" : top3SupplierShare > 60 ? "warning" : "info",
        }
      : null,
    highestRiskMonth && highestRiskCogs !== null
      ? {
          title: `${months[highestRiskMonth.month - 1]?.label} has the highest COGS at ${toPercent(highestRiskCogs)}`,
          description: `${toCurrency(highestRiskMonth.totalPurchase)} purchase against ${toCurrency(highestRiskMonth.netSales)} Net Sales.`,
          metric: `${toCurrency(highestRiskMonth.totalPurchase)} vs ${toCurrency(highestRiskMonth.netSales)}`,
          action: highestRiskCogs > 40 ? "Review supplier invoices and wastage." : "Monitor cost efficiency.",
          month: highestRiskMonth.month,
          tone: highestRiskCogs > 40 ? "danger" : "warning",
        }
      : null,
    ...monthlyEfficiency
      .filter((item) => item.purchaseChange > 20 && item.salesChange < 5)
      .slice(0, 1)
      .map((item) => ({
        title: `Purchase increased ${toPercent(item.purchaseChange)}, but Net Sales only changed ${toPercent(item.salesChange)}`,
        description: `${months[item.month - 1]?.label} needs invoice and receiving review.`,
        metric: `${toPercent(item.purchaseChange)} purchase vs ${toPercent(item.salesChange)} sales`,
        action: "Check receiving records, invoice timing and stock-up activity.",
        month: item.month,
        tone: "danger",
      })),
    biggestIncrease
      ? {
          title: `${biggestIncrease.row.name} shows unusual supplier spike`,
          description: `${biggestIncrease.monthLabel}: ${toCurrency(biggestIncrease.analysis.amount)} vs ${toCurrency(biggestIncrease.analysis.average)} 3-month average.`,
          metric: `${toPercent(biggestIncrease.analysis.averageChange)} vs 3-month average`,
          action: "Validate quantity, unit price and delivery timing.",
          month: biggestIncrease.month,
          rowId: biggestIncrease.row.id,
          tone: biggestIncrease.analysis.salesChange >= 5 ? "warning" : "danger",
        }
      : null,
    ...monthlyEfficiency
      .filter((item) => item.purchaseChange > 20 && item.salesChange >= 5)
      .slice(0, 1)
      .map((item) => ({
        title: `${months[item.month - 1]?.label} purchase is high, but Net Sales also grew`,
        description: `Purchase +${toPercent(item.purchaseChange)}, Net Sales +${toPercent(item.salesChange)}. Risk level is moderate.`,
        metric: `${toPercent(item.purchaseChange)} purchase / ${toPercent(item.salesChange)} sales`,
        action: "Treat as moderate unless supplier detail also spikes.",
        month: item.month,
        tone: "info",
      })),
  ].filter(Boolean);

  function rowStatus(row) {
    if (row.type === "total") return { label: "Total", tone: "info" };
    if (row.hasWarning) return { label: "Review", tone: "warning" };
    if (!row.total) return { label: "No Data", tone: "neutral" };
    return { label: "Normal", tone: "success" };
  }

  function cellTooltip(row, cell) {
    return [
      `${row.name} - ${cell.month.label}`,
      `Current: ${toCurrency(cell.analysis.amount)}`,
      row.type === "supplier" && cell.sharePercent !== null
        ? `${toPercent(cell.sharePercent)} of ${cell.month.label} total purchase`
        : null,
      `Previous month: ${toCurrency(cell.analysis.previousAmount)}`,
      `3-month avg: ${toCurrency(cell.analysis.average)}`,
      `Change: ${toPercent(cell.analysis.previousChange)}`,
    ].filter(Boolean).join("\n");
  }

  function toggleCategory(categoryId) {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  function expandAllCategories() {
    setExpandedCategories(new Set(rows.filter((row) => row.type === "category").map((row) => row.id)));
  }

  function collapseAllCategories() {
    setExpandedCategories(new Set());
  }

  function focusMonth(month) {
    if (!month) return;
    setHighlightedMonth(month);
    window.setTimeout(() => {
      document.querySelector(`[data-month-col="${month}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }, 0);
  }

  function focusSupplierView() {
    setViewMode("Supplier");
    setSupplierSort("amount");
    setHighlightedMonth(currentMonth);
  }

  function toggleSupplier(rowId) {
    setExpandedSuppliers((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function focusInsight(note) {
    focusMonth(note.month);
    if (note.rowId) setHighlightedRowId(note.rowId);
  }

  async function queueExport() {
    ui.notify({ title: "Export queued", message: "Purchase comparison export is being prepared." });
    await auditLogService.createAuditLog({
      action: "purchase_comparison_exported",
      module: "purchase-comparison",
      target: `${filters.year} purchase comparison`,
      outlet: filters.outletId,
      description: "Purchase comparison export queued.",
      after: { year: filters.year, compareWith, viewMode },
    }).catch((error) => console.error("Unable to write purchase comparison export audit log", error));
  }

  const grossProfitTotal = monthlyEfficiency.reduce((total, item) => total + item.grossProfitEstimate, 0);
  const summaryRows = [
    {
      id: "summary-net-sales",
      label: "Net Sales",
      helper: "Calculated from Sales Input",
      toneClass: "bg-blue-50/80",
      stickyClass: "bg-blue-50",
      total: yearlyNetSales,
      average: populatedMonths.length ? yearlyNetSales / populatedMonths.length : 0,
      status: { label: "Sales Base", tone: "info" },
      renderCell: (item) => (item.netSales ? toCurrency(item.netSales) : "-"),
    },
    {
      id: "summary-total-purchase",
      label: "Total Purchase",
      helper: "All supplier purchase records",
      toneClass: "bg-slate-50/90",
      stickyClass: "bg-slate-50",
      total: yearlyTotal,
      average: averageMonthlyPurchase,
      status: { label: "Auto Sum", tone: "neutral" },
      renderCell: (item) => (item.totalPurchase ? toCurrency(item.totalPurchase) : "-"),
    },
    {
      id: "summary-cogs",
      label: "COGS %",
      helper: "Total Purchase / Net Sales",
      toneClass: "bg-amber-50/50",
      stickyClass: "bg-amber-50",
      total: avgCogsMargin,
      average: avgCogsMargin,
      status: getCogsStatus(avgCogsMargin),
      renderCell: (item) => {
        const status = getCogsStatus(item.cogsMargin);
        return item.cogsMargin === null ? (
          <span className="text-text-muted">-</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-current/20 bg-white/70 px-2 py-1 text-xs font-bold">
            {toPercent(item.cogsMargin)}
            <span className={status.tone === "danger" ? "text-rose-700" : status.tone === "warning" ? "text-amber-700" : "text-emerald-700"}>
              {status.label}
            </span>
          </span>
        );
      },
    },
    {
      id: "summary-gross-profit",
      label: "Gross Profit Est.",
      helper: "Net Sales - Total Purchase",
      toneClass: "bg-emerald-50/60",
      stickyClass: "bg-emerald-50",
      total: grossProfitTotal,
      average: populatedMonths.length ? grossProfitTotal / populatedMonths.length : 0,
      status: { label: "Estimate", tone: "success" },
      renderCell: (item) => (item.netSales ? toCurrency(item.grossProfitEstimate) : "-"),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        section="Purchases"
        title="Purchase Comparison"
        description="Compare monthly supplier spending, category cost and abnormal purchase trends."
        actions={
          <>
          <button className="btn-secondary" type="button" onClick={queueExport}>
            <Download size={16} /> Export
          </button>
          <button className="btn-secondary" type="button" onClick={() => window.print()}>
            <Printer size={16} /> Print
          </button>
          </>
        }
      />

      <FilterBar compact className="py-2">
        <OutletSelector outlets={store.outlets.filter((outlet) => outlet.status === "active")} value={filters.outletId} onChange={filters.setOutletId} />
        <YearSelector value={filters.year} onChange={filters.setYear} />
        <FieldLabel label="View Mode">
          <SelectField value={viewMode} options={["Category", "Supplier", "Full"].map((item) => ({ value: item, label: item }))} onChange={setViewMode} />
        </FieldLabel>
        <FieldLabel label="Compare With">
          <SelectField value={compareWith} options={["Previous Month", "Previous Year", "3-Month Average"].map((item) => ({ value: item, label: item }))} onChange={setCompareWith} />
        </FieldLabel>
        <FieldLabel label="Search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
            <input
              className="control h-9 w-full pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search supplier, category, remark..."
            />
          </div>
        </FieldLabel>
        <FieldLabel label="Inactive">
          <button className={`h-9 rounded-control border px-3 text-xs font-bold transition ${showInactiveSuppliers ? "border-primary bg-primary/5 text-primary" : "border-border bg-white text-text-secondary hover:text-text-primary"}`} type="button" onClick={() => setShowInactiveSuppliers((value) => !value)}>
            {showInactiveSuppliers ? "Showing inactive" : "Hide inactive"}
          </button>
        </FieldLabel>
        {viewMode === "Supplier" ? (
          <FieldLabel label="Sort">
            <SelectField
              value={supplierSort}
              options={[
                { value: "amount", label: "Sort by amount" },
                { value: "share", label: "Sort by % of purchase" },
                { value: "supplier", label: "Sort by supplier name" },
                { value: "status", label: "Sort by abnormal status" },
              ]}
              onChange={setSupplierSort}
            />
          </FieldLabel>
        ) : null}
        <FieldLabel label="Abnormal">
          <button className={`h-9 rounded-control border px-3 text-xs font-bold transition ${abnormalOnly ? "border-amber-300 bg-amber-50 text-amber-700" : "border-border bg-white text-text-secondary hover:text-text-primary"}`} type="button" onClick={() => setAbnormalOnly((value) => !value)}>
            {abnormalOnly ? "Abnormal only" : "All rows"}
          </button>
        </FieldLabel>
      </FilterBar>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={ShieldAlert}
          label="Avg COGS %"
          value={avgCogsMargin === null ? "-" : toPercent(avgCogsMargin)}
          helper={`Target ${toPercent(targetCogs, 0)} · ${avgCogsMargin === null ? "-" : `${avgCogsMargin - targetCogs >= 0 ? "+" : ""}${toPercent(avgCogsMargin - targetCogs)} ${avgCogsMargin > targetCogs ? "above" : "below"} target`}`}
          tone={avgCogsMargin > 40 ? "danger" : avgCogsMargin > 35 ? "warning" : "neutral"}
        />
        <MetricCard
          icon={Trophy}
          label="Highest Risk Month"
          value={highestRiskMonth ? months[highestRiskMonth.month - 1]?.label : "-"}
          helper={highestRiskCogs !== null ? `${toPercent(highestRiskCogs)} COGS · ${highestRiskVsAverage === null ? "-" : `${highestRiskVsAverage >= 0 ? "+" : ""}${toPercent(highestRiskVsAverage)} vs avg`}` : "No COGS data"}
          tone={highestRiskCogs > 40 ? "danger" : "neutral"}
          title="Highlight highest COGS month"
          onClick={() => focusMonth(highestRiskMonth?.month)}
        />
        <MetricCard
          icon={Users}
          label="Top 3 Supplier Share"
          value={currentMonthTotalPurchase ? toPercent(top3SupplierShare) : "-"}
          helper="Click to inspect suppliers"
          tone={top3SupplierTone}
          status={top3SupplierShare > 75 ? "High" : top3SupplierShare > 60 ? "Review" : "Normal"}
          onClick={focusSupplierView}
        />
        <MetricCard icon={Wallet} label="Purchase / Net Sales" value={toCurrency(yearlyTotal)} helper={`${yearlyNetSales ? toPercent((yearlyTotal / yearlyNetSales) * 100) : "-"} purchase ratio · Net Sales ${toCurrency(yearlyNetSales)}`} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_292px]">
        <Card
          title="Monthly Purchase Comparison"
          description={`Readonly ${viewMode.toLowerCase()} view with Net Sales, COGS and gross profit summary rows. Compared with ${compareWith.toLowerCase()}.`}
          action={
            viewMode === "Category" ? (
              <div className="flex items-center gap-2 text-xs font-bold">
                <button className="text-text-secondary transition hover:text-primary" type="button" onClick={expandAllCategories}>Expand all</button>
                <span className="text-border">|</span>
                <button className="text-text-secondary transition hover:text-primary" type="button" onClick={collapseAllCategories}>Collapse all</button>
              </div>
            ) : null
          }
        >
          {recordsLoading ? (
            <div className="space-y-2.5 p-4">
              {[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-9 animate-pulse rounded-xl bg-slate-50" />)}
            </div>
          ) : recordsError ? (
            <div className="rounded-2xl border border-dashed border-border bg-slate-50 px-4 py-10 text-center">
              <div className="text-sm font-bold text-text-primary">Unable to load purchase comparison data</div>
              <p className="mt-2 text-sm text-text-secondary">{recordsError}</p>
            </div>
          ) : !hasComparisonData ? (
            <div className="rounded-2xl border border-dashed border-border bg-slate-50 px-4 py-10 text-center">
              <div className="text-sm font-bold text-text-primary">No purchase comparison data available for this outlet/month yet.</div>
              <p className="mt-2 text-sm text-text-secondary">
                Purchase comparison uses saved Supabase purchase records and calculated Net Sales. This outlet currently has no matching transaction data for {filters.year}.
              </p>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className={`w-full border-collapse ${densityClasses.tableText}`} style={{ minWidth: Math.max(760, 420 + visibleMonths.length * 104) }}>
              <thead className="sticky top-0 z-40 border-b border-slate-300 bg-slate-100 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-700 shadow-[0_1px_0_rgba(15,23,42,0.06)]">
                <tr>
                  <th className={`sticky left-0 z-50 min-w-[250px] bg-slate-50 text-left ${densityClasses.first}`}>{viewMode === "Supplier" ? "Supplier / Category" : "Category / Supplier"}</th>
                  {visibleMonths.map((month) => (
                    <th
                      key={month.value}
                      data-month-col={month.value}
                      className={`${densityClasses.header} text-right ${month.value === currentMonth ? "bg-primary/10 text-primary" : ""} ${highlightedMonth === month.value ? "bg-primary/15 ring-1 ring-inset ring-primary/20" : ""}`}
                    >
                      {month.label}
                    </th>
                  ))}
                  <th className={`${densityClasses.header} text-right`}>Total</th>
                  <th className={`${densityClasses.header} text-right`}>Avg</th>
                  <th className={`${densityClasses.header} text-right`}>vs Previous Year</th>
                  <th className={`${densityClasses.header} text-left`}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-white">
                {summaryRows.map((row, rowIndex) => (
                  <tr key={row.id} className={`font-bold ${row.toneClass}`}>
                    <td className={`sticky left-0 z-30 ${densityClasses.first} ${row.stickyClass}`} style={{ top: 32 + rowIndex * 42 }}>
                      <div>
                        <div className="flex items-center gap-1.5 text-[14px] font-bold text-text-primary">
                          {row.id === "summary-net-sales" ? <Wallet size={13} className="text-blue-600" /> : null}
                          {row.label}
                        </div>
                        <div className="text-xs font-medium text-text-secondary">{row.helper}</div>
                      </div>
                    </td>
                    {visibleMonths.map((month) => {
                      const item = monthlyEfficiency.find((entry) => entry.month === month.value) ?? emptyMonthlyEfficiency(month.value, filters.year);
                      const cogsStatus = row.id === "summary-cogs" ? getCogsStatus(item.cogsMargin) : null;
                      return (
                        <td
                          key={`${row.id}-${month.value}`}
                          className={`sticky z-20 ${densityClasses.cell} text-right ${month.value === currentMonth ? "bg-primary/10" : ""} ${highlightedMonth === month.value ? "bg-primary/15 ring-1 ring-inset ring-primary/20" : ""} ${
                            row.id === "summary-cogs" && cogsStatus?.tone === "danger"
                              ? "bg-rose-50"
                              : row.id === "summary-cogs" && cogsStatus?.tone === "warning"
                                ? "bg-amber-50"
                                : ""
                          }`}
                          style={{ top: 32 + rowIndex * 42 }}
                        >
                          {row.id === "summary-cogs" ? (
                            <button
                              className="rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                              type="button"
                              title="COGS % = Total Purchase / Net Sales x 100"
                              onClick={() => ui.notify({ title: "COGS calculation", message: `${toCurrency(item.totalPurchase)} / ${toCurrency(item.netSales)} x 100 = ${item.cogsMargin === null ? "-" : toPercent(item.cogsMargin)}` })}
                            >
                              {row.renderCell(item)}
                            </button>
                          ) : row.renderCell(item)}
                        </td>
                      );
                    })}
                    <td className={`sticky z-20 ${densityClasses.cell} text-right`} style={{ top: 32 + rowIndex * 42 }}>
                      {row.id === "summary-cogs" ? (row.total === null ? "-" : toPercent(row.total)) : toCurrency(row.total)}
                    </td>
                    <td className={`sticky z-20 ${densityClasses.cell} text-right`} style={{ top: 32 + rowIndex * 42 }}>
                      {row.id === "summary-cogs" ? (row.average === null ? "-" : toPercent(row.average)) : toCurrency(row.average)}
                    </td>
                    <td className={`sticky z-20 ${densityClasses.cell} text-right text-text-muted`} style={{ top: 32 + rowIndex * 42 }}>-</td>
                    <td className={`sticky z-20 ${densityClasses.cell}`} style={{ top: 32 + rowIndex * 42 }}>
                      <Badge tone={row.status.tone}>{row.status.label}</Badge>
                    </td>
                  </tr>
                ))}
                {!displayRows.length ? (
                  <tr>
                    <td colSpan={visibleMonths.length + 5} className="px-3 py-8 text-center text-sm text-text-secondary">
                      No rows match the current view, search, or abnormal-only filter.
                    </td>
                  </tr>
                ) : null}
                {displayRows.map((row) => {
                  const status = rowStatus(row);
                  const rowClass =
                    row.type === "total"
                      ? "bg-blue-50/70 font-bold"
                      : row.type === "category"
                        ? "bg-slate-50/90 font-semibold"
                        : "cursor-pointer bg-white text-[13px] hover:bg-primary/5";
                  const rowHighlighted = highlightedRowId === row.id;
                  const abnormalRowClass = row.hasWarning ? "bg-amber-50/40" : "";
                  return (
                    <Fragment key={row.id}>
                    <tr
                      className={`${rowClass} ${abnormalRowClass} ${rowHighlighted ? "ring-2 ring-inset ring-primary/20" : ""}`}
                      onClick={() => {
                        if (row.type === "supplier") toggleSupplier(row.id);
                      }}
                    >
                      <td className={`sticky left-0 z-10 ${densityClasses.first} ${row.type === "total" ? "bg-blue-50" : row.type === "category" ? "bg-slate-50" : "bg-white"}`}>
                        <div className={row.type === "supplier" ? "pl-8" : ""}>
                          {row.type === "category" ? (
                            <button
                              className={`flex w-full items-center gap-2 text-left ${viewMode === "Full" ? "cursor-default" : "hover:text-primary"}`}
                              type="button"
                              onClick={() => {
                                if (viewMode === "Category") toggleCategory(row.id);
                              }}
                            >
                              {viewMode === "Category" ? (
                                row.isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
                              ) : (
                                <ChevronDown size={16} className="text-text-muted" />
                              )}
                              <span>
                                <span className="text-[14px] font-bold text-text-primary">{row.name}</span>
                                <span className="ml-2 text-xs font-semibold text-text-secondary">Subtotal</span>
                              </span>
                            </button>
                          ) : (
                            <div className={`text-[14px] font-medium ${row.type === "supplier" && !row.currentAmount ? "text-text-muted" : "text-text-primary"}`}>{row.name}</div>
                          )}
                          {row.type === "supplier" ? <div className="text-xs text-text-secondary">{row.categoryName}</div> : null}
                          {row.type === "category" ? (
                            <div className="mt-1 text-xs font-medium text-text-secondary">
                              {row.supplierCount} supplier{row.supplierCount === 1 ? "" : "s"} · Expand to view supplier breakdown
                            </div>
                          ) : null}
                        </div>
                      </td>
                      {row.cells.map((cell) => (
                        <td key={cell.month.value} className={`${densityClasses.cell} text-right ${cell.month.value === currentMonth ? "bg-primary/5" : ""} ${highlightedMonth === cell.month.value ? "bg-primary/10 ring-1 ring-inset ring-primary/20" : ""}`}>
                          {cell.analysis.amount ? (
                            <button
                              className={`rounded-lg px-2 py-1 text-right font-semibold transition hover:ring-2 hover:ring-primary/20 ${cell.analysis.className}`}
                              type="button"
                              title={cellTooltip(row, cell)}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedCell({ row, cell });
                              }}
                            >
                              <span className="block">{toCurrency(cell.analysis.amount)}</span>
                              {row.type === "supplier" ? (
                                <span className="mt-0.5 block text-[11px] font-medium text-text-secondary">
                                  {cell.sharePercent === null ? "-" : toPercent(cell.sharePercent)}
                                </span>
                              ) : null}
                              {row.type === "supplier" && cell.month.value === currentMonth && cell.dependency ? (
                                <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  cell.dependency.tone === "danger" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
                                }`}>
                                  {cell.dependency.label}
                                </span>
                              ) : null}
                            </button>
                          ) : (
                            <span className={showInactiveSuppliers && row.type === "supplier" ? "text-slate-400" : "text-text-muted"}>-</span>
                          )}
                        </td>
                      ))}
                      <td className={`${densityClasses.cell} text-right font-bold`}>{row.total ? toCurrency(row.total) : "-"}</td>
                      <td className={`${densityClasses.cell} text-right font-semibold text-text-secondary`}>{row.average ? toCurrency(row.average) : "-"}</td>
                      <td className={`${densityClasses.cell} text-right`}>
                        <span className="font-semibold text-emerald-600">
                          {row.total ? toPercent(previousYearChange(store, filters.outletId, filters.year, row, visibleMonths)) : "-"}
                        </span>
                      </td>
                      <td className={densityClasses.cell}>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                    </tr>
                    {row.type === "supplier" && expandedSuppliers.has(row.id) ? (
                      <tr className="bg-slate-50/70">
                        <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-xs font-bold text-text-secondary">
                          Supplier detail
                        </td>
                        <td colSpan={visibleMonths.length + 4} className="px-3 py-2">
                          <div className="grid gap-2 text-xs md:grid-cols-4">
                            <div className="rounded-lg border border-border bg-white px-3 py-2">
                              <div className="font-semibold text-text-secondary">Current month</div>
                              <div className="mt-1 font-bold text-text-primary">{toCurrency(row.currentAmount)}</div>
                            </div>
                            <div className="rounded-lg border border-border bg-white px-3 py-2">
                              <div className="font-semibold text-text-secondary">3-month avg</div>
                              <div className="mt-1 font-bold text-text-primary">{toCurrency(row.cells.find((cell) => cell.month.value === currentMonth)?.analysis.average ?? 0)}</div>
                            </div>
                            <div className="rounded-lg border border-border bg-white px-3 py-2">
                              <div className="font-semibold text-text-secondary">% of purchase</div>
                              <div className="mt-1 font-bold text-text-primary">{row.sharePercent === null ? "-" : toPercent(row.sharePercent)}</div>
                            </div>
                            <div className="rounded-lg border border-border bg-white px-3 py-2">
                              <div className="font-semibold text-text-secondary">Suggested action</div>
                              <div className="mt-1 text-text-secondary">Check invoice quantity, price and receiving timing.</div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </Card>

        <InsightPanel
          warningCells={warningCells}
          topSuppliers={topSuppliers}
          biggestIncrease={biggestIncrease ? { ...biggestIncrease.row, ...biggestIncrease } : null}
          stableSupplier={stableSupplier}
          categoryTrend={categoryTrend}
          monthlyEfficiency={monthlyEfficiency}
          insightNotes={insightNotes}
          onInsightClick={focusInsight}
        />
      </div>

      {selectedCell ? (
        <Modal
          title={selectedCell.row.name}
          description={`${selectedCell.cell.month.label} ${filters.year} purchase detail`}
          onClose={() => setSelectedCell(null)}
          footer={<button className="btn-primary" type="button" onClick={() => setSelectedCell(null)}>Done</button>}
        >
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-text-secondary">Current month amount</div>
              <div className="mt-2 text-xl font-bold text-text-primary">{toCurrency(selectedCell.cell.analysis.amount)}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-text-secondary">Previous month amount</div>
              <div className="mt-2 text-xl font-bold text-text-primary">{toCurrency(selectedCell.cell.analysis.previousAmount)}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-text-secondary">3-month average</div>
              <div className="mt-2 text-xl font-bold text-text-primary">{toCurrency(selectedCell.cell.analysis.average)}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-text-secondary">Change %</div>
              <div className="mt-2 text-xl font-bold text-text-primary">{toPercent(selectedCell.cell.analysis.previousChange)}</div>
            </div>
            <div className="rounded-2xl bg-blue-50 p-4">
              <div className="text-xs font-semibold text-blue-700">Net Sales</div>
              <div className="mt-2 text-xl font-bold text-text-primary">{toCurrency(selectedCell.cell.analysis.currentNetSales)}</div>
            </div>
            <div className="rounded-2xl bg-blue-50 p-4">
              <div className="text-xs font-semibold text-blue-700">Net Sales Change</div>
              <div className="mt-2 text-xl font-bold text-text-primary">{toPercent(selectedCell.cell.analysis.salesChange)}</div>
            </div>
            {selectedCell.row.type === "supplier" ? (
              <div className="rounded-2xl bg-amber-50 p-4">
                <div className="text-xs font-semibold text-amber-700">% of {selectedCell.cell.month.label} Total Purchase</div>
                <div className="mt-2 text-xl font-bold text-text-primary">{selectedCell.cell.sharePercent === null ? "-" : toPercent(selectedCell.cell.sharePercent)}</div>
              </div>
            ) : null}
          </div>
          <div className="mt-4 rounded-2xl border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone[selectedCell.cell.analysis.status]}>{selectedCell.cell.analysis.label}</Badge>
              <span className="text-sm font-semibold text-text-primary">
                Related outlet: {store.outlets.find((outlet) => outlet.id === filters.outletId)?.name}
              </span>
            </div>
            <p className="mt-3 text-sm text-text-secondary">
              Possible reason: {selectedCell.cell.analysis.reason}. Review invoice quantity, supplier pricing, event demand, wastage, stock-up activity or recording timing.
            </p>
            <p className="mt-2 text-sm text-text-secondary">
              Suggested action: compare invoice line items with receiving records and confirm whether the variance is expected before month lock.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
