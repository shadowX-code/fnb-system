import { BarChart3, Boxes, CheckCircle2, Package } from "lucide-react";
import FactorySegmentedControl from "../FactorySegmentedControl.jsx";
import { FactoryDataSurface } from "../FactoryDataDisplay.jsx";
import { quantity, percent } from "../../utils/factoryFormatters.js";

const metricLabels = {
  output: "Output Qty",
  completion: "Completion",
  batches: "Batch Count",
};

const numeric = (value) => Number(value || 0);

export function productionCompletion(row) {
  const eligibleDueCount = numeric(row?.eligible_due_count);
  if (eligibleDueCount <= 0) return { value: null, label: "—", helper: "No due Job Orders", tone: "neutral" };
  const value = numeric(row?.completion_rate);
  return { value, label: percent(value), helper: `${numeric(row?.completed_within_month_count)} of ${eligibleDueCount} due Job Orders`, tone: value >= 100 ? "success" : value === 0 ? "warning" : "neutral" };
}

export function productionMetricValue(row, metric) {
  if (metric === "completion") return productionCompletion(row).value;
  return numeric(metric === "batches" ? row?.batch_count : row?.output_qty);
}

export function rankProductionRows(rows, metric) {
  return [...(rows || [])]
    .sort((left, right) => {
      const leftValue = productionMetricValue(left, metric);
      const rightValue = productionMetricValue(right, metric);
      if (leftValue === null && rightValue !== null) return 1;
      if (rightValue === null && leftValue !== null) return -1;
      return numeric(rightValue) - numeric(leftValue)
        || String(left.product || "").localeCompare(String(right.product || ""))
        || String(left.finished_good_id || "").localeCompare(String(right.finished_good_id || ""));
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function metricDisplay(row, metric) {
  if (metric === "completion") return productionCompletion(row);
  if (metric === "batches") return { value: numeric(row.batch_count), label: numeric(row.batch_count).toLocaleString("en-MY"), helper: "Completed batches", tone: "success" };
  return { value: numeric(row.output_qty), label: quantity(row.output_qty, row.uom), helper: "Completed output", tone: "success" };
}

function ProductionMetric({ icon: Icon, label, value, helper, tone = "neutral" }) {
  const valueClass = tone === "warning" ? "text-amber-700 dark:text-amber-300" : tone === "success" ? "text-emerald-700 dark:text-emerald-300" : "text-text-primary";
  return <div className="min-w-0"><div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted"><Icon size={14} aria-hidden="true" />{label}</div><div className={`mt-1 truncate text-sm font-semibold tabular-nums ${valueClass}`}>{value}</div>{helper ? <div className="mt-0.5 truncate text-[11px] text-text-secondary">{helper}</div> : null}</div>;
}

function ProductionRow({ row, metric, maximum }) {
  const active = metricDisplay(row, metric);
  const completion = productionCompletion(row);
  const width = active.value === null ? 0 : metric === "completion" ? Math.min(100, Math.max(0, active.value)) : maximum > 0 ? Math.max(4, (active.value / maximum) * 100) : 0;
  const targetQty = metric === "output" ? numeric(row.target_qty) : 0;
  const targetPosition = targetQty > 0 && maximum > 0 ? Math.min(100, (targetQty / maximum) * 100) : null;
  const railClass = active.tone === "warning" ? "bg-amber-500" : active.tone === "neutral" ? "bg-slate-400" : "bg-primary";
  return (
    <div className="grid gap-3 border-b border-border px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(190px,0.9fr)_minmax(220px,1.5fr)_minmax(92px,0.42fr)_minmax(84px,0.38fr)_minmax(100px,0.48fr)_minmax(120px,0.54fr)] lg:items-center lg:gap-5">
      <div className="flex min-w-0 items-start gap-3"><div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold tabular-nums text-text-secondary">{row.rank}</div><div className="min-w-0"><div className="truncate text-sm font-semibold text-text-primary">{row.product || "Finished Good"}</div><div className="mt-0.5 truncate text-xs text-text-secondary">{row.packaging_sku || "—"}</div></div></div>
      <div className="min-w-0"><div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium text-text-secondary">{metricLabels[metric]}</span><span className="shrink-0 font-semibold tabular-nums text-text-primary">{active.label}</span></div><div className="relative mt-2 h-2 overflow-hidden rounded-full bg-surface-muted"><div className={`h-full rounded-full transition-[width] duration-200 ${railClass}`} style={{ width: `${width}%` }} />{targetPosition !== null ? <span aria-label={`Target ${quantity(targetQty, row.uom)}`} className="pointer-events-none absolute inset-y-0 w-px bg-text-primary/60" style={{ left: `calc(${targetPosition}% - 1px)` }} /> : null}</div><div className="mt-1 truncate text-[11px] text-text-secondary">{active.helper}</div></div>
      <ProductionMetric icon={Package} label="Output" value={quantity(row.output_qty, row.uom)} />
      <ProductionMetric icon={Boxes} label="Batches" value={numeric(row.batch_count).toLocaleString("en-MY")} />
      <ProductionMetric icon={BarChart3} label="Avg. batch" value={quantity(row.average_batch_qty, row.uom)} />
      <ProductionMetric icon={CheckCircle2} label="Completion" value={completion.label} helper={completion.helper} tone={completion.tone} />
    </div>
  );
}

function FooterMetric({ icon: Icon, label, value, helper }) {
  return <div className="min-w-0 px-4 py-3 first:pl-0 last:pr-0 sm:border-r sm:border-border sm:last:border-r-0"><div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted"><Icon size={14} aria-hidden="true" />{label}</div><div className="mt-1 truncate text-base font-semibold tabular-nums text-text-primary">{value}</div>{helper ? <div className="mt-0.5 truncate text-[11px] text-text-secondary">{helper}</div> : null}</div>;
}

export default function FactoryProductionIntelligenceRanking({ rows, metric, onMetricChange }) {
  const groupedRows = (rows || []).reduce((groups, row) => {
    const uom = row.uom || "UOM unavailable";
    groups.set(uom, [...(groups.get(uom) || []), row]);
    return groups;
  }, new Map());
  const rankedGroups = [...groupedRows.entries()]
    .sort(([leftUom], [rightUom]) => leftUom.localeCompare(rightUom))
    .map(([uom, groupRows]) => ({
      uom,
      rows: rankProductionRows(groupRows, metric),
    }));
  const rankedRows = rankedGroups.flatMap((group) => group.rows);
  const totalOutput = rankedRows.reduce((sum, row) => sum + numeric(row.output_qty), 0);
  const totalBatches = rankedRows.reduce((sum, row) => sum + numeric(row.batch_count), 0);
  const comparableRows = rankedRows.filter((row) => numeric(row.eligible_due_count) > 0);
  const eligibleDueCount = comparableRows.reduce((sum, row) => sum + numeric(row.eligible_due_count), 0);
  const completedDueCount = comparableRows.reduce((sum, row) => sum + numeric(row.completed_within_month_count), 0);
  const uoms = [...new Set(rankedRows.map((row) => row.uom).filter(Boolean))];
  const totalOutputLabel = uoms.length === 1 ? quantity(totalOutput, uoms[0]) : "—";
  const averageBatchLabel = uoms.length === 1 && totalBatches > 0 ? quantity(totalOutput / totalBatches, uoms[0]) : "—";

  return (
    <FactoryDataSurface className="factory-production-intelligence">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
        <div><h2 className="text-base font-semibold text-text-primary">Production Summary</h2><p className="mt-1 text-sm text-text-secondary">Completed production by product for the selected month.</p></div>
        <FactorySegmentedControl value={metric} onChange={onMetricChange} label="Production summary metric" options={[{ value: "output", label: "Output Qty" }, { value: "completion", label: "Completion" }, { value: "batches", label: "Batch Count" }]} />
      </div>
      {rankedRows.length ? <>
        <div className="hidden border-b border-border bg-surface-muted px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted lg:grid lg:grid-cols-[minmax(190px,0.9fr)_minmax(220px,1.5fr)_minmax(92px,0.42fr)_minmax(84px,0.38fr)_minmax(100px,0.48fr)_minmax(120px,0.54fr)] lg:gap-5"><div>Product</div><div>{metricLabels[metric]}</div><div>Output Qty</div><div>Batches</div><div>Average Batch</div><div>Completion Rate</div></div>
        <div>{rankedGroups.map((group) => {
          const maximum = Math.max(0, ...group.rows.map((row) => numeric(productionMetricValue(row, metric))), ...(metric === "output" ? group.rows.map((row) => numeric(row.target_qty)) : []));
          return <section key={group.uom} aria-label={`${group.uom} production ranking`}>{rankedGroups.length > 1 ? <div className="border-b border-border bg-surface-muted px-4 py-2 text-xs font-semibold text-text-secondary">{group.uom}</div> : null}{group.rows.map((row) => <ProductionRow key={row.id || `${row.finished_good_id}-${row.uom}`} row={row} metric={metric} maximum={maximum} />)}</section>;
        })}</div>
        <div className="grid border-t border-border bg-surface-muted sm:grid-cols-4"><FooterMetric icon={Package} label="Total Output" value={totalOutputLabel} helper={uoms.length === 1 ? "Selected production unit" : "Multiple production units"} /><FooterMetric icon={Boxes} label="Total Batches" value={totalBatches.toLocaleString("en-MY")} /><FooterMetric icon={BarChart3} label="Average Batch Size" value={averageBatchLabel} helper={uoms.length === 1 ? "Across completed batches" : "Multiple production units"} /><FooterMetric icon={CheckCircle2} label="Overall Completion" value={eligibleDueCount ? percent((completedDueCount * 100) / eligibleDueCount) : "—"} helper={eligibleDueCount ? `${completedDueCount} of ${eligibleDueCount} due Job Orders` : "No due Job Orders"} /></div>
      </> : <div className="p-4"><div className="py-10 text-center text-sm text-text-secondary">No completed Production matches this month and filter.</div></div>}
    </FactoryDataSurface>
  );
}
