import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Eye, ShieldCheck } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import AdminFilterToolbar from "../../../components/layout/AdminFilterToolbar.jsx";
import AdminSummaryGrid from "../../../components/ui/AdminSummaryGrid.jsx";
import AdminDataSection from "../../../components/tables/AdminDataSection.jsx";
import AdminPagination, { useAdminPagedQuery } from "../../../components/tables/AdminPagination.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import AsyncDataSurface from "../../../components/feedback/AsyncDataSurface.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminSearchField from "../../../components/forms/AdminSearchField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import FactoryRowActions from "../../factory/components/FactoryRowActions.jsx";
import { employeeComplianceService } from "../../../services/employeeComplianceService.js";
import { getAccessibleOutlets, hasPermission } from "../../../utils/accessControl.js";

const requirementOptions = [
  { value: "all", label: "All" },
  { value: "food_handler_certificate", label: "Food Handler Certificate" },
  { value: "typhoid_injection", label: "Typhoid Injection" },
];
const statusOptions = [
  { value: "all", label: "All" },
  { value: "missing", label: "Missing" },
  { value: "pending_verification", label: "Needs Verification" },
  { value: "verified", label: "Compliant" },
  { value: "expiring_soon", label: "Expiring Soon" },
  { value: "expired", label: "Expired" },
  { value: "rejected", label: "Rejected" },
];
const labels = Object.fromEntries(statusOptions.map((item) => [item.value, item.label]));
const tones = { verified: "success", expiring_soon: "warning", pending_verification: "warning", expired: "danger", rejected: "danger", missing: "neutral" };
const formatDate = (value) => value ? new Date(`${value}T12:00:00+08:00`).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const submissionIdFor = (row) => row.state?.pending_submission_id || row.state?.rejected_submission_id || row.state?.effective_submission_id;

function RequirementStatus({ requirement }) {
  if (!requirement) return <span className="text-text-muted">—</span>;
  const state = requirement.state || {};
  const expiry = state.status === "pending_verification" ? state.pending_expiry_date : state.status === "rejected" ? state.rejected_expiry_date : state.effective_expiry_date;
  return <div className="space-y-1"><Badge tone={tones[state.status]}>{labels[state.status] || state.status || "Missing"}</Badge>{expiry ? <div className="text-xs text-text-muted">Expires {formatDate(expiry)}</div> : null}</div>;
}

