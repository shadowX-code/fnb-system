import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import { FieldLabel, OutletSelector, YearSelector } from "../../../components/forms/Selectors.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { months } from "../data/mockData.js";
import { getCategoryName, sumAmount, toCurrency, toPercent } from "../utils/analytics.js";

function purchaseAmount(store, outletId, year, month, row, mode) {
  return sumAmount(
    store.purchaseRecords.filter((record) => {
      const base = record.outlet_id === outletId && record.year === year && record.month === month;
      return mode === "Supplier View" ? base && record.supplier_id === row.id : base && record.category_id === row.id;
    }),
  );
}

export default function PurchaseComparisonPage({ store, ui }) {
  const filters = usePeriodFilters(store);
  const [mode, setMode] = useState("Supplier View");
  const [query, setQuery] = useState("");
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const baseRows = mode === "Supplier View" ? store.suppliers : store.purchaseCategories;
  const rows = useMemo(
    () =>
      baseRows.filter((row) => {
        const match = row.name.toLowerCase().includes(query.toLowerCase());
        if (!abnormalOnly) return match;
        return (
          match &&
          months.some((month) => {
            const current = purchaseAmount(store, filters.outletId, filters.year, month.value, row, mode);
            const prev = purchaseAmount(store, filters.outletId, filters.year, Math.max(month.value - 1, 1), row, mode);
            return prev && current > prev * 1.25;
          })
        );
      }),
    [abnormalOnly, baseRows, filters.outletId, filters.year, mode, query, store],
  );

  const columns = [
    {
      key: "name",
      header: mode === "Supplier View" ? "Supplier" : "Category",
      sticky: true,
      render: (row) => (
        <div>
          <div className="font-semibold">{row.name}</div>
          {mode === "Supplier View" ? <div className="text-xs text-text-secondary">{getCategoryName(store.purchaseCategories, row.default_category_id)}</div> : null}
        </div>
      ),
    },
    ...months.map((month) => ({
      key: month.label,
      header: month.label,
      align: "right",
      render: (row) => {
        const amount = purchaseAmount(store, filters.outletId, filters.year, month.value, row, mode);
        const previous = purchaseAmount(store, filters.outletId, filters.year, Math.max(month.value - 1, 1), row, mode);
        const state = previous && amount > previous * 1.25 ? "rounded-lg bg-rose-50 px-2 py-1 text-rose-700" : previous && amount < previous * 0.85 ? "rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700" : "";
        return amount ? <span className={state}>{toCurrency(amount)}</span> : "-";
      },
    })),
    { key: "total", header: "Total", align: "right", render: (row) => <strong>{toCurrency(months.reduce((total, month) => total + purchaseAmount(store, filters.outletId, filters.year, month.value, row, mode), 0))}</strong> },
    { key: "vs", header: "vs Previous Year", align: "right", render: () => <span className="font-semibold text-emerald-600">{toPercent(8.25)}</span> },
  ];

  return (
    <div className="space-y-5">
      <FilterBar compact actions={<button className="btn-secondary" onClick={() => ui.notify({ title: "Export queued", message: "Purchase comparison export is mocked." })}><Download size={16} /> Export</button>}>
        <OutletSelector outlets={store.outlets.filter((outlet) => outlet.status === "active")} value={filters.outletId} onChange={filters.setOutletId} />
        <YearSelector value={filters.year} onChange={filters.setYear} />
        <FieldLabel label="View">
          <select className="control" value={mode} onChange={(event) => setMode(event.target.value)}>
            <option>Supplier View</option>
            <option>Category View</option>
          </select>
        </FieldLabel>
        <FieldLabel label="Search / Filter">
          <input className="control" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search supplier..." />
        </FieldLabel>
      </FilterBar>
      <div className="mb-3 flex items-center justify-between">
        <button className={`btn-secondary ${abnormalOnly ? "border-rose-200 bg-rose-50 text-rose-700" : ""}`} onClick={() => setAbnormalOnly((value) => !value)}>
          {abnormalOnly ? "Showing Abnormal Only" : "Show Abnormal Only"}
        </button>
      </div>
      <Card title="Purchase Comparison" description="Cells above recent trend are tinted red; lower cells are tinted green.">
        <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} />
      </Card>
    </div>
  );
}
