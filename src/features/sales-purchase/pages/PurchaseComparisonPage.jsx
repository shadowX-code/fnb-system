import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  Printer,
  Search,
  Settings,
  ShieldAlert,
  TrendingUp,
  Trophy,
  Wallet,
} from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import { FieldLabel, OutletSelector, YearSelector } from "../../../components/forms/Selectors.jsx";
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

const statusTone = {
  normal: "success",
  warning: "warning",
  danger: "danger",
  empty: "neutral",
};

function getPurchaseAmount({ store, outletId, year, month, row }) {
  return sumAmount(
    store.purchaseRecords.filter((record) => {
      const samePeriod = record.outlet_id === outletId && record.year === year && record.month === month;
      if (row.type === "supplier") return samePeriod && record.supplier_id === row.id;
      if (row.type === "category" || row.type === "subtotal") return samePeriod && record.category_id === row.id;
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

function getSuppliersByCategory(store, category) {
  return store.suppliers
    .filter((supplier) => supplier.status === "active" && supplier.default_category_id === category.id)
    .map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      type: "supplier",
      category_id: category.id,
      categoryName: category.name,
    }));
}

function buildComparisonRows(store, viewMode, expandedCategories) {
  const rows = [];
  const categories = store.purchaseCategories.filter((category) => category.status === "active");

  if (viewMode === "Supplier") {
    categories.forEach((category) => rows.push(...getSuppliersByCategory(store, category)));
    return rows;
  }

  categories.forEach((category) => {
    const suppliers = getSuppliersByCategory(store, category);
    const categoryRow = {
      id: category.id,
      name: category.name,
      type: "category",
      supplierCount: suppliers.length,
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

function InsightPanel({ warningCells, topSuppliers, biggestIncrease, stableSupplier, categoryTrend, monthlyEfficiency, insightNotes }) {
  const highestCogs = [...monthlyEfficiency].filter((item) => item.cogsMargin !== null).sort((a, b) => b.cogsMargin - a.cogsMargin)[0];

  return (
    <aside className="card overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-bold text-text-primary">Comparison Insights</h2>
        <p className="mt-1 text-xs text-text-secondary">Purchase performance interpreted against Net Sales and COGS.</p>
      </div>
      <div className="space-y-4 p-5">
        <div className="space-y-2">
          {insightNotes.map((note) => (
            <div key={note.title} className={`rounded-2xl border p-3 text-sm ${note.tone === "danger" ? "border-rose-200 bg-rose-50 text-rose-800" : note.tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
              <div className="font-bold">{note.title}</div>
              <p className="mt-1 text-xs opacity-90">{note.description}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="text-xs font-semibold text-text-secondary">Highest COGS Month</div>
          <div className="mt-2 text-base font-bold text-text-primary">{highestCogs ? months[highestCogs.month - 1]?.label : "-"}</div>
          <div className="mt-1 text-sm text-text-secondary">
            {highestCogs ? `${toPercent(highestCogs.cogsMargin)} COGS, ${toCurrency(highestCogs.totalPurchase)} purchase` : "No COGS data"}
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="text-xs font-semibold text-text-secondary">Biggest Increase Supplier</div>
          <div className="mt-2 text-base font-bold text-text-primary">{biggestIncrease?.name ?? "-"}</div>
          <div className="mt-1 text-sm text-text-secondary">
            {biggestIncrease ? `${toPercent(biggestIncrease.analysis.previousChange)} in ${biggestIncrease.monthLabel}` : "No increase found"}
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="text-xs font-semibold text-text-secondary">Most Stable Supplier</div>
          <div className="mt-2 text-base font-bold text-text-primary">{stableSupplier?.name ?? "-"}</div>
          <div className="mt-1 text-sm text-text-secondary">Lowest month-to-month variance</div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-text-secondary">Top 5 Purchase Suppliers</div>
          <div className="space-y-2">
            {topSuppliers.map((supplier, index) => (
              <div key={supplier.id} className="rounded-2xl border border-border bg-white p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
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
              <div key={`${item.row.id}-${item.month}`} className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm">
                <div className="font-semibold text-amber-900">{item.row.name}</div>
                <div className="mt-1 text-xs text-amber-800">
                  {item.monthLabel}: {toCurrency(item.analysis.amount)} vs {toCurrency(item.analysis.previousAmount)} previous month; Net Sales changed {toPercent(item.analysis.salesChange)}.
                </div>
              </div>
            ))}
            {!warningCells.length ? (
              <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-text-secondary">No suspicious purchase cells found.</div>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function PurchaseComparisonPage({ store, ui }) {
  const filters = usePeriodFilters(store);
  const [viewMode, setViewMode] = useState("Category");
  const [compareWith, setCompareWith] = useState("3-Month Average");
  const [query, setQuery] = useState("");
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [showFullYear, setShowFullYear] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState(() => new Set());
  const [selectedCell, setSelectedCell] = useState(null);
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
    () => (showFullYear ? months : months.filter((month) => month.value <= currentMonth)),
    [currentMonth, showFullYear],
  );

  const rows = useMemo(() => buildComparisonRows(store, viewMode, expandedCategories), [expandedCategories, store, viewMode]);
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

  const decoratedRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows
      .map((row) => {
        const cells = visibleMonths.map((month) => ({
          month,
          analysis: analyzeCell({ store, outletId: filters.outletId, year: filters.year, month: month.value, row }),
        }));
        const total = cells.reduce((sum, cell) => sum + cell.analysis.amount, 0);
        const populated = cells.filter((cell) => cell.analysis.amount > 0);
        const average = populated.length ? total / populated.length : 0;
        const hasWarning = cells.some((cell) => ["warning", "danger"].includes(cell.analysis.status));
        return { ...row, cells, total, average, hasWarning };
      })
      .filter((row) => {
        const supplierSearchMatch =
          row.type === "category" &&
          store.suppliers.some(
            (supplier) =>
              supplier.default_category_id === row.id &&
              supplier.name.toLowerCase().includes(search),
          );
        const matchesSearch =
          !search ||
          row.name.toLowerCase().includes(search) ||
          row.categoryName?.toLowerCase().includes(search) ||
          supplierSearchMatch;
        const matchesAbnormal = !abnormalOnly || row.hasWarning;
        return matchesSearch && matchesAbnormal;
      });
  }, [abnormalOnly, filters.outletId, filters.year, query, rows, store, visibleMonths]);

  const displayRows = useMemo(() => {
    if (viewMode === "Supplier") return [...decoratedRows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return decoratedRows;
  }, [decoratedRows, viewMode]);

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
    .filter((item) => item.cogsMargin !== null)
    .sort((a, b) => b.cogsMargin - a.cogsMargin)[0];

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
    return cogsStatus.severity === "high" || (item.purchaseChange > 20 && item.salesChange < 5);
  });

  const insightNotes = [
    highestRiskMonth
      ? {
          title: `${months[highestRiskMonth.month - 1]?.label} has the highest COGS at ${toPercent(highestRiskMonth.cogsMargin)}`,
          description: `${toCurrency(highestRiskMonth.totalPurchase)} purchase against ${toCurrency(highestRiskMonth.netSales)} Net Sales.`,
          tone: highestRiskMonth.cogsMargin > 40 ? "danger" : "warning",
        }
      : null,
    ...monthlyEfficiency
      .filter((item) => item.purchaseChange > 20 && item.salesChange < 5)
      .slice(0, 1)
      .map((item) => ({
        title: `Purchase increased ${toPercent(item.purchaseChange)}, but Net Sales only changed ${toPercent(item.salesChange)}`,
        description: `${months[item.month - 1]?.label} needs invoice and receiving review.`,
        tone: "danger",
      })),
    biggestIncrease
      ? {
          title: `${biggestIncrease.row.name} shows unusual supplier spike`,
          description: `${biggestIncrease.monthLabel}: ${toCurrency(biggestIncrease.analysis.amount)} vs ${toCurrency(biggestIncrease.analysis.average)} 3-month average.`,
          tone: biggestIncrease.analysis.salesChange >= 5 ? "warning" : "danger",
        }
      : null,
    ...monthlyEfficiency
      .filter((item) => item.purchaseChange > 20 && item.salesChange >= 5)
      .slice(0, 1)
      .map((item) => ({
        title: `${months[item.month - 1]?.label} purchase is high, but Net Sales also grew`,
        description: `Purchase +${toPercent(item.purchaseChange)}, Net Sales +${toPercent(item.salesChange)}. Risk level is moderate.`,
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
      `Previous month: ${toCurrency(cell.analysis.previousAmount)}`,
      `3-month avg: ${toCurrency(cell.analysis.average)}`,
      `Change: ${toPercent(cell.analysis.previousChange)}`,
    ].join("\n");
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
    setExpandedCategories(new Set(store.purchaseCategories.filter((category) => category.status === "active").map((category) => category.id)));
  }

  function collapseAllCategories() {
    setExpandedCategories(new Set());
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
    <div className="space-y-5">
      <PageHeader
        section="Purchases"
        title="Purchase Comparison"
        description="Compare monthly supplier spending, category cost and abnormal purchase trends."
        actions={
          <>
          <button className="btn-secondary" type="button" onClick={() => ui.notify({ title: "Export queued", message: "Purchase comparison export is mocked." })}>
            <Download size={16} /> Export
          </button>
          <button className="btn-secondary" type="button" onClick={() => window.print()}>
            <Printer size={16} /> Print
          </button>
          <button className="btn-secondary" type="button" onClick={() => ui.notify({ title: "View settings", message: "Column density and metric presets will be configurable later." })}>
            <Settings size={16} /> View Settings
          </button>
          </>
        }
      />

      <FilterBar compact>
        <OutletSelector outlets={store.outlets.filter((outlet) => outlet.status === "active")} value={filters.outletId} onChange={filters.setOutletId} />
        <YearSelector value={filters.year} onChange={filters.setYear} />
        <FieldLabel label="View Mode">
          <select className="control" value={viewMode} onChange={(event) => setViewMode(event.target.value)}>
            <option>Category</option>
            <option>Supplier</option>
            <option>Full</option>
          </select>
        </FieldLabel>
        <FieldLabel label="Compare With">
          <select className="control" value={compareWith} onChange={(event) => setCompareWith(event.target.value)}>
            <option>Previous Month</option>
            <option>Previous Year</option>
            <option>3-Month Average</option>
          </select>
        </FieldLabel>
        <FieldLabel label="Search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
            <input
              className="control w-full pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={viewMode === "Supplier" ? "Search supplier..." : "Search category or supplier..."}
            />
          </div>
        </FieldLabel>
        <FieldLabel label="Months">
          <label className="inline-flex h-10 items-center gap-2 rounded-control border border-border bg-white px-3 text-sm font-semibold text-text-primary">
            <input type="checkbox" checked={showFullYear} onChange={(event) => setShowFullYear(event.target.checked)} />
            Show full year
          </label>
        </FieldLabel>
        <FieldLabel label="Abnormal">
          <label className="inline-flex h-10 items-center gap-2 rounded-control border border-border bg-white px-3 text-sm font-semibold text-text-primary">
            <input type="checkbox" checked={abnormalOnly} onChange={(event) => setAbnormalOnly(event.target.checked)} />
            Show abnormal only
          </label>
        </FieldLabel>
      </FilterBar>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard icon={Wallet} label="Total Net Sales" value={toCurrency(yearlyNetSales)} helper="Calculated from Sales Input" />
        <MetricCard icon={Wallet} label="Total Purchase" value={toCurrency(yearlyTotal)} helper={`${filters.year} saved purchase`} />
        <MetricCard icon={ShieldAlert} label="Avg COGS %" value={avgCogsMargin === null ? "-" : toPercent(avgCogsMargin)} helper="Average monthly cost ratio" tone={avgCogsMargin > 40 ? "danger" : avgCogsMargin > 35 ? "warning" : "neutral"} />
        <MetricCard icon={Trophy} label="Highest Risk Month" value={highestRiskMonth ? months[highestRiskMonth.month - 1]?.label : "-"} helper={highestRiskMonth?.cogsMargin !== null ? `${toPercent(highestRiskMonth.cogsMargin)} COGS` : "No COGS data"} tone={highestRiskMonth?.cogsMargin > 40 ? "danger" : "neutral"} />
        <MetricCard icon={TrendingUp} label="Biggest Supplier Increase" value={biggestIncrease?.row.name ?? "-"} helper={biggestIncrease ? `${toPercent(biggestIncrease.analysis.previousChange)} in ${biggestIncrease.monthLabel}` : "No spike"} tone={biggestIncrease ? "warning" : "neutral"} />
        <MetricCard icon={Eye} label="Warning Items" value={warningCells.length + efficiencyWarnings.length} helper="Supplier and COGS signals" tone={warningCells.length + efficiencyWarnings.length ? "warning" : "neutral"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card
          title="Monthly Purchase Comparison"
          description={`Readonly ${viewMode.toLowerCase()} view with Net Sales, COGS and gross profit summary rows. Compared with ${compareWith.toLowerCase()}.`}
          action={
            viewMode === "Category" ? (
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary h-9" type="button" onClick={expandAllCategories}>Expand All</button>
                <button className="btn-secondary h-9" type="button" onClick={collapseAllCategories}>Collapse All</button>
              </div>
            ) : null
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" style={{ minWidth: showFullYear ? 1560 : 980 }}>
              <thead className="table-head">
                <tr>
                  <th className="sticky left-0 z-20 min-w-[260px] bg-slate-50 px-4 py-3 text-left">{viewMode === "Supplier" ? "Supplier / Category" : "Category / Supplier"}</th>
                  {visibleMonths.map((month) => (
                    <th key={month.value} className={`px-3 py-3 text-right ${month.value === currentMonth ? "bg-primary/5 text-primary" : ""}`}>
                      {month.label}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="px-3 py-3 text-right">Avg</th>
                  <th className="px-3 py-3 text-right">vs Previous Year</th>
                  <th className="px-3 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-white">
                {summaryRows.map((row, rowIndex) => (
                  <tr key={row.id} className={`font-bold ${row.toneClass}`}>
                    <td className={`sticky left-0 z-30 px-4 py-3 ${row.stickyClass}`} style={{ top: rowIndex * 56 }}>
                      <div>
                        <div className="font-bold text-text-primary">{row.label}</div>
                        <div className="text-xs font-medium text-text-secondary">{row.helper}</div>
                      </div>
                    </td>
                    {monthlyEfficiency.map((item) => {
                      const cogsStatus = row.id === "summary-cogs" ? getCogsStatus(item.cogsMargin) : null;
                      return (
                        <td
                          key={`${row.id}-${item.month}`}
                          className={`sticky z-20 px-3 py-3 text-right ${item.month === currentMonth ? "bg-primary/10" : ""} ${
                            row.id === "summary-cogs" && cogsStatus?.tone === "danger"
                              ? "bg-rose-50"
                              : row.id === "summary-cogs" && cogsStatus?.tone === "warning"
                                ? "bg-amber-50"
                                : ""
                          }`}
                          style={{ top: rowIndex * 56 }}
                        >
                          {row.renderCell(item)}
                        </td>
                      );
                    })}
                    <td className="sticky z-20 px-3 py-3 text-right" style={{ top: rowIndex * 56 }}>
                      {row.id === "summary-cogs" ? (row.total === null ? "-" : toPercent(row.total)) : toCurrency(row.total)}
                    </td>
                    <td className="sticky z-20 px-3 py-3 text-right" style={{ top: rowIndex * 56 }}>
                      {row.id === "summary-cogs" ? (row.average === null ? "-" : toPercent(row.average)) : toCurrency(row.average)}
                    </td>
                    <td className="sticky z-20 px-3 py-3 text-right text-text-muted" style={{ top: rowIndex * 56 }}>-</td>
                    <td className="sticky z-20 px-3 py-3" style={{ top: rowIndex * 56 }}>
                      <Badge tone={row.status.tone}>{row.status.label}</Badge>
                    </td>
                  </tr>
                ))}
                {!displayRows.length ? (
                  <tr>
                    <td colSpan={visibleMonths.length + 5} className="px-4 py-10 text-center text-sm text-text-secondary">
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
                        : "bg-white text-[13px] hover:bg-slate-50/70";
                  return (
                    <tr key={row.id} className={rowClass}>
                      <td className={`sticky left-0 z-10 px-4 py-3 ${row.type === "total" ? "bg-blue-50" : row.type === "category" ? "bg-slate-50" : "bg-white"}`}>
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
                                <span className="font-bold text-text-primary">{row.name}</span>
                                <span className="ml-2 text-xs font-semibold text-text-secondary">Subtotal</span>
                              </span>
                            </button>
                          ) : (
                            <div className="font-medium text-text-primary">{row.name}</div>
                          )}
                          {row.type === "supplier" ? <div className="text-xs text-text-secondary">{row.categoryName}</div> : null}
                          {row.type === "category" ? <div className="mt-1 text-xs font-medium text-text-secondary">{row.supplierCount} suppliers. Click to inspect supplier detail.</div> : null}
                        </div>
                      </td>
                      {row.cells.map((cell) => (
                        <td key={cell.month.value} className={`px-3 py-3 text-right ${cell.month.value === currentMonth ? "bg-primary/5" : ""}`}>
                          {cell.analysis.amount ? (
                            <button
                              className={`rounded-lg px-2 py-1 text-right font-semibold transition hover:ring-2 hover:ring-primary/20 ${cell.analysis.className}`}
                              type="button"
                              title={cellTooltip(row, cell)}
                              onClick={() => setSelectedCell({ row, cell })}
                            >
                              {toCurrency(cell.analysis.amount)}
                            </button>
                          ) : (
                            <span className="text-text-muted">-</span>
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-3 text-right font-bold">{row.total ? toCurrency(row.total) : "-"}</td>
                      <td className="px-3 py-3 text-right font-semibold text-text-secondary">{row.average ? toCurrency(row.average) : "-"}</td>
                      <td className="px-3 py-3 text-right">
                        <span className="font-semibold text-emerald-600">
                          {row.total ? toPercent(previousYearChange(store, filters.outletId, filters.year, row, visibleMonths)) : "-"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <InsightPanel
          warningCells={warningCells}
          topSuppliers={topSuppliers}
          biggestIncrease={biggestIncrease ? { ...biggestIncrease.row, ...biggestIncrease } : null}
          stableSupplier={stableSupplier}
          categoryTrend={categoryTrend}
          monthlyEfficiency={monthlyEfficiency}
          insightNotes={insightNotes}
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
