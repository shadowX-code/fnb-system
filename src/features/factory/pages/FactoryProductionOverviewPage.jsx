import { useMemo } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, PackageCheck, Play } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import { productionQcStatus, strictDateValue, strictTimeValueMinutes } from "../../../services/factoryService.js";
import { useFactoryOperationalJobs } from "../context/FactoryOperationalJobsContext.jsx";
import { formatFactoryDate } from "../utils/factoryDates.js";
import { percent, quantity } from "../utils/factoryFormatters.js";
import { jobPriorityTone, jobStatusLabel, statusTone } from "../utils/factoryStatus.js";

function finishedGoodName(job) { return job?.product_family_name || job?.product_name_en || job?.product_name || "Finished Good"; }
function packagingSkuLabel(job) { return [job?.variant_name || "Packaging SKU", job?.product_code || "No SKU"].filter(Boolean).join(" · "); }
function progress(job) { return Number(job?.progress_percent || (job?.status === "completed" ? 100 : job?.status === "in_progress" ? 50 : 0)); }
function progressTone(value) { return value >= 100 ? "bg-emerald-500" : value ? "bg-amber-500" : "bg-text-muted/30"; }
function timeLabel(value) { const match = /^(\d{2}):(\d{2})/.exec(String(value || "")); if (!match) return "—"; const hour = Number(match[1]); return `${String(hour % 12 || 12).padStart(2, "0")}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`; }
function qcLabel(status) {
  const normalized = String(status || "").toLowerCase().replace(/_/g, " ");
  if (["not started", "in progress", "pending", "incomplete"].includes(normalized)) return "QC Incomplete";
  if (["fail", "failed"].includes(normalized)) return "QC Failed";
  if (["pass", "passed"].includes(normalized)) return "QC Passed";
  return "No QC Required";
}
function qcTone(status) { return String(status || "").toLowerCase().includes("fail") ? "danger" : String(status || "").toLowerCase().includes("pass") ? "success" : "warning"; }
function outputLabel(production) { return quantity(production?.actual_output_qty || production?.good_output_qty || production?.actual_produced_qty || 0, production?.uom); }
function aggregateOutput(rows = []) { return rows.map((row) => quantity(row.quantity, row.uom)).join(" · ") || "0"; }
function activityDate(dateValue, timeValue, timestampValue = "") {
  const dateTimestamp = strictDateValue(dateValue);
  const timeMinutes = strictTimeValueMinutes(String(timeValue || "").slice(0, 5));
  if (dateTimestamp !== null && timeMinutes !== null) {
    const [year, month, day] = String(dateValue).split("-");
    const monthLabel = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1];
    const localDate = new Date(Number(year), Number(month) - 1, Number(day), Math.floor(timeMinutes / 60), timeMinutes % 60);
    return { sortValue: localDate.getTime(), dateLabel: monthLabel ? `${day} ${monthLabel} ${year}` : "—", timeLabel: timeLabel(timeValue) };
  }
  const timestamp = new Date(timestampValue);
  if (Number.isNaN(timestamp.getTime())) return { sortValue: 0, dateLabel: "—", timeLabel: "—" };
  return { sortValue: timestamp.getTime(), dateLabel: timestamp.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), timeLabel: timestamp.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase() };
}
function activityReference(job, production) { const batchNo = String(production?.batch_no || "").trim(); if (/^PB/i.test(batchNo)) return batchNo; const jobOrderNo = String(job?.job_order_no || production?.job_order_no || "").trim(); return /^JO/i.test(jobOrderNo) ? jobOrderNo : "—"; }
function activityOperator(value) { const name = String(value || "").trim(); if (!name || name.includes("@") || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(name)) return { name: "—", helper: "" }; if (name.toLowerCase() === "system") return { name: "System", helper: "Automated" }; return { name, helper: "" }; }
function activityFinishedGood(job, production) { return job?.product_family_name || job?.product_name_en || job?.product_name || production?.product_family_name || production?.product_name_en || production?.product_name || "—"; }

