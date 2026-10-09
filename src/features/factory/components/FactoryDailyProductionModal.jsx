import { useEffect, useRef } from "react";
import { Eye } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import { FactoryCellEntity, FactoryCellText } from "./FactoryTableCell.jsx";
import { formatFactoryAuditDateTime, formatFactoryReadableDate } from "../utils/factoryDates.js";
import { performanceNumber as number } from "../utils/productionMonthlyPerformance.js";

function quantity(value, unit) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : `${number(value)}${unit ? ` ${unit}` : ""}`;
}

export default function FactoryDailyProductionModal({ day, onClose, onViewResult }) {
  const content = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = content.current.closest('[role="dialog"]');
    dialog.querySelector("button")?.focus();
    function keyDown(event) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    dialog.addEventListener("keydown", keyDown);
    return () => { dialog.removeEventListener("keydown", keyDown); if (previous?.isConnected) previous.focus(); };
  }, [onClose]);
  return <Modal title="Daily Production" description={formatFactoryReadableDate(day.day)} onClose={onClose} size="lg">
    <div ref={content}>
      <dl className="mb-3 flex flex-wrap gap-x-8 gap-y-3 border-b border-border pb-3">
        {[{ label: "Total Output", value: day.state === "missing" ? "Incomplete" : day.state === "future" ? "—" : `${number(day.output_kg)} kg` }, { label: "Completed Runs", value: number(day.completed_runs) }, { label: "Productivity", value: day.productivity == null ? "—" : `${number(day.productivity)} kg/JO-hour` }].map(item => <div key={item.label}><dt className="text-xs text-text-secondary">{item.label}</dt><dd className="mt-1 text-base font-semibold tabular-nums text-text-primary">{item.value}</dd></div>)}
      </dl>
      {day.records.length ? <ul className="divide-y divide-border">{day.records.map(run => <li key={run.production_id} className="py-3 first:pt-0 last:pb-0">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <FactoryCellEntity name={run.finished_good_name || "Finished Good"} code={run.finished_good_name_cn} />
            <div className="text-xs text-text-secondary">{[run.sku_code, run.variant_name || quantity(run.pack_size_qty, run.pack_size_uom)].filter(value => value && value !== "—").join(" · ") || "Packaging SKU unavailable"}</div>
            <FactoryCellText primary={run.job_order_no || "Job Order unavailable"} secondary={run.production_no} />
          </div>
          {onViewResult && run.job_order_id ? <button type="button" className="btn-icon shrink-0" title="View Production result" aria-label={`View Production result for ${run.job_order_no || run.production_no}`} onClick={() => onViewResult(run)}><Eye size={16} /></button> : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {[{ label: "Actual Output", value: run.output_kg == null ? quantity(run.output_qty, run.output_uom) : quantity(run.output_kg, "kg") }, { label: "Actual Pack Qty", value: quantity(run.actual_pack_qty, "packs") }, { label: "Duration", value: run.jo_hours == null ? "—" : quantity(run.jo_hours, "JO-hours") }, { label: "Production Start", value: formatFactoryAuditDateTime(run.start_at) }, { label: "Production End", value: formatFactoryAuditDateTime(run.end_at) }].map(item => <div key={item.label} className="min-w-0"><dt className="text-xs text-text-secondary">{item.label}</dt><dd className="mt-0.5 break-words text-sm tabular-nums text-text-primary">{item.value}</dd></div>)}
        </dl>
      </li>)}</ul> : <EmptyState title="No completed Production" description={day.state === "future" ? "No completed runs are attributed to this date yet." : "No completed runs are attributed to this business date."} />}
      {day.invalid_duration_runs > 0 || day.missing_output_runs > 0 ? <p role="note" className="mt-3 text-xs text-text-secondary">{day.invalid_duration_runs > 0 ? `${day.invalid_duration_runs} runs have no valid duration and are excluded from productivity. ` : ""}{day.missing_output_runs > 0 ? `${day.missing_output_runs} runs have no valid kg output.` : ""}</p> : null}
    </div>
  </Modal>;
}
