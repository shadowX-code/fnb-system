import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryRowAction from "../components/FactoryRowAction.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { factoryService } from "../../../services/factoryService.js";
import { formatFactoryDateTime, malaysiaBusinessDateInput } from "../utils/factoryDates.js";
import { quantity } from "../utils/factoryFormatters.js";

const statusLabel = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const statusTone = (value) => value === "verified" ? "success" : value === "awaiting_verification" ? "warning" : "neutral";

export default function FactoryMestiRawMaterialControlPage() {
  const [tab, setTab] = useState("standards");
  const [standards, setStandards] = useState([]);
  const [report, setReport] = useState([]);
  const [filters, setFilters] = useState({ dateFrom: malaysiaBusinessDateInput(), dateTo: malaysiaBusinessDateInput(), rawMaterial: "", supplier: "", storageLocation: "", verificationStatus: "", search: "" });
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const loadStandards = useCallback(async () => { setError(""); try { setStandards(await factoryService.listMestiRawMaterialControlStandards()); } catch (reason) { setError(reason.message || "Unable to load Raw Material Control Standards."); } }, []);
  const loadReport = useCallback(async () => { setError(""); try { setReport(await factoryService.listMestiRawMaterialControlReceivingReport(filters)); } catch (reason) { setError(reason.message || "Unable to load Receiving Report."); } }, [filters]);
  useEffect(() => { if (tab === "standards") loadStandards(); else loadReport(); }, [tab, loadStandards, loadReport]);
  const materialOptions = [...new Map(report.map((row) => [row.raw_material_id || row.item_name, { value: row.raw_material_id, label: row.item_name }])).values()];
  const supplierOptions = [...new Map(report.map((row) => [row.supplier_id || row.supplier_name, { value: row.supplier_id, label: row.supplier_name }])).values()];
  const storageOptions = [...new Map(report.map((row) => [row.storage_location_id || row.storage_location, { value: row.storage_location_id, label: row.storage_location }])).values()];
  const columns = [
    { key: "received_at", label: "Receive Time", render: (row) => formatFactoryDateTime(row.received_at) },
    { key: "item_name", label: "Item", render: (row) => <div><div className="font-semibold text-text-primary">{row.item_name}</div><div className="text-xs text-text-secondary">{row.receiving_no}</div></div> },
    { key: "supplier_name", label: "Supplier", render: (row) => row.supplier_name || "—" },
    { key: "acceptance_procedure_snapshot", label: "Acceptance Procedure", render: (row) => row.acceptance_procedure_snapshot || "—" },
    { key: "qty", label: "Quantity", render: (row) => quantity(row.received_qty, row.uom) },
    { key: "storage_location", label: "Storage", render: (row) => row.storage_location || "—" },
    { key: "storage_time", label: "Storage Time", render: (row) => formatFactoryDateTime(row.received_at) },
    { key: "received_by_name", label: "Received By", render: (row) => row.received_by_name || "—" },
    { key: "verified_by_name", label: "Verified By", render: (row) => row.verified_by_name || (row.verification_status === "awaiting_verification" ? "Awaiting Verification" : "—") },
    { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowAction label={`View ${row.item_name || "receiving evidence"}`} onClick={() => setDetail(row)} /> },
  ];
  return <div className="space-y-5"><PageHeader section="MeSTI" title="Raw Material Control" description="Read-only raw material standards and canonical receiving evidence." actions={<button className="btn-secondary" type="button" onClick={tab === "standards" ? loadStandards : loadReport}><RefreshCw size={15} />Refresh</button>} />
    <div className="flex gap-2 border-b border-border"><button type="button" className={tab === "standards" ? "border-b-2 border-primary px-3 py-2 text-sm font-bold text-primary" : "px-3 py-2 text-sm font-semibold text-text-secondary"} onClick={() => setTab("standards")}>Control Standards</button><button type="button" className={tab === "report" ? "border-b-2 border-primary px-3 py-2 text-sm font-bold text-primary" : "px-3 py-2 text-sm font-semibold text-text-secondary"} onClick={() => setTab("report")}>Receiving Report</button></div>
    {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}
    {tab === "standards" ? <div className="overflow-hidden rounded-lg border border-border bg-white"><FactoryTable rows={standards} columns={[{ key: "item", label: "Item", render: (row) => <div><div className="font-semibold text-text-primary">{row.item}</div><div className="text-xs text-text-secondary">{row.material_code}</div></div> }, { key: "acceptance_procedure", label: "Acceptance Procedure", render: (row) => row.acceptance_procedure || "—" }, { key: "control_methods", label: "Control Methods", render: (row) => row.control_methods || "—" }]} emptyTitle="No Raw Material standards" emptyDescription="Active Raw Material Master records appear here." /></div> : <><div className="grid gap-3 rounded-lg border border-border bg-white p-4 md:grid-cols-3"><Field label="Date from"><FeedXDatePicker value={filters.dateFrom} onChange={(dateFrom) => setFilters((current) => ({ ...current, dateFrom }))} /></Field><Field label="Date to"><FeedXDatePicker value={filters.dateTo} onChange={(dateTo) => setFilters((current) => ({ ...current, dateTo }))} /></Field><Field label="Verification"><SearchableSelect value={filters.verificationStatus} options={[{ value: "", label: "All" }, { value: "awaiting_verification", label: "Awaiting Verification" }, { value: "verified", label: "Verified" }]} onChange={(verificationStatus) => setFilters((current) => ({ ...current, verificationStatus }))} /></Field><Field label="Item"><SearchableSelect value={filters.rawMaterial} options={materialOptions} placeholder="All items" onChange={(rawMaterial) => setFilters((current) => ({ ...current, rawMaterial }))} /></Field><Field label="Supplier"><SearchableSelect value={filters.supplier} options={supplierOptions} placeholder="All suppliers" onChange={(supplier) => setFilters((current) => ({ ...current, supplier }))} /></Field><Field label="Storage"><SearchableSelect value={filters.storageLocation} options={storageOptions} placeholder="All storage" onChange={(storageLocation) => setFilters((current) => ({ ...current, storageLocation }))} /></Field><Field label="Search"><input className={inputClass()} value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Receiving no., item or supplier" /></Field></div><div className="overflow-hidden rounded-lg border border-border bg-white"><FactoryTable rows={report} columns={columns} emptyTitle="No Receiving evidence" emptyDescription="Completed Raw Material Receiving documents appear here." /></div></>}
    {detail ? <Modal title="Receiving Evidence" onClose={() => setDetail(null)}><div className="grid gap-3 text-sm"><div><div className="text-xs font-semibold text-text-secondary">Receiving No.</div><div className="font-bold">{detail.receiving_no}</div></div><div><div className="text-xs font-semibold text-text-secondary">Status</div><Badge tone={statusTone(detail.verification_status)}>{statusLabel(detail.verification_status)}</Badge></div><div><div className="text-xs font-semibold text-text-secondary">Acceptance Procedure</div><div>{detail.acceptance_procedure_snapshot || "—"}</div></div><div><div className="text-xs font-semibold text-text-secondary">Control Methods</div><div>{detail.control_methods_snapshot || "—"}</div></div><div><div className="text-xs font-semibold text-text-secondary">Storage</div><div>{detail.storage_location || "—"} · {formatFactoryDateTime(detail.received_at)}</div></div><div><div className="text-xs font-semibold text-text-secondary">Received By</div><div>{detail.received_by_name || "—"}</div></div><div><div className="text-xs font-semibold text-text-secondary">Verified By</div><div>{detail.verified_by_name || (detail.verification_status === "awaiting_verification" ? "Awaiting Verification" : "—")}{detail.verified_at ? ` · ${formatFactoryDateTime(detail.verified_at)}` : ""}</div></div><div><div className="text-xs font-semibold text-text-secondary">Supplier Reference</div><div>{detail.reference_no || "—"}</div></div></div></Modal> : null}
  </div>;
}
