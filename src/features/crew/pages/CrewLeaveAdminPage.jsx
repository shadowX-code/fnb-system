import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarDays, Check, History, RotateCcw, Search, Settings2, SlidersHorizontal, X } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { crewService } from "../../../services/crewService.js";

const typeLabel = { annual: "Annual Leave", medical: "Medical Leave / MC", unpaid: "Unpaid Leave", other: "Other Leave" };
const statusTone = { pending: "warning", approved: "success", rejected: "danger", cancelled: "neutral" };
const monthOptions = Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: new Date(2026, index, 1).toLocaleDateString("en-MY", { month: "long" }) }));
const dayOptions = Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }));
const formatDate = (value) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—";
const formatTime = (value) => value ? new Date(`2026-01-01T${String(value).slice(0, 5)}:00`).toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit" }) : "—";
const formatDays = (value) => value == null ? "Unlimited" : `${Number(value).toFixed(Number(value) % 1 ? 1 : 0)} days`;
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
  const [outletId, setOutletId] = useState(outlets[0]?.id || "");
  const [data, setData] = useState({ requests: [], balances: [], policies: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("requests");
  const [filters, setFilters] = useState({ search: "", type: "all", status: "all" });
  const [review, setReview] = useState(null);
  const [balanceEmployee, setBalanceEmployee] = useState(null);
  const [adjustment, setAdjustment] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [saving, setSaving] = useState(false);
  const canReview = auth.hasPermission("crew_leave.review");
  const canAdjust = auth.hasPermission("crew_leave_balance.adjust");
  const canSettings = auth.hasPermission("crew_leave_settings.manage");

  const load = async () => {
    if (!outletId) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try { setData(await crewService.leaveAdminData(outletId)); }
    catch (cause) { setError(cause.message || "Unable to load leave data."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [outletId]);

  const requestRows = useMemo(() => data.requests.filter((row) => (filters.type === "all" || row.leave_type === filters.type) && (filters.status === "all" || row.status === filters.status) && (!filters.search || `${row.employee?.name} ${row.employee?.position}`.toLowerCase().includes(filters.search.toLowerCase()))), [data.requests, filters]);
  const groupedBalances = useMemo(() => groupBalances(data.balances), [data.balances]);
  const balanceRows = useMemo(() => groupedBalances.filter((row) => !filters.search || `${row.employee?.name} ${row.employee?.position}`.toLowerCase().includes(filters.search.toLowerCase())), [groupedBalances, filters.search]);
  const hasActiveFilters = Boolean(filters.search || filters.type !== "all" || filters.status !== "all");
  const clearFilters = () => setFilters({ search: "", type: "all", status: "all" });

  const decide = async (decision, reason = null) => { setSaving(true); try { await crewService.reviewLeave(review.id, decision, reason); ui.notify({ title: decision === "approve" ? "Leave approved" : "Leave rejected", message: decision === "approve" ? "Balance and Duty Roster evidence are updated." : "Reserved balance has been released.", tone: "success" }); setReview(null); await load(); } catch (cause) { ui.notify({ title: "Unable to review leave", message: cause.message, tone: "error" }); } finally { setSaving(false); } };
  const adjust = async (amount, reason) => { setSaving(true); try { await crewService.adjustLeaveBalance(adjustment.entitlement_id, amount, reason); ui.notify({ title: "Balance adjusted", message: "The immutable adjustment is now included in the employee balance.", tone: "success" }); setAdjustment(null); await load(); } catch (cause) { ui.notify({ title: "Unable to adjust balance", message: cause.message, tone: "error" }); } finally { setSaving(false); } };
  const savePolicy = async (values) => { setSaving(true); try { await crewService.saveLeavePolicy(outletId, policy.leave_type, values); ui.notify({ title: "Leave policy saved", message: "Future entitlements use the updated policy. Existing grants remain historical.", tone: "success" }); setPolicy(null); await load(); } catch (cause) { ui.notify({ title: "Unable to save policy", message: cause.message, tone: "error" }); } finally { setSaving(false); } };

  return <div className="min-w-0 overflow-x-hidden space-y-4">
    <PageHeader section="Crew · Workforce" title="Leave" description="Review requests, understand employee balances and manage auditable outlet leave policy." />
    <nav className="inline-flex rounded-xl border border-border bg-white p-1" aria-label="Leave sections">{[["requests", "Requests"], ["balances", "Balances"], ["settings", "Settings"]].map(([value, label]) => <button type="button" role="tab" aria-selected={tab === value} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${tab === value ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-slate-50 hover:text-text-primary"}`} key={value} onClick={() => setTab(value)}>{label}</button>)}</nav>
    <LeaveToolbar tab={tab} outlets={outlets} outletId={outletId} setOutletId={setOutletId} filters={filters} setFilters={setFilters} hasActiveFilters={hasActiveFilters} clearFilters={clearFilters} />
    {error ? <ErrorState message={error} onRetry={load} /> : null}
    {!error && tab === "requests" ? <RequestsPanel allRows={data.requests} rows={requestRows} loading={loading} filtered={hasActiveFilters} canReview={canReview} setReview={setReview} /> : null}
    {!error && tab === "balances" ? <BalancesPanel allRows={groupedBalances} rows={balanceRows} loading={loading} filtered={Boolean(filters.search)} onManage={setBalanceEmployee} /> : null}
    {!error && tab === "settings" ? <SettingsPanel rows={data.policies} loading={loading} canManage={canSettings} onEdit={setPolicy} /> : null}
    {review ? <LeaveReview request={review} canReview={canReview} saving={saving} onClose={() => setReview(null)} onDecide={decide} /> : null}
    {balanceEmployee ? <BalanceDetail group={balanceEmployee} canAdjust={canAdjust} onClose={() => setBalanceEmployee(null)} onAdjust={(row) => { setBalanceEmployee(null); setAdjustment(row); }} /> : null}
    {adjustment ? <AdjustmentModal balance={adjustment} saving={saving} onClose={() => setAdjustment(null)} onSave={adjust} /> : null}
    {policy ? <PolicyModal policy={policy} saving={saving} onClose={() => setPolicy(null)} onSave={savePolicy} /> : null}
  </div>;
}

function LeaveToolbar({ tab, outlets, outletId, setOutletId, filters, setFilters, hasActiveFilters, clearFilters }) {
  const searchable = tab !== "settings";
  return <Card className="overflow-visible"><div className={`grid items-end gap-3 p-3 ${tab === "requests" ? "md:grid-cols-[220px_minmax(260px,1fr)_190px_180px_auto]" : searchable ? "md:grid-cols-[220px_minmax(280px,1fr)_auto]" : "md:grid-cols-[220px_1fr]"}`}>
    <SelectField label="Outlet" ariaLabel="Outlet" value={outletId} onChange={setOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />
    {searchable ? <label className="field"><span>Search Employee</span><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} /><input className="control w-full pl-9" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search employee name or position" /></div></label> : <p className="self-center text-sm text-text-secondary">Policies apply to the selected outlet and future entitlement generation.</p>}
    {tab === "requests" ? <><SelectField label="Leave Type" value={filters.type} onChange={(type) => setFilters({ ...filters, type })} options={[{ value: "all", label: "All" }, ...Object.entries(typeLabel).map(([value, label]) => ({ value, label }))]} /><SelectField label="Status" value={filters.status} onChange={(status) => setFilters({ ...filters, status })} options={[{ value: "all", label: "All" }, ...["pending", "approved", "rejected", "cancelled"].map((value) => ({ value, label: statusLabel(value) }))]} /></> : null}
    {searchable && hasActiveFilters ? <button className="btn-ghost mb-0.5 justify-self-start whitespace-nowrap" type="button" onClick={clearFilters}><RotateCcw size={14} /> Clear filters</button> : null}
  </div></Card>;
}

function RequestsPanel({ allRows, rows, loading, filtered, canReview, setReview }) {
  return <Card title="Leave Requests" description="Pending requests reserve entitlement immediately; approval converts the same reservation into used leave.">{loading ? <Loading /> : rows.length ? <DataTable density="compact" tableClassName="min-w-[980px]" rows={rows} getRowKey={(row) => row.id} columns={requestColumns(canReview, setReview)} /> : <div className="p-4"><EmptyState title={filtered && allRows.length ? "No requests match these filters" : "No leave requests"} description={filtered && allRows.length ? "Clear or adjust the employee, leave type or status filters." : "Employee leave requests for this outlet will appear here."} /></div>}</Card>;
}

function requestColumns(canReview, setReview) { return [
  { key: "employee", header: "Employee", render: (row) => <Employee employee={row.employee} /> },
  { key: "type", header: "Leave Type", render: (row) => <span className="font-semibold text-text-primary">{typeLabel[row.leave_type]}</span> },
  { key: "dates", header: "Dates", render: (row) => <div><div className="font-semibold text-text-primary">{formatDate(row.start_date)}{row.start_date !== row.end_date ? ` – ${formatDate(row.end_date)}` : ""}</div></div> },
  { key: "duration", header: "Duration", render: (row) => formatDays(row.requested_days) },
  { key: "balance", header: "Balance", render: (row) => <span className="font-semibold">{!row.balance_context ? "—" : row.balance_context.balance_enforced === false ? "Unlimited" : `${formatDays(row.balance_context.available)} available`}</span> },
  { key: "conflict", header: "Roster", render: (row) => { const working = row.roster_context?.filter((day) => day.schedule?.entry_type === "working") || []; return <span className={working.length ? "font-semibold text-amber-700" : "text-text-secondary"}>{working.length ? `${working.length} shift conflict${working.length === 1 ? "" : "s"}` : "No conflict"}</span>; } },
  { key: "status", header: "Status", render: (row) => <Badge tone={statusTone[row.status]}>{statusLabel(row.status)}</Badge> },
  { key: "action", header: "Action", align: "right", render: (row) => <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setReview(row)}>{row.status === "pending" && canReview ? "Review" : "View"}</button> },
]; }

function BalancesPanel({ allRows, rows, loading, filtered, onManage }) {
  const balanceCell = (row, type) => { const balance = row.balances[type]; return !balance ? <span className="text-text-muted">—</span> : balance.balance_enforced === false ? <span className="font-semibold text-text-primary">Unlimited</span> : <div><strong className={Number(balance.available) < 0 ? "text-rose-600" : "text-text-primary"}>{formatDays(balance.available)}</strong><small className="block text-text-secondary">available</small></div>; };
  return <Card title="Employee Leave Balances" description="One employee per row. Used and pending values come from leave evidence; adjustments remain immutable.">{loading ? <Loading /> : rows.length ? <DataTable density="compact" tableClassName="min-w-[1040px]" rows={rows} getRowKey={(row) => row.employee?.id} columns={[
    { key: "employee", header: "Employee", render: (row) => <Employee employee={row.employee} /> },
    { key: "annual", header: "Annual Leave", render: (row) => balanceCell(row, "annual") },
    { key: "medical", header: "Medical / MC", render: (row) => balanceCell(row, "medical") },
    { key: "unpaid", header: "Unpaid Leave", render: (row) => balanceCell(row, "unpaid") },
    { key: "other", header: "Other Leave", render: (row) => balanceCell(row, "other") },
    { key: "period", header: "Period", render: (row) => <span className="whitespace-nowrap text-text-secondary">{formatDate(row.period_start)} – {formatDate(row.period_end)}</span> },
    { key: "action", header: "Action", align: "right", render: (row) => <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onManage(row)}>Manage</button> },
  ]} /> : <div className="p-4"><EmptyState title={filtered && allRows.length ? "No employees match this search" : "No leave balances"} description={filtered && allRows.length ? "Clear or adjust the employee search." : "Active Crew entitlement balances for this outlet will appear here."} /></div>}</Card>;
}

function SettingsPanel({ rows, loading, canManage, onEdit }) {
  return <Card title="Leave Policy" description="Calendar-year defaults are outlet scoped. Existing annual grants remain unchanged for auditability.">{loading ? <Loading /> : rows.length ? <DataTable density="compact" tableClassName="min-w-[920px]" rows={rows} getRowKey={(row) => row.id} columns={[
    { key: "type", header: "Leave Type", render: (row) => <strong>{typeLabel[row.leave_type]}</strong> },
    { key: "entitlement", header: "Entitlement", render: (row) => row.balance_enforced ? `${formatDays(row.annual_days)} / year` : "Unlimited" },
    { key: "rule", header: "Balance Rule", render: (row) => row.balance_enforced ? "Enforce available balance" : "Unlimited" },
    { key: "proration", header: "Join-date Proration", render: (row) => <Badge tone={row.proration_enabled ? "success" : "neutral"}>{row.proration_enabled ? "Enabled" : "Off"}</Badge> },
    { key: "carry", header: "Carry Forward", render: (row) => row.carry_forward_enabled ? <div><strong>Enabled</strong><small className="block text-text-secondary">Max {formatDays(row.max_carry_forward_days)} · Expires {monthOptions[Number(row.carry_forward_expiry_month) - 1]?.label || "—"} {row.carry_forward_expiry_day || "—"}</small></div> : "Off" },
    { key: "action", header: "Action", align: "right", render: (row) => canManage ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onEdit(row)}><Settings2 size={14} /> Edit</button> : "—" },
  ]} /> : <div className="p-4"><EmptyState title="No leave policies" description="Outlet leave policies will appear here when configured." /></div>}</Card>;
}

function LeaveReview({ request, canReview, saving, onClose, onDecide }) {
  const [mode, setMode] = useState("review");
  const [reason, setReason] = useState("");
  const working = request.roster_context?.filter((item) => item.schedule?.entry_type === "working") || [];
  const balance = request.balance_context;
  const footer = mode === "reject" ? <><button className="btn-secondary" type="button" onClick={() => setMode("review")}>Back</button><button className="btn-danger" type="button" disabled={saving || !reason.trim()} onClick={() => onDecide("reject", reason)}>Confirm Rejection</button></> : mode === "approve" ? <><button className="btn-secondary" type="button" onClick={() => setMode("review")}>Back</button><button className="btn-primary" type="button" disabled={saving || (balance?.balance_enforced && Number(balance?.available) < 0)} onClick={() => onDecide("approve")}><Check size={16} /> Approve Leave</button></> : request.status === "pending" && canReview ? <><button className="btn-danger" type="button" onClick={() => setMode("reject")}><X size={16} /> Reject</button><button className="btn-primary" type="button" onClick={() => setMode("approve")}><Check size={16} /> Approve</button></> : <button className="btn-secondary" type="button" onClick={onClose}>Close</button>;
  return <Modal size="xl" title="Leave Request" description={`${request.employee?.name} · ${request.employee?.position || "Crew"} · ${request.outlet?.name}`} onClose={onClose} footer={footer}><div className="grid gap-5 lg:grid-cols-[minmax(0,1.12fr)_minmax(290px,.88fr)]">
    <section className="space-y-4"><section><h3 className="mb-2 text-sm font-bold text-text-primary">Request Summary</h3><div className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2"><Detail label="Leave Type" value={typeLabel[request.leave_type]} /><Detail label="Dates" value={`${formatDate(request.start_date)}${request.start_date !== request.end_date ? ` – ${formatDate(request.end_date)}` : ""}`} /><Detail label="Duration" value={formatDays(request.requested_days)} /><Detail label="Status" value={<Badge tone={statusTone[request.status]}>{statusLabel(request.status)}</Badge>} /></div></section>
    {balance ? <section><h3 className="mb-2 text-sm font-bold text-text-primary">Balance Context</h3><div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border p-3 sm:grid-cols-3"><Detail label="Entitled" value={formatDays(balance.entitled)} /><Detail label="Used" value={formatDays(balance.used)} /><Detail label="Pending" value={formatDays(balance.pending)} /><Detail label="Available now" value={balance.balance_enforced === false ? "Unlimited" : formatDays(balance.available)} /><Detail label="Requested" value={formatDays(request.requested_days)} /><Detail label="After approval" value={balance.balance_enforced === false ? "Unlimited" : formatDays(balance.available)} /></div></section> : null}
    <section><h3 className="text-sm font-bold text-text-primary">Reason</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{request.reason || "No reason provided."}</p></section>
    {mode === "reject" ? <label className="field"><span>Rejection Reason *</span><textarea className="control min-h-24 w-full py-2" rows="3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this request is rejected" /></label> : null}</section>
    <RosterContext request={request} working={working} />
  </div></Modal>;
}

function RosterContext({ request, working }) {
  const days = request.roster_context || [];
  return <section><div className="mb-2 flex items-center gap-2"><CalendarDays size={17} className="text-primary" /><h3 className="text-sm font-bold text-text-primary">Roster Context</h3></div>{days.length ? <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">{days.map((item) => <div className="grid gap-1 p-3" key={item.date}><div className="flex items-center justify-between gap-3"><strong className="text-sm text-text-primary">{formatDate(item.date)}</strong><Badge tone={item.schedule?.entry_type === "working" ? "warning" : "neutral"}>{item.schedule?.entry_type === "working" ? "Conflict" : "No conflict"}</Badge></div><span className="text-sm font-semibold text-text-primary">{rosterLabel(item.schedule)}</span><small className="text-text-secondary">{item.schedule?.outlet_name || request.outlet?.name || "No outlet context"}</small></div>)}</div> : <div className="rounded-xl bg-slate-50 p-4"><strong className="text-sm text-text-primary">No published roster</strong><p className="mt-1 text-sm text-text-secondary">No schedule context is available for the requested dates.</p></div>}{working.length ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-800">{working.length} published shift{working.length === 1 ? " conflicts" : "s conflict"} with this request. Approval preserves the superseded roster evidence.</p> : null}</section>;
}

function BalanceDetail({ group, canAdjust, onClose, onAdjust }) {
  const periodYear = group.period_start ? new Date(`${group.period_start}T00:00:00`).getFullYear() : "Current period";
  return <Modal size="lg" title="Leave Balance" description={`${group.employee?.name} · ${group.employee?.position || "Crew"} · ${periodYear}`} onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}><div className="divide-y divide-border overflow-hidden rounded-xl border border-border">{Object.keys(typeLabel).map((type) => { const row = group.balances[type]; const unlimited = row?.balance_enforced === false; return <section className="grid gap-3 p-4 sm:grid-cols-[minmax(170px,1fr)_minmax(0,2fr)_auto] sm:items-center" key={type}><div><h3 className="font-bold text-text-primary">{typeLabel[type]}</h3><p className="mt-1 text-xs text-text-secondary">{!row ? "Not configured" : unlimited ? "No balance limit" : `${formatDate(row.period_start)} – ${formatDate(row.period_end)}`}</p></div>{!row ? <span className="text-sm text-text-muted">No entitlement record</span> : unlimited ? <strong className="text-primary">Unlimited</strong> : <div className="grid grid-cols-4 gap-3"><Detail label="Entitled" value={formatDays(row.entitled)} /><Detail label="Used" value={formatDays(row.used)} /><Detail label="Pending" value={formatDays(row.pending)} /><Detail label="Available" value={formatDays(row.available)} /></div>}{canAdjust && row?.balance_enforced ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onAdjust(row)}><SlidersHorizontal size={14} /> Adjust</button> : <span />}</section>; })}</div></Modal>;
}

function AdjustmentModal({ balance, saving, onClose, onSave }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const amountNumber = Number(amount);
  const valid = Boolean(amountNumber && reason.trim());
  return <Modal title="Adjust Leave Balance" description={`${balance.employee?.name} · ${typeLabel[balance.leave_type]}`} onClose={onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={saving || !valid} onClick={() => onSave(amountNumber, reason)}>Save Adjustment</button></>}><div className="space-y-4"><div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-4"><Detail label="Entitled" value={formatDays(balance.entitled)} /><Detail label="Used" value={formatDays(balance.used)} /><Detail label="Pending" value={formatDays(balance.pending)} /><Detail label="Available" value={formatDays(balance.available)} /></div><label className="field"><span>Adjustment</span><div className="relative"><input className={`control w-full pr-14 font-bold ${amountNumber > 0 ? "text-emerald-700" : amountNumber < 0 ? "text-rose-600" : ""}`} type="number" step="0.5" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="+ / -" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-muted">days</span></div></label>{amountNumber ? <p className={`rounded-xl px-3 py-2 text-sm font-semibold ${amountNumber > 0 ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{amountNumber > 0 ? "+" : ""}{amountNumber} days · New available balance {formatDays(Number(balance.available) + amountNumber)}</p> : null}<label className="field"><span>Reason *</span><textarea className="control min-h-24 w-full py-2" rows="4" maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for this permanent adjustment" /></label><p className="flex items-start gap-2 text-xs leading-5 text-text-secondary"><History className="mt-0.5 shrink-0" size={14} />Adjustments are permanent audit records and cannot be edited or deleted.</p></div></Modal>;
}

function PolicyModal({ policy, saving, onClose, onSave }) {
  const [values, setValues] = useState({ annual_days: policy.annual_days, proration_enabled: policy.proration_enabled, balance_enforced: policy.balance_enforced, carry_forward_enabled: policy.carry_forward_enabled, max_carry_forward_days: policy.max_carry_forward_days, carry_forward_expiry_month: policy.carry_forward_expiry_month ? String(policy.carry_forward_expiry_month) : "", carry_forward_expiry_day: policy.carry_forward_expiry_day ? String(policy.carry_forward_expiry_day) : "" });
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const invalid = values.balance_enforced && (Number(values.annual_days) < 0 || (values.carry_forward_enabled && (Number(values.max_carry_forward_days) < 0 || !values.carry_forward_expiry_month || !values.carry_forward_expiry_day)));
  return <Modal size="md" title={`Edit ${typeLabel[policy.leave_type]}`} description="Applies to newly generated annual entitlements for this outlet." onClose={onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={saving || invalid} onClick={() => onSave(values)}>Save Policy</button></>}><div className="space-y-4"><ToggleRow label="Enforce available balance" help="Prevent requests that exceed the employee’s available entitlement." checked={values.balance_enforced} onChange={(checked) => update("balance_enforced", checked)} />{values.balance_enforced ? <><label className="field"><span>Annual entitlement</span><div className="relative"><input className="control w-full pr-14" type="number" min="0" step="0.5" value={values.annual_days} onChange={(event) => update("annual_days", event.target.value)} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-muted">days</span></div></label><ToggleRow label="Prorate by join date" help="New joiners receive a proportional entitlement for the remaining year." checked={values.proration_enabled} onChange={(checked) => update("proration_enabled", checked)} /><ToggleRow label="Carry forward" help="Allow unused entitlement to carry into the next annual period." checked={values.carry_forward_enabled} onChange={(checked) => update("carry_forward_enabled", checked)} />{values.carry_forward_enabled ? <div className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2"><label className="field sm:col-span-2"><span>Maximum carry-forward</span><div className="relative"><input className="control w-full pr-14" type="number" min="0" step="0.5" value={values.max_carry_forward_days} onChange={(event) => update("max_carry_forward_days", event.target.value)} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-muted">days</span></div></label><SelectField label="Expiry month" value={values.carry_forward_expiry_month} onChange={(value) => update("carry_forward_expiry_month", value)} options={monthOptions} placeholder="Month" /><SelectField label="Expiry day" value={values.carry_forward_expiry_day} onChange={(value) => update("carry_forward_expiry_day", value)} options={dayOptions} placeholder="Day" /></div> : null}</> : <div className="rounded-xl bg-slate-50 p-4"><strong className="text-sm text-text-primary">Unlimited leave</strong><p className="mt-1 text-sm text-text-secondary">Entitlement, proration and carry-forward controls do not apply while balance enforcement is off.</p></div>}</div></Modal>;
}

function ToggleRow({ label, help, checked, onChange }) { return <button type="button" role="switch" aria-checked={checked} className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-white p-3 text-left" onClick={() => onChange(!checked)}><span><strong className="block text-sm text-text-primary">{label}</strong><small className="mt-0.5 block text-text-secondary">{help}</small></span><span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-primary" : "bg-slate-300"}`}><i className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? "left-6" : "left-1"}`} /></span></button>; }
function Employee({ employee }) { return <div><strong className="block text-text-primary">{employee?.name || "Crew employee"}</strong><small className="block text-text-secondary">{employee?.position || "Crew"}</small></div>; }
function Detail({ label, value }) { return <div><div className="text-xs font-semibold text-text-muted">{label}</div><div className="mt-1 text-sm font-bold text-text-primary">{value}</div></div>; }
function Loading() { return <div className="space-y-2 p-4" role="status" aria-label="Loading leave data">{[1, 2, 3, 4].map((row) => <div className="h-10 animate-pulse rounded-lg bg-slate-100" key={row} />)}</div>; }
function ErrorState({ message, onRetry }) { return <section className="flex items-center justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 p-4" role="alert"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 shrink-0 text-rose-600" size={18} /><div><strong className="text-sm text-rose-800">Unable to load leave</strong><p className="mt-1 text-sm text-rose-700">{message}</p></div></div><button className="btn-secondary" type="button" onClick={onRetry}>Retry</button></section>; }
