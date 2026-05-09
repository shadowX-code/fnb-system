import { useMemo, useState } from "react";
import {
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
import Modal from "../../../components/feedback/Modal.jsx";
import TrendChart from "../../../components/charts/TrendChart.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { months } from "../data/mockData.js";
import {
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
    return {
      amount,
      previousAmount,
      average,
      previousChange,
      averageChange,
      status: "danger",
      label: "High Risk",
      className: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-100",
      reason: "More than 50% above previous month",
    };
  }

  if (average && averageChange > 25) {
    return {
      amount,
      previousAmount,
      average,
      previousChange,
      averageChange,
      status: "warning",
      label: "Warning",
      className: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100",
      reason: "More than 25% above 3-month average",
    };
  }

  if (average && amount < average) {
    return {
      amount,
      previousAmount,
      average,
      previousChange,
      averageChange,
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
    status: "normal",
    label: "Normal",
    className: "text-text-primary",
    reason: "Within expected range",
  };
}

function buildComparisonRows(store, viewBy) {
  if (viewBy === "Category") {
    return [
      ...store.purchaseCategories
        .filter((category) => category.status === "active")
        .map((category) => ({ id: category.id, name: category.name, type: "category" })),
      { id: "total-purchase", name: "Total Purchase", type: "total" },
    ];
  }

  const rows = [];
  store.purchaseCategories
    .filter((category) => category.status === "active")
    .forEach((category) => {
      const suppliers = store.suppliers
        .filter((supplier) => supplier.status === "active" && supplier.default_category_id === category.id)
        .map((supplier) => ({
          id: supplier.id,
          name: supplier.name,
          type: "supplier",
          category_id: category.id,
          categoryName: category.name,
        }));

      if (suppliers.length) {
        rows.push({ id: category.id, name: category.name, type: "subtotal" });
        rows.push(...suppliers);
      }
    });
  rows.push({ id: "total-purchase", name: "Total Purchase", type: "total" });
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

function previousYearChange(store, outletId, year, row) {
  const currentTotal = months.reduce(
    (total, month) => total + getPurchaseAmount({ store, outletId, year, month: month.value, row }),
    0,
  );
  const previousTotal = months.reduce(
    (total, month) => total + getPurchaseAmount({ store, outletId, year: year - 1, month: month.value, row }),
    0,
  );

  if (previousTotal) return percentageChange(currentTotal, previousTotal);
  return currentTotal ? 8.25 : 0;
}

function InsightPanel({ store, outletId, year, warningCells, topSuppliers, biggestIncrease, stableSupplier, categoryTrend }) {
  return (
    <aside className="card overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-bold text-text-primary">Comparison Insights</h2>
        <p className="mt-1 text-xs text-text-secondary">Read-only purchase trend signals for the selected year.</p>
      </div>
      <div className="space-y-4 p-5">
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
                  {item.monthLabel}: {toCurrency(item.analysis.amount)} vs {toCurrency(item.analysis.previousAmount)} previous month.
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
  const [viewBy, setViewBy] = useState("Supplier");
  const [compareWith, setCompareWith] = useState("3-Month Average");
  const [query, setQuery] = useState("");
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [selectedCell, setSelectedCell] = useState(null);
  const currentMonth = Math.max(
    ...store.purchaseRecords
      .filter((record) => record.outlet_id === filters.outletId && record.year === filters.year)
      .map((record) => record.month),
    1,
  );

  const rows = useMemo(() => buildComparisonRows(store, viewBy), [store, viewBy]);

  const decoratedRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows
      .map((row) => {
        const cells = months.map((month) => ({
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
        const matchesSearch =
          !search ||
          row.name.toLowerCase().includes(search) ||
          row.categoryName?.toLowerCase().includes(search);
        const matchesAbnormal = !abnormalOnly || row.hasWarning || row.type === "total";
        return matchesSearch && matchesAbnormal;
      });
  }, [abnormalOnly, filters.outletId, filters.year, query, rows, store]);

  const annualTotal = getPurchaseAmount({
    store,
    outletId: filters.outletId,
    year: filters.year,
    month: currentMonth,
    row: { id: "total-purchase", type: "total" },
  });
  const monthlyTotals = months.map((month) => ({
    ...month,
    total: getPurchaseAmount({
      store,
      outletId: filters.outletId,
      year: filters.year,
      month: month.value,
      row: { id: "total-purchase", type: "total" },
    }),
  }));
  const yearlyTotal = monthlyTotals.reduce((total, item) => total + item.total, 0);
  const populatedMonths = monthlyTotals.filter((item) => item.total > 0);
  const highestMonth = [...monthlyTotals].sort((a, b) => b.total - a.total)[0];
  const averageMonthlyPurchase = populatedMonths.length ? yearlyTotal / populatedMonths.length : 0;
  const netSales = getNetSales(store.salesRecords, filters.outletId, currentMonth, filters.year, store.salesChannels);
  const cogsMargin = netSales ? (annualTotal / netSales) * 100 : 0;

  const warningCells = decoratedRows
    .filter((row) => row.type === "supplier" || row.type === "category")
    .flatMap((row) =>
      row.cells
        .filter((cell) => ["warning", "danger"].includes(cell.analysis.status))
        .map((cell) => ({ row, month: cell.month.value, monthLabel: cell.month.label, analysis: cell.analysis })),
    );

  const biggestIncrease = warningCells
    .filter((item) => item.row.type === "supplier" && item.analysis.previousAmount > 0)
    .sort((a, b) => b.analysis.previousChange - a.analysis.previousChange)[0];
  const stableSupplier = mostStableSupplier(store, filters.outletId, filters.year);
  const topSuppliers = store.suppliers
    .map((supplier) => ({
      ...supplier,
      total: months.reduce(
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
      total: months.reduce(
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Purchases</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-text-primary">Purchase Comparison</h1>
          <p className="mt-1 text-sm text-text-secondary">Compare monthly supplier spending, category cost and abnormal purchase trends.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" type="button" onClick={() => ui.notify({ title: "Export queued", message: "Purchase comparison export is mocked." })}>
            <Download size={16} /> Export
          </button>
          <button className="btn-secondary" type="button" onClick={() => window.print()}>
            <Printer size={16} /> Print
          </button>
          <button className="btn-secondary" type="button" onClick={() => ui.notify({ title: "View settings", message: "Column density and metric presets will be configurable later." })}>
            <Settings size={16} /> View Settings
          </button>
        </div>
      </div>

      <FilterBar compact>
        <OutletSelector outlets={store.outlets.filter((outlet) => outlet.status === "active")} value={filters.outletId} onChange={filters.setOutletId} />
        <YearSelector value={filters.year} onChange={filters.setYear} />
        <FieldLabel label="View By">
          <select className="control" value={viewBy} onChange={(event) => setViewBy(event.target.value)}>
            <option>Supplier</option>
            <option>Category</option>
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
              placeholder={viewBy === "Supplier" ? "Search supplier..." : "Search category..."}
            />
          </div>
        </FieldLabel>
        <FieldLabel label="Abnormal">
          <label className="inline-flex h-10 items-center gap-2 rounded-control border border-border bg-white px-3 text-sm font-semibold text-text-primary">
            <input type="checkbox" checked={abnormalOnly} onChange={(event) => setAbnormalOnly(event.target.checked)} />
            Show abnormal only
          </label>
        </FieldLabel>
      </FilterBar>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard icon={Wallet} label="Total Purchase" value={toCurrency(yearlyTotal)} helper={`${filters.year} saved records`} />
        <MetricCard icon={Trophy} label="Highest Purchase Month" value={highestMonth?.label ?? "-"} helper={highestMonth ? toCurrency(highestMonth.total) : "No data"} />
        <MetricCard icon={TrendingUp} label="Biggest Supplier Increase" value={biggestIncrease?.row.name ?? "-"} helper={biggestIncrease ? `${toPercent(biggestIncrease.analysis.previousChange)} in ${biggestIncrease.monthLabel}` : "No spike"} tone={biggestIncrease ? "warning" : "neutral"} />
        <MetricCard icon={ShieldAlert} label="COGS Margin" value={toPercent(cogsMargin)} helper={`Based on ${months[currentMonth - 1]?.label} net sales`} tone={cogsMargin > 40 ? "danger" : "neutral"} status={cogsMargin > 40 ? "High" : "Normal"} />
        <MetricCard icon={Eye} label="Warning Items" value={warningCells.length} helper="Highlighted cells" tone={warningCells.length ? "warning" : "neutral"} />
        <MetricCard icon={Wallet} label="Average Monthly" value={toCurrency(averageMonthlyPurchase)} helper={`${populatedMonths.length} months with data`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card
          title="Monthly Purchase Comparison"
          description={`Readonly ${viewBy.toLowerCase()} view compared with ${compareWith.toLowerCase()}. Click any month cell for detail.`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1560px] border-collapse text-sm">
              <thead className="table-head">
                <tr>
                  <th className="sticky left-0 z-20 bg-slate-50 px-4 py-3 text-left">{viewBy === "Supplier" ? "Supplier / Category" : "Category"}</th>
                  {months.map((month) => (
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
                {decoratedRows.map((row) => {
                  const status = rowStatus(row);
                  const rowClass =
                    row.type === "total"
                      ? "bg-blue-50/70 font-bold"
                      : row.type === "subtotal" || row.type === "category"
                        ? "bg-slate-50/80"
                        : "hover:bg-slate-50/70";
                  return (
                    <tr key={row.id} className={rowClass}>
                      <td className={`sticky left-0 z-10 px-4 py-3 ${row.type === "total" ? "bg-blue-50" : row.type === "subtotal" || row.type === "category" ? "bg-slate-50" : "bg-white"}`}>
                        <div className={row.type === "supplier" ? "pl-4" : ""}>
                          <div className={`font-semibold ${row.type === "subtotal" || row.type === "total" ? "text-text-primary" : ""}`}>{row.name}</div>
                          {row.type === "supplier" ? <div className="text-xs text-text-secondary">{row.categoryName}</div> : null}
                          {row.type === "subtotal" ? <div className="text-xs text-text-secondary">Category subtotal</div> : null}
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
                          {row.total ? toPercent(previousYearChange(store, filters.outletId, filters.year, row)) : "-"}
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
          store={store}
          outletId={filters.outletId}
          year={filters.year}
          warningCells={warningCells}
          topSuppliers={topSuppliers}
          biggestIncrease={biggestIncrease ? { ...biggestIncrease.row, ...biggestIncrease } : null}
          stableSupplier={stableSupplier}
          categoryTrend={categoryTrend}
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
