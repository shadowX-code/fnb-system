import { useEffect, useMemo, useRef, useState } from "react";
import { Percent, Plus, Save, Trash2, TrendingUp, Wallet } from "lucide-react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import PeriodFilterBar from "../components/PeriodFilterBar.jsx";
import SummaryPanel from "../components/SummaryPanel.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { operationsService } from "../services/operationsService.js";
import {
  getPreviousPeriod,
  getOutletTaxConfig,
  getSalesBreakdown,
  percentageChange,
  sumAmount,
  toCurrency,
  toPercent,
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
        amount: record ? Math.abs(Number(record.amount || 0)) : "",
        remark: record?.remark ?? "",
      };
    });
}

const deductionTypes = ["SST Deduction", "Refund", "Promo Subsidy", "Delivery Commission", "Other Deduction"];
const deliveryNames = new Set(["GrabFood", "FoodPanda", "ShopeeFood"]);
const sstChannelNames = ["SST Deduction", "SST", "SST (-)"];
const deductionDisplayNames = {
  "SST Deduction": "SST",
  "Other Deduction": "Other",
  "Promo Deduction": "Promo",
  "Promo Subsidy": "Promo",
  Refund: "Refund",
  "Refund Deduction": "Refund",
  "Delivery Commission Deduction": "Delivery Commission",
  "Delivery Commission": "Delivery Commission",
};

function normalizeInputAmount(value, type) {
  if (value === "") return "";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return value;
  return type === "adjustment" ? String(Math.abs(numeric)) : value;
}

