import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  FileText,
  MoreHorizontal,
  Percent,
  Plus,
  Save,
  Search,
  SquarePen,
  Trash2,
  Wallet,
} from "lucide-react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import { FieldLabel, MonthSelector, OutletSelector, YearSelector } from "../../../components/forms/Selectors.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import SupplierCombobox from "../components/SupplierCombobox.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { operationsService } from "../services/operationsService.js";
import { purchaseRecordService } from "../../../services/purchaseRecordService.js";
import { months } from "../data/mockData.js";
import {
  getCategoryName,
  getNetSales,
  getPreviousPeriod,
  getPurchaseTotal,
  getPurchaseRowAnalysis,
  getSupplierPurchaseAmount,
  getSupplierName,
  percentageChange,
  sumAmount,
  toCurrency,
  toPercent,
} from "../utils/analytics.js";

const statusTone = {
  Normal: "success",
  Warning: "warning",
  "High Risk": "danger",
  New: "info",
  Missing: "neutral",
};

function getLock(store, outletId, month, year) {
  return store.monthlyLocks.find((lock) => lock.outlet_id === outletId && lock.month === month && lock.year === year);
}

function buildPurchaseRows(store, outletId, month, year) {
  return store.purchaseRecords
    .filter((record) => record.outlet_id === outletId && record.month === month && record.year === year)
    .map((record) => ({ ...record, draft: false }));
}

function isAmountMissing(row) {
  return row.amount === "" || row.amount === null || row.amount === undefined;
}

