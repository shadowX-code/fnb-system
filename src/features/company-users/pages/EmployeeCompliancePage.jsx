import { useMemo, useState } from "react";
import { Eye, Search, ShieldCheck } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import AdminFilterToolbar from "../../../components/layout/AdminFilterToolbar.jsx";
import AdminSummaryGrid from "../../../components/ui/AdminSummaryGrid.jsx";
import AdminDataSection from "../../../components/tables/AdminDataSection.jsx";
import AdminPagination, { useAdminPagedQuery } from "../../../components/tables/AdminPagination.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import AsyncDataSurface from "../../../components/feedback/AsyncDataSurface.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import { employeeComplianceService } from "../../../services/employeeComplianceService.js";
import { getAccessibleOutlets, hasPermission } from "../../../utils/accessControl.js";

const requirementOptions = [
  { value: "all", label: "All Requirements" },
  { value: "food_handler_certificate", label: "Food Handler Certificate" },
  { value: "typhoid_injection", label: "Typhoid Injection" },
];
const statusOptions = [
  { value: "all", label: "All Statuses" },
  { value: "missing", label: "Missing" },
  { value: "pending_verification", label: "Pending Verification" },
  { value: "verified", label: "Verified" },
  { value: "expiring_soon", label: "Expiring Soon" },
  { value: "expired", label: "Expired" },
  { value: "rejected", label: "Rejected" },
];
const labels = Object.fromEntries(statusOptions.map((item) => [item.value, item.label]));
const tones = { verified: "success", expiring_soon: "warning", pending_verification: "warning", expired: "danger", rejected: "danger", missing: "neutral" };
const formatDate = (value) => value ? new Date(`${value}T12:00:00+08:00`).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const submissionIdFor = (row) => row.state?.pending_submission_id || row.state?.rejected_submission_id || row.state?.effective_submission_id;

function SearchField({ value, onChange }) {
  return <label className="block"><span className="mb-1 block type-caption font-semibold text-text-secondary">Search Crew</span><span className="relative block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} /><input className="control h-10 w-full pl-9" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Name or employee code" /></span></label>;
}
SearchField.adminFilterRole = "search";

