import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Eye, History, Settings2, SlidersHorizontal, X } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import AdminPagination, { useAdminPagedQuery } from "../../../components/tables/AdminPagination.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import AsyncDataSurface from "../../../components/feedback/AsyncDataSurface.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import MultiSelectField from "../../../components/forms/MultiSelectField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import AdminSegmentedControl from "../../../components/forms/AdminSegmentedControl.jsx";
import AdminFilterToolbar, { AdminOutletField } from "../../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../../components/forms/AdminSearchField.jsx";
import { semanticStatusTone } from "../../../components/ui/semanticStatus.js";
import { crewService } from "../../../services/crewService.js";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";
import { formatLeaveDate, formatLeaveDateRange } from "../utils/leaveFormatters.js";

const typeLabel = { annual: "Annual Leave", medical: "Medical Leave / MC", unpaid: "Unpaid Leave", other: "Other Leave", replacement: "Replacement Leave" };
const employmentTypeOptions = [
  { value: "probation", label: "Probation" }, { value: "full_time", label: "Full-Time" },
  { value: "part_time", label: "Part-Time" }, { value: "intern", label: "Intern" },
  { value: "contract", label: "Contract" },
];
const malaysiaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const monthOptions = Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: new Date(2026, index, 1).toLocaleDateString("en-MY", { month: "long" }) }));
const dayOptions = Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }));
const formatTime = (value) => value ? new Date(`2026-01-01T${String(value).slice(0, 5)}:00`).toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit" }) : "—";
const formatDays = (value) => {
  if (value == null) return "Unlimited";
  const days = Number(value);
  return `${days.toFixed(days % 1 ? 1 : 0)} ${days === 1 ? "day" : "days"}`;
};
const statusLabel = (value) => value ? value[0].toUpperCase() + value.slice(1) : "—";
const rosterLabel = (schedule) => !schedule || schedule === "null" ? "No published roster" : schedule.entry_type === "working" ? `${formatTime(schedule.start_time)} – ${formatTime(schedule.end_time)}` : schedule.template_name || String(schedule.entry_type || "Not scheduled").replaceAll("_", " ");

