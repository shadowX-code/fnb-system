import { useCallback, useEffect, useState } from "react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryRowAction from "../components/FactoryRowAction.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import { FactoryCellDateTime } from "../components/FactoryTableCell.jsx";
import { FactoryEvidenceGrid, FactoryEvidenceHeader, FactoryEvidencePreview, FactoryEvidenceSection } from "../components/FactoryEvidencePresentation.jsx";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { factoryService } from "../../../services/factoryService.js";
import { formatFactoryDate, formatFactoryDateTime } from "../utils/factoryDates.js";
import { quantity } from "../utils/factoryFormatters.js";
import { factoryTimeAmPmLabel } from "../components/productionExecution/productionExecutionHelpers.js";

function verificationEvidence(row) {
  return row.verified_by_name || (row.verification_status === "awaiting_verification" ? "Awaiting Verification" : "—");
}

function qcTone(row) {
  return row.qc_summary?.startsWith("Passed") ? "success" : row.qc_summary?.startsWith("Complete") ? "warning" : "neutral";
}

function qcResultLabel(check) {
  if (check.result) return String(check.result).replace(/\b\w/g, (letter) => letter.toUpperCase());
  return check.notes ? "Recorded" : "Pending";
}

function qcChecksFromProduction(production) {
  return (production?.step_executions || []).flatMap((step) => step.qc_results || []).map((check) => ({
    id: check.id,
    qc_name: check.qc_name,
    qc_type: check.qc_type,
    result: check.checklist_result,
    notes: check.remarks,
    recorded_by_name: check.checked_by_name,
    recorded_at: check.checked_at,
  }));
}

