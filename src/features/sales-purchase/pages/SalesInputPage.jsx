import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import PeriodFilterBar from "../components/PeriodFilterBar.jsx";
import SummaryPanel from "../components/SummaryPanel.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { operationsService } from "../services/operationsService.js";
import {
  getPreviousPeriod,
  getSalesBreakdown,
  percentageChange,
  sumAmount,
  toCurrency,
  toPercent,
  toSignedCurrency,
} from "../utils/analytics.js";

function getLock(store, outletId, month, year) {
  return store.monthlyLocks.find((lock) => lock.outlet_id === outletId && lock.month === month && lock.year === year);
}

function buildSalesRows(store, outletId, month, year) {
  return store.salesChannels
    .filter((channel) => channel.status === "active" && channel.type !== "total")
    .map((channel) => {
    const record = store.salesRecords.find(
      (item) =>
        item.outlet_id === outletId &&
        item.month === month &&
        item.year === year &&
        item.channel_id === channel.id,
    );
    return {
      id: record?.id,
      channel_id: channel.id,
      channelName: channel.name,
      type: channel.type,
      amount: record?.amount ?? 0,
      remark: record?.remark ?? "",
    };
  });
}

export default function SalesInputPage({ store, setStore, ui }) {
  const filters = usePeriodFilters(store);
  const [saveState, setSaveState] = useState("draft");
  const [rows, setRows] = useState(() => buildSalesRows(store, filters.outletId, filters.month, filters.year));

  const isLocked = Boolean(getLock(store, filters.outletId, filters.month, filters.year)?.is_locked);
  function reloadRows(next = filters) {
    setRows(buildSalesRows(store, next.outletId, next.month, next.year));
    setSaveState("draft");
  }

  useEffect(() => {
    setRows(buildSalesRows(store, filters.outletId, filters.month, filters.year));
  }, [filters.month, filters.outletId, filters.year, store.salesChannels, store.salesRecords]);

  const salesRows = rows.filter((row) => row.type === "channel");
  const adjustmentRows = rows.filter((row) => row.type === "adjustment");
  const grossSales = sumAmount(salesRows);
  const adjustmentTotal = sumAmount(adjustmentRows);
  const totalDeduction = Math.abs(Math.min(adjustmentTotal, 0));
  const netSales = grossSales + adjustmentTotal;
  const previous = getPreviousPeriod(filters.month, filters.year);
  const previousBreakdown = getSalesBreakdown(
    store.salesRecords,
    store.salesChannels,
    filters.outletId,
    previous.month,
    previous.year,
  );
  const highest = salesRows.filter((row) => Number(row.amount) > 0).sort((a, b) => b.amount - a.amount)[0];
  const lowest = salesRows.filter((row) => Number(row.amount) > 0).sort((a, b) => a.amount - b.amount)[0];

  const columns = useMemo(
    () => [
      {
        key: "channel",
        header: "Channel",
        sticky: true,
        render: (row) => (
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">{row.channelName}</span>
            {row.type === "adjustment" ? <Badge tone="warning">Deduction</Badge> : null}
          </div>
        ),
      },
      {
        key: "amount",
        header: "Amount (RM)",
        render: (row, index) => (
          <div>
            <input
              className="control w-36"
              type="number"
              disabled={isLocked}
              value={row.amount}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, amount: event.target.value } : item,
                  ),
                )
              }
            />
            {row.amount === "" ? <div className="mt-1 text-xs font-semibold text-rose-600">Amount required</div> : null}
          </div>
        ),
      },
      {
        key: "share",
        header: "% of Net Sales",
        align: "right",
        render: (row) => toPercent(netSales ? (Number(row.amount) / netSales) * 100 : 0),
      },
      {
        key: "vs",
        header: "vs Previous Period",
        align: "right",
        render: (row) => {
          const previousValue = sumAmount(
            store.salesRecords.filter(
              (record) =>
                record.outlet_id === filters.outletId &&
                record.month === previous.month &&
                record.year === previous.year &&
                record.channel_id === row.channel_id,
            ),
          );
          const change = percentageChange(Number(row.amount), previousValue);
          return <span className={change >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-rose-600"}>{toPercent(change)}</span>;
        },
      },
      {
        key: "remark",
        header: "Remark",
        render: (row, index) => (
          <input
            className="control w-full"
            disabled={isLocked}
            value={row.remark}
            placeholder="Optional"
            onChange={(event) =>
              setRows((current) =>
                current.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, remark: event.target.value } : item,
                ),
              )
            }
          />
        ),
      },
      {
        key: "action",
        header: "Action",
        align: "right",
        render: (row, index) =>
          row.custom ? (
            <button className="icon-btn" disabled={isLocked} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>
              <Trash2 size={15} />
            </button>
          ) : (
            <span className="text-text-muted">-</span>
          ),
      },
    ],
    [filters.outletId, isLocked, netSales, previous.month, previous.year, store.salesRecords],
  );

  const summaryRows = [
    {
      id: "gross-sales",
      label: "Gross Sales",
      description: "All sales channels before deductions",
      value: grossSales,
      previous: previousBreakdown.grossSales,
      tone: "neutral",
    },
    {
      id: "total-deduction",
      label: "Total Deduction",
      description: "SST and other adjustment rows",
      value: adjustmentTotal,
      previous: previousBreakdown.adjustmentTotal,
      tone: "warning",
    },
    {
      id: "net-sales",
      label: "Net Sales",
      description: "Gross Sales + signed deductions",
      value: netSales,
      previous: previousBreakdown.netSales,
      tone: "info",
    },
  ];

  const summaryColumns = [
    {
      key: "label",
      header: "Auto Summary",
      sticky: true,
      render: (row) => (
        <div>
          <div className="flex items-center gap-2 font-bold text-text-primary">
            {row.label}
            {row.id === "net-sales" ? <Badge tone="info">Calculated</Badge> : null}
          </div>
          <div className="mt-1 text-xs text-text-secondary">{row.description}</div>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount (RM)",
      align: "right",
      render: (row) => (
        <span className={`text-base font-bold ${row.id === "total-deduction" ? "text-rose-600" : "text-text-primary"}`}>
          {row.id === "total-deduction" ? toSignedCurrency(row.value) : toCurrency(row.value)}
        </span>
      ),
    },
    {
      key: "share",
      header: "% of Net Sales",
      align: "right",
      render: (row) => (row.id === "net-sales" ? "100%" : toPercent(netSales ? (row.value / netSales) * 100 : 0)),
    },
    {
      key: "vs",
      header: "vs Previous Period",
      align: "right",
      render: (row) => {
        const change = percentageChange(row.value, row.previous);
        return <span className={change >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-rose-600"}>{toPercent(change)}</span>;
      },
    },
    { key: "remark", header: "Remark", render: () => <span className="text-text-muted">Read-only system calculation</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        section="Sales"
        title="Sales Input"
        description="Manual monthly sales entry by outlet and structured channel."
        actions={
          <>
            <button className="btn-secondary" type="button" disabled={isLocked} onClick={() => {
              setRows(buildSalesRows(store, filters.outletId, previous.month, previous.year).map((row) => ({ ...row, id: undefined })));
              ui.notify({ title: "Previous month imported", message: "Amounts were copied for review." });
            }}>Import from Previous Month</button>
            <button
              className="btn-primary"
              type="button"
              disabled={isLocked}
              onClick={() => {
                if (rows.some((row) => row.amount === "" || Number.isNaN(Number(row.amount)))) {
                  ui.notify({ title: "Validation warning", message: "Please fill all sales amounts before saving.", tone: "error" });
                  return;
                }
                setStore((current) =>
                  operationsService.upsertSalesData(current, {
                    outletId: filters.outletId,
                    month: filters.month,
                    year: filters.year,
                    salesRows: rows,
                  }),
                );
                setSaveState("saved");
                ui.notify({ title: "Sales data saved", message: `${filters.month}/${filters.year} sales records updated.` });
              }}
            >
              <Save size={16} /> Save Sales Data
            </button>
          </>
        }
      />
      <PeriodFilterBar
        store={store}
        filters={{
          ...filters,
          setOutletId: (value) => {
            filters.setOutletId(value);
            reloadRows({ ...filters, outletId: value });
          },
          setMonth: (value) => {
            filters.setMonth(value);
            reloadRows({ ...filters, month: value });
          },
          setYear: (value) => {
            filters.setYear(value);
            reloadRows({ ...filters, year: value });
          },
        }}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card
          title="Channel Entry"
          description="Net Sales is calculated from Gross Sales minus signed deductions. It is never manually entered."
          action={
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-secondary"
                type="button"
                disabled={isLocked}
                onClick={() => {
                  const result = operationsService.addSalesChannel(store, "Custom Channel", "channel");
                  setStore(result.state);
                  setRows((current) => [
                    ...current,
                    { id: undefined, channel_id: result.channel.id, channelName: result.channel.name, type: "channel", amount: "", remark: "", custom: true },
                  ]);
                }}
              >
                <Plus size={16} /> Add Custom Channel
              </button>
              <button
                className="btn-secondary"
                type="button"
                disabled={isLocked}
                onClick={() => {
                  const result = operationsService.addSalesChannel(store, "Other Deduction", "adjustment");
                  setStore(result.state);
                  setRows((current) => [
                    ...current,
                    { id: undefined, channel_id: result.channel.id, channelName: result.channel.name, type: "adjustment", amount: "", remark: "", custom: true },
                  ]);
                }}
              >
                <Plus size={16} /> Add Deduction
              </button>
            </div>
          }
        >
          <div className="space-y-5 p-5">
            <div>
              <div className="mb-3">
                <h3 className="text-sm font-bold text-text-primary">1. Sales Channels</h3>
                <p className="text-xs text-text-secondary">Enter Dine In, takeaway, delivery platforms and other revenue channels.</p>
              </div>
              <DataTable columns={columns} rows={salesRows} getRowKey={(row) => row.channel_id} />
            </div>

            <div>
              <div className="mb-3">
                <h3 className="text-sm font-bold text-text-primary">2. Adjustment / Deduction</h3>
                <p className="text-xs text-text-secondary">Enter SST or other deductions as negative values. They reduce calculated Net Sales.</p>
              </div>
              <DataTable columns={columns} rows={adjustmentRows} getRowKey={(row) => row.channel_id} />
            </div>

            <div>
              <div className="mb-3">
                <h3 className="text-sm font-bold text-text-primary">3. Auto Summary</h3>
                <p className="text-xs text-text-secondary">These rows are calculated by the system and cannot be edited.</p>
              </div>
              <DataTable columns={summaryColumns} rows={summaryRows} getRowKey={(row) => row.id} />
            </div>
          </div>
        </Card>

        <SummaryPanel
          title="Sales Summary"
          items={[
            { label: "Gross Sales", value: toCurrency(grossSales) },
            { label: "SST / Deduction", value: toCurrency(totalDeduction) },
            { label: "Net Sales", value: toCurrency(netSales) },
            { label: "Avg Daily Sales", value: toCurrency(netSales / 31) },
            { label: "Highest Channel", value: highest?.channelName ?? "-" },
            { label: "Lowest Channel", value: lowest?.channelName ?? "-" },
            { label: "Save Status", value: saveState === "saved" ? "Saved" : "Draft" },
          ]}
        >
          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-text-secondary">
            <div className="font-semibold text-text-primary">Quick Tips</div>
            <p className="mt-2">Review delivery channels with low share before finalizing month data.</p>
          </div>
        </SummaryPanel>
      </div>
      {isLocked ? <div className="card border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">This month is locked. Sales inputs are disabled until an admin unlocks it.</div> : null}
    </div>
  );
}