export default function CrewLeaveAdminPage({ auth, store, ui }) {
  const outlets = (store?.outlets || []).filter((outlet) => auth.canAccessOutlet?.(outlet.id) ?? true);
  const { outletId, setOutletId } = useCrewAdminOutlet(outlets);
  const [tab, setTab] = useState("requests");
  const [filters, setFilters] = useState({ search: "", type: "all", status: "all" });
  const [review, setReview] = useState(null);
  const [balanceEmployee, setBalanceEmployee] = useState(null);
  const [adjustment, setAdjustment] = useState(null);
  const [correction, setCorrection] = useState(null);
  const [adjustmentHistory, setAdjustmentHistory] = useState({ loading: false, error: "", rows: [] });
  const [policy, setPolicy] = useState(null);
  const [saving, setSaving] = useState(false);
  const [policies, setPolicies] = useState({ rows: [], loading: false, error: "" });
  const canReview = auth.hasPermission("crew_leave.review");
  const canAdjust = auth.hasPermission("crew_leave_balance.adjust");
  const canSettings = auth.hasPermission("crew_leave_settings.manage");

  const requestFilters = useMemo(() => ({ query: filters.search, type: filters.type, status: filters.status }), [filters]);
  const balanceFilters = useMemo(() => ({ query: filters.search }), [filters.search]);
  const requestSignature = useMemo(() => JSON.stringify({ outletId, requestFilters }), [outletId, requestFilters]);
  const balanceSignature = useMemo(() => JSON.stringify({ outletId, balanceFilters }), [balanceFilters, outletId]);
  const [requestListing, requestActions] = useAdminPagedQuery({ storageKey: "crew-leave-requests", enabled: Boolean(outletId && tab === "requests"), querySignature: requestSignature, loadPage: ({ page, pageSize }) => crewService.leaveRequestsAdminPage({ outletId, filters: requestFilters, page, pageSize }) });
  const [balanceListing, balanceActions] = useAdminPagedQuery({ storageKey: "crew-leave-balances", enabled: Boolean(outletId && tab === "balances"), querySignature: balanceSignature, loadPage: ({ page, pageSize }) => crewService.leaveBalancesAdminPage({ outletId, filters: balanceFilters, page, pageSize }) });
  const loadPolicies = useCallback(async () => {
    if (!outletId) return;
    setPolicies((current) => ({ ...current, loading: true, error: "" }));
    try { const rows = await crewService.leaveAdminPolicies(outletId); setPolicies({ rows, loading: false, error: "" }); }
    catch (cause) { setPolicies((current) => ({ ...current, loading: false, error: cause.message || "Unable to load leave policies." })); }
  }, [outletId]);
  useEffect(() => { if (tab === "settings") loadPolicies(); }, [loadPolicies, tab]);
  const hasActiveFilters = tab === "requests" ? Boolean(filters.search || filters.type !== "all" || filters.status !== "all") : Boolean(filters.search);
  const clearFilters = () => setFilters({ search: "", type: "all", status: "all" });

  const loadAdjustmentHistory = async (employeeId) => {
    setAdjustmentHistory({ loading: true, error: "", rows: [] });
    try {
      const rows = await crewService.leaveAdjustmentHistory(employeeId);
      setAdjustmentHistory({ loading: false, error: "", rows });
      return rows;
    } catch (cause) {
      setAdjustmentHistory({ loading: false, error: cause.message || "Unable to load adjustment history.", rows: [] });
      return [];
    }
  };
  const openBalance = (group) => { setBalanceEmployee(group); loadAdjustmentHistory(group.employee?.id); };

  const decide = async (decision, reason = null) => { setSaving(true); try { await crewService.reviewLeave(review.id, decision, reason); ui.notify({ title: decision === "approve" ? "Leave approved" : "Leave rejected", message: decision === "approve" ? "Balance and Duty Roster evidence are updated." : "Reserved balance has been released.", tone: "success" }); setReview(null); await Promise.all([requestActions.refreshNow(), balanceActions.refreshNow()]); } catch (cause) { ui.notify({ title: "Unable to review leave", message: cause.message, tone: "error" }); } finally { setSaving(false); } };
  const adjust = async (amount, reason) => { const employeeId = adjustment.employee?.id || adjustment.employee_id; setSaving(true); try { await crewService.adjustLeaveBalance(adjustment.entitlement_id, amount, reason); const fresh = await balanceActions.refreshNow(); const group = fresh?.rows?.find((item) => item.employee?.id === employeeId); await loadAdjustmentHistory(employeeId); ui.notify({ title: "Balance adjusted", message: "The immutable adjustment is now included in the employee balance and history.", tone: "success" }); setAdjustment(null); setBalanceEmployee(group || null); } catch (cause) { ui.notify({ title: "Unable to adjust balance", message: cause.message, tone: "error" }); } finally { setSaving(false); } };
  const reconcile = async (reason) => { const employeeId = correction.employee?.id || correction.employee_id; setSaving(true); try { await crewService.reconcileLeaveEntitlement(correction.review_id, reason); const fresh = await balanceActions.refreshNow(); const group = fresh?.rows?.find((item) => item.employee?.id === employeeId); await loadAdjustmentHistory(employeeId); ui.notify({ title: "Leave correction recorded", message: "The prior grant remains unchanged; the correction is auditable.", tone: "success" }); setCorrection(null); setBalanceEmployee(group || null); } catch (cause) { ui.notify({ title: "Unable to correct entitlement", message: cause.message, tone: "error" }); } finally { setSaving(false); } };
  const savePolicy = async (values) => { setSaving(true); try { await crewService.saveLeavePolicy(outletId, policy.leave_type, values); ui.notify({ title: "Leave policy saved", message: "Future entitlements use the updated policy. Existing grants remain historical.", tone: "success" }); setPolicy(null); await loadPolicies(); } catch (cause) { ui.notify({ title: "Unable to save policy", message: cause.message, tone: "error" }); } finally { setSaving(false); } };

  return <div className="min-w-0 overflow-x-hidden space-y-4">
    <PageHeader section="Crew · Workforce" title="Leave" description="Review requests, understand employee balances and manage auditable outlet leave policy." />
    <AdminSegmentedControl value={tab} onChange={setTab} label="Leave sections" options={[{ value: "requests", label: "Requests" }, { value: "balances", label: "Balances" }, { value: "settings", label: "Settings" }]} />
    <LeaveToolbar tab={tab} outlets={outlets} outletId={outletId} setOutletId={setOutletId} filters={filters} setFilters={setFilters} hasActiveFilters={hasActiveFilters} clearFilters={clearFilters} />
    {tab === "requests" ? <RequestsPanel rows={requestListing.rows} listing={requestListing} actions={requestActions} filtered={hasActiveFilters} canReview={canReview} setReview={setReview} /> : null}
    {tab === "balances" ? <BalancesPanel rows={balanceListing.rows} listing={balanceListing} actions={balanceActions} filtered={Boolean(filters.search)} onManage={openBalance} /> : null}
    {tab === "settings" ? <SettingsPanel rows={policies.rows} loading={policies.loading} error={policies.error} onRetry={loadPolicies} canManage={canSettings} onEdit={setPolicy} /> : null}
    {review ? <LeaveReview request={review} canReview={canReview} saving={saving} onClose={() => setReview(null)} onDecide={decide} /> : null}
    {balanceEmployee ? <BalanceDetail group={balanceEmployee} history={adjustmentHistory} canAdjust={canAdjust} onRetryHistory={() => loadAdjustmentHistory(balanceEmployee.employee?.id)} onClose={() => setBalanceEmployee(null)} onAdjust={(row) => { setBalanceEmployee(null); setAdjustment(row); }} onCorrect={(row) => { setBalanceEmployee(null); setCorrection(row); }} /> : null}
    {adjustment ? <AdjustmentModal balance={adjustment} saving={saving} onClose={() => setAdjustment(null)} onSave={adjust} /> : null}
    {correction ? <CorrectionModal balance={correction} saving={saving} onClose={() => setCorrection(null)} onSave={reconcile} /> : null}
    {policy ? <PolicyModal policy={policy} saving={saving} onClose={() => setPolicy(null)} onSave={savePolicy} /> : null}
  </div>;
}

