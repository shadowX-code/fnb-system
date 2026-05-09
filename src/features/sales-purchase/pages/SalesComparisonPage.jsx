import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import { FieldLabel, OutletSelector, YearSelector } from "../../../components/forms/Selectors.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { months } from "../data/mockData.js";
import { getSalesBreakdown, sumAmount, toPercent, toSignedCurrency } from "../utils/analytics.js";

export default function SalesComparisonPage({ store, ui }) {
  const filters = usePeriodFilters(store);
  const [compareWith, setCompareWith] = useState("Previous Year");
  const [viewMode, setViewMode] = useState("Summary");
  const rows = useMemo(() => {
    const active = store.salesChannels.filter((channel) => channel.status === "active" && channel.type !== "total");
    const salesRows = active.filter((channel) => channel.type === "channel");
    const adjustmentRows = active.filter((channel) => channel.type === "adjustment");
    return [
      ...salesRows,
      { id: "summary-gross-sales", name: "Gross Sales", type: "summary-gross" },
      ...adjustmentRows,
      { id: "summary-net-sales", name: "Net Sales", type: "summary-net" },
    ];
  }, [store.salesChannels]);

  function getRowAmount(row, month) {
    if (row.type === "summary-gross") {
      return getSalesBreakdown(store.salesRecords, store.salesChannels, filters.outletId, month, filters.year).grossSales;
    }
    if (row.type === "summary-net") {
      return getSalesBreakdown(store.salesRecords, store.salesChannels, filters.outletId, month, filters.year).netSales;
    }
    return sumAmount(
      store.salesRecords.filter(
        (record) =>
          record.outlet_id === filters.outletId &&
          record.year === filters.year &&
          record.month === month &&
          record.channel_id === row.id,
      ),
    );
  }

  function getRowTotal(row) {
    return months.reduce((total, month) => total + getRowAmount(row, month.value), 0);
  }

  const columns = [
    {
      key: "channel",
      header: "Channel",
      sticky: true,
      render: (row) => (
        <span className={`font-semibold ${row.type?.startsWith("summary") ? "text-primary" : ""}`}>{row.name}</span>
      ),
    },
    ...months.map((month) => ({
      key: month.label,
      header: month.label,
      align: "right",
      render: (row) => {
        const amount = getRowAmount(row, month.value);
        return amount ? <span className={amount < 0 ? "text-rose-600" : "text-text-primary"}>{toSignedCurrency(amount)}</span> : "-";
      },
    })),
    {
      key: "total",
      header: "Total",
      align: "right",
      render: (row) => (
        <strong>
          {toSignedCurrency(getRowTotal(row))}
        </strong>
      ),
    },
    { key: "vs", header: "vs Previous Year", align: "right", render: () => <span className="font-semibold text-emerald-600">{toPercent(12.41)}</span> },
  ];

  return (
    <div className="space-y-5">
      <FilterBar
        compact
        actions={
          <button className="btn-secondary" type="button" onClick={() => ui.notify({ title: "Export queued", message: "Sales comparison CSV is being prepared." })}>
            <Download size={16} /> Export
          </button>
        }
      >
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
          </select>
        </FieldLabel>
      </FilterBar>
      <Card title="Sales Comparison" description={`Jan-Dec ${viewMode.toLowerCase()} view compared with ${compareWith.toLowerCase()}.`}>
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          getRowClassName={(row) => (row.type?.startsWith("summary") ? "bg-blue-50/60" : "")}
        />
      </Card>
    </div>
  );
}