function ReviewModal({ row, canReview, onClose, onReviewed }) {
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submissionId = submissionIdFor(row);

  async function loadEvidence() {
    setError("");
    try { setEvidenceUrl(await employeeComplianceService.adminEvidenceUrl(submissionId)); }
    catch (nextError) { setError(nextError.message || "Evidence is unavailable."); }
  }
  async function review(decision) {
    if (decision === "rejected" && !reason.trim()) { setError("Enter a rejection reason."); return; }
    setBusy(true); setError("");
    try {
      await employeeComplianceService.review({ submissionId, decision, rejectionReason: reason });
      await onReviewed();
    } catch (nextError) { setError(nextError.message || "Unable to review this submission."); setBusy(false); }
  }

  return <Modal title={`${row.full_name} · ${row.requirement_name}`} description="Review the submitted evidence before making a decision." size="md" onClose={onClose} footer={row.state?.status === "pending_verification" && canReview ? <><button className="btn-secondary" type="button" disabled={busy} onClick={() => review("rejected")}>Reject</button><button className="btn-primary" type="button" disabled={busy} onClick={() => review("verified")}>Verify</button></> : null}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><Badge tone={tones[row.state?.status]}>{labels[row.state?.status] || row.state?.status}</Badge>{row.requires_expiry ? <span className="text-sm text-text-secondary">Expiry {formatDate(row.state?.pending_expiry_date || row.state?.effective_expiry_date || row.state?.rejected_expiry_date)}</span> : null}</div>
      {evidenceUrl ? <img className="max-h-[48vh] w-full rounded-lg border border-border bg-slate-50 object-contain" src={evidenceUrl} alt={`${row.requirement_name} evidence`} /> : submissionId ? <button className="btn-secondary" type="button" onClick={loadEvidence}><Eye size={16} /> View private evidence</button> : null}
      {row.state?.status === "pending_verification" && canReview ? <label className="block"><span className="mb-1.5 block text-sm font-semibold text-text-primary">Rejection reason</span><textarea className="control min-h-24 w-full py-2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required only when rejecting" /></label> : null}
      {row.state?.rejection_reason ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><strong>Rejected:</strong> {row.state.rejection_reason}</div> : null}
      {row.state?.replacement_pending && row.state?.effective_submission_id ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">The existing verified record remains effective until this replacement is verified.</div> : null}
      {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
    </div>
  </Modal>;
}

export default function EmployeeCompliancePage({ store, auth }) {
  const outlets = useMemo(() => getAccessibleOutlets(auth, store?.outlets ?? []), [auth, store?.outlets]);
  const [outletId, setOutletId] = useState("all");
  const [query, setQuery] = useState("");
  const [requirement, setRequirement] = useState("all");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState(null);
  const canReview = hasPermission(auth, "employee_compliance.review");
  const signature = JSON.stringify({ outletId, query: query.trim(), requirement, status });
  const [listing, actions] = useAdminPagedQuery({
    storageKey: "employee-compliance",
    querySignature: signature,
    loadPage: ({ page, pageSize }) => employeeComplianceService.adminPage({ outletId, filters: { query: query.trim(), requirement, status }, page, pageSize }),
  });
  const summary = listing.summary || {};
  const columns = [
    { key: "crew", header: "Crew", render: (row) => <div><strong className="block text-text-primary">{row.full_name}</strong><span className="text-xs text-text-muted">{row.employee_code || row.position || "Active employee"}</span></div> },
    { key: "outlet", header: "Outlet", render: (row) => row.outlet_name || "—" },
    { key: "requirement", header: "Requirement", render: (row) => <div><strong className="block text-text-primary">{row.requirement_name}</strong>{row.requires_expiry ? <span className="text-xs text-text-muted">Expiry required</span> : null}</div> },
    { key: "expiry", header: "Expiry", render: (row) => formatDate(row.state?.effective_expiry_date || row.state?.pending_expiry_date || row.state?.rejected_expiry_date) },
    { key: "status", header: "Status", render: (row) => <Badge tone={tones[row.state?.status]}>{labels[row.state?.status] || "Missing"}</Badge> },
    { key: "action", header: "", align: "right", render: (row) => submissionIdFor(row) ? <button className="btn-secondary px-3 py-2 text-xs" type="button" onClick={() => setSelected(row)}>{row.state?.status === "pending_verification" ? "Review" : "View"}</button> : <span className="text-text-muted">—</span> },
  ];
  const outletOptions = [{ value: "all", label: "All Accessible Outlets" }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))];

  return <div className="space-y-5">
    <PageHeader section="People" title="Employee Compliance" description="Review required employee documents and expiry status across accessible outlets." />
    <AdminFilterToolbar outlet={<SelectField label="Outlet" value={outletId} options={outletOptions} onChange={setOutletId} />} search={<SearchField value={query} onChange={setQuery} />} filters={<><SelectField label="Requirement" value={requirement} options={requirementOptions} onChange={setRequirement} /><SelectField label="Status" value={status} options={statusOptions} onChange={setStatus} /></>} activeFilters={[]} />
    <AdminSummaryGrid items={[
      { key: "compliant", label: "Compliant", value: summary.compliant ?? 0, helper: "Currently effective" },
      { key: "verification", label: "Needs Verification", value: summary.needs_verification ?? 0, helper: "Pending Admin review", emphasis: "warning" },
      { key: "expiring", label: "Expiring Soon", value: summary.expiring_soon ?? 0, helper: "Within 30 days" },
      { key: "missing", label: "Missing or Expired", value: summary.missing_or_expired ?? 0, helper: "Action required", emphasis: "danger" },
    ]} />
    <AdminDataSection title="Compliance Records" description="One row per active employee and requirement.">
      <AsyncDataSurface loading={listing.loading} error={listing.error} hasData={listing.hasLoaded && listing.rows.length > 0} isEmpty={listing.hasLoaded && !listing.rows.length} emptyTitle="No compliance records" emptyDescription="No active employees match these filters." onRetry={actions.retry}>
        <DataTable columns={columns} rows={listing.rows} getRowKey={(row) => `${row.employee_id}:${row.requirement_id}`} density="compact" />
        <AdminPagination page={listing.loadedPage} pageSize={listing.loadedPageSize} total={listing.loadedTotal} loading={listing.loading} noun="requirements" onPageChange={actions.requestPage} onPageSizeChange={actions.requestPageSize} />
      </AsyncDataSurface>
    </AdminDataSection>
    {selected ? <ReviewModal row={selected} canReview={canReview} onClose={() => setSelected(null)} onReviewed={async () => { setSelected(null); await actions.refreshNow(); }} /> : null}
  </div>;
}
