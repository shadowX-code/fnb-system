import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarDays, Check, Eye, History, RotateCcw, Search, Settings2, SlidersHorizontal, X } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { crewService } from "../../../services/crewService.js";
import CrewAdminToolbar, { CrewAdminOutletField } from "../components/CrewAdminToolbar.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";
import { formatLeaveDate, formatLeaveDateRange } from "../utils/leaveFormatters.js";

const typeLabel = { annual: "Annual Leave", medical: "Medical Leave / MC", unpaid: "Unpaid Leave", other: "Other Leave" };
const statusTone = { pending: "warning", approved: "success", rejected: "danger", cancelled: "neutral" };
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

function groupBalances(rows) {
  const employees = new Map();
  rows.forEach((row) => {
    const employee = row.employee || { id: row.employee_id, name: "Crew employee", position: "Crew" };
    const key = employee.id || row.employee_id;
    if (!employees.has(key)) employees.set(key, { employee, balances: {}, period_start: row.period_start, period_end: row.period_end });
    const group = employees.get(key);
    group.balances[row.leave_type] = row;
    if (row.period_start && (!group.period_start || row.period_start < group.period_start)) group.period_start = row.period_start;
    if (row.period_end && (!group.period_end || row.period_end > group.period_end)) group.period_end = row.period_end;
  });
  return [...employees.values()].sort((a, b) => String(a.employee?.name || "").localeCompare(String(b.employee?.name || "")));
}

