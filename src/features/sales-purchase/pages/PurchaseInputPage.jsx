import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Copy,
  MoreHorizontal,
  Percent,
  Plus,
  Save,
  Search,
  Trash2,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import { FieldLabel, MonthSelector, OutletSelector, YearSelector } from "../../../components/forms/Selectors.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import EntityModal from "../components/EntityModal.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { operationsService } from "../services/operationsService.js";
import {
  getCategoryName,
  getNetSales,
  getPreviousPeriod,
  getPurchaseRowAnalysis,
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

function PurchaseInsightPanel({ cogsMargin, highest, biggestIncrease, missingRows, reviewItems, store }) {
  const cogsTone = cogsMargin > 40 ? "danger" : cogsMargin > 36 ? "warning" : "success";

  return (
    <aside className="card overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-bold text-text-primary">Purchase Insights</h2>
        <p className="mt-1 text-xs text-text-secondary">Live checks for the selected outlet and month.</p>
      </div>
      <div className="space-y-4 p-5">
        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="text-xs font-semibold text-text-secondary">Highest Supplier</div>
          <div className="mt-2 text-base font-bold text-text-primary">
            {highest ? getSupplierName(store.suppliers, highest.supplier_id) : "-"}
          </div>
          <div className="mt-1 text-sm text-text-secondary">{highest ? toCurrency(highest.amount) : "No amount yet"}</div>
        </div>

        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="text-xs font-semibold text-text-secondary">Biggest Increase</div>
          <div className="mt-2 text-base font-bold text-text-primary">
            {biggestIncrease ? getSupplierName(store.suppliers, biggestIncrease.supplier_id) : "-"}
          </div>
          <div className="mt-1 text-sm text-text-secondary">
            {biggestIncrease ? `${toPercent(biggestIncrease.analysis.changePercent)} vs previous month` : "No comparison yet"}
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-secondary">COGS Margin Status</span>
            <Badge tone={cogsTone}>{cogsMargin > 40 ? "COGS High" : cogsMargin > 36 ? "Review" : "Normal"}</Badge>
          </div>
          <div className="mt-2 text-2xl font-bold text-text-primary">{toPercent(cogsMargin)}</div>
          <div className="mt-1 text-sm text-text-secondary">Total Purchase / calculated Net Sales</div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-text-secondary">
            <span>Suggested Review Items</span>
            <span>{reviewItems.length}</span>
          </div>
          <div className="space-y-2">
            {reviewItems.length ? (
              reviewItems.slice(0, 4).map((item) => (
                <div key={item.localKey} className="rounded-2xl border border-border bg-white p-3">
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
              <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-text-secondary">No abnormal supplier rows found.</div>
            )}
          </div>
        </div>

        {missingRows ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {missingRows} row{missingRows > 1 ? "s" : ""} still need an amount before saving.
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export default function PurchaseInputPage({ store, setStore, ui }) {
  const filters = usePeriodFilters(store);
  const [saveState, setSaveState] = useState("draft");
  const [rows, setRows] = useState(() => buildPurchaseRows(store, filters.outletId, filters.month, filters.year));
  const [supplierModal, setSupplierModal] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [sortBy, setSortBy] = useState("amount");
  const [showAbnormalOnly, setShowAbnormalOnly] = useState(false);
  const previous = getPreviousPeriod(filters.month, filters.year);
  const isLocked = Boolean(getLock(store, filters.outletId, filters.month, filters.year)?.is_locked);
  const netSales = getNetSales(store.salesRecords, filters.outletId, filters.month, filters.year, store.salesChannels);
  const totalPurchase = sumAmount(rows);
  const cogsMargin = netSales ? (totalPurchase / netSales) * 100 : 0;
  const profitMargin = netSales ? 100 - cogsMargin : 0;

  useEffect(() => {
    setRows(buildPurchaseRows(store, filters.outletId, filters.month, filters.year));
    setSaveState("draft");
  }, [filters.month, filters.outletId, filters.year, store.purchaseRecords]);

  const analyzedRows = useMemo(
    () =>
      rows.map((row, index) => ({
        ...row,
        localKey: row.id ?? `${row.supplier_id || "new"}-${index}`,
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
  const highest = [...rows].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
  const biggestIncrease = [...analyzedRows].filter((row) => row.analysis.previousAmount > 0).sort((a, b) => b.analysis.changePercent - a.analysis.changePercent)[0];
  const missingRows = analyzedRows.filter((row) => row.analysis.status === "Missing").length;
  const warningItems = analyzedRows.filter((row) => ["Warning", "High Risk", "Missing"].includes(row.analysis.status));

  function updateRow(localKey, patch) {
    setRows((current) =>
      current.map((row, index) => {
        const key = row.id ?? `${row.supplier_id || "new"}-${index}`;
        return key === localKey ? { ...row, ...patch } : row;
      }),
    );
    setSaveState("draft");
  }

  function addSupplierRow() {
    setRows((current) => [
      ...current,
      {
        id: undefined,
        supplier_id: "",
        category_id: "cat-others",
        remark: "",
        amount: "",
        draft: true,
      },
    ]);
  }

  function duplicatePreviousMonth(copyAmount = false) {
    const previousRows = buildPurchaseRows(store, filters.outletId, previous.month, previous.year);
    setRows(
      previousRows.map((row) => ({
        ...row,
        id: undefined,
        amount: copyAmount ? row.amount : "",
        remark: row.remark ?? "",
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

  function savePurchaseData() {
    if (!validateRows()) return;
    setStore((current) =>
      operationsService.upsertPurchaseData(current, {
        outletId: filters.outletId,
        month: filters.month,
        year: filters.year,
        purchaseRows: rows,
      }),
    );
    setSaveState("saved");
    ui.notify({ title: "Purchase data saved successfully", message: `${rows.length} supplier rows updated.` });
  }

  const supplierOptions = store.suppliers.filter((supplier) => supplier.status === "active");

  const columns = [
    {
      key: "supplier",
      header: "Supplier",
      sticky: true,
      render: (row) => (
        <div className="min-w-64">
          <select
            className="control w-full"
            disabled={isLocked}
            value={row.supplier_id}
            onChange={(event) => {
              const supplier = store.suppliers.find((item) => item.id === event.target.value);
              updateRow(row.localKey, {
                supplier_id: event.target.value,
                category_id: supplier?.default_category_id ?? row.category_id,
              });
            }}
          >
            <option value="">Search or select supplier</option>
            {supplierOptions.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          {row.draft ? <div className="mt-1 text-[11px] font-semibold text-primary">Draft row</div> : null}
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (row) => (
        <select
          className="control min-w-40"
          disabled={isLocked}
          value={row.category_id}
          onChange={(event) => updateRow(row.localKey, { category_id: event.target.value })}
        >
          <option value="">Select category</option>
          {store.purchaseCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "remark",
      header: "Remark",
      render: (row) => (
        <input
          className="control w-48"
          disabled={isLocked}
          value={row.remark ?? ""}
          placeholder="Optional note"
          onChange={(event) => updateRow(row.localKey, { remark: event.target.value })}
        />
      ),
    },
    {
      key: "amount",
      header: "Current Month Amount",
      align: "right",
      render: (row) => (
        <input
          className={`control w-36 text-right font-semibold ${
            isAmountMissing(row) ? "border-amber-300 bg-amber-50/60" : "focus:border-primary focus:ring-4 focus:ring-primary/15"
          }`}
          type="number"
          disabled={isLocked}
          value={row.amount}
          placeholder="Required"
          onChange={(event) => updateRow(row.localKey, { amount: event.target.value })}
        />
      ),
    },
    {
      key: "previous",
      header: "Previous Month",
      align: "right",
      render: (row) => <span className="font-medium text-text-secondary">{row.analysis.previousAmount ? toCurrency(row.analysis.previousAmount) : "-"}</span>,
    },
    {
      key: "average",
      header: "3-Month Avg",
      align: "right",
      render: (row) => <span className="font-medium text-text-secondary">{row.analysis.threeMonthAverage ? toCurrency(row.analysis.threeMonthAverage) : "-"}</span>,
    },
    {
      key: "change",
      header: "Change %",
      align: "right",
      render: (row) => {
        const isUp = row.analysis.changePercent >= 0;
        return (
          <span className={`font-bold ${isUp ? "text-emerald-600" : "text-rose-600"}`}>
            {row.analysis.previousAmount ? toPercent(row.analysis.changePercent) : "-"}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="space-y-1">
          <Badge tone={statusTone[row.analysis.status]}>{row.analysis.status}</Badge>
          <div className="max-w-44 text-[11px] text-text-secondary">{row.analysis.reason}</div>
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (row) => (
        <button
          className="icon-btn"
          type="button"
          disabled={isLocked}
          onClick={async () => {
            if (
              await ui.confirm({
                title: "Delete purchase row?",
                message: "This row will be removed from the current draft.",
                danger: true,
                confirmLabel: "Delete",
              })
            ) {
              setRows((current) => current.filter((item, index) => (item.id ?? `${item.supplier_id || "new"}-${index}`) !== row.localKey));
            }
          }}
        >
          <Trash2 size={15} />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        section="Purchases"
        title="Purchase Input"
        description="Record monthly supplier purchases by outlet."
        actions={
          <>
          <button className="btn-secondary" type="button" disabled={isLocked} onClick={() => setDuplicateModal(true)}>
            <Copy size={16} /> Duplicate Previous Month
          </button>
          <button className="btn-primary" type="button" disabled={isLocked} onClick={savePurchaseData}>
            <Save size={16} /> Save Purchase Data
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
          <select className="control" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">All categories</option>
            {store.purchaseCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel label="Status">
          <select className="control" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All status</option>
            {["Normal", "Warning", "High Risk", "New", "Missing"].map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel label="Search supplier">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
            <input
              className="control w-full pl-9"
              value={supplierSearch}
              placeholder="Supplier or remark"
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard icon={Wallet} label="Total Purchase" value={toCurrency(totalPurchase)} helper="Auto sum from supplier rows" status={saveState === "saved" ? "Saved" : "Draft"} />
        <MetricCard icon={Users} label="Total Suppliers" value={totalSuppliers} helper="Rows with supplier linked" />
        <MetricCard icon={Trophy} label="Highest Supplier" value={highest ? getSupplierName(store.suppliers, highest.supplier_id) : "-"} helper={highest ? toCurrency(highest.amount) : "No purchase"} />
        <MetricCard icon={Percent} label="COGS Margin" value={toPercent(cogsMargin)} helper="Purchase / Net Sales" tone={cogsMargin > 40 ? "danger" : cogsMargin > 36 ? "warning" : "neutral"} status={cogsMargin > 40 ? "High" : "Normal"} />
        <MetricCard icon={TrendingUp} label="Profit Margin Est." value={toPercent(profitMargin)} helper="Before overheads" tone={profitMargin < 60 ? "warning" : "neutral"} />
        <MetricCard icon={AlertTriangle} label="Warning Items" value={warningItems.length} helper="Rows needing review" tone={warningItems.length ? "warning" : "neutral"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card
          title="Supplier Purchase Input"
          description="Inline monthly supplier entry with previous month and 3-month average checks."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex h-10 items-center gap-2 rounded-control border border-border bg-white px-3 text-sm font-semibold text-text-primary">
                <input type="checkbox" checked={showAbnormalOnly} onChange={(event) => setShowAbnormalOnly(event.target.checked)} />
                Abnormal only
              </label>
              <select className="control w-44" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="amount">Sort by amount</option>
                <option value="change">Sort by change %</option>
                <option value="supplier">Sort by supplier</option>
              </select>
              <button className="btn-secondary" type="button" disabled={isLocked} onClick={addSupplierRow}>
                <Plus size={16} /> Add Supplier Row
              </button>
            </div>
          }
        >
          <DataTable
            columns={columns}
            rows={visibleRows}
            getRowKey={(row) => row.localKey}
            getRowClassName={(row) =>
              row.analysis.status === "High Risk"
                ? "bg-rose-50/60"
                : row.analysis.status === "Warning"
                  ? "bg-amber-50/70"
                  : row.analysis.status === "Missing"
                    ? "bg-slate-50"
                    : ""
            }
            footer={
              <tr className="font-bold text-text-primary">
                <td className="sticky left-0 z-10 bg-slate-50 px-4 py-3">Total Purchase</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right">{toCurrency(totalPurchase)}</td>
                <td className="px-4 py-3 text-right">{toCurrency(sumAmount(analyzedRows.map((row) => ({ amount: row.analysis.previousAmount }))))}</td>
                <td className="px-4 py-3 text-right">{toCurrency(sumAmount(analyzedRows.map((row) => ({ amount: row.analysis.threeMonthAverage }))))}</td>
                <td className="px-4 py-3 text-right">
                  {toPercent(
                    percentageChange(
                      totalPurchase,
                      sumAmount(analyzedRows.map((row) => ({ amount: row.analysis.previousAmount }))),
                    ),
                  )}
                </td>
                <td className="px-4 py-3">Auto calculated</td>
                <td className="px-4 py-3" />
              </tr>
            }
          />
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

      <div className="flex gap-2">
        <button className="btn-secondary" disabled={isLocked} onClick={() => setSupplierModal(true)}>
          <Plus size={16} /> Add New Supplier
        </button>
      </div>

      {duplicateModal ? (
        <Modal
          title="Duplicate Previous Month"
          description="Choose how much data to bring into the current month draft."
          onClose={() => setDuplicateModal(false)}
          footer={
            <>
              <button className="btn-secondary" type="button" onClick={() => setDuplicateModal(false)}>Cancel</button>
              <button className="btn-secondary" type="button" onClick={() => duplicatePreviousMonth(false)}>Copy supplier only</button>
              <button className="btn-primary" type="button" onClick={() => duplicatePreviousMonth(true)}>Copy supplier + amount</button>
            </>
          }
        >
          <div className="space-y-3 text-sm text-text-secondary">
            <p>Supplier-only mode keeps every amount blank so the team can enter the new month from scratch.</p>
            <p>Copying amounts is useful for quick estimation, but every copied row will still be marked as Draft.</p>
          </div>
        </Modal>
      ) : null}

      {supplierModal ? (
        <EntityModal
          title="Add Supplier"
          description="New supplier becomes selectable immediately."
          fields={[
            { name: "name", label: "Supplier Name", placeholder: "Supplier name" },
            { name: "default_category_id", label: "Default Category", type: "select", options: store.purchaseCategories.map((category) => ({ value: category.id, label: category.name })) },
          ]}
          initialValues={{ name: "", default_category_id: "cat-others" }}
          onClose={() => setSupplierModal(false)}
          onSubmit={(values) => {
            if (!values.name?.trim()) return ui.notify({ title: "Supplier name required", tone: "error" });
            const result = operationsService.addSupplier(store, values.name, values.default_category_id);
            setStore(result.state);
            setRows((current) => [...current, { supplier_id: result.supplier.id, category_id: result.supplier.default_category_id, remark: "", amount: "", draft: true }]);
            setSupplierModal(false);
            ui.notify({ title: "Supplier added", message: values.name });
          }}
        />
      ) : null}
    </div>
  );
}
