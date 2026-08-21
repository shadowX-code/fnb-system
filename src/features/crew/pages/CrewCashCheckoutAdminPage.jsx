import { useEffect, useMemo, useState } from "react";
import { Banknote, CheckCircle2, Clipboard, Eye, HandCoins, History, Settings2, WalletCards } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Badge from "../../../components/ui/Badge.jsx";
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
    <CrewAdminToolbar outlet={<CrewAdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((item) => ({ value: item.id, label: item.name }))} />} time={<div className="flex gap-2"><label className="field-label">From<input className="control mt-1" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="field-label">To<input className="control mt-1" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></div>} primary={<div className="flex gap-2">{canManage && <button className="btn-secondary" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /> Settings</button>}{tab === "deposit" && canCollect && <button className="btn-primary" onClick={() => setCollectionOpen(true)}><HandCoins size={16} /> Record Collection</button>}</div>} />
    <div className="inline-flex rounded-xl border border-border bg-white p-1" role="tablist"><button className={tab === "checkout" ? "btn-primary" : "btn-ghost"} role="tab" aria-selected={tab === "checkout"} onClick={() => setTab("checkout")}>Daily Checkout</button><button className={tab === "deposit" ? "btn-primary" : "btn-ghost"} role="tab" aria-selected={tab === "deposit"} onClick={() => setTab("deposit")}>Cash Deposit</button></div>
    {loadError ? <section className="card flex min-h-72 flex-col items-center justify-center gap-3 p-8 text-center"><Banknote size={28} className="text-text-muted" /><div><h2 className="text-base font-semibold">Unable to load Cash Checkout</h2><p className="mt-1 text-sm text-text-secondary">{loadError}</p></div><button className="btn-primary" onClick={refresh}>Retry</button></section> : tab === "checkout" ? <>
      <section className="grid gap-3 md:grid-cols-4"><Metric icon={WalletCards} label="Floating Cash" value={data.settings ? money(data.settings.floating_cash) : "Not configured"} helper={data.settings ? "Current outlet setting" : "Set this before Crew can reconcile opening cash"} /><Metric icon={CheckCircle2} label="Completed" value={data.checkouts.filter((item) => item.status === "completed").length} helper="Selected period" /><Metric icon={History} label="In Progress" value={data.checkouts.filter((item) => item.status !== "completed").length} helper="Draft through submitted" /><Metric icon={Banknote} label="Needs Review" value={reviewCount} helper="Variance, shortfall or receipt difference" tone={reviewCount ? "warning" : "success"} /></section>
      <section className="card overflow-hidden">{loading ? <div className="p-8 text-sm text-text-muted">Loading Cash Checkout…</div> : <DataTable density="compact" tableClassName="min-w-[1120px]" rows={data.checkouts} getRowKey={(row) => row.id} columns={[
        { key: "date", header: "Date", render: (row) => date(row.business_date) },
        { key: "outlet", header: "Outlet", render: () => outlets.find((item) => item.id === outletId)?.name || "—" },
        { key: "crew", header: "Checked Out By", render: (row) => formatCrewEmployee(row.checked_out_by) },
        { key: "opening", header: "Opening", render: (row) => money(row.expected_opening_cash) },
        { key: "counted", header: "Counted", render: (row) => money(row.counted_cash) },
        { key: "pos", header: "POS Expected", render: (row) => row.pos_expected_cash == null ? "—" : money(row.pos_expected_cash) },
        { key: "variance", header: "Variance", render: (row) => <Badge tone={statusTone(row.reconciliation_status)}>{row.variance == null ? "—" : `${row.variance > 0 ? "+" : ""}${money(row.variance)}`}</Badge> },
        { key: "carry", header: "Carry Forward", render: (row) => money(row.carry_forward) },
        { key: "deposit", header: "For Deposit", render: (row) => <strong>{money(row.amount_for_deposit)}</strong> },
        { key: "status", header: "Status", render: (row) => <Badge tone={statusTone(row.review_required && row.review_status === "pending" ? "review_required" : row.status)}>{row.review_required && row.review_status === "pending" ? "Review Required" : statusLabel(row.status)}</Badge> },
        { key: "actions", header: "Actions", align: "right", render: (row) => <button className="icon-btn h-9 w-9" aria-label={`View checkout ${date(row.business_date)}`} onClick={() => setSelected(row)}><Eye size={16} /></button> },
      ]} />}</section>
    </> : <>
      <section className="grid gap-3 md:grid-cols-3"><Metric icon={WalletCards} label="Current Balance" value={money(data.summary.current_balance)} helper="Total due minus confirmed collections" /><Metric icon={Banknote} label="Total Added" value={money(data.summary.total_added)} helper="Completed Cash Checkout only" /><Metric icon={HandCoins} label="Total Collected" value={money(data.summary.total_collected)} helper="Confirmed receipts only" /></section>
      <section className="card overflow-hidden"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-semibold">Deposit Ledger</h2><p className="text-sm text-text-secondary">Append-only checkout, collection and correction activity.</p></div><button className="btn-secondary" onClick={copySummary}><Clipboard size={15} /> Copy Summary</button></div>{loading ? <div className="p-8 text-sm text-text-muted">Loading Cash Deposit…</div> : <DataTable density="compact" tableClassName="min-w-[860px]" rows={data.ledger} getRowKey={(row) => row.id} columns={[
        { key: "date", header: "Date", render: (row) => <span className="grid gap-0.5"><strong className="text-[13px]">{formatCrewOperationalDateTime(row.occurred_at).split(" · ")[0]}</strong><small className="text-xs text-text-muted">{formatCrewOperationalDateTime(row.occurred_at).split(" · ")[1]}</small></span> }, { key: "activity", header: "Activity", render: (row) => <span className="grid gap-0.5"><strong>{ledgerActivity(row)}</strong>{ledgerActor(row) !== "—" && <small className="text-xs text-text-muted">{ledgerActor(row)}</small>}</span> },
        { key: "in", header: "Amount In", render: (row) => Number(row.amount_in) ? <span className="font-semibold text-emerald-700">+{money(row.amount_in)}</span> : "—" },
        { key: "out", header: "Amount Out", render: (row) => Number(row.amount_out) ? <span className="font-semibold text-slate-700">−{money(row.amount_out)}</span> : "—" },
        { key: "balance", header: "Balance", render: (row) => <strong>{money(row.balance)}</strong> },
      ]} />}</section>
      {data.collections.some((item) => ["pending_receipt", "review_required"].includes(item.status)) && <section className="card overflow-hidden"><div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Handover Status</h2></div><DataTable density="compact" rows={data.collections.filter((item) => ["pending_receipt", "review_required"].includes(item.status))} getRowKey={(row) => row.id} columns={[{ key: "receiver", header: "Receiver", render: (row) => row.receiver_name }, { key: "amount", header: "Handed Over", render: (row) => money(row.amount) }, { key: "received", header: "Received", render: (row) => row.received_amount ? money(row.received_amount) : "Awaiting confirmation" }, { key: "status", header: "Status", render: (row) => <Badge tone="warning">{statusLabel(row.status)}</Badge> }, { key: "action", header: "Action", align: "right", render: (row) => row.status === "review_required" && canReview ? <button className="btn-secondary" onClick={() => reviewCollection(row, refresh, ui)}>Review Difference</button> : null }]} /></section>}
    </>}
    {selected && <CheckoutDetail row={selected} canReview={canReview} canManage={canManage} onReview={review} onChanged={refresh} ui={ui} onClose={() => setSelected(null)} />}
    {settingsOpen && <CashSettings initial={data.settings || {}} history={data.float_history} outletId={outletId} onClose={() => setSettingsOpen(false)} onSaved={async () => { setSettingsOpen(false); await refresh(); }} ui={ui} />}
    {collectionOpen && <CollectionForm outletId={outletId} employees={data.employees} balance={data.summary.available_balance ?? data.summary.current_balance} onClose={() => setCollectionOpen(false)} onSaved={async () => { setCollectionOpen(false); await refresh(); }} ui={ui} />}
  </div>;
}

