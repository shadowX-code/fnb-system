import { useEffect, useMemo, useState } from "react";
import { Banknote, CheckCircle2, Clipboard, Eye, HandCoins, History, Settings2, WalletCards } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import MultiSelectField from "../../../components/forms/MultiSelectField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import CrewAdminToolbar, { CrewAdminOutletField } from "../components/CrewAdminToolbar.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";
import { crewService } from "../../../services/crewService.js";
import { formatCrewEmployee, formatCrewMoney, formatCrewOperationalDateTime } from "../utils/crewI18n.js";

const localDate = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
const money = (value) => formatCrewMoney(value);
const date = (value) => value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00+08:00`)) : "—";
const ledgerActivity = (entry) => ({ checkout_due: "Cash Checkout", collection: "Cash Collection", checkout_adjustment: "Cash Adjustment", checkout_reversal: "Cash Reversal" }[entry.entry_type] || entry.activity || "Cash Activity");
const ledgerActor = (entry) => formatCrewEmployee(entry.receiver_name || entry.recorded_by);
const statusLabel = (value) => ({ draft: "Draft", reconciled: "Reconciled", submitted: "Submitted", completed: "Completed", pending_receipt: "Pending Receipt", review_required: "Review Required", cancelled: "Cancelled", balanced: "Balanced", over: "Over", short: "Short" }[value] || value || "—");
const statusTone = (value) => ["completed", "balanced"].includes(value) ? "success" : ["review_required", "over", "short", "submitted", "pending_receipt"].includes(value) ? "warning" : value === "cancelled" ? "danger" : "neutral";
const emptyData = () => ({ settings: null, summary: {}, checkouts: [], ledger: [], collections: [], float_history: [], employees: [] });
const normalizeData = (payload) => {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    settings: source.settings && typeof source.settings === "object" ? source.settings : null,
    summary: source.summary && typeof source.summary === "object" ? source.summary : {},
    checkouts: Array.isArray(source.checkouts) ? source.checkouts : [], ledger: Array.isArray(source.ledger) ? source.ledger : [],
    collections: Array.isArray(source.collections) ? source.collections : [], float_history: Array.isArray(source.float_history) ? source.float_history : [], employees: Array.isArray(source.employees) ? source.employees : [],
  };
};
const checkoutPositionOptions = ["Cashier", "Service Crew", "Supervisor", "Outlet Manager"].map((label) => ({ value: label, label }));
const receiverTypeOptions = [{ value: "internal", label: "Internal Receiver" }, { value: "external", label: "External Receiver" }];
const collectionPurposeOptions = [{ value: "Cash deposit collection", label: "Cash Deposit" }, { value: "Cash collection", label: "Cash Collection" }, { value: "Other", label: "Other" }];

export default function CrewCashCheckoutAdminPage({ auth, ui, store }) {
  const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
  const [tab, setTab] = useState("checkout");
  const [from, setFrom] = useState(() => { const value = new Date(); value.setDate(value.getDate() - 30); return localDate(value); });
  const [to, setTo] = useState(localDate());
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const canManage = auth.hasPermission("crew_cash_checkout.manage");
  const canReview = auth.hasPermission("crew_cash_checkout.review");
  const canCollect = auth.hasPermission("crew_cash_deposit.record_collection");

  async function refresh() {
    if (!outletId) { setData(emptyData()); setLoadError(""); setLoading(false); return; }
    setLoading(true); setLoadError("");
    try { setData(normalizeData(await crewService.cashCheckoutAdminData(outletId, from, to))); }
    catch (cause) { setData(emptyData()); setLoadError(cause.message || "Unable to load Cash Checkout"); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, [outletId, from, to]);

  async function review(checkout, decision) {
    const note = decision === "reject" ? window.prompt("Reason for returning this checkout") : "Reviewed and approved";
    if (decision === "reject" && !note) return;
    try { await crewService.reviewCashCheckout(checkout.id, decision, note); setSelected(null); await refresh(); ui.notify({ title: `Cash Checkout ${decision === "approve" ? "completed" : "returned"}`, message: "The audit trail and deposit ledger remain server-controlled." }); }
    catch (cause) { ui.notify({ title: "Unable to review Cash Checkout", message: cause.message, tone: "error" }); }
  }

  async function copySummary() {
    const outlet = outlets.find((item) => item.id === outletId)?.name || "Outlet";
    const lines = [...data.ledger].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at)).map((entry) => {
      const amount = Number(entry.amount_in || 0) || Number(entry.amount_out || 0);
      const receiver = Number(entry.amount_out || 0) > 0 && entry.receiver_name ? ` ${entry.receiver_name} received` : "";
      return `${new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(entry.occurred_at))}: ${money(amount)}${receiver}`;
    });
    await navigator.clipboard.writeText([`Cash Deposit - ${outlet}`, "", ...lines, "", `Balance: ${money(data.summary.current_balance)}`].join("\n"));
    ui.notify({ title: "Copied ✓", message: "Cash Deposit summary is ready to paste into WhatsApp." });
  }

  const reviewCount = useMemo(() => data.checkouts.filter((item) => item.review_required && item.review_status === "pending").length + data.collections.filter((item) => item.status === "review_required").length, [data]);
  return <div className="space-y-4">
    <PageHeader section="Crew · Operations" title="Cash Checkout" description="Reconcile daily outlet cash separately from the auditable Cash Deposit ledger." />
    <CrewAdminToolbar
      outlet={<CrewAdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((item) => ({ value: item.id, label: item.name }))} />}
      time={<div className="grid grid-cols-2 gap-2"><DatePickerField label="From" value={from} onChange={setFrom} /><DatePickerField label="To" value={to} onChange={setTo} /></div>}
      primary={<div className="flex gap-2">{canManage && <button className="btn-secondary" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /> Settings</button>}{tab === "deposit" && canCollect && <button className="btn-primary" onClick={() => setCollectionOpen(true)}><HandCoins size={16} /> Record Collection</button>}</div>}
    />
    <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-white p-1" role="tablist" aria-label="Cash Checkout sections">
      <button className={`h-9 rounded-lg px-3 text-sm font-semibold transition ${tab === "checkout" ? "bg-primary/10 text-primary shadow-sm" : "text-text-secondary hover:bg-slate-50 hover:text-text-primary"}`} role="tab" aria-selected={tab === "checkout"} onClick={() => setTab("checkout")}>Daily Checkout</button>
      <button className={`h-9 rounded-lg px-3 text-sm font-semibold transition ${tab === "deposit" ? "bg-primary/10 text-primary shadow-sm" : "text-text-secondary hover:bg-slate-50 hover:text-text-primary"}`} role="tab" aria-selected={tab === "deposit"} onClick={() => setTab("deposit")}>Cash Deposit</button>
    </div>
    {loadError ? <section className="card flex min-h-72 flex-col items-center justify-center gap-3 p-8 text-center"><Banknote size={28} className="text-text-muted" /><div><h2 className="text-base font-semibold">Unable to load Cash Checkout</h2><p className="mt-1 text-sm text-text-secondary">{loadError}</p></div><button className="btn-primary" onClick={refresh}>Retry</button></section> : tab === "checkout" ? <>
      <section className="grid gap-3 md:grid-cols-4"><Metric icon={WalletCards} label="Floating Cash" value={data.settings ? money(data.settings.floating_cash) : "Not configured"} helper={data.settings ? "Current outlet setting" : "Set this before Crew can reconcile opening cash"} action={canManage ? <button className="mt-2 text-xs font-semibold text-primary hover:underline" onClick={() => setSettingsOpen(true)}>View Settings</button> : null} /><Metric icon={CheckCircle2} label="Completed" value={data.checkouts.filter((item) => item.status === "completed").length} helper="Selected period" /><Metric icon={History} label="In Progress" value={data.checkouts.filter((item) => item.status !== "completed").length} helper="Draft through submitted" /><Metric icon={Banknote} label="Needs Review" value={reviewCount} helper="Variance, shortfall or receipt difference" tone={reviewCount ? "warning" : "success"} /></section>
      <section className="card crew-cash-table overflow-hidden">{loading ? <div className="p-8 text-sm text-text-muted">Loading Cash Checkout…</div> : <DataTable density="compact" tableClassName="min-w-[1080px]" rows={data.checkouts} getRowKey={(row) => row.id} columns={[
        { key: "date", header: "Date", render: (row) => date(row.business_date) },
        { key: "crew", header: "Checked Out By", render: (row) => <span className="font-semibold text-text-primary">{formatCrewEmployee(row.checked_out_by)}</span> },
        { key: "opening", header: "Opening", align: "right", render: (row) => money(row.expected_opening_cash) },
        { key: "counted", header: "Counted", align: "right", render: (row) => money(row.counted_cash) },
        { key: "pos", header: "POS Expected", align: "right", render: (row) => row.pos_expected_cash == null ? "—" : money(row.pos_expected_cash) },
        { key: "variance", header: "Variance", align: "right", render: (row) => <Badge tone={statusTone(row.reconciliation_status)}>{row.variance == null ? "—" : `${row.variance > 0 ? "+" : ""}${money(row.variance)}`}</Badge> },
        { key: "carry", header: "Carry Forward", align: "right", render: (row) => money(row.carry_forward) },
        { key: "deposit", header: "For Deposit", align: "right", render: (row) => <strong>{money(row.amount_for_deposit)}</strong> },
        { key: "status", header: "Status", render: (row) => <Badge tone={statusTone(row.review_required && row.review_status === "pending" ? "review_required" : row.status)}>{row.review_required && row.review_status === "pending" ? "Review Required" : statusLabel(row.status)}</Badge> },
        { key: "actions", header: "Actions", align: "right", render: (row) => <button className="icon-btn h-9 w-9" aria-label={`View checkout ${date(row.business_date)}`} onClick={() => setSelected(row)}><Eye size={16} /></button> },
      ]} />}</section>
    </> : <>
      <section className="grid gap-3 md:grid-cols-4"><Metric icon={WalletCards} label="Current Balance" value={money(data.summary.current_balance)} helper="Total due minus confirmed collections" emphasis /><Metric icon={Banknote} label="Available Balance" value={money(data.summary.available_balance ?? data.summary.current_balance)} helper="Available to collect now" /><Metric icon={HandCoins} label="Pending Handover" value={money(data.summary.pending_handover ?? 0)} helper="Reserved until receipt is confirmed" tone={Number(data.summary.pending_handover) ? "warning" : "neutral"} /><Metric icon={History} label="Total Collected" value={money(data.summary.total_collected)} helper="Confirmed receipts only" /></section>
      <section className="card overflow-hidden"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-semibold">Deposit Ledger</h2><p className="text-sm text-text-secondary">Append-only checkout, collection and correction activity.</p></div><button className="btn-secondary" onClick={copySummary}><Clipboard size={15} /> Copy Summary</button></div>{loading ? <div className="p-8 text-sm text-text-muted">Loading Cash Deposit…</div> : <DataTable density="compact" tableClassName="min-w-[860px]" rows={data.ledger} getRowKey={(row) => row.id} columns={[
        { key: "date", header: "Date", render: (row) => <span className="grid gap-0.5"><strong className="text-[13px]">{formatCrewOperationalDateTime(row.occurred_at).split(" · ")[0]}</strong><small className="text-xs text-text-muted">{formatCrewOperationalDateTime(row.occurred_at).split(" · ")[1]}</small></span> }, { key: "activity", header: "Activity", render: (row) => <span className="grid gap-0.5"><strong>{ledgerActivity(row)}</strong>{ledgerActor(row) !== "—" && <small className="text-xs text-text-muted">{ledgerActor(row)}</small>}</span> },
        { key: "amount", header: "Amount", align: "right", render: (row) => Number(row.amount_in) ? <span className="font-semibold text-emerald-700">+{money(row.amount_in)}</span> : Number(row.amount_out) ? <span className="font-semibold text-slate-700">−{money(row.amount_out)}</span> : "—" },
        { key: "balance", header: "Balance", align: "right", render: (row) => <strong>{money(row.balance)}</strong> },
        { key: "receiver", header: "Receiver", render: (row) => ledgerActor(row) },
        { key: "recorded", header: "Recorded By", render: (row) => formatCrewEmployee(row.recorded_by) },
      ]} />}</section>
      {data.collections.some((item) => ["pending_receipt", "review_required"].includes(item.status)) && <section className="card overflow-hidden"><div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Handover Status</h2></div><DataTable density="compact" rows={data.collections.filter((item) => ["pending_receipt", "review_required"].includes(item.status))} getRowKey={(row) => row.id} columns={[{ key: "receiver", header: "Receiver", render: (row) => row.receiver_name }, { key: "amount", header: "Handed Over", render: (row) => money(row.amount) }, { key: "received", header: "Received", render: (row) => row.received_amount ? money(row.received_amount) : "Awaiting confirmation" }, { key: "status", header: "Status", render: (row) => <Badge tone="warning">{statusLabel(row.status)}</Badge> }, { key: "action", header: "Action", align: "right", render: (row) => row.status === "review_required" && canReview ? <button className="btn-secondary" onClick={() => reviewCollection(row, refresh, ui)}>Review Difference</button> : null }]} /></section>}
    </>}
    {selected && <CheckoutDetail row={selected} canReview={canReview} canManage={canManage} onReview={review} onChanged={refresh} ui={ui} onClose={() => setSelected(null)} />}
    {settingsOpen && <CashSettings initial={data.settings || {}} history={data.float_history} outletId={outletId} onClose={() => setSettingsOpen(false)} onSaved={async () => { setSettingsOpen(false); await refresh(); }} ui={ui} />}
    {collectionOpen && <CollectionForm outletId={outletId} employees={data.employees} balance={data.summary.available_balance ?? data.summary.current_balance} onClose={() => setCollectionOpen(false)} onSaved={async () => { setCollectionOpen(false); await refresh(); }} ui={ui} />}
  </div>;
}

function Metric({ icon: Icon, label, value, helper, action, tone = "neutral", emphasis = false }) {
  return <article className={`min-h-[142px] rounded-2xl border p-4 ${tone === "warning" ? "border-amber-200 bg-amber-50" : "border-border bg-white"}`}>
    <Icon size={18} className={tone === "warning" ? "text-amber-700" : "text-primary"} />
    <span className="mt-4 block text-sm font-semibold text-text-secondary">{label}</span>
    <strong className={`mt-1 block ${emphasis ? "text-[28px]" : "text-2xl"} leading-tight text-text-primary`}>{value}</strong>
    <small className="mt-1 block text-text-muted">{helper}</small>
    {action}
  </article>;
}

function CheckoutDetail({ row, canReview, canManage, onReview, onChanged, ui, onClose }) {
  const counts = Object.entries(row.denomination_counts || {}).filter(([, qty]) => Number(qty) > 0);
  const [correcting, setCorrecting] = useState(false);
  return <Modal title={`Cash Checkout · ${date(row.business_date)}`} description={`${formatCrewEmployee(row.checked_out_by)} · ${statusLabel(row.status)}`} size="xl" onClose={onClose} footer={<div className="flex w-full justify-between"><span>{canManage && row.status === "completed" ? <button className="btn-secondary" onClick={() => setCorrecting(true)}>Record Correction</button> : null}</span><span className="flex gap-2">{canReview && row.review_required && row.review_status === "pending" ? <><button className="btn-secondary" onClick={() => onReview(row, "reject")}>Return</button><button className="btn-primary" onClick={() => onReview(row, "approve")}>Approve & Complete</button></> : <button className="btn-secondary" onClick={onClose}>Close</button>}</span></div>}>
    <div className="grid gap-3 sm:grid-cols-3"><Detail label="Expected Opening" value={money(row.expected_opening_cash)} /><Detail label="Counted Cash" value={money(row.counted_cash)} /><Detail label="POS Expected" value={row.pos_expected_cash == null ? "—" : money(row.pos_expected_cash)} /><Detail label="Variance" value={row.variance == null ? "—" : money(row.variance)} /><Detail label="Carry Forward" value={money(row.carry_forward)} /><Detail label="For Deposit" value={money(row.amount_for_deposit)} /></div>
    {row.float_shortfall > 0 && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Float shortfall: {money(row.float_shortfall)}</p>}
    {(row.variance_reason || row.opening_variance_reason) && <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm"><strong>Recorded reasons</strong>{row.opening_variance_reason && <p>Opening: {row.opening_variance_reason}</p>}{row.variance_reason && <p>Reconciliation: {row.variance_reason}</p>}</div>}
    <div className="mt-5"><h3 className="font-semibold">Denomination Count</h3><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">{counts.length ? counts.map(([denomination, qty]) => <div className="rounded-lg border border-border p-2 text-sm" key={denomination}><small className="text-text-muted">RM{denomination}</small><strong className="block">× {qty}</strong></div>) : <p className="text-sm text-text-muted">No denomination quantities recorded.</p>}</div></div>
    {correcting && <Correction checkout={row} onClose={() => setCorrecting(false)} onSaved={async () => { setCorrecting(false); onClose(); await onChanged(); }} ui={ui} />}
  </Modal>;
}

function Detail({ label, value }) { return <div className="rounded-xl border border-border p-3"><small className="text-text-muted">{label}</small><strong className="mt-1 block">{value}</strong></div>; }

function CashSettings({ initial, history, outletId, onClose, onSaved, ui }) {
  const [form, setForm] = useState({ floating_cash: initial.floating_cash ?? 0, variance_tolerance: initial.variance_tolerance ?? 0, required_positions: initial.required_positions || ["Cashier", "Supervisor", "Outlet Manager"], closing_deadline: initial.closing_deadline || "", require_receiver_confirmation: initial.require_receiver_confirmation ?? true, require_manager_review_over_tolerance: initial.require_manager_review_over_tolerance ?? true, effective_date: localDate(), reason: "" });
  const [saving, setSaving] = useState(false);
  const floatingCashChanged = Number(form.floating_cash) !== Number(initial.floating_cash ?? 0);
  const positionOptions = [...checkoutPositionOptions, ...form.required_positions.filter((value) => !checkoutPositionOptions.some((option) => option.value === value)).map((value) => ({ value, label: value }))];
  async function submit(event) { event.preventDefault(); if (floatingCashChanged && !form.reason.trim()) { ui.notify({ title: "Reason required", message: "Add a reason before changing Floating Cash.", tone: "error" }); return; } setSaving(true); try { await crewService.saveCashSettings(outletId, form); await onSaved(); ui.notify({ title: "Cash settings saved", message: "Floating Cash history was recorded when the amount changed." }); } catch (cause) { ui.notify({ title: "Unable to save settings", message: cause.message, tone: "error" }); } finally { setSaving(false); } }
  return <Modal title="Cash Checkout Settings" description="Outlet-level cash rules. Floating Cash changes remain immutable audit events." size="xl" onClose={onClose} bodyClassName="pb-5" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving} form="cash-settings" type="submit">{saving ? "Saving…" : "Save Settings"}</button></>}><form id="cash-settings" onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><MoneyField label="Floating Cash (RM)" value={form.floating_cash} onChange={(value) => setForm({ ...form, floating_cash: value })} min="0" /><MoneyField label="Variance Tolerance (RM)" value={form.variance_tolerance} onChange={(value) => setForm({ ...form, variance_tolerance: value })} min="0" /><DatePickerField label="Effective Date" value={form.effective_date} onChange={(value) => setForm({ ...form, effective_date: value })} /><Field label="Closing Deadline"><input className="control h-10" type="time" value={form.closing_deadline} onChange={(event) => setForm({ ...form, closing_deadline: event.target.value })} /></Field><MultiSelectField label="Checkout Positions" value={form.required_positions} options={positionOptions} onApply={(required_positions) => setForm({ ...form, required_positions })} placeholder="Select positions" /><Field label="Reason for Floating Cash Change" required={floatingCashChanged}><textarea className="control min-h-20" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder={floatingCashChanged ? "Required when the Floating Cash amount changes" : "Optional unless Floating Cash changes"} /></Field><SettingToggle checked={form.require_receiver_confirmation} onChange={(checked) => setForm({ ...form, require_receiver_confirmation: checked })} label="Require internal receiver confirmation" helper="Internal collections remain pending until the named Crew member confirms receipt." /><SettingToggle checked={form.require_manager_review_over_tolerance} onChange={(checked) => setForm({ ...form, require_manager_review_over_tolerance: checked })} label="Require review over tolerance" helper="Variances above the configured tolerance stay in review before completion." /></form><div className="mt-6"><div><h3 className="font-semibold">Floating Cash History</h3><p className="mt-1 text-sm text-text-secondary">Previous outlet amounts and their immutable reasons.</p></div>{history.length ? <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">{history.map((item) => <div className="grid gap-1 px-3 py-3 text-sm sm:grid-cols-[112px_150px_minmax(0,1fr)_auto]" key={item.id}><span className="text-text-secondary">{date(item.effective_date)}</span><strong>{money(item.previous_amount)} → {money(item.new_amount)}</strong><span className="truncate text-text-secondary">{item.reason || "—"}</span><span className="text-text-muted">{formatCrewEmployee(item.adjusted_by)}</span></div>)}</div> : <p className="mt-3 text-sm text-text-muted">No Floating Cash adjustments recorded.</p>}</div></Modal>;
}

function CollectionForm({ outletId, employees, balance, onClose, onSaved, ui }) {
  const [form, setForm] = useState({ receiver_type: "external", receiver_employee_id: "", receiver_name: "", amount: "", purpose: "Cash deposit collection", note: "" }); const [saving, setSaving] = useState(false);
  async function submit(event) { event.preventDefault(); setSaving(true); try { await crewService.recordAdminCashCollection(outletId, form); await onSaved(); ui.notify({ title: form.receiver_type === "internal" ? "Handover submitted" : "Collection recorded", message: form.receiver_type === "internal" ? "The ledger will deduct after the receiver confirms." : "The confirmed collection was appended to the ledger." }); } catch (cause) { ui.notify({ title: "Unable to record collection", message: cause.message, tone: "error" }); } finally { setSaving(false); } }
  const employeeOptions = employees.map((item) => ({ value: item.id, label: `${item.name} · ${item.position}` }));
  return <Modal title="Record Cash Collection" description={`Available deposit balance: ${money(balance)}`} onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button form="collection-form" type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Record Collection"}</button></>}><form id="collection-form" className="space-y-4" onSubmit={submit}><SelectField label="Receiver Type" value={form.receiver_type} options={receiverTypeOptions} onChange={(receiver_type) => setForm({ ...form, receiver_type, receiver_employee_id: "", receiver_name: "" })} />{form.receiver_type === "internal" ? <><SelectField label="Receiver" required searchable value={form.receiver_employee_id} options={employeeOptions} placeholder="Search Crew" onChange={(receiver_employee_id) => setForm({ ...form, receiver_employee_id })} /><p className="-mt-2 rounded-xl bg-primary/5 px-3 py-2 text-xs text-text-secondary">Receiver must confirm receipt before the collection is finalized.</p></> : <Field label="Receiver Name" required><input aria-label="Receiver Name" className="control h-10" required value={form.receiver_name} onChange={(event) => setForm({ ...form, receiver_name: event.target.value })} /></Field>}<MoneyField label="Amount (RM)" required value={form.amount} min="0.05" max={Number(balance || 0)} onChange={(amount) => setForm({ ...form, amount })} /><SelectField label="Purpose" value={form.purpose} options={collectionPurposeOptions} onChange={(purpose) => setForm({ ...form, purpose })} /><Field label="Note (optional)"><textarea className="control min-h-20" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field></form></Modal>;
}

function Correction({ checkout, onClose, onSaved, ui }) { const [form, setForm] = useState({ action: "adjustment", amount: "", reason: "" }); const [saving, setSaving] = useState(false); async function submit(event) { event.preventDefault(); setSaving(true); try { await crewService.adjustCashCheckout(checkout.id, form.action, form.action === "reversal" ? null : form.amount, form.reason); await onSaved(); ui.notify({ title: "Correction recorded", message: "The original completed checkout remains immutable." }); } catch (cause) { ui.notify({ title: "Unable to record correction", message: cause.message, tone: "error" }); } finally { setSaving(false); } } return <Modal title="Record Cash Correction" description="Creates an append-only ledger correction; it never rewrites the completed checkout." onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" type="submit" form="cash-correction" disabled={saving}>{saving ? "Saving…" : "Record Correction"}</button></>}><form id="cash-correction" onSubmit={submit} className="space-y-4"><SelectField label="Action" value={form.action} options={[{ value: "adjustment", label: "Adjustment" }, { value: "reversal", label: "Reversal" }]} onChange={(action) => setForm({ ...form, action })} />{form.action === "adjustment" && <MoneyField label="Signed Amount (RM)" required value={form.amount} onChange={(amount) => setForm({ ...form, amount })} helper="Use a negative value for deduction." />}<Field label="Reason" required><textarea className="control min-h-24" required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field><p className="text-xs text-text-muted">This entry is appended to the audit ledger and cannot be edited or removed.</p></form></Modal>; }

async function reviewCollection(row, refresh, ui) { const note = window.prompt(`Received ${money(row.received_amount)} vs handed over ${money(row.amount)}. Enter review note:`); if (!note) return; const approve = window.confirm("Approve the received amount and deduct it from the ledger?"); try { await crewService.reviewCashCollection(row.id, approve ? "approve" : "reject", note); await refresh(); ui.notify({ title: approve ? "Collection completed" : "Collection cancelled", message: "The receipt difference remains in the audit trail." }); } catch (cause) { ui.notify({ title: "Unable to review collection", message: cause.message, tone: "error" }); } }
function Field({ label, children, required = false }) { return <label className="field"><span>{label} {required ? <em className="not-italic text-rose-500">*</em> : null}</span>{children}</label>; }
function MoneyField({ label, value, onChange, min, max, required = false, helper }) { return <Field label={label} required={required}><input aria-label={label} className="control h-10" required={required} type="number" min={min} max={max} step="0.05" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />{helper ? <small className="mt-1 block text-xs text-text-muted">{helper}</small> : null}</Field>; }
function SettingToggle({ checked, onChange, label, helper }) { return <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} className={`flex min-h-[78px] items-start gap-3 rounded-xl border p-3 text-left transition ${checked ? "border-primary/30 bg-primary/5" : "border-border bg-white hover:bg-slate-50"}`}><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${checked ? "border-primary bg-primary text-white" : "border-slate-300 bg-white text-transparent"}`}>✓</span><span><strong className="block text-sm text-text-primary">{label}</strong><small className="mt-1 block text-xs leading-5 text-text-secondary">{helper}</small></span></button>; }