export default function SalesInputPage({ store, setStore, ui }) {
  const filters = usePeriodFilters(store);
  const amountInputRefs = useRef(new Map());
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedRecently, setSavedRecently] = useState(false);
  const [savedRowsCount, setSavedRowsCount] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [rows, setRows] = useState(() => buildSalesRows(store, filters.outletId, filters.month, filters.year));
  const [activeRowId, setActiveRowId] = useState(null);
  const [deductionModal, setDeductionModal] = useState(false);
  const [deductionType, setDeductionType] = useState("SST Deduction");

  const sstConfig = getOutletTaxConfig(store.outletTaxConfigs, filters.outletId, filters.month, filters.year, "SST");
  const sstEnabled = Boolean(sstConfig.enabled);
  const sstRate = Number(sstConfig.rate || 0);
  const isLocked = Boolean(getLock(store, filters.outletId, filters.month, filters.year)?.is_locked);
  const hasSavedRecord = store.salesRecords.some(
    (record) =>
      record.outlet_id === filters.outletId &&
      record.month === filters.month &&
      record.year === filters.year,
  );
  const visibleRows = rows.filter((row) => sstEnabled || !sstChannelNames.includes(row.channelName));
  const salesRows = visibleRows.filter((row) => row.type === "channel");
  const adjustmentRows = visibleRows.filter((row) => row.type === "adjustment");
  const orderedInputRows = [...salesRows, ...adjustmentRows];
  const grossSales = sumAmount(salesRows);
  const totalDeduction = sumAmount(adjustmentRows.map((row) => ({ ...row, amount: Math.abs(Number(row.amount || 0)) })));
  const netSales = grossSales - totalDeduction;
  const sstRow = adjustmentRows.find((row) => sstChannelNames.includes(row.channelName));
  const actualSst = sstEnabled ? Math.abs(Number(sstRow?.amount || 0)) : 0;
  const expectedSst = sstEnabled ? grossSales * (sstRate / 100) : 0;
  const sstVariance = expectedSst ? ((actualSst - expectedSst) / expectedSst) * 100 : 0;
  const previous = getPreviousPeriod(filters.month, filters.year);
  const previousBreakdown = getSalesBreakdown(
    store.salesRecords,
    store.salesChannels,
    filters.outletId,
    previous.month,
    previous.year,
  );
  const deliveryRows = salesRows.filter((row) => deliveryNames.has(row.channelName));
  const deliverySales = sumAmount(deliveryRows);
  const deliveryShare = grossSales ? (deliverySales / grossSales) * 100 : 0;
  const dineInRow = salesRows.find((row) => row.channelName === "Dine In");
  const dineInSales = Number(dineInRow?.amount || 0);
  const dineInMix = grossSales ? (dineInSales / grossSales) * 100 : 0;
  const highest = salesRows.filter((row) => Number(row.amount || 0) > 0).sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
  const highestShare = grossSales && highest ? (Number(highest.amount || 0) / grossSales) * 100 : 0;

  function reloadRows(next = filters) {
    setRows(buildSalesRows(store, next.outletId, next.month, next.year));
    setIsDirty(false);
    setIsSaving(false);
    setSavedRecently(false);
  }

  useEffect(() => {
    setRows(buildSalesRows(store, filters.outletId, filters.month, filters.year));
    setIsDirty(false);
    setIsSaving(false);
    setSavedRecently(false);
  }, [filters.month, filters.outletId, filters.year, store.salesChannels, store.salesRecords]);

  useEffect(() => {
    if (!sstEnabled && deductionType === "SST Deduction") {
      setDeductionType("Refund");
    }
  }, [deductionType, sstEnabled]);

  function markDraft() {
    if (!isSaving) {
      setIsDirty(true);
      setSavedRecently(false);
    }
  }

  function updateRow(channelId, patch) {
    setRows((current) => current.map((item) => (item.channel_id === channelId ? { ...item, ...patch } : item)));
    markDraft();
  }

  function getPreviousValue(row) {
    return sumAmount(
      store.salesRecords.filter(
        (record) =>
          record.outlet_id === filters.outletId &&
          record.month === previous.month &&
          record.year === previous.year &&
          record.channel_id === row.channel_id,
      ),
    );
  }

  function getRowChange(row) {
    const previousValue = getPreviousValue(row);
    if (!previousValue) return null;
    return percentageChange(Number(row.amount || 0), previousValue);
  }

  function isAbnormal(row) {
    const change = getRowChange(row);
    return row.type === "channel" && change !== null && change > 150;
  }

  function focusNextAmount(channelId) {
    const index = orderedInputRows.findIndex((row) => row.channel_id === channelId);
    const nextRow = orderedInputRows[index + 1];
    if (!nextRow) return;
    const nextInput = amountInputRefs.current.get(nextRow.channel_id);
    nextInput?.focus();
    nextInput?.select();
  }

  function saveSalesData() {
    if (isLocked || isSaving) return;
    const invalidRows = visibleRows.filter((row) => Number.isNaN(Number(row.amount || 0)));
    if (invalidRows.length) {
      ui.notify({ title: "Validation warning", message: "Please enter valid numeric amounts before saving.", tone: "error" });
      return;
    }
    setIsSaving(true);
    window.setTimeout(() => {
      setStore((current) =>
        operationsService.upsertSalesData(current, {
          outletId: filters.outletId,
          month: filters.month,
          year: filters.year,
          salesRows: visibleRows.map((row) => ({ ...row, amount: row.type === "adjustment" ? Math.abs(Number(row.amount || 0)) : Number(row.amount || 0) })),
        }),
      );
      setIsSaving(false);
      setIsDirty(false);
      setSavedRecently(true);
      setSavedRowsCount(visibleRows.length);
      setLastSavedAt(new Date());
      window.setTimeout(() => setSavedRecently(false), 4000);
      ui.notify({ title: "Sales data saved successfully", message: `${visibleRows.length} sales rows saved.` });
    }, 300);
  }

  useEffect(() => {
    function handleShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveSalesData();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  const saveStatusLabel =
    isSaving
      ? "Saving..."
      : isDirty
        ? hasSavedRecord
          ? "● Unsaved changes"
          : "● Unsaved draft"
        : savedRecently
          ? `✓ Saved successfully · ${savedRowsCount} rows saved`
          : hasSavedRecord
            ? lastSavedAt
              ? `✓ Last saved ${lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "✓ Saved"
            : "No data yet";
  const saveStatusClass = isSaving
    ? "text-primary"
    : isDirty
      ? "text-amber-700"
      : hasSavedRecord || savedRecently
        ? "text-emerald-700"
        : "text-text-secondary";

  const rowColumns = useMemo(() => {
    const baseColumns = [
      {
        key: "channel",
        header: "Channel",
        sticky: true,
        width: "180px",
        className: "w-[180px]",
        headerClassName: "w-[180px]",
        render: (row) => (
          <div className="flex w-[160px] items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold text-text-primary" title={row.channelName}>
              {row.type === "adjustment" ? deductionDisplayNames[row.channelName] ?? row.channelName.replace(/\s*Deduction$/i, "") : row.channelName}
            </span>
            {row.type === "adjustment" ? <Badge tone="warning">Deduction</Badge> : null}
            {isAbnormal(row) ? <Badge tone="warning">Unusual</Badge> : null}
          </div>
        ),
      },
      {
        key: "amount",
        header: "Amount (RM)",
        align: "right",
        width: "150px",
        className: "w-[150px]",
        headerClassName: "w-[150px]",
        render: (row) => (
          <input
            ref={(element) => {
              if (element) amountInputRefs.current.set(row.channel_id, element);
              else amountInputRefs.current.delete(row.channel_id);
            }}
            className="control h-8 w-28 text-right text-[15px] font-semibold transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            type="number"
            disabled={isLocked}
            value={row.amount ?? ""}
            placeholder="0.00"
            onFocus={(event) => {
              setActiveRowId(row.channel_id);
              event.target.select();
            }}
            onBlur={() => setActiveRowId(null)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                focusNextAmount(row.channel_id);
              }
            }}
            onChange={(event) => updateRow(row.channel_id, { amount: normalizeInputAmount(event.target.value, row.type) })}
          />
        ),
      },
      {
        key: "share",
        header: "Share of Gross Sales",
        align: "right",
        width: "130px",
        className: "w-[130px]",
        headerClassName: "w-[130px]",
        render: (row) =>
          row.type === "channel" ? (
            <span className="text-sm font-medium text-text-primary">{toPercent(grossSales ? (Number(row.amount || 0) / grossSales) * 100 : 0)}</span>
          ) : (
            <span className="text-text-muted">—</span>
          ),
      },
      {
        key: "vs",
        header: "vs Previous Period",
        align: "right",
        width: "130px",
        className: "w-[130px]",
        headerClassName: "w-[130px]",
        render: (row) => {
          const change = getRowChange(row);
          if (change === null) return <span className="text-text-muted">—</span>;
          return (
              <span
              className={`text-sm font-semibold ${change >= 0 ? "text-emerald-600" : "text-rose-500"}`}
              title={isAbnormal(row) ? "Unusual change vs previous period" : undefined}
            >
              {toPercent(change)}
            </span>
          );
        },
      },
      {
        key: "remark",
        header: "Remark",
        width: "200px",
        className: "w-[200px]",
        headerClassName: "w-[200px]",
        render: (row) => (
          <input
            className="control h-8 w-full"
            disabled={isLocked}
            value={row.remark}
            placeholder="Optional"
            onChange={(event) => updateRow(row.channel_id, { remark: event.target.value })}
          />
        ),
      },
    ];

    baseColumns.push({
      key: "action",
      header: "Action",
      align: "right",
      width: "72px",
      className: "w-[72px]",
      headerClassName: "w-[72px]",
      render: (row) =>
        row.custom ? (
          <button
            className="icon-btn"
            disabled={isLocked}
            type="button"
            onClick={() => {
              setRows((current) => current.filter((item) => item.channel_id !== row.channel_id));
              markDraft();
            }}
          >
            <Trash2 size={14} />
          </button>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    });

    return baseColumns;
  }, [grossSales, isLocked, store.salesRecords, filters.outletId, previous.month, previous.year, rows, activeRowId]);

  const summaryRows = [
    {
      id: "gross-sales",
      label: "Gross Sales",
      description: "All sales channels before deductions",
      value: grossSales,
      previous: previousBreakdown.grossSales,
    },
    {
      id: "total-deduction",
      label: "Total Deduction",
      description: "Deduction amounts are automatically subtracted from Gross Sales.",
      value: totalDeduction,
      previous: previousBreakdown.adjustmentTotal,
    },
    {
      id: "net-sales",
      label: "Net Sales",
      description: "Gross Sales - Total Deduction",
      value: netSales,
      previous: previousBreakdown.netSales,
    },
  ];

  const summaryColumns = [
    {
      key: "label",
      header: "Auto Summary",
      sticky: true,
      width: "180px",
      className: "w-[180px]",
      headerClassName: "w-[180px]",
      render: (row) => (
        <div>
          <div className="flex items-center gap-1.5 text-[15px] font-bold text-text-primary">
            {row.label}
            {row.id === "net-sales" ? <Badge tone="info">Calculated</Badge> : null}
          </div>
          <div className="mt-0.5 text-[13px] text-text-secondary">{row.description}</div>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount (RM)",
      align: "right",
      width: "150px",
      className: "w-[150px]",
      headerClassName: "w-[150px]",
      render: (row) => (
        <span className={`text-[15px] font-bold ${row.id === "total-deduction" ? "text-rose-500" : "text-text-primary"}`}>
          {toCurrency(row.value)}
        </span>
      ),
    },
    {
      key: "share",
      header: "Share",
      align: "right",
      width: "130px",
      className: "w-[130px]",
      headerClassName: "w-[130px]",
      render: (row) => (row.id === "net-sales" ? "100%" : toPercent(netSales ? (row.value / netSales) * 100 : 0)),
    },
    {
      key: "vs",
      header: "vs Previous Period",
      align: "right",
      width: "130px",
      className: "w-[130px]",
      headerClassName: "w-[130px]",
      render: (row) => {
        if (!row.previous) return <span className="text-text-muted">—</span>;
        const change = percentageChange(row.value, row.previous);
        return <span className={change >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-rose-500"}>{toPercent(change)}</span>;
      },
    },
    {
      key: "remark",
      header: "Remark",
      width: "220px",
      className: "w-[220px]",
      headerClassName: "w-[220px]",
      render: () => <span className="text-xs text-text-muted">Read-only system calculation</span>,
    },
  ];

  function addCustomChannel() {
    const result = operationsService.addSalesChannel(store, "Custom Channel", "channel");
    setStore(result.state);
    setRows((current) => [
      ...current,
      { id: undefined, channel_id: result.channel.id, channelName: result.channel.name, type: "channel", amount: "", remark: "", custom: true },
    ]);
    markDraft();
  }

  function addDeduction() {
    if (!sstEnabled && deductionType === "SST Deduction") {
      ui.notify({ title: "SST not enabled", message: "This outlet is not configured for SST.", tone: "info" });
      return;
    }
    const existingChannel = store.salesChannels.find((channel) => channel.name === deductionType && channel.type === "adjustment");
    const existingRow = rows.find((row) => row.channelName === deductionType && row.type === "adjustment");
    if (existingRow) {
      ui.notify({ title: "Deduction already exists", message: `${deductionType} is already available in the table.`, tone: "info" });
      setDeductionModal(false);
      return;
    }

    if (existingChannel) {
      setRows((current) => [
        ...current,
        { id: undefined, channel_id: existingChannel.id, channelName: existingChannel.name, type: "adjustment", amount: "", remark: "", custom: true },
      ]);
    } else {
      const result = operationsService.addSalesChannel(store, deductionType, "adjustment");
      setStore(result.state);
      setRows((current) => [
        ...current,
        { id: undefined, channel_id: result.channel.id, channelName: result.channel.name, type: "adjustment", amount: "", remark: "", custom: true },
      ]);
    }
    markDraft();
    setDeductionModal(false);
  }

  return (
    <div className="space-y-3">
      <PageHeader
        section="Sales"
        title="Sales Input"
        description="Manual monthly sales entry by outlet and structured channel."
        actions={
          <>
            <span className={`text-xs font-semibold ${saveStatusClass}`}>{saveStatusLabel}</span>
            <button
              className="btn-secondary"
              type="button"
              disabled={isLocked}
              onClick={() => {
                setRows(buildSalesRows(store, filters.outletId, previous.month, previous.year).map((row) => ({ ...row, id: undefined })));
                setIsDirty(true);
                setSavedRecently(false);
                ui.notify({ title: "Previous month imported", message: "Rows were copied for review." });
              }}
            >
              Import Previous
            </button>
            <button className="btn-primary" type="button" disabled={isLocked || isSaving} onClick={saveSalesData}>
              <Save size={15} /> {isSaving ? "Saving..." : "Save Sales Data"}
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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Wallet} label="Net Sales" value={toCurrency(netSales)} helper="System calculated as Gross Sales minus deductions" trend="Calculated" />
        <MetricCard icon={TrendingUp} label="Delivery Sales" value={toCurrency(deliverySales)} helper={`${toPercent(deliveryShare)} of Gross Sales`} trend="GrabFood + FoodPanda + ShopeeFood" />
        <MetricCard icon={Percent} label="Dine In Mix" value={toPercent(dineInMix)} helper={toCurrency(dineInSales)} trend="Based on Gross Sales" />
        <MetricCard
          icon={TrendingUp}
          label="Top Channel Contribution"
          value={highest?.channelName ?? "—"}
          helper={highest ? `${toCurrency(highest.amount)} · ${toPercent(highestShare)}` : "No sales channel entered"}
          trend={highest ? "Current leader" : "Awaiting data"}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card
          title="Sales Operations Workspace"
          description="Enter sales channels first, then deduction amounts. Net Sales is read-only and calculated in real time."
          action={
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" type="button" disabled={isLocked} onClick={addCustomChannel}>
                <Plus size={15} /> Custom Channel
              </button>
              <button className="btn-secondary" type="button" disabled={isLocked} onClick={() => setDeductionModal(true)}>
                <Plus size={15} /> Add Deduction
              </button>
            </div>
          }
        >
          <div className="space-y-3 p-3">
            <div>
              <div className="mb-2 flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">1. Sales Channels</h3>
                  <p className="text-xs text-text-secondary">Empty amounts count as RM0. Press Enter to jump to the next amount.</p>
                </div>
                <span className="text-xs font-semibold text-text-secondary">Sales Mix % uses Gross Sales</span>
              </div>
              <DataTable
                columns={rowColumns}
                rows={salesRows}
                getRowKey={(row) => row.channel_id}
                density="compact"
                tableClassName="min-w-[850px] table-fixed"
                getRowClassName={(row) => `${activeRowId === row.channel_id ? "bg-primary/5" : ""} ${isAbnormal(row) ? "bg-amber-50/70" : ""}`}
              />
            </div>

            <div>
              <div className="mb-2">
                <h3 className="text-sm font-bold text-text-primary">2. Adjustment / Deduction</h3>
                <p className="text-xs text-text-secondary">Enter positive deduction amounts. The system automatically subtracts them from Net Sales.</p>
              </div>
              {adjustmentRows.length ? (
                <DataTable
                  columns={rowColumns}
                  rows={adjustmentRows}
                  getRowKey={(row) => row.channel_id}
                  density="compact"
                  tableClassName="min-w-[850px] table-fixed"
                  getRowClassName={(row) => (activeRowId === row.channel_id ? "bg-primary/5" : "")}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-slate-50 px-3 py-2 text-xs font-semibold text-text-secondary">
                  {sstEnabled ? "No deductions added yet." : "SST is not effective for this outlet and period. Add other deductions only when needed."}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2">
                <h3 className="text-sm font-bold text-text-primary">3. Auto Summary</h3>
                <p className="text-xs text-text-secondary">Gross Sales, deductions and Net Sales update instantly while you type.</p>
              </div>
              <DataTable columns={summaryColumns} rows={summaryRows} getRowKey={(row) => row.id} density="compact" tableClassName="min-w-[860px] table-fixed" />
            </div>
          </div>
        </Card>

        <SummaryPanel
          title="Live Sales Summary"
          items={[
            { label: "Net Sales", value: toCurrency(netSales) },
            { label: "Avg Daily Sales", value: toCurrency(netSales / 31) },
            { label: "Top Channel Contribution", value: highest ? `${highest.channelName} · ${toPercent(highestShare)}` : "—" },
            { label: "Delivery Sales", value: toCurrency(deliverySales) },
            { label: "Delivery Mix", value: toPercent(deliveryShare) },
            ...(sstEnabled ? [{ label: "SST Deduction", value: toCurrency(actualSst), tone: "danger" }] : []),
            ...(totalDeduction && (!sstEnabled || totalDeduction !== actualSst) ? [{ label: "Total Deduction", value: toCurrency(totalDeduction), tone: "danger" }] : []),
            { label: "Save Status", value: saveStatusLabel },
          ]}
        >
          <div className="space-y-3 rounded-xl bg-slate-50 p-3 text-xs text-text-secondary">
            <div>
              <div className="font-semibold text-text-primary">Delivery Group Summary</div>
              <div className="mt-2 flex items-center justify-between">
                <span>Total Delivery</span>
                <span className="font-semibold text-text-primary">{toCurrency(deliverySales)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span>Delivery %</span>
                <span className="font-semibold text-text-primary">{toPercent(deliveryShare)}</span>
              </div>
            </div>
            <div className="space-y-1 border-t border-border pt-3">
              {deliveryRows.map((row) => (
                <div key={row.channel_id} className="flex items-center justify-between gap-2">
                  <span>{row.channelName}</span>
                  <span className="font-semibold text-text-primary">{toPercent(deliverySales ? (Number(row.amount || 0) / deliverySales) * 100 : 0)}</span>
                </div>
              ))}
            </div>
            {sstEnabled ? (
              <div className="space-y-1 border-t border-border pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span>Expected SST ({toPercent(sstRate, 0)})</span>
                  <span className="font-semibold text-text-primary">{toCurrency(expectedSst)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>Variance</span>
                  <span className={`font-semibold ${Math.abs(sstVariance) > 15 ? "text-amber-700" : "text-text-primary"}`}>{toPercent(sstVariance)}</span>
                </div>
              </div>
            ) : null}
          </div>
        </SummaryPanel>
      </div>

      {isLocked ? <div className="card border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">This month is locked. Sales inputs are disabled until an admin unlocks it.</div> : null}

      {deductionModal ? (
        <Modal
          title="Add Deduction"
          description="Choose a structured deduction type before adding it to the sales entry table."
          onClose={() => setDeductionModal(false)}
          footer={
            <>
              <button className="btn-secondary" type="button" onClick={() => setDeductionModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" type="button" onClick={addDeduction}>
                Add Deduction
              </button>
            </>
          }
        >
          <div className="space-y-2">
            {deductionTypes.filter((type) => sstEnabled || type !== "SST Deduction").map((type) => (
              <label key={type} className="flex cursor-pointer items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm transition hover:bg-slate-50">
                <span className="font-semibold text-text-primary">{type}</span>
                <input className="h-4 w-4 accent-primary" type="radio" checked={deductionType === type} onChange={() => setDeductionType(type)} />
              </label>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