function EmployeeRequirementsModal({ employee, onClose, onReview }) {
  return <Modal title={employee.full_name} description={[employee.position, employee.outlet_name].filter(Boolean).join(" · ")} size="md" onClose={onClose}>
    <div className="divide-y divide-border">{employee.requirements.map((requirement) => <div key={requirement.requirement_id} className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div><strong className="mb-2 block text-sm text-text-primary">{requirement.requirement_name}</strong><RequirementStatus requirement={requirement} />{requirement.state?.replacement_pending ? <p className="mt-2 text-xs text-text-secondary">Existing verified evidence remains effective while the replacement is reviewed.</p> : null}</div>
      {submissionIdFor(requirement) ? <FactoryRowActions onView={() => onReview({ ...employee, ...requirement })} viewLabel={requirement.state?.status === "pending_verification" ? `Review ${requirement.requirement_name}` : `View ${requirement.requirement_name}`} /> : <span className="text-xs text-text-muted">No evidence submitted</span>}
    </div>)}</div>
  </Modal>;
}

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
  const [reviewing, setReviewing] = useState(null);
  const canReview = hasPermission(auth, "employee_compliance.review");
  const signature = JSON.stringify({ outletId, query: query.trim(), requirement, status });
  const [listing, actions] = useAdminPagedQuery({
    storageKey: "employee-compliance",
    querySignature: signature,
    loadPage: ({ page, pageSize }) => employeeComplianceService.adminPage({ outletId, filters: { query: query.trim(), requirement, status }, page, pageSize }),
  });
  const summary = listing.summary || {};
  const columns = [
    { key: "employee", header: "Employee", render: (row) => <div><strong className="block text-text-primary">{row.full_name}</strong><span className="text-xs text-text-muted">{row.position || "—"}</span></div> },
    { key: "outlet", header: "Outlet", render: (row) => row.outlet_name || "—" },
    ...["food_handler_certificate", "typhoid_injection"].map((code) => ({ key: code, header: requirementOptions.find((option) => option.value === code).label, render: (row) => <RequirementStatus requirement={row.requirements.find((item) => item.requirement_code === code)} /> })),
    { key: "status", header: "Overall Status", render: (row) => <Badge tone={tones[row.overall_status]}>{labels[row.overall_status] || row.overall_status}</Badge> },
    { key: "action", header: "Actions", align: "right", width: "72px", render: (row) => <FactoryRowActions onView={() => setSelected(row)} viewLabel={`View ${row.full_name} compliance`} /> },
  ];
  const outletOptions = [{ value: "all", label: "All" }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))];
  const activeFilters = [
    outletId !== "all" && { key: "outlet", label: "Outlet", value: outletOptions.find((option) => option.value === outletId)?.label || outletId, onRemove: () => setOutletId("all") },
    query.trim() && { key: "query", label: "Search", value: query.trim(), onRemove: () => setQuery("") },
    requirement !== "all" && { key: "requirement", label: "Requirement", value: requirementOptions.find((option) => option.value === requirement)?.label || requirement, onRemove: () => setRequirement("all") },
    status !== "all" && { key: "status", label: "Status", value: statusOptions.find((option) => option.value === status)?.label || status, onRemove: () => setStatus("all") },
  ].filter(Boolean);

  return <div className="space-y-5">
    <PageHeader section="People" title="Food Handling Compliance" description="Review Food Handler Certificate and Typhoid Injection records, verification and expiry status across accessible outlets." />
    <AdminFilterToolbar outlet={<SelectField label="Outlet" ariaLabel="Outlet" value={outletId} options={outletOptions} onChange={setOutletId} />} search={<AdminSearchField label="Search Crew" value={query} onChange={setQuery} placeholder="Name or employee code" />} filters={<><SelectField label="Requirement" ariaLabel="Requirement" value={requirement} options={requirementOptions} onChange={setRequirement} /><SelectField label="Status" ariaLabel="Status" value={status} options={statusOptions} onChange={setStatus} /></>} activeFilters={activeFilters} onClear={() => { setOutletId("all"); setQuery(""); setRequirement("all"); setStatus("all"); }} />
    <AdminSummaryGrid variant="standard" ariaLabel="Food handling compliance summary" items={[
      { key: "compliant", label: "Compliant", value: summary.compliant ?? 0, helper: "All requirements compliant", tone: "success", icon: CheckCircle2 },
      { key: "verification", label: "Needs Verification", value: summary.needs_verification ?? 0, helper: "Pending Admin review", tone: "warning", icon: ShieldCheck },
      { key: "expiring", label: "Expiring Soon", value: summary.expiring_soon ?? 0, helper: "Within 30 days", tone: "warning", icon: Clock3 },
      { key: "missing", label: "Missing or Expired", value: summary.missing_or_expired ?? 0, helper: "Action required", tone: "danger", icon: AlertTriangle },
    ]} />
    <p className="text-xs text-text-muted">Employee counts for the current filters, grouped once by the most actionable requirement: Missing / Expired / Rejected, then Needs Verification, Expiring Soon, Compliant.</p>
    <AdminDataSection>
      <AsyncDataSurface loading={listing.loading} error={listing.error} hasData={listing.hasLoaded && listing.rows.length > 0} isEmpty={listing.hasLoaded && !listing.rows.length} emptyTitle="No food handling records" emptyDescription="No active employees match these filters." onRetry={actions.retry}>
        <DataTable columns={columns} rows={listing.rows} getRowKey={(row) => row.employee_id} density="compact" />
        <AdminPagination page={listing.loadedPage} pageSize={listing.loadedPageSize} total={listing.loadedTotal} loading={listing.loading} noun="employees" onPageChange={actions.requestPage} onPageSizeChange={actions.requestPageSize} />
      </AsyncDataSurface>
    </AdminDataSection>
    {selected && !reviewing ? <EmployeeRequirementsModal employee={selected} onClose={() => setSelected(null)} onReview={setReviewing} /> : null}
    {reviewing ? <ReviewModal row={reviewing} canReview={canReview} onClose={() => setReviewing(null)} onReviewed={async () => { setReviewing(null); setSelected(null); await actions.refreshNow(); }} /> : null}
  </div>;
}