function FoodProcessingEvidence({ detail }) {
  const qcChecks = detail.qc_checks || [];
  return <div className="space-y-1">
    <FactoryEvidenceHeader title={detail.product_name} subtitle={[detail.product_code, detail.variant_name, detail.batch_no].filter(Boolean).join(" · ")} status={{ label: detail.qc_summary || detail.qc_status || "Evidence unavailable", tone: qcTone(detail) }} />
    <FactoryEvidenceSection title="Production"><FactoryEvidenceGrid items={[
      { label: "Job Order", value: detail.job_order_no },
      { label: "Production / Batch", value: [detail.production_no, detail.batch_no].filter(Boolean).join(" · ") },
      { label: "Started", value: factoryTimeAmPmLabel(detail.start_time) },
      { label: "Completed", value: formatFactoryDateTime(detail.completed_at) },
      { label: "Quantity", value: quantity(detail.good_output_qty || detail.actual_output_qty, detail.uom) },
      { label: "Expiry", value: formatFactoryDate(detail.expiry_date) },
    ]} /></FactoryEvidenceSection>
    <FactoryEvidenceSection title="QC Evidence">
      {qcChecks.length ? <div className="divide-y divide-border rounded-lg border border-border">{qcChecks.map((check, index) => <div key={check.id || `${check.qc_name}-${index}`} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4"><div><div className="text-sm font-semibold text-text-primary">{check.qc_name || "QC check"}</div>{check.notes ? <div className="mt-0.5 text-xs text-text-secondary">{check.notes}</div> : null}{check.recorded_at ? <div className="mt-0.5 text-xs text-text-muted">{formatFactoryDateTime(check.recorded_at)}</div> : null}</div><FactoryStatusBadge tone={check.result === "fail" ? "danger" : check.result === "pass" || check.result === "na" ? "success" : "warning"}>{qcResultLabel(check)}</FactoryStatusBadge></div>)}</div> : <div className="text-sm text-text-secondary">Evidence unavailable</div>}
    </FactoryEvidenceSection>
    <FactoryEvidenceSection title="Verification"><FactoryEvidenceGrid items={[
      { label: "Completed By", value: detail.completed_by_name },
      { label: "Verified By", value: verificationEvidence(detail) },
      { label: "Verified At", value: formatFactoryDateTime(detail.verified_at) },
    ]} /></FactoryEvidenceSection>
    <FactoryEvidenceSection title="Remarks"><div className="text-sm text-text-secondary">{detail.notes || "No remarks"}</div></FactoryEvidenceSection>
  </div>;
}

export default function FactoryMestiFoodProcessingControlPage() {
  const [rows, setRows] = useState([]);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [evidenceByProduction, setEvidenceByProduction] = useState({});
  const [filters, setFilters] = useState({
    dateFrom: "", dateTo: "", product: "", qcStatus: "", verificationStatus: "", search: "",
  });

  const load = useCallback(async () => {
    try {
      setError("");
      setRows(await factoryService.listMestiFoodProcessingControl(filters));
    } catch (loadError) {
      setError(loadError.message || "Unable to load Food Processing Control.");
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const products = [...new Map(rows
    .filter((row) => row.finished_good_id && row.product_name)
    .map((row) => [row.finished_good_id, { value: row.finished_good_id, label: row.product_name }]))
    .values()];
  const detailFor = (row) => evidenceByProduction[row.id] ? { ...row, ...evidenceByProduction[row.id], qc_checks: qcChecksFromProduction(evidenceByProduction[row.id]) } : row;
  async function loadEvidence(row, open = false) {
    if (!row.id) return;
    let production = evidenceByProduction[row.id];
    try {
      if (!production) {
        production = await factoryService.getProductionEvidence(row.id);
        if (production) setEvidenceByProduction((current) => ({ ...current, [row.id]: production }));
      }
      if (open) setDetail(production ? { ...row, ...production, qc_checks: qcChecksFromProduction(production) } : row);
    } catch (loadError) {
      if (open) setError(loadError.message || "Unable to load Production evidence.");
    }
  }
  const columns = [
    { key: "production_date", label: "Date", render: (row) => formatFactoryDate(row.production_date) },
    {
      key: "product",
      label: "Product",
      render: (row) => <div><b>{row.product_name || "—"}</b><div className="text-xs text-text-secondary">{[row.product_code, row.variant_name].filter(Boolean).join(" · ")}</div></div>,
    },
    { key: "qc", label: "QC", render: (row) => { const detailRow = detailFor(row); return <FactoryEvidencePreview label={row.qc_summary || row.qc_status || "Evidence unavailable"} tone={qcTone(row)} items={detailRow.qc_checks} onPreview={() => loadEvidence(row)} onOpen={() => loadEvidence(row, true)} />; } },
    { key: "start", label: "Time (Start)", render: (row) => factoryTimeAmPmLabel(row.start_time) },
    {
      key: "complete",
      label: "Time (Complete)",
      render: (row) => {
        const [date, ...time] = formatFactoryDateTime(row.completed_at).split(" ");
        return <FactoryCellDateTime date={date} time={time.join(" ")} />;
      },
    },
    { key: "qty", label: "Quantity", render: (row) => quantity(row.good_output_qty || row.actual_output_qty, row.uom) },
    { key: "expiry", label: "Expiry Date", render: (row) => formatFactoryDate(row.expiry_date) },
    { key: "remarks", label: "Remarks", render: (row) => row.notes || "—" },
    { key: "completed", label: "Completed By", render: (row) => row.completed_by_name || "—" },
    { key: "verified", label: "Verified By", render: verificationEvidence },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (row) => <FactoryRowAction label={`View ${row.product_name || "record"}`} onClick={() => loadEvidence(row, true)} />,
    },
  ];

  return <div className="space-y-5">
    <PageHeader
      section="MeSTI"
      title="Food Processing Control"
      description="Read-only completed Production and QC evidence."
    />
    {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm">{error}</div> : null}
    <FactoryFilterBar moreFilters={<><Field label="QC"><SearchableSelect value={filters.qcStatus} options={[{ value: "", label: "All" }, { value: "Passed", label: "Passed" }, { value: "Pending", label: "Pending" }]} onChange={(qcStatus) => setFilters((current) => ({ ...current, qcStatus }))} /></Field><Field label="Verification"><SearchableSelect value={filters.verificationStatus} options={[{ value: "", label: "All" }, { value: "awaiting_verification", label: "Awaiting Verification" }, { value: "verified", label: "Verified" }]} onChange={(verificationStatus) => setFilters((current) => ({ ...current, verificationStatus }))} /></Field></>} activeFilters={[filters.dateFrom && { key: "from", label: "From", value: filters.dateFrom, onRemove: () => setFilters((current) => ({ ...current, dateFrom: "" })) }, filters.dateTo && { key: "to", label: "To", value: filters.dateTo, onRemove: () => setFilters((current) => ({ ...current, dateTo: "" })) }, filters.product && { key: "product", label: "Product", value: products.find((option) => option.value === filters.product)?.label || filters.product, onRemove: () => setFilters((current) => ({ ...current, product: "" })) }, filters.qcStatus && { key: "qc", label: "QC", value: filters.qcStatus, onRemove: () => setFilters((current) => ({ ...current, qcStatus: "" })) }, filters.verificationStatus && { key: "verification", label: "Verification", value: filters.verificationStatus.replaceAll("_", " "), onRemove: () => setFilters((current) => ({ ...current, verificationStatus: "" })) }, filters.search && { key: "search", label: "Search", value: filters.search, onRemove: () => setFilters((current) => ({ ...current, search: "" })) }].filter(Boolean)} onClear={() => setFilters({ dateFrom: "", dateTo: "", product: "", qcStatus: "", verificationStatus: "", search: "" })}>
      <Field label="Date"><FeedXDatePicker value={filters.dateFrom} placeholder="From" onChange={(dateFrom) => setFilters((current) => ({ ...current, dateFrom }))} /></Field>
      <Field label="To"><FeedXDatePicker value={filters.dateTo} placeholder="To" onChange={(dateTo) => setFilters((current) => ({ ...current, dateTo }))} /></Field>
      <Field label="Product"><SearchableSelect value={filters.product} options={[{ value: "", label: "All" }, ...products]} placeholder="All" onChange={(product) => setFilters((current) => ({ ...current, product }))} /></Field>
      <Field label="Search"><input className={inputClass()} value={filters.search} placeholder="Product, SKU or batch" onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></Field>
    </FactoryFilterBar>
    <FactoryDataSurface>
      <FactoryTable rows={rows} columns={columns} emptyTitle="No completed Production" emptyDescription="Completed Production records appear automatically." />
    </FactoryDataSurface>
    {detail ? <Modal title="Food Processing Evidence" onClose={() => setDetail(null)} size="lg"><FoodProcessingEvidence detail={detail} /></Modal> : null}
  </div>;
}
