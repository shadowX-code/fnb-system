import { useMemo, useRef, useState } from "react";
import { Download, FileBarChart2, FileText, RefreshCw } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { getAccessibleOutletOptions } from "../../../utils/accessControl.js";
import { reportingService } from "../../../services/reportingService.js";
import MonthlyProfitPoster from "../components/MonthlyProfitPoster.jsx";
import YearlyPnlPoster from "../components/YearlyPnlPoster.jsx";
import { reportMonths, statusLabel } from "../components/reportingFormatters.js";
import { exportPoster } from "../services/reportPosterExport.js";

function defaultPeriod() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export default function ReportsPage({ store, ui, auth }) {
  const initial = defaultPeriod();
  const exportPosterRef = useRef(null);
  const [draft, setDraft] = useState({ reportType: "monthly", outletId: store.outlets[0]?.id ?? "", year: initial.year, month: initial.month });
  const [generated, setGenerated] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState("");
  const [exportError, setExportError] = useState("");
  const [exportSuccess, setExportSuccess] = useState("");
  const outletOptions = useMemo(() => getAccessibleOutletOptions(auth, store.outlets, { includeAll: false }), [auth, store.outlets]);
  const yearOptions = useMemo(() => Array.from({ length: 5 }, (_, index) => initial.year - 2 + index).map((year) => ({ value: year, label: year })), [initial.year]);
  const hasExportPermission = Boolean(auth?.hasPermission?.("reports.export"));

  async function generate() {
    if (!draft.outletId) {
      setError("Select an accessible outlet before generating a report.");
      return;
    }
    setError("");
    setExportError("");
    setExportSuccess("");
    setLoading(true);
    try {
      const dataset = draft.reportType === "monthly"
        ? await reportingService.getMonthlyOutletReport({ outletId: draft.outletId, year: Number(draft.year), month: Number(draft.month) })
        : await reportingService.getYearlyOutletFinancialReport({ outletId: draft.outletId, year: Number(draft.year) });
      setGenerated({ reportType: draft.reportType, dataset, filters: { ...draft } });
    } catch (nextError) {
      setError(nextError?.message ?? "Unable to generate this report.");
      ui?.notify?.({ title: "Report unavailable", message: "The Reporting service could not return this outlet-scoped dataset.", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function download(format) {
    if (!generated || exporting || !hasExportPermission) return;
    setExportError("");
    setExportSuccess("");
    setExporting(format);
    try {
      const filename = await exportPoster({ element: exportPosterRef.current, reportType: generated.reportType, dataset: generated.dataset, filters: generated.filters, format });
      const message = `${format.toUpperCase()} downloaded: ${filename}`;
      setExportSuccess(message);
      ui?.notify?.({ title: "Report downloaded", message, tone: "success" });
    } catch (nextError) {
      setExportError(nextError?.message ?? "Unable to export this report. Please try again.");
      ui?.notify?.({ title: "Export failed", message: "The generated poster could not be downloaded. Please try again.", tone: "error" });
    } finally {
      setExporting("");
    }
  }

  const generatedStatus = generated?.reportType === "monthly" ? statusLabel(generated.dataset.financialCompleteness) : statusLabel(generated?.dataset.completeness, generated?.dataset.periodMode);
  const exportDisabled = !generated || !hasExportPermission || Boolean(exporting);
  const renderPoster = () => (generated.reportType === "monthly" ? <MonthlyProfitPoster dataset={generated.dataset} /> : <YearlyPnlPoster dataset={generated.dataset} />);

  return <div className="space-y-5">
    <PageHeader section="Overview" title="Reports" description="Generate outlet-scoped financial poster previews from the canonical Reporting read contract." />
    <FilterBar actions={<button className="btn-primary" type="button" onClick={generate} disabled={loading || !draft.outletId}><FileBarChart2 size={15} />{loading ? "Generating…" : "Generate Report"}</button>}>
      <SelectField label="Report Type" value={draft.reportType} options={[{ value: "monthly", label: "Monthly Profit" }, { value: "yearly", label: "Yearly P&L" }]} onChange={(reportType) => setDraft((current) => ({ ...current, reportType }))} />
      <SelectField label="Outlet" value={draft.outletId} options={outletOptions} placeholder="Select outlet" searchable onChange={(outletId) => setDraft((current) => ({ ...current, outletId }))} />
      {draft.reportType === "monthly" ? <SelectField label="Month" value={draft.month} options={reportMonths} onChange={(month) => setDraft((current) => ({ ...current, month: Number(month) }))} /> : null}
      <SelectField label="Year" value={draft.year} options={yearOptions} onChange={(year) => setDraft((current) => ({ ...current, year: Number(year) }))} />
    </FilterBar>
    <p className="-mt-2 text-xs text-text-muted">Changing filters does not refresh the preview. Select <b>Generate Report</b> to use the new selection.</p>
    {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</div> : null}
    {generated ? <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-white px-4 py-3">
        <div><div className="text-xs font-bold uppercase tracking-wide text-text-muted">Preview context</div><div className="mt-1 text-sm font-semibold text-text-primary">{generated.dataset.outlet?.name ?? "Outlet"} · {generated.reportType === "monthly" ? `${reportMonths[generated.filters.month - 1]?.label} ${generated.filters.year}` : generated.filters.year}</div><div className="mt-1 text-xs text-text-secondary">Status: <b>{generatedStatus}</b></div></div>
        <div className="flex flex-wrap items-center gap-2"><button className="btn-secondary" type="button" onClick={() => download("png")} disabled={exportDisabled} title={!hasExportPermission ? "reports.export permission is required" : undefined}><Download size={15} />{exporting === "png" ? "Preparing PNG…" : "Download PNG"}</button><button className="btn-secondary" type="button" onClick={() => download("pdf")} disabled={exportDisabled} title={!hasExportPermission ? "reports.export permission is required" : undefined}><FileText size={15} />{exporting === "pdf" ? "Preparing PDF…" : "Download PDF"}</button><button className="btn-secondary" type="button" onClick={generate} disabled={loading || Boolean(exporting)}><RefreshCw size={15} className={loading ? "animate-spin" : ""} />Regenerate</button></div>
      </div>
      {!hasExportPermission ? <p className="text-xs text-text-muted">Download controls require the <b>reports.export</b> permission.</p> : null}
      {exportError ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{exportError}</div> : null}
      {exportSuccess ? <p role="status" className="text-sm font-semibold text-emerald-700">{exportSuccess}</p> : null}
      <div className="rounded-3xl border border-border bg-slate-100/80 p-3 sm:p-6"><div className="mx-auto w-full max-w-[760px]">{renderPoster()}</div></div>
      <div ref={exportPosterRef} aria-hidden="true" style={{ position: "fixed", left: "-10000px", top: 0, width: "1200px", height: "1500px", overflow: "hidden", pointerEvents: "none" }}>{renderPoster()}</div>
    </section> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><FileBarChart2 className="mx-auto text-primary" size={28} /><h2 className="mt-3 text-base font-bold text-text-primary">Generate a report preview</h2><p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">Choose a report type, outlet and period. The poster will use server-authoritative Reporting data only.</p></div>}
  </div>;
}