function LeaveToolbar({ tab, outlets, outletId, setOutletId, filters, setFilters, hasActiveFilters, clearFilters }) {
  const searchable = tab !== "settings";
  const activeFilters = [
    filters.search && { key: "search", label: "Search", value: filters.search, onRemove: () => setFilters({ ...filters, search: "" }) },
    tab === "requests" && filters.type !== "all" && { key: "type", label: "Leave type", value: typeLabel[filters.type], onRemove: () => setFilters({ ...filters, type: "all" }) },
    tab === "requests" && filters.status !== "all" && { key: "status", label: "Status", value: statusLabel(filters.status), onRemove: () => setFilters({ ...filters, status: "all" }) },
  ].filter(Boolean);
  return <AdminFilterToolbar outlet={<AdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />} search={searchable ? <AdminSearchField label="Search Employee" value={filters.search} onChange={(search) => setFilters({ ...filters, search })} placeholder="Search employee name or position" /> : null} filters={tab === "requests" ? <><SelectField label="Leave Type" value={filters.type} onChange={(type) => setFilters({ ...filters, type })} options={[{ value: "all", label: "All" }, ...Object.entries(typeLabel).map(([value, label]) => ({ value, label }))]} /><SelectField label="Status" value={filters.status} onChange={(status) => setFilters({ ...filters, status })} options={[{ value: "all", label: "All" }, ...["pending", "approved", "rejected", "cancelled"].map((value) => ({ value, label: statusLabel(value) }))]} /></> : !searchable ? <p className="self-center text-sm text-text-secondary">Policies apply to the selected outlet and future entitlement generation.</p> : null} activeFilters={activeFilters} onClear={clearFilters} />;
}

function RequestsPanel({ rows, listing, actions, filtered, canReview, setReview }) {
  return <Card><AsyncDataSurface loading={listing.loading} error={listing.error} hasData={rows.length > 0} isEmpty={listing.hasLoaded && !rows.length} onRetry={actions.retry} emptyTitle={filtered ? "No requests match these filters" : "No leave requests"} emptyDescription={filtered ? "Clear or adjust the employee, leave type or status filters." : "Employee leave requests for this outlet will appear here."}><DataTable density="compact" tableClassName="min-w-[980px]" rows={rows} getRowKey={(row) => row.id} columns={requestColumns(canReview, setReview)} /><AdminPagination {...listing} onPageChange={actions.requestPage} onPageSizeChange={actions.requestPageSize} noun="leave requests" /></AsyncDataSurface></Card>;
}