export default function FactoryProductionOverviewPage({ route = "production-overview", auth, openJob, startJob, completeProduction, viewCompletedResult, releaseJob, cancelJob }) {
  const can = auth?.hasPermission || (() => false);
  const overview = useFactoryOperationalJobs();
  const jobs = overview.hasLoaded ? overview.jobs : [];
  const productions = overview.hasLoaded ? overview.productions : [];
  const productionByJobId = useMemo(() => new Map(productions.map((production) => [production.job_order_id, production])), [productions]);
  const columns = [
    { key: "scheduled", title: "Schedule", helper: "Scheduled for future production", badge: "neutral", accent: "border-border bg-surface-muted" },
    { key: "released", title: "Released", helper: "Ready to start", badge: "info", accent: "border-border bg-surface-muted" },
    { key: "in_progress", title: "In Progress", helper: "Currently running", badge: "warning", accent: "border-border bg-surface-muted" },
    { key: "completed", title: "Completed Today", helper: "Finished today", badge: "success", accent: "border-border bg-surface-muted" },
  ].map((column) => ({ ...column, jobs: jobs.filter((job) => (column.key === "scheduled" ? job.status === "planned" : job.status === column.key)) }));
  const activity = useMemo(() => {
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const started = jobs.filter((job) => job.production_date && job.start_time).map((job) => { const production = productionByJobId.get(job.id); return { id: `start-${job.id}`, ...activityDate(job.production_date, job.start_time, job.started_at), event: "Production Started", product: activityFinishedGood(job, production), reference: activityReference(job, production), operator: activityOperator(job.production_operator_name), result: "Started", tone: "warning" }; });
    const completed = productions.map((production) => { const job = jobById.get(production.job_order_id); return { id: `complete-${production.id}`, ...activityDate(production.end_date, production.end_time, production.completed_at || production.created_at), event: "Production Completed", product: activityFinishedGood(job, production), reference: activityReference(job, production), operator: activityOperator(production.operator_name || job?.production_operator_name), result: "Completed", tone: "success" }; });
    const qc = jobs.flatMap((job) => { const checks = (job.step_executions || []).flatMap((step) => step.qc_results || []); const recorded = checks.filter((check) => check.checked_at); if (!recorded.length) return []; const latest = recorded.reduce((current, check) => new Date(check.checked_at).getTime() > new Date(current.checked_at).getTime() ? check : current); const state = productionQcStatus(checks); const production = productionByJobId.get(job.id); return [{ id: `qc-${job.id}-${latest.id}`, ...activityDate("", "", latest.checked_at), event: state.status === "Failed" ? "QC Failed" : "QC Check", product: activityFinishedGood(job, production), reference: activityReference(job, production), operator: activityOperator(latest.checked_by_name || job.production_operator_name), result: state.status === "Failed" ? "Failed" : state.requiredTotal ? `${state.requiredCompleted}/${state.requiredTotal} Passed` : "Passed", tone: state.status === "Failed" ? "danger" : state.status === "Passed" ? "success" : "warning" }]; });
    return [...started, ...completed, ...qc].filter((row) => row.sortValue > 0).sort((a, b) => b.sortValue - a.sortValue || b.id.localeCompare(a.id)).slice(0, 8);
  }, [jobs, productions]);
  const activityColumns = [
    { key: "date", label: "Date / Time", render: (row) => <div className="whitespace-nowrap"><div className="font-semibold text-text-primary">{row.dateLabel}</div><div className="text-xs text-text-muted">{row.timeLabel}</div></div> },
    { key: "event", label: "Event", render: (row) => <div className="font-semibold text-text-primary">{row.event}</div> },
    { key: "finished_good", label: "Finished Good", render: (row) => <div className="min-w-[180px] font-bold text-text-primary">{row.product}</div> },
    { key: "reference", label: "Reference", render: (row) => <div className="font-mono text-xs font-bold text-text-secondary">{row.reference}</div> },
    { key: "operator", label: "Operator", render: (row) => <div><div className="font-semibold text-text-primary">{row.operator.name}</div>{row.operator.helper ? <div className="text-xs text-text-muted">{row.operator.helper}</div> : null}</div> },
    { key: "result", label: "Result", render: (row) => <FactoryStatusBadge status={row.result} tone={row.tone}>{row.result}</FactoryStatusBadge> },
  ];
  function actions(job) {
    if (job.status === "planned") return <FactoryRowActions onView={() => openJob(job, { readOnly: true })} primaryAction={can("factory_job_orders.edit") ? { label: "Release", onClick: () => releaseJob(job) } : null} secondaryActions={[can("factory_job_orders.edit") ? { label: "Edit", onClick: () => openJob(job, { readOnly: false }) } : null, can("factory_job_orders.cancel") ? { label: "Cancel", destructive: true, onClick: () => cancelJob(job) } : null]} />;
    if (job.status === "released") return <FactoryRowActions onView={() => openJob(job, { readOnly: true })} primaryAction={can("factory_production.complete") ? { label: "Start Production", onClick: () => startJob(job) } : null} secondaryActions={[can("factory_job_orders.cancel") ? { label: "Cancel", destructive: true, onClick: () => cancelJob(job) } : null]} />;
    if (job.status === "in_progress" && can("factory_production.complete")) return <FactoryRowActions onView={() => completeProduction(job, { processOnly: true })} viewLabel="View process" primaryAction={{ label: "Complete Production", onClick: () => completeProduction(job) }} />;
    if (job.status === "in_progress" && can("factory_production.view")) return <FactoryRowActions onView={() => completeProduction(job, { processOnly: true, readOnly: true })} viewLabel="View process" />;
    if (job.status === "completed") return <FactoryRowActions onView={() => viewCompletedResult(job)} viewLabel="View result" />;
    return null;
  }
  function card(job, column) {
    const production = productionByJobId.get(job.id); const jobProgress = progress(job); const qc = productionQcStatus((job.step_executions || []).flatMap((step) => step.qc_results || []));
    return <div key={job.id} className="rounded-xl border border-border bg-surface p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="line-clamp-2 text-base font-bold leading-5 text-text-primary">{finishedGoodName(job)}</div><div className="mt-1 line-clamp-2 text-xs font-semibold leading-4 text-text-secondary">{packagingSkuLabel(job)}</div><div className="mt-2 font-mono text-[11px] font-bold text-text-muted">{job.job_order_no}</div></div><div className="flex shrink-0 flex-col items-end gap-1.5"><FactoryStatusBadge status={job.status} tone={statusTone(job.status)}>{jobStatusLabel(job.status)}</FactoryStatusBadge><FactoryStatusBadge status={job.priority} tone={jobPriorityTone(job.priority)}>{job.priority || "Normal"}</FactoryStatusBadge></div></div>{column.key === "in_progress" ? <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2"><span className="text-xs font-semibold text-text-muted">Production QC</span><FactoryStatusBadge status={qc.status} tone={qcTone(qc.status)}>{qcLabel(qc.status)}</FactoryStatusBadge></div> : null}<div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold"><div className="rounded-lg border border-border bg-surface-muted px-3 py-2"><div className="text-text-muted">Target Production</div><div className="mt-1 text-sm font-bold text-text-primary">{quantity(job.target_production_qty || job.target_quantity, job.uom)}</div></div><div className="rounded-lg border border-border bg-surface-muted px-3 py-2"><div className="text-text-muted">{column.key === "completed" ? "Output Qty" : column.key === "in_progress" ? "Started" : "Scheduled Date"}</div><div className="mt-1 text-sm font-bold text-text-primary">{column.key === "completed" ? production ? outputLabel(production) : quantity(job.produced_quantity || job.target_quantity, job.uom) : column.key === "in_progress" ? job.production_date && job.start_time ? `${formatFactoryDate(job.production_date)} · ${timeLabel(job.start_time)}` : "—" : formatFactoryDate(job.planned_date)}</div></div></div>{column.key === "completed" ? <div className="mt-3 text-xs font-semibold text-text-secondary">Completed {job.completed_at ? formatFactoryDate(job.completed_at) : "—"}</div> : <div className="mt-3"><div className="flex items-center justify-between text-xs font-bold text-text-secondary"><span>Progress</span><span>{jobProgress}%</span></div><div className="mt-1.5 h-2 rounded-full bg-surface-muted"><div className={`h-full rounded-full ${progressTone(jobProgress)}`} style={{ width: `${jobProgress}%` }} /></div></div>}<div className="mt-3 overflow-x-auto">{actions(job)}</div></div>;
  }
  const cards = [{ label: "Scheduled", value: overview.hasLoaded ? Number(overview.summary.scheduled || 0) : "—", helper: "Scheduled for future production", icon: CalendarClock }, { label: "Released", value: overview.hasLoaded ? Number(overview.summary.released || 0) : "—", helper: "Ready to start", icon: ClipboardCheck, tone: "info" }, { label: "In Progress", value: overview.hasLoaded ? Number(overview.summary.inProgress || 0) : "—", helper: "Currently running", icon: Play, tone: "warning" }, { label: "Completed Today", value: overview.hasLoaded ? Number(overview.summary.completedToday || 0) : "—", helper: "Finished today", icon: CheckCircle2, tone: "success" }, { label: "Output Today", value: overview.hasLoaded ? aggregateOutput(overview.summary.outputByUom || []) : "—", helper: "Total kg/L produced today", icon: PackageCheck }, { label: "Completion Rate", value: overview.hasLoaded ? percent(Number(overview.summary.completionRate || 0)) : "—", helper: "Completed vs planned", icon: CheckCircle2, tone: "success" }];
  if (route !== "production-overview") return null;
  return <div className="space-y-5"><PageHeader section="Factory" title="Production Overview" description="Monitor, release, start and complete factory production from one operational board." />{overview.error ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm font-semibold text-text-primary"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={16} /><span>{overview.error}</span></div><button className="btn-secondary h-8 px-3 text-xs" type="button" disabled={overview.loading} onClick={overview.retry}>Retry</button></div> : overview.loading ? <div className="rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm font-semibold text-text-secondary">{overview.hasLoaded ? "Refreshing operational Job Orders…" : "Loading operational Job Orders…"}</div> : null}<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">{cards.map((item) => <MetricCard key={item.label} {...item} />)}</div><Card title="Production Pipeline" description="Schedule, release, execute and complete Factory production in lifecycle order.">{!overview.hasLoaded ? <div className="p-4"><EmptyState title={overview.error ? "Production pipeline unavailable" : "Loading production pipeline"} description="Loading Scheduled, Released, In Progress and today’s Completed Job Orders." /></div> : <div className="overflow-x-auto p-4"><div className="grid min-w-[1120px] grid-cols-4 gap-4">{columns.map((column) => <div key={column.key} className={`rounded-xl border p-3 ${column.accent}`}><div className="mb-3 flex items-center justify-between gap-3"><div><div className="text-sm font-bold text-text-primary">{column.title}</div><div className="text-xs font-semibold text-text-secondary">{column.helper}</div></div><FactoryStatusBadge status={column.key} tone={column.badge}>{column.jobs.length}</FactoryStatusBadge></div><div className="space-y-3">{column.jobs.length ? column.jobs.map((job) => card(job, column)) : <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-6 text-center text-sm font-semibold text-text-secondary">No {column.title.toLowerCase()} jobs.</div>}</div></div>)}</div></div>}</Card><Card title="Recent Production Activity" description="Latest production starts and completed output.">{!overview.hasLoaded ? <div className="p-4"><EmptyState title="Loading production activity" description="Operational activity appears after the complete pipeline loads." /></div> : <FactoryTable columns={activityColumns} rows={activity} emptyTitle="No production activity" emptyDescription="Production starts and completed output will appear here." />}</Card></div>;
}