function Metric({ icon: Icon, label, value, helper, tone = "neutral" }) { return <article className={`rounded-2xl border p-4 ${tone === "warning" ? "border-amber-200 bg-amber-50" : "border-border bg-white"}`}><Icon size={18} className={tone === "warning" ? "text-amber-700" : "text-primary"} /><strong className="mt-4 block text-2xl">{value}</strong><span className="text-sm font-semibold">{label}</span><small className="block text-text-muted">{helper}</small></article>; }

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
  async function submit(event) { event.preventDefault(); setSaving(true); try { await crewService.saveCashSettings(outletId, form); await onSaved(); ui.notify({ title: "Cash settings saved", message: "Floating Cash history was recorded when the amount changed." }); } catch (cause) { ui.notify({ title: "Unable to save settings", message: cause.message, tone: "error" }); } finally { setSaving(false); } }
  return <Modal title="Cash Checkout Settings" description="Simple outlet-level rules. Floating Cash changes are immutable audit events." size="xl" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving} form="cash-settings" type="submit">{saving ? "Saving…" : "Save Settings"}</button></>}><form id="cash-settings" onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><Field label="Floating Cash (RM)"><input className="control" type="number" min="0" step="0.05" value={form.floating_cash} onChange={(event) => setForm({ ...form, floating_cash: event.target.value })} /></Field><Field label="Variance Tolerance (RM)"><input className="control" type="number" min="0" step="0.05" value={form.variance_tolerance} onChange={(event) => setForm({ ...form, variance_tolerance: event.target.value })} /></Field><Field label="Effective Date"><input className="control" type="date" value={form.effective_date} onChange={(event) => setForm({ ...form, effective_date: event.target.value })} /></Field><Field label="Closing Deadline"><input className="control" type="time" value={form.closing_deadline} onChange={(event) => setForm({ ...form, closing_deadline: event.target.value })} /></Field><Field label="Checkout Positions"><input className="control" value={form.required_positions.join(", ")} onChange={(event) => setForm({ ...form, required_positions: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></Field><Field label="Reason for Floating Cash change"><input className="control" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Required when amount changes" /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.require_receiver_confirmation} onChange={(event) => setForm({ ...form, require_receiver_confirmation: event.target.checked })} /> Require internal receiver confirmation</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.require_manager_review_over_tolerance} onChange={(event) => setForm({ ...form, require_manager_review_over_tolerance: event.target.checked })} /> Require review over tolerance</label></form><div className="mt-6"><h3 className="font-semibold">Floating Cash History</h3>{history.length ? <div className="mt-2 divide-y divide-border rounded-xl border border-border">{history.map((item) => <div className="grid gap-1 p-3 text-sm sm:grid-cols-[110px_1fr_1fr]" key={item.id}><span>{date(item.effective_date)}</span><strong>{money(item.previous_amount)} → {money(item.new_amount)}</strong><span className="text-text-muted">{item.reason} · {item.adjusted_by}</span></div>)}</div> : <p className="mt-2 text-sm text-text-muted">No Floating Cash adjustments recorded.</p>}</div></Modal>;
}

function CollectionForm({ outletId, employees, balance, onClose, onSaved, ui }) {
  const [form, setForm] = useState({ receiver_type: "external", receiver_employee_id: "", receiver_name: "", amount: "", purpose: "Cash deposit collection", note: "" }); const [saving, setSaving] = useState(false);
  async function submit(event) { event.preventDefault(); setSaving(true); try { await crewService.recordAdminCashCollection(outletId, form); await onSaved(); ui.notify({ title: form.receiver_type === "internal" ? "Handover submitted" : "Collection recorded", message: form.receiver_type === "internal" ? "The ledger will deduct after the receiver confirms." : "The confirmed collection was appended to the ledger." }); } catch (cause) { ui.notify({ title: "Unable to record collection", message: cause.message, tone: "error" }); } finally { setSaving(false); } }
  return <Modal title="Record Cash Collection" description={`Available deposit balance: ${money(balance)}`} onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button form="collection-form" type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Record Collection"}</button></>}><form id="collection-form" className="space-y-4" onSubmit={submit}><Field label="Receiver Type"><select className="control" value={form.receiver_type} onChange={(event) => setForm({ ...form, receiver_type: event.target.value })}><option value="external">External Receiver</option><option value="internal">FeedX Crew</option></select></Field>{form.receiver_type === "internal" ? <Field label="Receiver"><select className="control" required value={form.receiver_employee_id} onChange={(event) => setForm({ ...form, receiver_employee_id: event.target.value })}><option value="">Select Crew</option>{employees.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.position}</option>)}</select></Field> : <Field label="Receiver Name"><input className="control" required value={form.receiver_name} onChange={(event) => setForm({ ...form, receiver_name: event.target.value })} /></Field>}<Field label="Amount (RM)"><input className="control" required type="number" min="0.05" max={Number(balance || 0)} step="0.05" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></Field><Field label="Purpose"><input className="control" required value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} /></Field><Field label="Note (optional)"><textarea className="control min-h-20" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field></form></Modal>;
}

function Correction({ checkout, onClose, onSaved, ui }) { const [form, setForm] = useState({ action: "adjustment", amount: "", reason: "" }); const [saving, setSaving] = useState(false); async function submit(event) { event.preventDefault(); setSaving(true); try { await crewService.adjustCashCheckout(checkout.id, form.action, form.action === "reversal" ? null : form.amount, form.reason); await onSaved(); ui.notify({ title: "Correction recorded", message: "The original completed checkout remains immutable." }); } catch (cause) { ui.notify({ title: "Unable to record correction", message: cause.message, tone: "error" }); } finally { setSaving(false); } } return <Modal title="Record Cash Correction" description="Creates an append-only ledger correction. It never rewrites the completed checkout." onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" type="submit" form="cash-correction" disabled={saving}>{saving ? "Saving…" : "Record Correction"}</button></>}><form id="cash-correction" onSubmit={submit} className="space-y-4"><Field label="Action"><select className="control" value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value })}><option value="adjustment">Adjustment</option><option value="reversal">Reverse deposit entry</option></select></Field>{form.action === "adjustment" && <Field label="Signed Amount (RM)"><input className="control" type="number" step="0.05" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="Use a negative value to reduce" /></Field>}<Field label="Reason"><textarea className="control min-h-24" required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field></form></Modal>; }

async function reviewCollection(row, refresh, ui) { const note = window.prompt(`Received ${money(row.received_amount)} vs handed over ${money(row.amount)}. Enter review note:`); if (!note) return; const approve = window.confirm("Approve the received amount and deduct it from the ledger?"); try { await crewService.reviewCashCollection(row.id, approve ? "approve" : "reject", note); await refresh(); ui.notify({ title: approve ? "Collection completed" : "Collection cancelled", message: "The receipt difference remains in the audit trail." }); } catch (cause) { ui.notify({ title: "Unable to review collection", message: cause.message, tone: "error" }); } }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
