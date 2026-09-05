import { useCallback, useEffect, useState } from "react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryRowAction from "../components/FactoryRowAction.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import { FactoryCellDateTime } from "../components/FactoryTableCell.jsx";
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

export default function FactoryMestiFoodProcessingControlPage() {
  const [rows, setRows] = useState([]);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
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
  const columns = [
    { key: "production_date", label: "Date", render: (row) => formatFactoryDate(row.production_date) },
    {
      key: "product",
      label: "Product",
      render: (row) => <div><b>{row.product_name || "—"}</b><div className="text-xs text-text-secondary">{[row.product_code, row.variant_name].filter(Boolean).join(" · ")}</div></div>,
    },
    { key: "qc", label: "QC", render: (row) => <FactoryStatusBadge tone={row.qc_summary?.startsWith("Passed") ? "success" : "neutral"}>{row.qc_summary || row.qc_status || "Evidence unavailable"}</FactoryStatusBadge> },
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
      render: (row) => <FactoryRowAction label={`View ${row.product_name || "record"}`} onClick={() => setDetail(row)} />,
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
    {detail ? <Modal title="Food Processing Evidence" onClose={() => setDetail(null)}>
      <div className="grid gap-3 text-sm">
        {[
          ["Job Order", detail.job_order_no],
          ["Production / Batch", [detail.production_no, detail.batch_no].filter(Boolean).join(" · ")],
          ["Product / SKU", [detail.product_name, detail.product_code].filter(Boolean).join(" · ")],
          ["Start", factoryTimeAmPmLabel(detail.start_time)],
          ["Complete", formatFactoryDateTime(detail.completed_at)],
          ["Quantity", quantity(detail.good_output_qty || detail.actual_output_qty, detail.uom)],
          ["Expiry", formatFactoryDate(detail.expiry_date)],
          ["Remarks", detail.notes],
          ["QC evidence", detail.qc_summary || detail.qc_status],
          ["Completed By", detail.completed_by_name],
          ["Verified By", verificationEvidence(detail)],
          ["Verified At", formatFactoryDateTime(detail.verified_at)],
        ].map(([label, value]) => <div key={label}><div className="text-xs font-semibold text-text-secondary">{label}</div><div>{value || "—"}</div></div>)}
      </div>
    </Modal> : null}
  </div>;
}