export default function CrewLeaveAdminPage({ auth, store, ui }) {
  const outlets = (store?.outlets || []).filter((outlet) => auth.canAccessOutlet?.(outlet.id) ?? true);
  const { outletId, setOutletId } = useCrewAdminOutlet(outlets);
  const [data, setData] = useState({ requests: [], balances: [], policies: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("requests");
  const [filters, setFilters] = useState({ search: "", type: "all", status: "all" });
  const [review, setReview] = useState(null);
  const [balanceEmployee, setBalanceEmployee] = useState(null);
  const [adjustment, setAdjustment] = useState(null);
  const [adjustmentHistory, setAdjustmentHistory] = useState({ loading: false, error: "", rows: [] });
  const [policy, setPolicy] = useState(null);
  const [saving, setSaving] = useState(false);
  const canReview = auth.hasPermission("crew_leave.review");
  const canAdjust = auth.hasPermission("crew_leave_balance.adjust");
  const canSettings = auth.hasPermission("crew_leave_settings.manage");

  const load = async () => {
    if (!outletId) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try { const next = await crewService.leaveAdminData(outletId); setData(next); return next; }
    catch (cause) { setError(cause.message || "Unable to load leave data."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [outletId]);

  const requestRows = useMemo(() => data.requests.filter((row) => (filters.type === "all" || row.leave_type === filters.type) && (filters.status === "all" || row.status === filters.status) && (!filters.search || `${row.employee?.name} ${row.employee?.position}`.toLowerCase().includes(filters.search.toLowerCase()))), [data.requests, filters]);
  const groupedBalances = useMemo(() => groupBalances(data.balances), [data.balances]);
  const balanceRows = useMemo(() => groupedBalances.filter((row) => !filters.search || `${row.employee?.name} ${row.employee?.position}`.toLowerCase().includes(filters.search.toLowerCase())), [groupedBalances, filters.search]);
  const hasActiveFilters = Boolean(filters.search || filters.type !== "all" || filters.status !== "all");
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

  const decide = async (decision, reason = null) => { setSaving(true); try { await crewService.reviewLeave(review.id, decision, reason); ui.notify({ title: decision === "approve" ? "Leave approved" : "Leave rejected", message: decision === "approve" ? "Balance and Duty Roster evidence are updated." : "Reserved balance has been released.", tone: "success" }); setReview(null); await load(); } catch (cause) { ui.notify({ title: "Unable to review leave", message: cause.message, tone: "error" }); } finally { setSaving(false); } };
  const adjust = async (amount, reason) => { const employeeId = adjustment.employee?.id || adjustment.employee_id; setSaving(true); try { await crewService.adjustLeaveBalance(adjustment.entitlement_id, amount, reason); const fresh = await load(); const group = groupBalances(fresh?.balances || []).find((item) => item.employee?.id === employeeId); await loadAdjustmentHistory(employeeId); ui.notify({ title: "Balance adjusted", message: "The immutable adjustment is now included in the employee balance and history.", tone: "success" }); setAdjustment(null); setBalanceEmployee(group || null); } catch (cause) { ui.notify({ title: "Unable to adjust balance", message: cause.message, tone: "error" }); } finally { setSaving(false); } };
  const savePolicy = async (values) => { setSaving(true); try { await crewService.saveLeavePolicy(outletId, policy.leave_type, values); ui.notify({ title: "Leave policy saved", message: "Future entitlements use the updated policy. Existing grants remain historical.", tone: "success" }); setPolicy(null); await load(); } catch (cause) { ui.notify({ title: "Unable to save policy", message: cause.message, tone: "error" }); } finally { setSaving(false); } };

  return <div className="min-w-0 overflow-x-hidden space-y-4">
    <PageHeader section="Crew · Workforce" title="Leave" description="Review requests, understand employee balances and manage auditable outlet leave policy." />
    <nav className="inline-flex rounded-xl border border-border bg-white p-1" aria-label="Leave sections">{[["requests", "Requests"], ["balances", "Balances"], ["settings", "Settings"]].map(([value, label]) => <button type="button" role="tab" aria-selected={tab === value} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${tab === value ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-slate-50 hover:text-text-primary"}`} key={value} onClick={() => setTab(value)}>{label}</button>)}</nav>
    <LeaveToolbar tab={tab} outlets={outlets} outletId={outletId} setOutletId={setOutletId} filters={filters} setFilters={setFilters} hasActiveFilters={hasActiveFilters} clearFilters={clearFilters} />
    {error ? <ErrorState message={error} onRetry={load} /> : null}
    {!error && tab === "requests" ? <RequestsPanel allRows={data.requests} rows={requestRows} loading={loading} filtered={hasActiveFilters} canReview={canReview} setReview={setReview} /> : null}
    {!error && tab === "balances" ? <BalancesPanel allRows={groupedBalances} rows={balanceRows} loading={loading} filtered={Boolean(filters.search)} onManage={openBalance} /> : null}
    {!error && tab === "settings" ? <SettingsPanel rows={data.policies} loading={loading} canManage={canSettings} onEdit={setPolicy} /> : null}
    {review ? <LeaveReview request={review} canReview={canReview} saving={saving} onClose={() => setReview(null)} onDecide={decide} /> : null}
    {balanceEmployee ? <BalanceDetail group={balanceEmployee} history={adjustmentHistory} canAdjust={canAdjust} onRetryHistory={() => loadAdjustmentHistory(balanceEmployee.employee?.id)} onClose={() => setBalanceEmployee(null)} onAdjust={(row) => { setBalanceEmployee(null); setAdjustment(row); }} /> : null}
    {adjustment ? <AdjustmentModal balance={adjustment} saving={saving} onClose={() => setAdjustment(null)} onSave={adjust} /> : null}
    {policy ? <PolicyModal policy={policy} saving={saving} onClose={() => setPolicy(null)} onSave={savePolicy} /> : null}
  </div>;
}

function LeaveToolbar({ tab, outlets, outletId, setOutletId, filters, setFilters, hasActiveFilters, clearFilters }) {
  const searchable = tab !== "settings";
  return <CrewAdminToolbar outlet={<CrewAdminOutletField />} search={searchable ? <label className="field"><span>Search Employee</span><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} /><input className="control w-full pl-9" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search employee name or position" /></div></label> : null} filters={tab === "requests" ? <><SelectField label="Leave Type" value={filters.type} onChange={(type) => setFilters({ ...filters, type })} options={[{ value: "all", label: "All" }, ...Object.entries(typeLabel).map(([value, label]) => ({ value, label }))]} /><SelectField label="Status" value={filters.status} onChange={(status) => setFilters({ ...filters, status })} options={[{ value: "all", label: "All" }, ...["pending", "approved", "rejected", "cancelled"].map((value) => ({ value, label: statusLabel(value) }))]} /></> : !searchable ? <p className="self-center text-sm text-text-secondary">Policies apply to the selected outlet and future entitlement generation.</p> : null} secondary={searchable && hasActiveFilters ? <button className="btn-ghost mb-0.5 whitespace-nowrap" type="button" onClick={clearFilters}><RotateCcw size={14} /> Clear filters</button> : null} />;
}

function RequestsPanel({ allRows, rows, loading, filtered, canReview, setReview }) {
  return <Card title="Leave Requests" description="Pending requests reserve entitlement immediately; approval converts the same reservation into used leave.">{loading ? <Loading /> : rows.length ? <DataTable density="compact" tableClassName="min-w-[980px]" rows={rows} getRowKey={(row) => row.id} columns={requestColumns(canReview, setReview)} /> : <div className="p-4"><EmptyState title={filtered && allRows.length ? "No requests match these filters" : "No leave requests"} description={filtered && allRows.length ? "Clear or adjust the employee, leave type or status filters." : "Employee leave requests for this outlet will appear here."} /></div>}</Card>;
}

function requestColumns(canReview, setReview) { return [
  { key: "employee", header: "Employee", render: (row) => <Employee employee={row.employee} /> },
  { key: "type", header: "Leave Type", render: (row) => <span className="text-text-primary">{typeLabel[row.leave_type]}</span> },
  { key: "dates", header: "Dates", render: (row) => <span className="whitespace-nowrap text-text-secondary">{formatLeaveDateRange(row.start_date, row.end_date)}</span> },
  { key: "duration", header: "Duration", render: (row) => <span className="text-text-secondary">{formatDays(row.requested_days)}</span> },
  { key: "balance", header: "Balance", render: (row) => <span className="text-text-secondary">{!row.balance_context ? "—" : row.balance_context.balance_enforced === false ? "Unlimited" : `${formatDays(row.balance_context.available)} available`}</span> },
  { key: "conflict", header: "Roster", render: (row) => { const working = row.roster_context?.filter((day) => day.schedule?.entry_type === "working") || []; return working.length ? <Badge tone="warning">{working.length} conflict{working.length === 1 ? "" : "s"}</Badge> : <span className="text-text-secondary">No conflict</span>; } },
  { key: "status", header: "Status", render: (row) => <Badge tone={statusTone[row.status]}>{statusLabel(row.status)}</Badge> },
  { key: "action", header: "Action", align: "right", render: (row) => row.status === "pending" && canReview ? <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs font-semibold" type="button" onClick={() => setReview(row)}>Review</button> : <button className="icon-btn h-9 w-9 min-h-9" type="button" aria-label={`View leave request for ${row.employee?.name || "employee"}`} title="View request" onClick={() => setReview(row)}><Eye size={16} /></button> },
]; }

function BalancesPanel({ allRows, rows, loading, filtered, onManage }) {
  const balanceCell = (row, type) => { const balance = row.balances[type]; return !balance ? <span className="text-text-muted">—</span> : balance.balance_enforced === false ? <div><span className="text-text-primary">Unlimited</span><small className="block text-text-secondary">No balance limit</small></div> : <div><span className={`font-semibold ${Number(balance.available) < 0 ? "text-rose-600" : "text-text-primary"}`}>{formatDays(balance.available)}</span><small className="block text-text-secondary">available</small></div>; };
  return <Card title="Employee Leave Balances" description="One employee per row. Used and pending values come from leave evidence; adjustments remain immutable.">{loading ? <Loading /> : rows.length ? <DataTable density="compact" tableClassName="min-w-[1040px]" rows={rows} getRowKey={(row) => row.employee?.id} columns={[
    { key: "employee", header: "Employee", render: (row) => <Employee employee={row.employee} /> },
    { key: "annual", header: "Annual Leave", render: (row) => balanceCell(row, "annual") },
    { key: "medical", header: "Medical / MC", render: (row) => balanceCell(row, "medical") },
    { key: "unpaid", header: "Unpaid Leave", render: (row) => balanceCell(row, "unpaid") },
    { key: "other", header: "Other Leave", render: (row) => balanceCell(row, "other") },
    { key: "period", header: "Period", render: (row) => <span className="whitespace-nowrap text-text-secondary">{formatLeaveDateRange(row.period_start, row.period_end)}</span> },
    { key: "action", header: "Action", align: "right", render: (row) => <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs font-semibold" type="button" onClick={() => onManage(row)}>Manage</button> },
  ]} /> : <div className="p-4"><EmptyState title={filtered && allRows.length ? "No employees match this search" : "No leave balances"} description={filtered && allRows.length ? "Clear or adjust the employee search." : "Active Crew entitlement balances for this outlet will appear here."} /></div>}</Card>;
}

function SettingsPanel({ rows, loading, canManage, onEdit }) {
  return <Card title="Leave Policy" description="Calendar-year defaults are outlet scoped. Existing annual grants remain unchanged for auditability.">{loading ? <Loading /> : rows.length ? <DataTable density="compact" tableClassName="min-w-[920px]" rows={rows} getRowKey={(row) => row.id} columns={[
    { key: "type", header: "Leave Type", render: (row) => <span className="font-semibold text-text-primary">{typeLabel[row.leave_type]}</span> },
    { key: "entitlement", header: "Entitlement", render: (row) => row.balance_enforced ? `${formatDays(row.annual_days)} / year` : "Unlimited" },
    { key: "rule", header: "Balance Rule", render: (row) => <span className="text-text-secondary">{row.balance_enforced ? "Enforced" : "Unlimited"}</span> },
    { key: "proration", header: "Join-date Proration", render: (row) => <Badge tone={row.proration_enabled ? "success" : "neutral"}>{row.proration_enabled ? "Enabled" : "Off"}</Badge> },
    { key: "carry", header: "Carry Forward", render: (row) => row.carry_forward_enabled ? <div><span className="text-text-primary">Enabled</span><small className="block text-text-secondary">Max {formatDays(row.max_carry_forward_days)} · Expires {String(row.carry_forward_expiry_day || "").padStart(2, "0")}/{String(row.carry_forward_expiry_month || "").padStart(2, "0")}</small></div> : <span className="text-text-secondary">Off</span> },
    { key: "action", header: "Action", align: "right", render: (row) => canManage ? <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs font-semibold" type="button" onClick={() => onEdit(row)}><Settings2 size={14} /> Edit</button> : "—" },
  ]} /> : <div className="p-4"><EmptyState title="No leave policies" description="Outlet leave policies will appear here when configured." /></div>}</Card>;
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
    <section className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4"><div><span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{typeLabel[request.leave_type]}</span><h3 className="mt-1 text-base font-semibold text-text-primary">{formatLeaveDateRange(request.start_date, request.end_date)} · {formatDays(request.requested_days)}</h3></div><Badge tone={statusTone[request.status]}>{statusLabel(request.status)}</Badge></section>
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

function BalanceDetail({ group, history, canAdjust, onRetryHistory, onClose, onAdjust }) {
  const periodYear = group.period_start ? new Date(`${group.period_start}T00:00:00`).getFullYear() : "Current period";
  return <Modal size="xl" title="Leave Balance" description={`${group.employee?.name} · ${group.employee?.position || "Crew"} · ${periodYear}`} onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}><div className="space-y-5"><div className="divide-y divide-border overflow-hidden rounded-xl border border-border">{Object.keys(typeLabel).map((type) => { const row = group.balances[type]; const unlimited = row?.balance_enforced === false; return <section className="grid gap-3 p-4 sm:grid-cols-[minmax(180px,1fr)_minmax(0,2fr)_auto] sm:items-center" key={type}><div><h3 className="font-semibold text-text-primary">{typeLabel[type]}</h3><p className="mt-1 text-xs text-text-secondary">{!row ? "Not configured" : unlimited ? "No balance limit" : formatLeaveDateRange(row.period_start, row.period_end)}</p></div>{!row ? <span className="text-sm text-text-muted">No entitlement record</span> : unlimited ? <div><span className="font-semibold text-text-primary">Unlimited</span><small className="block text-text-secondary">No balance limit</small></div> : <div className="grid grid-cols-4 gap-3"><Detail label="Entitled" value={formatDays(row.entitled)} /><Detail label="Used" value={formatDays(row.used)} /><Detail label="Pending" value={formatDays(row.pending)} /><Detail label="Available" value={formatDays(row.available)} emphasize /></div>}{canAdjust && row?.balance_enforced ? <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs font-semibold" type="button" onClick={() => onAdjust(row)}><SlidersHorizontal size={14} /> Adjust</button> : <span />}</section>; })}</div><AdjustmentHistory history={history} onRetry={onRetryHistory} /></div></Modal>;
}

function AdjustmentHistory({ history, onRetry }) {
  return <section><div className="mb-2 flex items-center gap-2"><History size={16} className="text-primary" /><h3 className="text-sm font-semibold text-text-primary">Adjustment History</h3></div>{history.loading ? <Loading /> : history.error ? <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3"><span className="text-sm text-rose-700">{history.error}</span><button className="btn-secondary min-h-8 px-3 py-1 text-xs" type="button" onClick={onRetry}>Retry</button></div> : history.rows.length ? <DataTable density="compact" tableClassName="min-w-[820px]" rows={history.rows} getRowKey={(row) => row.id} columns={[
    { key: "date", header: "Date", render: (row) => <span className="whitespace-nowrap text-text-secondary">{formatLeaveDate(row.adjusted_at)}</span> },
    { key: "type", header: "Leave Type", render: (row) => <span className="text-text-primary">{typeLabel[row.leave_type]}</span> },
    { key: "amount", header: "Adjustment", render: (row) => <span className={`font-semibold ${Number(row.amount) > 0 ? "text-emerald-700" : "text-rose-600"}`}>{Number(row.amount) > 0 ? "+" : ""}{formatDays(row.amount)}</span> },
    { key: "reason", header: "Reason", render: (row) => <span className="text-text-secondary">{row.reason}</span> },
    { key: "actor", header: "Adjusted By", render: (row) => <span className="text-text-secondary">{row.adjusted_by?.name || "FeedX Admin"}</span> },
    { key: "result", header: "Resulting Balance", render: (row) => row.previous_available == null || row.resulting_available == null ? <span className="text-text-muted">Historical value unavailable</span> : <span className="whitespace-nowrap text-text-secondary">{formatDays(row.previous_available)} → <strong className="font-semibold text-text-primary">{formatDays(row.resulting_available)}</strong></span> },
  ]} /> : <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-text-secondary">No manual adjustments recorded.</div>}</section>;
}

function AdjustmentModal({ balance, saving, onClose, onSave }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const amountNumber = Number(amount);
  const valid = Boolean(amountNumber && reason.trim());
  return <Modal title="Adjust Leave Balance" description={`${balance.employee?.name} · ${typeLabel[balance.leave_type]}`} onClose={onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={saving || !valid} onClick={() => onSave(amountNumber, reason)}>Save Adjustment</button></>}><div className="space-y-4"><div className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-slate-50/60 p-3"><Detail label="Current available" value={formatDays(balance.available)} /><Detail label="Adjustment" value={amountNumber ? `${amountNumber > 0 ? "+" : ""}${formatDays(amountNumber)}` : "—"} /><Detail label="New available" value={amountNumber ? formatDays(Number(balance.available) + amountNumber) : formatDays(balance.available)} emphasize /></div><label className="field"><span>Adjustment</span><div className="relative"><input className={`control w-full pr-14 font-semibold ${amountNumber > 0 ? "text-emerald-700" : amountNumber < 0 ? "text-rose-600" : ""}`} type="number" step="0.5" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="+ / -" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-muted">days</span></div></label><label className="field"><span>Reason *</span><textarea className="control min-h-24 w-full py-2" rows="4" maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for this permanent adjustment" /></label><p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800"><History className="mt-0.5 shrink-0" size={14} />This creates a permanent audit record. Adjustments cannot be edited or deleted.</p></div></Modal>;
}

function PolicyModal({ policy, saving, onClose, onSave }) {
  const [values, setValues] = useState({ annual_days: policy.annual_days, proration_enabled: policy.proration_enabled, balance_enforced: policy.balance_enforced, carry_forward_enabled: policy.carry_forward_enabled, max_carry_forward_days: policy.max_carry_forward_days, carry_forward_expiry_month: policy.carry_forward_expiry_month ? String(policy.carry_forward_expiry_month) : "", carry_forward_expiry_day: policy.carry_forward_expiry_day ? String(policy.carry_forward_expiry_day) : "" });
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const invalid = values.balance_enforced && (Number(values.annual_days) < 0 || (values.carry_forward_enabled && (Number(values.max_carry_forward_days) < 0 || !values.carry_forward_expiry_month || !values.carry_forward_expiry_day)));
  return <Modal size="md" title={`Edit ${typeLabel[policy.leave_type]}`} description="Applies to newly generated annual entitlements for this outlet." onClose={onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={saving || invalid} onClick={() => onSave(values)}>Save Policy</button></>}><div className="space-y-4"><ToggleRow label="Enforce available balance" help="Prevent requests that exceed the employee’s available entitlement." checked={values.balance_enforced} onChange={(checked) => update("balance_enforced", checked)} />{values.balance_enforced ? <><label className="field"><span>Annual entitlement</span><div className="relative"><input className="control w-full pr-14" type="number" min="0" step="0.5" value={values.annual_days} onChange={(event) => update("annual_days", event.target.value)} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-muted">days</span></div></label><ToggleRow label="Prorate by join date" help="New joiners receive a proportional entitlement for the remaining year." checked={values.proration_enabled} onChange={(checked) => update("proration_enabled", checked)} /><ToggleRow label="Carry forward" help="Allow unused entitlement to carry into the next annual period." checked={values.carry_forward_enabled} onChange={(checked) => update("carry_forward_enabled", checked)} />{values.carry_forward_enabled ? <div className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2"><label className="field sm:col-span-2"><span>Maximum carry-forward</span><div className="relative"><input className="control w-full pr-14" type="number" min="0" step="0.5" value={values.max_carry_forward_days} onChange={(event) => update("max_carry_forward_days", event.target.value)} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-muted">days</span></div></label><SelectField label="Expiry month" value={values.carry_forward_expiry_month} onChange={(value) => update("carry_forward_expiry_month", value)} options={monthOptions} placeholder="Month" /><SelectField label="Expiry day" value={values.carry_forward_expiry_day} onChange={(value) => update("carry_forward_expiry_day", value)} options={dayOptions} placeholder="Day" /></div> : null}</> : <div className="rounded-xl bg-slate-50 p-4"><strong className="text-sm text-text-primary">Unlimited leave</strong><p className="mt-1 text-sm text-text-secondary">Entitlement, proration and carry-forward controls do not apply while balance enforcement is off.</p></div>}</div></Modal>;
}

function ToggleRow({ label, help, checked, onChange }) { return <button type="button" role="switch" aria-checked={checked} className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-white p-3 text-left" onClick={() => onChange(!checked)}><span><strong className="block text-sm text-text-primary">{label}</strong><small className="mt-0.5 block text-text-secondary">{help}</small></span><span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-primary" : "bg-slate-300"}`}><i className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? "left-6" : "left-1"}`} /></span></button>; }
function Employee({ employee }) { return <div><span className="block font-semibold text-text-primary">{employee?.name || "Crew employee"}</span><small className="block text-text-secondary">{employee?.position || "Crew"}</small></div>; }
function Detail({ label, value, emphasize = false }) { return <div><div className="text-xs font-medium text-text-muted">{label}</div><div className={`mt-1 text-sm text-text-primary ${emphasize ? "font-semibold" : "font-medium"}`}>{value}</div></div>; }
function Loading() { return <div className="space-y-2 p-4" role="status" aria-label="Loading leave data">{[1, 2, 3, 4].map((row) => <div className="h-10 animate-pulse rounded-lg bg-slate-100" key={row} />)}</div>; }
function ErrorState({ message, onRetry }) { return <section className="flex items-center justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 p-4" role="alert"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 shrink-0 text-rose-600" size={18} /><div><strong className="text-sm text-rose-800">Unable to load leave</strong><p className="mt-1 text-sm text-rose-700">{message}</p></div></div><button className="btn-secondary" type="button" onClick={onRetry}>Retry</button></section>; }