function PurchaseEntryTable({
  rows,
  store,
  supplierOptions,
  isLocked,
  focusSupplierKey,
  expandedRows,
  editingCategoryKey,
  amountInputRefs,
  totalPurchase,
  analyzedRows,
  updateRow,
  setEditingCategoryKey,
  setFocusSupplierKey,
  createSupplierForRow,
  toggleDetails,
  deleteRow,
}) {
  const previousTotal = sumAmount(analyzedRows.map((row) => ({ amount: row.analysis.previousAmount })));
  const varianceTotal = percentageChange(totalPurchase, previousTotal);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[320px]" />
          <col className="w-[150px]" />
          <col className="w-[140px]" />
          <col className="w-[120px]" />
          <col className="w-[100px]" />
          <col className="w-[120px]" />
          <col className="w-[90px]" />
        </colgroup>
        <thead className="sticky top-0 z-20 bg-slate-50 text-xs uppercase tracking-wide text-text-secondary">
          <tr>
            <th className="sticky left-0 z-30 bg-slate-50 px-3 py-2.5 text-left">Supplier</th>
            <th className="px-3 py-2.5 text-left">Category</th>
            <th className="px-3 py-2.5 text-right">Current Amount</th>
            <th className="px-3 py-2.5 text-right">Previous</th>
            <th className="px-3 py-2.5 text-right">Variance</th>
            <th className="px-3 py-2.5 text-left">Status</th>
            <th className="px-3 py-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-white">
          {rows.map((row) => {
            const isExpanded = expandedRows.has(row.localKey);
            const rowTone =
              row.analysis.status === "High Risk"
                ? "bg-rose-50/60"
                : row.analysis.status === "Warning"
                  ? "bg-amber-50/70"
                  : row.analysis.status === "Missing"
                    ? "bg-slate-50"
                    : "";
            const isUp = row.analysis.changePercent >= 0;
            return (
              <Fragment key={row.localKey}>
                <tr className={`transition hover:bg-slate-50/80 ${rowTone}`}>
                  <td className="sticky left-0 z-10 max-w-[320px] overflow-visible bg-inherit px-3 py-2.5 align-top">
                    <SupplierCombobox
                      suppliers={supplierOptions}
                      value={row.supplier_id}
                      disabled={isLocked}
                      error={!row.supplier_id}
                      autoFocus={focusSupplierKey === row.localKey}
                      onChange={(supplier) => {
                        updateRow(row.localKey, {
                          supplier_id: supplier?.id ?? "",
                          category_id: supplier?.default_category_id ?? row.category_id,
                        });
                        setFocusSupplierKey(null);
                      }}
                      onCreate={(name) => createSupplierForRow(row.localKey, name)}
                    />
                    <div className="mt-1 flex items-center gap-2">
                      {!row.supplier_id ? <span className="text-[11px] font-semibold text-amber-700">Supplier required</span> : null}
                      {row.draft ? <span className="text-[11px] font-semibold text-primary">Draft row</span> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {editingCategoryKey === row.localKey ? (
                      <SelectField
                        className="w-[150px] max-w-full"
                        disabled={isLocked}
                        value={row.category_id}
                        placeholder="Category"
                        options={store.purchaseCategories.map((category) => ({ value: category.id, label: category.name }))}
                        onChange={(nextValue) => {
                          updateRow(row.localKey, { category_id: nextValue });
                          setEditingCategoryKey(null);
                        }}
                      />
                    ) : (
                      <button
                        className={`inline-flex max-w-[150px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                          row.category_id ? "border-slate-200 bg-slate-50 text-text-secondary hover:border-primary/30 hover:text-primary" : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                        type="button"
                        disabled={isLocked}
                        title={row.category_id ? getCategoryName(store.purchaseCategories, row.category_id) : "Category required"}
                        onClick={() => setEditingCategoryKey(row.localKey)}
                      >
                        <span className="truncate">{row.category_id ? getCategoryName(store.purchaseCategories, row.category_id) : "Required"}</span>
                        <SquarePen size={12} />
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <input
                      ref={(element) => {
                        if (element) amountInputRefs.current.set(row.localKey, element);
                        else amountInputRefs.current.delete(row.localKey);
                      }}
                      className={`control h-9 w-[132px] max-w-full text-right text-base font-bold tabular-nums ${
                        isAmountMissing(row) ? "border-amber-300 bg-amber-50/60" : "focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/25 focus:ring-offset-1"
                      }`}
                      type="number"
                      disabled={isLocked}
                      value={row.amount}
                      placeholder="0.00"
                      onChange={(event) => updateRow(row.localKey, { amount: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        const currentIndex = rows.findIndex((item) => item.localKey === row.localKey);
                        const nextRow = rows[currentIndex + 1];
                        if (nextRow) amountInputRefs.current.get(nextRow.localKey)?.focus();
                      }}
                    />
                    {isAmountMissing(row) ? <div className="mt-1 text-[11px] font-semibold text-amber-700">Amount required</div> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right align-top font-medium text-text-secondary">
                    {row.analysis.previousAmount ? toCurrency(row.analysis.previousAmount) : "-"}
                  </td>
                  <td className="px-3 py-2.5 text-right align-top">
                    <span className={`font-bold tabular-nums ${row.analysis.previousAmount ? (isUp ? "text-emerald-600" : "text-rose-600") : "text-text-muted"}`}>
                      {row.analysis.previousAmount ? toPercent(row.analysis.changePercent) : "-"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <Badge tone={statusTone[row.analysis.status]}>{row.analysis.status}</Badge>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex justify-end gap-1">
                      <button
                        className={`icon-btn ${isExpanded || row.remark ? "text-primary" : ""}`}
                        type="button"
                        aria-label="Toggle row details"
                        onClick={() => toggleDetails(row.localKey)}
                      >
                        <FileText size={15} />
                      </button>
                      <button className="icon-btn" type="button" disabled={isLocked} aria-label="Delete row" onClick={() => deleteRow(row)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
                {isExpanded ? (
                  <tr className="bg-slate-50/70">
                    <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5">
                      <button className="inline-flex items-center gap-2 text-xs font-bold text-text-secondary" type="button" onClick={() => toggleDetails(row.localKey)}>
                        <ChevronDown size={14} /> Details
                      </button>
                    </td>
                    <td colSpan={6} className="px-3 py-2.5">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_1.2fr]">
                        <label className="block">
                          <span className="text-xs font-semibold text-text-secondary">Remark</span>
                          <input
                            className="control mt-1 w-full"
                            disabled={isLocked}
                            value={row.remark ?? ""}
                            placeholder="Optional note, invoice reference, stock-up reason..."
                            onChange={(event) => updateRow(row.localKey, { remark: event.target.value })}
                          />
                        </label>
                        <div className="rounded-xl border border-border bg-white px-3 py-2">
                          <div className="text-xs font-semibold text-text-secondary">3-Month Avg</div>
                          <div className="mt-1 font-bold text-text-primary">{row.analysis.threeMonthAverage ? toCurrency(row.analysis.threeMonthAverage) : "-"}</div>
                        </div>
                        <div className="rounded-xl border border-border bg-white px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Badge tone={statusTone[row.analysis.status]}>{row.analysis.status}</Badge>
                            <span className="text-xs font-semibold text-text-secondary">Row check</span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-text-secondary">{row.analysis.reason}</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot className="border-t border-border bg-slate-50">
          <tr className="font-bold text-text-primary">
            <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5">Total Purchase</td>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 text-right">{toCurrency(totalPurchase)}</td>
            <td className="px-3 py-2.5 text-right">{toCurrency(previousTotal)}</td>
            <td className="px-3 py-2.5 text-right">
              <span className={varianceTotal >= 0 ? "text-emerald-600" : "text-rose-600"}>{toPercent(varianceTotal)}</span>
            </td>
            <td className="px-3 py-2.5">Auto calculated</td>
            <td className="px-3 py-2.5" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PurchaseInsightPanel({ cogsMargin, highest, biggestIncrease, missingRows, reviewItems, store }) {
  const [showAllInsights, setShowAllInsights] = useState(false);
  const cogsTone = cogsMargin > 40 ? "danger" : cogsMargin > 36 ? "warning" : "success";
  const cards = [
    {
      key: "highest",
      label: "Highest Supplier",
      title: highest ? getSupplierName(store.suppliers, highest.supplier_id) : "-",
      body: highest ? toCurrency(highest.amount) : "No amount yet",
    },
    {
      key: "increase",
      label: "Biggest Increase",
      title: biggestIncrease ? getSupplierName(store.suppliers, biggestIncrease.supplier_id) : "-",
      body: biggestIncrease ? `${toPercent(biggestIncrease.analysis.changePercent)} vs previous month` : "No comparison yet",
    },
    {
      key: "cogs",
      label: "COGS Margin Status",
      title: toPercent(cogsMargin),
      body: "Total Purchase / calculated Net Sales",
      badge: <Badge tone={cogsTone}>{cogsMargin > 40 ? "COGS High" : cogsMargin > 36 ? "Review" : "Normal"}</Badge>,
    },
  ];
  const visibleCards = showAllInsights ? cards : cards.slice(0, 2);

  return (
    <aside className="card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-bold text-text-primary">Purchase Insights</h2>
        <p className="mt-1 text-xs text-text-secondary">Live checks for the selected outlet and month.</p>
      </div>
      <div className="space-y-2.5 p-3">
        {visibleCards.map((card) => (
          <div key={card.key} className="rounded-xl bg-slate-50 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-text-secondary">{card.label}</div>
              {card.badge}
            </div>
            <div className="mt-1.5 truncate text-sm font-bold text-text-primary" title={card.title}>{card.title}</div>
            <div className="mt-0.5 text-xs text-text-secondary">{card.body}</div>
          </div>
        ))}
        {cards.length > 2 ? (
          <button className="w-full rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary transition hover:bg-slate-50" type="button" onClick={() => setShowAllInsights((value) => !value)}>
            {showAllInsights ? "Show top insights" : `View all insights (${cards.length})`}
          </button>
        ) : null}

        <div>
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-text-secondary">
            <span>Suggested Review Items</span>
            <span>{reviewItems.length}</span>
          </div>
          <div className="space-y-2">
            {reviewItems.length ? (
              reviewItems.slice(0, 4).map((item) => (
                <div key={item.localKey} className="rounded-xl border border-border bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-text-primary">{getSupplierName(store.suppliers, item.supplier_id)}</span>
                    <Badge tone={statusTone[item.analysis.status]}>{item.analysis.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-text-secondary">
                    {item.analysis.reason}. Current {toCurrency(item.amount)} vs {toCurrency(item.analysis.previousAmount)} previous month.
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-border p-3 text-sm text-text-secondary">No abnormal supplier rows found.</div>
            )}
          </div>
        </div>

        {missingRows ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800">
            {missingRows} row{missingRows > 1 ? "s" : ""} still need an amount before saving.
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export default function PurchaseInputPage({ store, setStore, ui }) {
  const filters = usePeriodFilters(store);
  const amountInputRefs = useRef(new Map());
  const [saveState, setSaveState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [rows, setRows] = useState(() => buildPurchaseRows(store, filters.outletId, filters.month, filters.year));
  const [duplicateModal, setDuplicateModal] = useState(false);
  const [duplicateMode, setDuplicateMode] = useState("supplier-only");
  const [focusSupplierKey, setFocusSupplierKey] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [sortBy, setSortBy] = useState("amount");
  const [showAbnormalOnly, setShowAbnormalOnly] = useState(false);
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [editingCategoryKey, setEditingCategoryKey] = useState(null);
  const previous = getPreviousPeriod(filters.month, filters.year);
  const isLocked = Boolean(getLock(store, filters.outletId, filters.month, filters.year)?.is_locked);
  const netSales = getNetSales(store.salesRecords, filters.outletId, filters.month, filters.year, store.salesChannels);
  const totalPurchase = sumAmount(rows);
  const cogsMargin = netSales ? (totalPurchase / netSales) * 100 : 0;
  const profitMargin = netSales ? 100 - cogsMargin : 0;

  useEffect(() => {
    let ignore = false;
    async function loadPurchaseRecords() {
      if (!filters.outletId) return;
      setSaveState("loading");
      setLoadError("");
      try {
        const records = await purchaseRecordService.getPurchaseRecords(filters.outletId, filters.year, filters.month);
        if (ignore) return;
        setStore((current) => ({
          ...current,
          purchaseRecords: [
            ...current.purchaseRecords.filter(
              (record) =>
                !(record.outlet_id === filters.outletId && Number(record.month) === Number(filters.month) && Number(record.year) === Number(filters.year)),
            ),
            ...records,
          ],
        }));
        setRows(records.map((record) => ({ ...record, draft: false })));
        setSaveState(records.length ? "saved" : "empty");
        setExpandedRows(new Set());
        setEditingCategoryKey(null);
      } catch (error) {
        console.error("Unable to load purchase records", error);
        if (!ignore) {
          setLoadError(error.message || "Unable to load purchase records.");
          setRows([]);
          setSaveState("error");
        }
      }
    }
    loadPurchaseRecords();
    return () => {
      ignore = true;
    };
  }, [filters.month, filters.outletId, filters.year]);

  useEffect(() => {
    if (saveState === "loading" || saveState === "error") return;
    setRows(buildPurchaseRows(store, filters.outletId, filters.month, filters.year));
    setExpandedRows(new Set());
    setSaveState(buildPurchaseRows(store, filters.outletId, filters.month, filters.year).length ? "saved" : "empty");
    setEditingCategoryKey(null);
  }, [filters.month, filters.outletId, filters.year, store.purchaseRecords]);

  const analyzedRows = useMemo(
    () =>
      rows.map((row, index) => ({
        ...row,
        localKey: row.id ?? row.temp_id ?? `${row.supplier_id || "new"}-${index}`,
        analysis: getPurchaseRowAnalysis({
          row,
          purchaseRecords: store.purchaseRecords,
          salesRecords: store.salesRecords,
          salesChannels: store.salesChannels,
          outletId: filters.outletId,
          month: filters.month,
          year: filters.year,
        }),
      })),
    [filters.month, filters.outletId, filters.year, rows, store.purchaseRecords, store.salesChannels, store.salesRecords],
  );

  const visibleRows = useMemo(() => {
    const search = supplierSearch.trim().toLowerCase();
    const filtered = analyzedRows.filter((row) => {
      const supplierName = getSupplierName(store.suppliers, row.supplier_id).toLowerCase();
      const matchSearch = !search || supplierName.includes(search) || (row.remark ?? "").toLowerCase().includes(search);
      const matchCategory = categoryFilter === "all" || row.category_id === categoryFilter;
      const matchStatus = statusFilter === "all" || row.analysis.status === statusFilter;
      const matchAbnormal = !showAbnormalOnly || ["Warning", "High Risk", "Missing"].includes(row.analysis.status);
      return matchSearch && matchCategory && matchStatus && matchAbnormal;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === "supplier") return getSupplierName(store.suppliers, a.supplier_id).localeCompare(getSupplierName(store.suppliers, b.supplier_id));
      if (sortBy === "change") return b.analysis.changePercent - a.analysis.changePercent;
      return Number(b.amount || 0) - Number(a.amount || 0);
    });
  }, [analyzedRows, categoryFilter, showAbnormalOnly, sortBy, statusFilter, store.suppliers, supplierSearch]);

  const totalSuppliers = rows.filter((row) => row.supplier_id).length;
  const highest = [...analyzedRows].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
  const biggestIncrease = [...analyzedRows].filter((row) => row.analysis.previousAmount > 0).sort((a, b) => b.analysis.changePercent - a.analysis.changePercent)[0];
  const missingRows = analyzedRows.filter((row) => row.analysis.status === "Missing").length;
  const warningItems = analyzedRows.filter((row) => ["Warning", "High Risk", "Missing"].includes(row.analysis.status));
  const previousTotalPurchase = getPurchaseTotal(store.purchaseRecords, filters.outletId, previous.month, previous.year);
  const totalPurchaseChange = percentageChange(totalPurchase, previousTotalPurchase);
  const highestSupplier = highest?.supplier_id ? store.suppliers.find((supplier) => supplier.id === highest.supplier_id) : null;
  const highestCategory = highestSupplier ? getCategoryName(store.purchaseCategories, highestSupplier.default_category_id) : "";
  const highestPrevious = highest?.supplier_id ? getSupplierPurchaseAmount(store.purchaseRecords, filters.outletId, highest.supplier_id, previous.month, previous.year) : 0;
  const highestChange = percentageChange(Number(highest?.amount || 0), highestPrevious);
  const trendMonths = months.filter((month) => month.value <= filters.month).slice(-6);
  const purchaseTrend = trendMonths.map((month) => ({
    label: month.label,
    value: month.value === filters.month ? totalPurchase : getPurchaseTotal(store.purchaseRecords, filters.outletId, month.value, filters.year),
    display: toCurrency(month.value === filters.month ? totalPurchase : getPurchaseTotal(store.purchaseRecords, filters.outletId, month.value, filters.year)),
    current: month.value === filters.month,
  }));
  const supplierCountTrend = trendMonths.map((month) => {
    const count = month.value === filters.month
      ? totalSuppliers
      : new Set(store.purchaseRecords.filter((record) => record.outlet_id === filters.outletId && record.month === month.value && record.year === filters.year && record.supplier_id).map((record) => record.supplier_id)).size;
    return { label: month.label, value: count, display: `${count} suppliers`, current: month.value === filters.month };
  });
  const highestSupplierTrend = highest?.supplier_id
    ? trendMonths.map((month) => {
        const value = month.value === filters.month
          ? Number(highest.amount || 0)
          : getSupplierPurchaseAmount(store.purchaseRecords, filters.outletId, highest.supplier_id, month.value, filters.year);
        return { label: month.label, value, display: toCurrency(value), current: month.value === filters.month };
      })
    : [];
  const cogsTrend = trendMonths.map((month) => {
    const purchase = month.value === filters.month ? totalPurchase : getPurchaseTotal(store.purchaseRecords, filters.outletId, month.value, filters.year);
    const sales = getNetSales(store.salesRecords, filters.outletId, month.value, filters.year, store.salesChannels);
    const value = sales ? (purchase / sales) * 100 : 0;
    return { label: month.label, value, display: toPercent(value), current: month.value === filters.month };
  });
  const saveStatusLabel =
    saveState === "loading"
      ? "Loading purchase records..."
      : saveState === "error"
        ? loadError || "Unable to load purchase records."
    : saveState === "saving"
      ? "Saving..."
      : saveState === "draft"
        ? "● Unsaved changes"
        : saveState === "empty"
          ? "No data yet"
        : lastSavedAt
          ? `✓ Saved successfully · ${lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "✓ Saved";

  useEffect(() => {
    function handleShortcut(event) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (!isLocked && saveState !== "saving") savePurchaseData();
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  function updateRow(localKey, patch) {
    setRows((current) =>
      current.map((row, index) => {
        const key = row.id ?? row.temp_id ?? `${row.supplier_id || "new"}-${index}`;
        return key === localKey ? { ...row, ...patch } : row;
      }),
    );
    setSaveState("draft");
  }

  function addSupplierRow() {
    const tempId = `draft-${crypto.randomUUID()}`;
    setRows((current) => [
      ...current,
      {
        temp_id: tempId,
        id: undefined,
        supplier_id: "",
        category_id: "",
        remark: "",
        amount: "",
        draft: true,
      },
    ]);
    setFocusSupplierKey(tempId);
    setExpandedRows((current) => new Set([...current, tempId]));
  }

  function toggleDetails(localKey) {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(localKey)) next.delete(localKey);
      else next.add(localKey);
      return next;
    });
  }

  async function deleteRow(row) {
    if (
      await ui.confirm({
        title: "Delete purchase row?",
        message: "This row will be removed from the current draft.",
        danger: true,
        confirmLabel: "Delete",
      })
    ) {
      setRows((current) => current.filter((item, index) => (item.id ?? item.temp_id ?? `${item.supplier_id || "new"}-${index}`) !== row.localKey));
      setExpandedRows((current) => {
        const next = new Set(current);
        next.delete(row.localKey);
        return next;
      });
    }
  }

  function duplicatePreviousMonth(copyAmount = false) {
    const previousRows = buildPurchaseRows(store, filters.outletId, previous.month, previous.year);
    setRows(
      previousRows.map((row) => ({
        ...row,
        temp_id: `draft-${crypto.randomUUID()}`,
        id: undefined,
        amount: copyAmount ? row.amount : "",
        remark: row.remark ?? "",
        category_id: store.suppliers.find((supplier) => supplier.id === row.supplier_id)?.default_category_id ?? row.category_id,
        draft: true,
      })),
    );
    setDuplicateModal(false);
    setSaveState("draft");
      ui.notify({
        title: "Previous month duplicated",
        message: copyAmount ? "Supplier list and amounts were copied as draft." : "Supplier list copied with blank amounts.",
    });
  }

  function validateRows() {
    const invalid = analyzedRows.filter((row) => !row.supplier_id || !row.category_id || isAmountMissing(row));
    if (invalid.length) {
      ui.notify({
        title: "Purchase data needs review",
        message: "Supplier, category and amount are required. Enter 0 if there was no purchase.",
        tone: "error",
      });
      return false;
    }
    return true;
  }

  async function savePurchaseData() {
    if (!validateRows()) return;
    const duplicateSupplierIds = rows
      .filter((row) => row.supplier_id)
      .map((row) => row.supplier_id)
      .filter((supplierId, index, list) => list.indexOf(supplierId) !== index);
    if (duplicateSupplierIds.length) {
      const duplicateNames = [...new Set(duplicateSupplierIds)].map((supplierId) => getSupplierName(store.suppliers, supplierId)).join(", ");
      const ok = await ui.confirm({
        title: "Duplicate supplier rows?",
        message: `${duplicateNames} appears more than once for this outlet/month. Save anyway?`,
        confirmLabel: "Save anyway",
      });
      if (!ok) return;
    }

    setSaveState("saving");
    setLoadError("");
    try {
      const savedRecords = await purchaseRecordService.savePurchaseRecords(filters.outletId, filters.year, filters.month, rows);
      setStore((current) =>
        ({
          ...current,
          purchaseRecords: [
            ...current.purchaseRecords.filter(
              (record) =>
                !(record.outlet_id === filters.outletId && Number(record.month) === Number(filters.month) && Number(record.year) === Number(filters.year)),
            ),
            ...savedRecords,
          ],
        }),
      );
      setRows(savedRecords.map((record) => ({ ...record, draft: false })));
      setSaveState("saved");
      setLastSavedAt(new Date());
      ui.notify({ title: "Purchase data saved successfully", message: `${savedRecords.length} supplier rows updated.` });
    } catch (error) {
      console.error("Unable to save purchase records", error);
      setSaveState("error");
      setLoadError(error.message || "Unable to save purchase records.");
      ui.notify({ title: "Unable to save purchase records", message: error.message || "Please try again.", tone: "error" });
    }
  }

  function createSupplierForRow(localKey, name) {
    const categoryId = rows.find((row, index) => (row.id ?? row.temp_id ?? `${row.supplier_id || "new"}-${index}`) === localKey)?.category_id || "cat-others";
    const result = operationsService.addSupplier(store, name, categoryId);
    setStore(result.state);
    updateRow(localKey, {
      supplier_id: result.supplier.id,
      category_id: result.supplier.default_category_id,
      draft: true,
    });
    ui.notify({ title: "Supplier created", message: `${result.supplier.name} is ready for purchase entry.` });
  }

  const supplierOptions = store.suppliers.filter((supplier) => supplier.status === "active");

  return (
    <div className="space-y-4">
      <PageHeader
        section="Purchases"
        title="Purchase Input"
        description="Record monthly supplier purchases by outlet."
        actions={
          <>
          <span className={`inline-flex h-10 items-center rounded-xl px-3 text-xs font-bold ${
            saveState === "draft" ? "bg-amber-50 text-amber-700" : saveState === "saving" || saveState === "loading" ? "bg-blue-50 text-blue-700" : saveState === "error" ? "bg-rose-50 text-rose-700" : saveState === "empty" ? "bg-slate-50 text-text-secondary" : "bg-emerald-50 text-emerald-700"
          }`}>
            {saveStatusLabel}
          </span>
          <button className="btn-secondary" type="button" disabled={isLocked} onClick={() => setDuplicateModal(true)}>
            <Copy size={16} /> Duplicate Previous Month
          </button>
          <button className="btn-primary" type="button" disabled={isLocked || saveState === "saving" || saveState === "loading"} onClick={savePurchaseData}>
            <Save size={16} /> {saveState === "saving" ? "Saving..." : "Save Purchase Data"}
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label="More actions"
            onClick={() => ui.notify({ title: "More actions", message: "Export and audit log actions will be connected in the next phase." })}
          >
            <MoreHorizontal size={17} />
          </button>
          </>
        }
      />
      <FilterBar compact>
        <OutletSelector outlets={store.outlets} value={filters.outletId} onChange={filters.setOutletId} />
        <MonthSelector value={filters.month} onChange={filters.setMonth} />
        <YearSelector value={filters.year} onChange={filters.setYear} />
        <FieldLabel label="Category">
          <SelectField
            value={categoryFilter === "all" ? "" : categoryFilter}
            placeholder="All categories"
            searchable
            options={store.purchaseCategories.map((category) => ({ value: category.id, label: category.name }))}
            onChange={(nextValue) => setCategoryFilter(nextValue || "all")}
          />
        </FieldLabel>
        <FieldLabel label="Row Status">
          <SelectField
            value={statusFilter === "all" ? "" : statusFilter}
            placeholder="All"
            options={["Normal", "Warning", "High Risk", "Missing"].map((item) => ({ value: item, label: item === "Missing" ? "Missing History" : item }))}
            onChange={(nextValue) => setStatusFilter(nextValue || "all")}
          />
        </FieldLabel>
        <FieldLabel label="Search supplier">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
            <input
              className="control w-full pl-9"
              value={supplierSearch}
              placeholder="Filter supplier or remark"
              onChange={(event) => setSupplierSearch(event.target.value)}
            />
          </div>
        </FieldLabel>
      </FilterBar>

      {isLocked ? (
        <div className="card border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          This month is locked. Purchase inputs are disabled until an admin unlocks it.
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard
          icon={Wallet}
          label="Total Purchase"
          value={toCurrency(totalPurchase)}
          helper={`${toPercent(totalPurchaseChange)} vs previous month`}
          trend={totalPurchaseChange >= 0 ? "Up" : "Down"}
          status={saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving" : "Draft"}
          sparklineData={purchaseTrend}
        />
        <MetricCard
          icon={Percent}
          label="COGS Margin"
          value={toPercent(cogsMargin)}
          helper="Purchase / Net Sales"
          tone={cogsMargin > 40 ? "danger" : cogsMargin > 36 ? "warning" : "neutral"}
          status={cogsMargin > 40 ? "High Risk" : cogsMargin > 36 ? "Watch" : "Healthy"}
          sparklineData={cogsTrend}
        />
        <MetricCard icon={AlertTriangle} label="Warning Items" value={warningItems.length} helper="Rows needing review" tone={warningItems.length ? "warning" : "neutral"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card
          title="Supplier Purchase Input"
          description="Fast supplier and amount entry. Notes and history stay collapsed until needed."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex h-10 items-center gap-2 rounded-control border border-border bg-white px-3 text-sm font-semibold text-text-primary">
                <input type="checkbox" checked={showAbnormalOnly} onChange={(event) => setShowAbnormalOnly(event.target.checked)} />
                Abnormal only
              </label>
              <SelectField
                value={sortBy}
                className="w-44"
                options={[
                  { value: "amount", label: "Sort by amount" },
                  { value: "change", label: "Sort by change %" },
                  { value: "supplier", label: "Sort by supplier" },
                ]}
                onChange={setSortBy}
              />
            </div>
          }
        >
          <div>
            {saveState === "saving" ? (
              <div className="border-b border-border p-4">
                <div className="h-3 w-48 animate-pulse rounded-full bg-slate-100" />
                <div className="mt-3 grid gap-2">
                  {[1, 2, 3].map((item) => <div key={item} className="h-10 animate-pulse rounded-xl bg-slate-50" />)}
                </div>
              </div>
            ) : null}
            {visibleRows.length ? (
              <PurchaseEntryTable
                rows={visibleRows}
                store={store}
                supplierOptions={supplierOptions}
                isLocked={isLocked}
                focusSupplierKey={focusSupplierKey}
                expandedRows={expandedRows}
                editingCategoryKey={editingCategoryKey}
                amountInputRefs={amountInputRefs}
                totalPurchase={totalPurchase}
                analyzedRows={analyzedRows}
                updateRow={updateRow}
                setEditingCategoryKey={setEditingCategoryKey}
                setFocusSupplierKey={setFocusSupplierKey}
                createSupplierForRow={createSupplierForRow}
                toggleDetails={toggleDetails}
                deleteRow={deleteRow}
              />
            ) : (
              <div className="p-8 text-center">
                <div className="text-sm font-bold text-text-primary">No supplier rows yet</div>
                <p className="mt-1 text-sm text-text-secondary">Duplicate previous month or add a supplier row to start entering purchases.</p>
              </div>
            )}
            <div className="border-t border-border bg-slate-50/70 p-4">
              <button className="btn-secondary" type="button" disabled={isLocked} onClick={addSupplierRow}>
                <Plus size={16} /> Add Supplier Row
              </button>
            </div>
          </div>
        </Card>

        <PurchaseInsightPanel
          cogsMargin={cogsMargin}
          highest={highest}
          biggestIncrease={biggestIncrease}
          missingRows={missingRows}
          reviewItems={warningItems}
          store={store}
        />
      </div>

      {duplicateModal ? (
        <Modal
          title={`Duplicate ${months[previous.month - 1]?.label} ${previous.year} into ${months[filters.month - 1]?.label} ${filters.year}?`}
          description={`${buildPurchaseRows(store, filters.outletId, previous.month, previous.year).length} supplier rows will be copied into the current draft.`}
          onClose={() => setDuplicateModal(false)}
          footer={
            <>
              <button className="btn-secondary" type="button" onClick={() => setDuplicateModal(false)}>Cancel</button>
              <button className="btn-primary" type="button" onClick={() => duplicatePreviousMonth(duplicateMode === "supplier-amount")}>Duplicate</button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <label className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${duplicateMode === "supplier-only" ? "border-primary bg-primary/5" : "border-border bg-white"}`}>
              <input type="radio" name="duplicate-mode" checked={duplicateMode === "supplier-only"} onChange={() => setDuplicateMode("supplier-only")} />
              <span>
                <span className="block font-bold text-text-primary">Copy supplier list only</span>
                <span className="mt-1 block text-text-secondary">Recommended. Amounts stay blank and every row is marked Draft.</span>
              </span>
            </label>
            <label className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${duplicateMode === "supplier-amount" ? "border-primary bg-primary/5" : "border-border bg-white"}`}>
              <input type="radio" name="duplicate-mode" checked={duplicateMode === "supplier-amount"} onChange={() => setDuplicateMode("supplier-amount")} />
              <span>
                <span className="block font-bold text-text-primary">Copy supplier list + amount</span>
                <span className="mt-1 block text-text-secondary">Useful for estimation. Review every copied amount before saving.</span>
              </span>
            </label>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
