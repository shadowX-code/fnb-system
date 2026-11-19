import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { FactoryTable } from "./FactoryDataDisplay.jsx";
import { FactoryCellText } from "./FactoryTableCell.jsx";
import { formatFactoryReadableDate, formatProductionDurationMinutes } from "../utils/factoryDates.js";
import { formatFactoryBatchNo } from "../utils/factoryFormatters.js";
import { performanceNumber as number } from "../utils/productionMonthlyPerformance.js";

function quantity(value, unit) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : `${number(value)}${unit ? ` ${unit}` : ""}`;
}

function duration(hours) {
  const minutes = Number(hours) * 60;
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  return minutes < 1 ? "<1 min" : formatProductionDurationMinutes(Math.round(minutes));
}

export default function FactoryDailyProductionModal({ day, onClose, onViewResult }) {
  const summaryRef = useRef(null);
  const opening = useRef(false);
  const [openingResult, setOpeningResult] = useState(false);
  const [error, setError] = useState(null);
  async function viewResult(run) {
    if (opening.current) return;
    opening.current = true;
    setOpeningResult(true);
    setError(null);
    try { await onViewResult(run); }
    catch { setError("Unable to open Production result. Please retry."); }
    finally { opening.current = false; setOpeningResult(false); }
  }
  useEffect(() => {
    summaryRef.current?.closest('[role="dialog"]')?.querySelector('[aria-label="Close modal"]')?.focus();
  }, []);

  const summary = [
    { label: "Total Output", value: day.state === "missing" ? "Incomplete" : day.state === "future" ? "—" : `${number(day.output_kg)} kg` },
    { label: "Completed Runs", value: number(day.completed_runs) },
    { label: "Productivity", value: day.productivity == null ? "—" : `${number(day.productivity)} kg/JO-hour` },
  ];
  const columns = [
    { key: "identity", label: "Product / Job Order", className: "min-w-0 break-words", render: (run) => (
      <FactoryCellText primary={run.finished_good_name || "Finished Good"} secondary={
        <div className="space-y-0.5">
          {run.finished_good_name_cn && <div>{run.finished_good_name_cn}</div>}
          <div>{[run.sku_code, run.variant_name || quantity(run.pack_size_qty, run.pack_size_uom)].filter(value => value && value !== "—").join(" · ") || "Packaging SKU unavailable"}</div>
          <div className="flex flex-wrap gap-x-2">
            <span className="font-semibold text-text-primary">{run.job_order_no || "Job Order unavailable"}</span>
            <span>Batch No. · {formatFactoryBatchNo(run.batch_no)}</span>
          </div>
        </div>
      } />
    ) },
    { key: "output", label: "Actual Output", align: "right", className: "tabular-nums", render: (run) =>
      run.output_kg == null ? quantity(run.output_qty, run.output_uom) : quantity(run.output_kg, "kg") },
    { key: "packs", label: "Actual Pack Qty", align: "right", className: "tabular-nums", render: (run) => quantity(run.actual_pack_qty, "packs") },
    { key: "duration", label: "Duration", align: "right", className: "tabular-nums", render: (run) => duration(run.jo_hours) },
    { key: "view", label: "View", mobileLabel: "", align: "right", render: (run) => onViewResult && run.job_order_id ? (
      <button type="button" className="btn-icon" disabled={openingResult} title="View Production result"
        aria-label={`View Production result for ${run.job_order_no || run.finished_good_name || "this run"}`}
        onClick={() => viewResult(run)}>
        <Eye size={16} />
      </button>
    ) : null },
  ];

  return <Modal title="Daily Production" description={formatFactoryReadableDate(day.day)} onClose={onClose} size="xl"
    bodyClassName="!p-0">
    <div ref={summaryRef} className="sticky top-0 z-10 grid grid-cols-3 gap-2 border-b border-border bg-[var(--theme-surface-raised)] px-3 py-3 sm:px-4" aria-label="Daily Production summary">
      {summary.map(item => <MetricCard key={item.label} {...item} variant="compact" wrapLabel valueClassName="text-sm font-semibold tabular-nums sm:text-base" />)}
    </div>
    <div className="min-w-0 p-3 sm:p-4">
      {error && <p role="alert" className="mb-3 text-sm text-text-secondary">{error}</p>}
      <FactoryTable columns={columns} rows={day.records} rowKey={(run) => run.production_id} mobileLayout="stack"
        emptyTitle="No completed Production"
        emptyDescription={day.state === "future" ? "No completed runs are attributed to this date yet." : "No completed runs are attributed to this business date."} />
      {day.invalid_duration_runs > 0 || day.missing_output_runs > 0 ? <p role="note" className="mt-3 text-xs text-text-secondary">{day.invalid_duration_runs > 0 ? `${day.invalid_duration_runs} runs have no valid duration and are excluded from productivity. ` : ""}{day.missing_output_runs > 0 ? `${day.missing_output_runs} runs have no valid kg output.` : ""}</p> : null}
    </div>
  </Modal>;
}