function requestColumns(canReview, setReview) { return [
  { key: "employee", header: "Employee", render: (row) => <Employee employee={row.employee} /> },
  { key: "type", header: "Leave Type", render: (row) => <span className="text-text-primary">{typeLabel[row.leave_type]}</span> },
  { key: "dates", header: "Dates", render: (row) => <span className="whitespace-nowrap text-text-secondary">{formatLeaveDateRange(row.start_date, row.end_date)}</span> },
  { key: "duration", header: "Duration", render: (row) => <span className="text-text-secondary">{formatDays(row.requested_days)}</span> },
  { key: "balance", header: "Balance", render: (row) => <span className="text-text-secondary">{!row.balance_context ? "—" : row.balance_context.balance_enforced === false ? "Unlimited" : `${formatDays(row.balance_context.available)} available`}</span> },
  { key: "conflict", header: "Roster", render: (row) => { const working = row.roster_context?.filter((day) => day.schedule?.entry_type === "working") || []; return working.length ? <Badge tone="warning">{working.length} conflict{working.length === 1 ? "" : "s"}</Badge> : <span className="text-text-secondary">No conflict</span>; } },
  { key: "status", header: "Status", render: (row) => <Badge tone={semanticStatusTone(row.status)}>{statusLabel(row.status)}</Badge> },
  { key: "action", header: "Action", align: "right", render: (row) => row.status === "pending" && canReview ? <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs font-semibold" type="button" onClick={() => setReview(row)}>Review</button> : <button className="icon-btn h-9 w-9 min-h-9" type="button" aria-label={`View leave request for ${row.employee?.name || "employee"}`} title="View request" onClick={() => setReview(row)}><Eye size={16} /></button> },
]; }

function BalancesPanel({ rows, listing, actions, filtered, onManage }) {
  const balanceCell = (row, type) => { const balance = row.balances[type]; return !balance ? <span className="text-text-muted">—</span> : balance.eligibility_state === "review_required" ? <Badge tone="warning">Review Required</Badge> : balance.current_eligibility === "not_eligible" ? <Badge tone="neutral">Not Eligible</Badge> : balance.balance_enforced === false ? <div><span className="text-text-primary">Unlimited</span><small className="block text-text-secondary">No balance limit</small></div> : <div><span className={`font-semibold ${Number(balance.available) < 0 ? "text-rose-600" : "text-text-primary"}`}>{formatDays(balance.available)}</span><small className="block text-text-secondary">available</small></div>; };
  return <Card><AsyncDataSurface loading={listing.loading} error={listing.error} hasData={rows.length > 0} isEmpty={listing.hasLoaded && !rows.length} onRetry={actions.retry} emptyTitle={filtered ? "No employees match this search" : "No leave balances"} emptyDescription={filtered ? "Clear or adjust the employee search." : "Active Crew entitlement balances for this outlet will appear here."}><DataTable density="compact" tableClassName="min-w-[1040px]" rows={rows} getRowKey={(row) => row.employee?.id} columns={[
    { key: "employee", header: "Employee", render: (row) => <Employee employee={row.employee} /> },
    { key: "annual", header: "Annual Leave", render: (row) => balanceCell(row, "annual") },
    { key: "medical", header: "Medical / MC", render: (row) => balanceCell(row, "medical") },
    { key: "unpaid", header: "Unpaid Leave", render: (row) => balanceCell(row, "unpaid") },
    { key: "other", header: "Other Leave", render: (row) => balanceCell(row, "other") },
    { key: "period", header: "Period", render: (row) => <span className="whitespace-nowrap text-text-secondary">{formatLeaveDateRange(row.period_start, row.period_end)}</span> },
    { key: "action", header: "Action", align: "right", render: (row) => <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs font-semibold" type="button" onClick={() => onManage(row)}>Manage</button> },
  ]} /><AdminPagination {...listing} onPageChange={actions.requestPage} onPageSizeChange={actions.requestPageSize} noun="Crew balances" /></AsyncDataSurface></Card>;
}

function SettingsPanel({ rows, loading, error, onRetry, canManage, onEdit }) {
  return <Card title="Leave Policy" description="Calendar-year defaults are outlet scoped. Existing annual grants remain unchanged for auditability."><AsyncDataSurface loading={loading} error={error} hasData={rows.length > 0} isEmpty={!rows.length} onRetry={onRetry} emptyTitle="No leave policies" emptyDescription="Outlet leave policies will appear here when configured."><DataTable density="compact" tableClassName="min-w-[920px]" rows={rows} getRowKey={(row) => row.id} columns={[
    { key: "type", header: "Leave Type", render: (row) => <span className="font-semibold text-text-primary">{typeLabel[row.leave_type]}</span> },
    { key: "entitlement", header: "Entitlement", render: (row) => row.balance_enforced ? `${formatDays(row.annual_days)} / year` : "Unlimited" },
    { key: "rule", header: "Balance Rule", render: (row) => <span className="text-text-secondary">{row.balance_enforced ? "Enforced" : "Unlimited"}</span> },
    { key: "eligibility", header: "Eligible Employment", render: (row) => <span className="text-text-secondary">{(row.eligible_employment_types || []).map((value) => employmentTypeOptions.find((item) => item.value === value)?.label || value).join(", ") || "Unresolved"}</span> },
    { key: "proration", header: "Proration", render: (row) => <Badge tone={row.proration_rule === "calendar_days" ? "success" : "neutral"}>{row.proration_rule === "calendar_days" ? "Eligible calendar days" : "No proration"}</Badge> },
    { key: "carry", header: "Carry Forward", render: (row) => row.carry_forward_enabled ? <div><span className="text-text-primary">Enabled</span><small className="block text-text-secondary">Max {formatDays(row.max_carry_forward_days)} · Expires {String(row.carry_forward_expiry_day || "").padStart(2, "0")}/{String(row.carry_forward_expiry_month || "").padStart(2, "0")}</small></div> : <span className="text-text-secondary">Off</span> },
    { key: "action", header: "Action", align: "right", render: (row) => canManage ? <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs font-semibold" type="button" onClick={() => onEdit(row)}><Settings2 size={14} /> Edit</button> : "—" },
  ]} /></AsyncDataSurface></Card>;
}

function LeaveReview({ request, canReview, saving, onClose, onDecide }) {
  const [mode, setMode] = useState("review");
  const [reason, setReason] = useState("");
  const balance = request.balance_context;
  const requested = Number(request.requested_days || 0);
  const availableAfter = balance?.balance_enforced === false ? null : Number(balance?.available || 0);
  const availableBefore = availableAfter == null ? null : availableAfter + requested;
  const footer = mode === "reject" ? <><button className="btn-secondary" type="button" onClick={() => setMode("review")}>Back</button><button className="btn-danger" type="button" disabled={saving || !reason.trim()} onClick={() => onDecide("reject", reason)}>Confirm Rejection</button></> : mode === "approve" ? <><button className="btn-secondary" type="button" onClick={() => setMode("review")}>Back</button><button className="btn-primary" type="button" disabled={saving || (balance?.balance_enforced && Number(balance?.available) < 0)} onClick={() => onDecide("approve")}><Check size={16} /> Approve Leave</button></> : request.status === "pending" && canReview ? <><button className="btn-danger" type="button" onClick={() => setMode("reject")}><X size={16} /> Reject</button><button className="btn-primary" type="button" onClick={() => setMode("approve")}><Check size={16} /> Approve</button></> : <button className="btn-secondary" type="button" onClick={onClose}>Close</button>;
  return <Modal size="lg" title="Leave Request" description={`${request.employee?.name} · ${request.employee?.position || "Crew"} · ${request.outlet?.name}`} onClose={onClose} footer={footer}><div className="space-y-5">
    <section className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4"><div><span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{typeLabel[request.leave_type]}</span><h3 className="mt-1 text-base font-semibold text-text-primary">{formatLeaveDateRange(request.start_date, request.end_date)} · {formatDays(request.requested_days)}</h3></div><Badge tone={semanticStatusTone(request.status)}>{statusLabel(request.status)}</Badge></section>
    {request.status === "pending" && canReview ? <p className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-text-secondary">This request has reserved entitlement. Approving records it as used leave; rejecting releases the reservation.</p> : null}
    {balance ? <section><h3 className="mb-2 text-sm font-semibold text-text-primary">Balance summary</h3><div className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-slate-50/60 p-3"><Detail label="Available before request" value={availableBefore == null ? "Unlimited" : formatDays(availableBefore)} /><Detail label="Requested" value={formatDays(request.requested_days)} /><Detail label="Remaining after approval" value={availableAfter == null ? "Unlimited" : formatDays(availableAfter)} emphasize /></div></section> : null}
    <RosterContext request={request} />
    <section><h3 className="text-sm font-semibold text-text-primary">Reason</h3><p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{request.reason || "No reason provided."}</p></section>
    {mode === "reject" ? <label className="field"><span>Rejection Reason *</span><textarea className="control min-h-24 w-full py-2" rows="3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this request is rejected" /></label> : null}
  </div></Modal>;
}

function RosterContext({ request }) {
  const days = request.roster_context || [];
  return <section><div className="mb-2 flex items-center gap-2"><CalendarDays size={16} className="text-primary" /><h3 className="text-sm font-semibold text-text-primary">Roster impact</h3></div>{days.length ? <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">{days.map((item) => { const conflict = item.schedule?.entry_type === "working"; return <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5" key={item.date}><span className="text-sm text-text-secondary">{formatLeaveDate(item.date)}</span><span className="min-w-0 text-sm text-text-primary">{rosterLabel(item.schedule)}<small className="ml-2 text-text-muted">{item.schedule?.outlet_name || request.outlet?.name || ""}</small></span><Badge tone={conflict ? "warning" : "neutral"}>{conflict ? "Conflict" : "No conflict"}</Badge></div>; })}</div> : <div className="rounded-xl bg-slate-50 p-3"><span className="text-sm font-semibold text-text-primary">No published roster</span><p className="mt-1 text-sm text-text-secondary">No schedule context is available for the requested dates.</p></div>}</section>;
}

function BalanceDetail({ group, history, canAdjust, onRetryHistory, onClose, onAdjust, onCorrect }) {
  const periodYear = group.period_start ? new Date(`${group.period_start}T00:00:00`).getFullYear() : "Current period";
  return <Modal size="xl" title="Leave Balance" description={`${group.employee?.name} · ${group.employee?.position || "Crew"} · ${periodYear}`} onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}><div className="space-y-5">
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {Object.keys(typeLabel).map((type) => {
        const row = group.balances[type];
        const unresolved = row?.eligibility_state === "review_required" && !row?.entitlement_id;
        const ineligible = row?.current_eligibility === "not_eligible";
        const unlimited = row?.balance_enforced === false;
        return <section className="grid gap-3 p-4 sm:grid-cols-[minmax(180px,1fr)_minmax(0,2fr)_auto] sm:items-center" key={type}>
          <div><h3 className="font-semibold text-text-primary">{typeLabel[type]}</h3><p className="mt-1 text-xs text-text-secondary">{!row ? "Not configured" : unlimited ? "No balance limit" : formatLeaveDateRange(row.period_start, row.period_end)}</p></div>
          {!row ? <span className="text-sm text-text-muted">No entitlement record</span> : unresolved ? <Badge tone="warning">Review Required</Badge> : ineligible ? <Badge tone="neutral">Not Eligible</Badge> : unlimited ? <div><span className="font-semibold text-text-primary">Unlimited</span><small className="block text-text-secondary">No balance limit</small></div> : <div className="grid grid-cols-4 gap-3"><Detail label="Entitled" value={formatDays(row.entitled)} /><Detail label="Used" value={formatDays(row.used)} /><Detail label="Pending" value={formatDays(row.pending)} /><Detail label="Available" value={formatDays(row.available)} emphasize /></div>}
          {canAdjust && row?.entitlement_id && row.balance_enforced ? <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs font-semibold" type="button" onClick={() => onAdjust(row)}><SlidersHorizontal size={14} /> Adjust</button> : <span />}
        </section>;
      })}
    </div>
    <EntitlementEvidence balances={group.balances} canAdjust={canAdjust} onCorrect={(row) => onCorrect({ ...row, employee: group.employee })} />
    <AdjustmentHistory history={history} onRetry={onRetryHistory} />
  </div></Modal>;
}

function EntitlementEvidence({ balances, canAdjust, onCorrect }) {
  const rows = Object.values(balances || {}).filter((row) => row?.explanation?.spans?.length || row?.eligibility_state === "review_required" || (row?.entitlement_id && row.calculation_version !== "employment-eligibility-v2"));
  if (!rows.length) return null;
  return <section className="space-y-3"><h3 className="text-sm font-semibold text-text-primary">Entitlement explanation</h3>{rows.map((row) => <div className="rounded-xl border border-border p-3" key={row.entitlement_id || row.leave_type}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-text-primary">{typeLabel[row.leave_type]}</strong>{row.eligibility_state === "review_required" ? <Badge tone="warning">Review Required</Badge> : null}</div>{row.entitlement_id && row.calculation_version !== "employment-eligibility-v2" ? <p className="mt-2 text-xs text-text-secondary">Existing grant: {row.prorated != null ? `${formatDays(row.prorated)} days` : "amount unavailable"}. Its original employment eligibility and policy basis were not verified at cutover.</p> : null}{(row.explanation?.spans || []).map((span, index) => <p className="mt-1 text-xs text-text-secondary" key={`${span.from}-${index}`}>{span.from} – {span.to} · {span.employment_type || "Employment unresolved"} · {span.eligible_days ?? 0} eligible days · {span.annual_days ?? "—"} days/year · {span.proration_rule === "calendar_days" ? "Calendar-day prorated" : "Not prorated"} · {span.calculated_contribution ?? 0} days</p>)}{row.calculation_version === "employment-eligibility-v2" || row.eligibility_state === "review_required" ? <p className="mt-2 text-xs text-text-secondary">Final entitlement: {row.explanation?.rounded_entitlement ?? row.prorated ?? "Not established"}{row.prorated != null || row.explanation?.rounded_entitlement != null ? " days" : ""}{row.expected_entitlement != null ? ` · Expected after change: ${row.expected_entitlement} days` : ""}</p> : null}{row.eligibility_state === "review_required" && (row.expected_evidence?.reason || row.explanation?.reason || row.review_reason) ? <p className="mt-1 text-xs text-amber-800">{row.expected_evidence?.reason || row.explanation?.reason || row.review_reason}</p> : null}{canAdjust && row.review_id && row.expected_entitlement != null ? <button className="btn-secondary mt-2 min-h-9 px-3 py-1.5 text-xs font-semibold" type="button" onClick={() => onCorrect(row)}>Review correction</button> : null}</div>)}</section>;
}

function CorrectionModal({ balance, saving, onClose, onSave }) {
  const [reason, setReason] = useState("");
  return <Modal title="Confirm Leave entitlement correction" description={`${balance.employee?.name} · ${typeLabel[balance.leave_type]}`} onClose={onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={saving || reason.trim().length < 3} onClick={() => onSave(reason)}>Confirm Correction</button></>}><div className="space-y-3"><p className="text-sm text-text-secondary">Existing grant: {formatDays(balance.prorated)}. Expected entitlement: {formatDays(balance.expected_entitlement)}. Correction: {balance.expected_difference > 0 ? "+" : ""}{formatDays(balance.expected_difference)}. The original grant remains unchanged.</p><label className="field"><span>Reason *</span><textarea className="control min-h-24 w-full py-2" rows="3" maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} /></label></div></Modal>;
}

function AdjustmentHistory({ history, onRetry }) {
  return <section><div className="mb-2 flex items-center gap-2"><History size={16} className="text-primary" /><h3 className="text-sm font-semibold text-text-primary">Adjustment History</h3></div><AsyncDataSurface loading={history.loading} error={history.error} hasData={history.rows.length > 0} isEmpty={!history.rows.length} onRetry={onRetry} emptyTitle="No manual adjustments recorded." emptyDescription="Approved adjustments remain available here as immutable evidence."><DataTable density="compact" tableClassName="min-w-[820px]" rows={history.rows} getRowKey={(row) => row.id} columns={[
    { key: "date", header: "Date", render: (row) => <span className="whitespace-nowrap text-text-secondary">{formatLeaveDate(row.adjusted_at)}</span> },
    { key: "type", header: "Leave Type", render: (row) => <span className="text-text-primary">{typeLabel[row.leave_type]}</span> },
    { key: "amount", header: "Adjustment", render: (row) => <span className={`font-semibold ${Number(row.amount) > 0 ? "text-emerald-700" : "text-rose-600"}`}>{Number(row.amount) > 0 ? "+" : ""}{formatDays(row.amount)}</span> },
    { key: "reason", header: "Reason", render: (row) => <span className="text-text-secondary">{row.reason}</span> },
    { key: "actor", header: "Adjusted By", render: (row) => <span className="text-text-secondary">{row.adjusted_by?.name || "FeedX Admin"}</span> },
    { key: "result", header: "Resulting Balance", render: (row) => row.previous_available == null || row.resulting_available == null ? <span className="text-text-muted">Historical value unavailable</span> : <span className="whitespace-nowrap text-text-secondary">{formatDays(row.previous_available)} → <strong className="font-semibold text-text-primary">{formatDays(row.resulting_available)}</strong></span> },
  ]} /></AsyncDataSurface></section>;
}

function AdjustmentModal({ balance, saving, onClose, onSave }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const amountNumber = Number(amount);
  const valid = Boolean(amountNumber && reason.trim());
  return <Modal title="Adjust Leave Balance" description={`${balance.employee?.name} · ${typeLabel[balance.leave_type]}`} onClose={onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={saving || !valid} onClick={() => onSave(amountNumber, reason)}>Save Adjustment</button></>}><div className="space-y-4"><div className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-slate-50/60 p-3"><Detail label="Current available" value={formatDays(balance.available)} /><Detail label="Adjustment" value={amountNumber ? `${amountNumber > 0 ? "+" : ""}${formatDays(amountNumber)}` : "—"} /><Detail label="New available" value={amountNumber ? formatDays(Number(balance.available) + amountNumber) : formatDays(balance.available)} emphasize /></div><label className="field"><span>Adjustment</span><div className="relative"><input className={`control w-full pr-14 font-semibold ${amountNumber > 0 ? "text-emerald-700" : amountNumber < 0 ? "text-rose-600" : ""}`} type="number" step="0.5" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="+ / -" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-muted">days</span></div></label><label className="field"><span>Reason *</span><textarea className="control min-h-24 w-full py-2" rows="4" maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for this permanent adjustment" /></label><p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800"><History className="mt-0.5 shrink-0" size={14} />This creates a permanent audit record. Adjustments cannot be edited or deleted.</p></div></Modal>;
}

function PolicyModal({ policy, saving, onClose, onSave }) {
  const [values, setValues] = useState({ annual_days: policy.annual_days, eligible_employment_types: policy.eligible_employment_types || employmentTypeOptions.map((item) => item.value), entitlement_method: policy.entitlement_method || (policy.balance_enforced ? "annual_allowance" : "unlimited"), proration_rule: policy.proration_rule || (policy.proration_enabled ? "calendar_days" : "none"), effective_from: malaysiaToday(), expected_version_id: policy.current_version_id, reason: "", carry_forward_enabled: policy.carry_forward_enabled, max_carry_forward_days: policy.max_carry_forward_days, carry_forward_expiry_month: policy.carry_forward_expiry_month ? String(policy.carry_forward_expiry_month) : "", carry_forward_expiry_day: policy.carry_forward_expiry_day ? String(policy.carry_forward_expiry_day) : "" });
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const unlimited = values.entitlement_method === "unlimited";
  const invalid = !values.effective_from || values.reason.trim().length < 3 || !values.eligible_employment_types.length || (!unlimited && (Number(values.annual_days) < 0 || !Number.isFinite(Number(values.annual_days)))) || (!unlimited && values.carry_forward_enabled && (Number(values.max_carry_forward_days) < 0 || !values.carry_forward_expiry_month || !values.carry_forward_expiry_day));
  const submit = () => onSave({ ...values, annual_days: unlimited ? 0 : Number(values.annual_days), proration_rule: unlimited ? "none" : values.proration_rule, carry_forward_enabled: unlimited ? false : values.carry_forward_enabled });
  return <Modal size="md" title={`Edit ${typeLabel[policy.leave_type]}`} description="Employment eligibility and entitlement are effective from the chosen date. Existing grants stay historical and changes needing correction are flagged for review." onClose={onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={saving || invalid} onClick={submit}>Confirm Policy</button></>}><div className="space-y-4"><MultiSelectField variant="form" label="Eligible Employment Types" value={values.eligible_employment_types} onApply={(value) => update("eligible_employment_types", value)} options={employmentTypeOptions} placeholder="Select employment types" /><SelectField label="Entitlement Method" value={values.entitlement_method} onChange={(value) => update("entitlement_method", value)} options={[{ value: "annual_allowance", label: "Annual allowance" }, { value: "unlimited", label: "Unlimited / no balance limit" }]} />{!unlimited ? <><label className="field"><span>Annual entitlement</span><input className="control w-full" type="number" min="0" step="0.5" value={values.annual_days} onChange={(event) => update("annual_days", event.target.value)} /></label><SelectField label="Proration Rule" value={values.proration_rule} onChange={(value) => update("proration_rule", value)} options={[{ value: "calendar_days", label: "Eligible calendar days ÷ year days" }, { value: "none", label: "No proration" }]} /><ToggleRow label="Carry forward" help="Allow unused entitlement to carry into the next annual period." checked={values.carry_forward_enabled} onChange={(checked) => update("carry_forward_enabled", checked)} />{values.carry_forward_enabled ? <div className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2"><label className="field sm:col-span-2"><span>Maximum carry-forward</span><input className="control w-full" type="number" min="0" step="0.5" value={values.max_carry_forward_days} onChange={(event) => update("max_carry_forward_days", event.target.value)} /></label><SelectField label="Expiry month" value={values.carry_forward_expiry_month} onChange={(value) => update("carry_forward_expiry_month", value)} options={monthOptions} placeholder="Month" /><SelectField label="Expiry day" value={values.carry_forward_expiry_day} onChange={(value) => update("carry_forward_expiry_day", value)} options={dayOptions} placeholder="Day" /></div> : null}</> : <p className="text-sm text-text-secondary">Requests remain subject to Employment Type eligibility, without an entitlement balance limit.</p>}<DatePickerField label="Effective from" value={values.effective_from} onChange={(value) => update("effective_from", value)} required /><label className="field"><span>Reason *</span><textarea className="control min-h-20 w-full py-2" rows="2" maxLength="500" value={values.reason} onChange={(event) => update("reason", event.target.value)} placeholder="Why is this policy changing?" /></label></div></Modal>;
}

function ToggleRow({ label, help, checked, onChange }) { return <button type="button" role="switch" aria-checked={checked} className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-white p-3 text-left" onClick={() => onChange(!checked)}><span><strong className="block text-sm text-text-primary">{label}</strong><small className="mt-0.5 block text-text-secondary">{help}</small></span><span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-primary" : "bg-slate-300"}`}><i className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? "left-6" : "left-1"}`} /></span></button>; }
function Employee({ employee }) { return <div><span className="block font-semibold text-text-primary">{employee?.name || "Crew employee"}</span><small className="block text-text-secondary">{employee?.position || "Crew"}</small></div>; }
function Detail({ label, value, emphasize = false }) { return <div><div className="text-xs font-medium text-text-muted">{label}</div><div className={`mt-1 text-sm text-text-primary ${emphasize ? "font-semibold" : "font-medium"}`}>{value}</div></div>; }
