import CrewCashAllocationAudit from "../components/CrewCashAllocationAudit.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, CheckCircle2, Clipboard, Eye, HandCoins, History, Settings2, WalletCards } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import AdminFilterToolbar, { AdminOutletField } from "../../../components/layout/AdminFilterToolbar.jsx";
import AsyncDataSurface from "../../../components/feedback/AsyncDataSurface.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import AdminPagination, { useAdminPagedQuery } from "../../../components/tables/AdminPagination.jsx";
import AdminDataSection from "../../../components/tables/AdminDataSection.jsx";
import AdminDateTimeCell from "../../../components/tables/AdminDateTimeCell.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import AdminSummaryGrid from "../../../components/ui/AdminSummaryGrid.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import FeedXDateRangePicker from "../../../components/ui/FeedXDateRangePicker.jsx";
import MultiSelectField from "../../../components/forms/MultiSelectField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import ToggleField from "../../../components/forms/ToggleField.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";
import { crewService } from "../../../services/crewService.js";
import { formatCrewEmployee, formatCrewMoney, formatCrewOperationalDate, formatCrewOperationalDateTime, formatCrewTime } from "../utils/crewI18n.js";
import AdminSegmentedControl from "../../../components/forms/AdminSegmentedControl.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { semanticStatusTone } from "../../../components/ui/semanticStatus.js";
import { CASH_HANDOVER_PURPOSE } from "../cashHandover.js";

const localDate = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
const money = (value) => formatCrewMoney(value);
const date = (value) => value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00+08:00`)) : "—";
const ledgerActivity = (entry) => ({ checkout_due: "Cash Checkout", collection: "Cash Collection", checkout_adjustment: "Cash Adjustment", checkout_reversal: "Cash Reversal" }[entry.entry_type] || entry.activity || "Cash Activity");
const ledgerActor = (entry) => formatCrewEmployee(entry.receiver_name || entry.recorded_by);
const statusLabel = (value) => ({ draft: "Draft", reconciled: "Reconciled", submitted: "Submitted", completed: "Completed", pending_receipt: "Pending Confirmation", review_required: "Review Required", cancelled: "Cancelled", balanced: "Balanced", over: "Over", short: "Short" }[value] || value || "—");
const emptyData = () => ({ settings: null, summary: {}, checkouts: [], ledger: [], collections: [], float_history: [], employees: [], eligible_receivers: [], receiver_configuration: {}, checkout_positions: [] });
const normalizeData = (payload) => {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    settings: source.settings && typeof source.settings === "object" && Object.keys(source.settings).length ? source.settings : null,
    summary: source.summary && typeof source.summary === "object" ? source.summary : {},
    checkouts: Array.isArray(source.checkouts) ? source.checkouts : [], ledger: Array.isArray(source.ledger) ? source.ledger : [],
    previous_unresolved: source.previous_unresolved || [], collections: Array.isArray(source.collections) ? source.collections : [], float_history: Array.isArray(source.float_history) ? source.float_history : [], employees: Array.isArray(source.employees) ? source.employees : [], eligible_receivers: Array.isArray(source.eligible_receivers) ? source.eligible_receivers : [], receiver_configuration: source.receiver_configuration || {}, checkout_positions: Array.isArray(source.checkout_positions) ? source.checkout_positions : [],
  };
};
const receiverTypeOptions = [{ value: "internal", label: "Internal Receiver" }, { value: "external", label: "External Receiver" }];
const ledgerDateTime = (value) => ({ date: formatCrewOperationalDate(value), time: formatCrewTime(value, { hour12: true }).toLowerCase() });
const checkoutDateTime = (row) => {
  const value = row.completed_at || row.submitted_at || row.updated_at || row.created_at;
  return value ? ledgerDateTime(value) : { date: "—", time: "" };
};
const sameIds = (left = [], right = []) => left.length === right.length && left.every((id) => right.includes(id));

export default function CrewCashCheckoutAdminPage({ auth, ui, store }) {
  const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
  const [tab, setTab] = useState("checkout");
  const [from, setFrom] = useState(() => { const value = new Date(); value.setDate(value.getDate() - 30); return localDate(value); });
  const [to, setTo] = useState(localDate());
  const [context, setContext] = useState(emptyData);
  const [selected, setSelected] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [floatOpen, setFloatOpen] = useState(false);
  const [floatHistoryOpen, setFloatHistoryOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const canManage = auth.hasPermission("crew_cash_checkout.manage");
  const canReview = auth.hasPermission("crew_cash_checkout.review");
  const canCollect = auth.hasPermission("crew_cash_deposit.record_collection");

  const checkoutSignature = useMemo(() => JSON.stringify({ outletId, from, to, listing: "checkouts" }), [from, outletId, to]);
  const ledgerSignature = useMemo(() => JSON.stringify({ outletId, from, to, listing: "ledger" }), [from, outletId, to]);
  const [checkoutListing, checkoutActions] = useAdminPagedQuery({ storageKey: "crew-cash-checkouts", enabled: Boolean(outletId && tab === "checkout"), querySignature: checkoutSignature, loadPage: ({ page, pageSize }) => crewService.cashCheckoutAdminPage({ outletId, from, to, listing: "checkouts", page, pageSize }) });
  const [ledgerListing, ledgerActions] = useAdminPagedQuery({ storageKey: "crew-cash-ledger", enabled: Boolean(outletId && tab === "deposit"), querySignature: ledgerSignature, loadPage: ({ page, pageSize }) => crewService.cashCheckoutAdminPage({ outletId, from, to, listing: "ledger", page, pageSize }) });
  const listing = tab === "checkout" ? checkoutListing : ledgerListing;
  const listingActions = tab === "checkout" ? checkoutActions : ledgerActions;
  const data = useMemo(() => normalizeData({ ...context, summary: listing.summary || {}, checkouts: tab === "checkout" ? listing.rows : [], ledger: tab === "deposit" ? listing.rows : [], collections: listing.summary?.collections || [] }), [context, listing.rows, listing.summary, tab]);
  const loading = listing.loading;
  const loadError = listing.error;
  const refresh = async () => listingActions.refreshNow();
  useEffect(() => {
    let active = true;
    setContext(emptyData());
    if (outletId) crewService.cashCheckoutAdminContext(outletId)
      .then((payload) => { if (active) setContext(normalizeData(payload)); })
      .catch(() => { if (active) setContext(emptyData()); });
    return () => { active = false; };
  }, [outletId]);

  async function afterSettingsSaved(close) {
    let readbackOk = true;
    try {
      const payload = await crewService.cashCheckoutAdminContext(outletId);
      setContext(normalizeData(payload));
      await refresh();
    } catch {
      readbackOk = false;
    }
    close();
    return readbackOk;
  }

  async function review(checkout, decision, note = "Reviewed and approved") {
    try { await crewService.reviewCashCheckout(checkout.id, decision, note); setSelected(null); await Promise.all([refresh(), crewService.cashCheckoutAdminContext(outletId).then((payload) => setContext(normalizeData(payload)))]); ui.notify({ title: `Cash Checkout ${decision === "approve" ? "completed" : decision === "cancel" ? "cancelled" : "returned"}`, message: "The audit trail and deposit ledger remain server-controlled." }); }
    catch (cause) { ui.notify({ title: "Unable to review Cash Checkout", message: cause.message, tone: "error" }); throw cause; }
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

  const reviewCount = useMemo(() => data.checkouts.filter((item) => item.status === "submitted").length + data.collections.filter((item) => item.status === "review_required").length, [data]);
  return <div className="space-y-4">
    <PageHeader
      section="Crew · Operations"
      title="Cash Checkout"
      description="Reconcile daily outlet cash separately from the auditable Cash Deposit ledger."
      secondaryActions={<div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={!outletId} onClick={() => setFloatOpen(true)}><WalletCards size={16} /> Floating Cash</button>{canManage ? <button className="btn-secondary" disabled={!outletId} onClick={() => setSettingsOpen(true)}><Settings2 size={16} /> Settings</button> : null}</div>}
      primaryActions={tab === "deposit" && canCollect ? <button className="btn-primary" onClick={() => setCollectionOpen(true)}><HandCoins size={16} /> Hand Over Cash</button> : null}
    />
    <AdminSegmentedControl value={tab} onChange={setTab} label="Cash Checkout sections" options={[{ value: "checkout", label: "Daily Checkout" }, { value: "deposit", label: "Cash Deposit" }]} />
    <AdminFilterToolbar
      ariaLabel="Cash Checkout filters"
      outlet={<AdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((item) => ({ value: item.id, label: item.name }))} />}
      period={<FeedXDateRangePicker from={from} to={to} today={localDate()} onApply={({ from: nextFrom, to: nextTo }) => { setFrom(nextFrom); setTo(nextTo); }} />}
    />
    {data.previous_unresolved?.length > 0 && <AdminDataSection title="Previous Day · Action Required" description="Continue the original checkout from its business date. Earlier checkouts must be completed or cancelled before a later checkout can complete.">{data.previous_unresolved.map((row) => <button key={row.id} className="btn-secondary mr-2 mb-2" onClick={async () => { try { const result = await crewService.cashCheckoutAdminPage({ outletId, from: row.business_date, to: row.business_date }); setSelected(result.rows.find((item) => item.id === row.id)); } catch (cause) { ui.notify({ title: "Unable to open checkout", message: cause.message, tone: "error" }); } }}>{date(row.business_date)} · {formatCrewEmployee(row.checked_out_by)} · {row.is_returned ? "Returned" : row.status === "submitted" ? "Needs Review" : "In Progress"} · Continue</button>)}</AdminDataSection>}
    <AsyncDataSurface loading={loading} error={loadError} errorTitle="Unable to load Cash Checkout" hasData={tab === "checkout" ? data.checkouts.length > 0 : data.ledger.length > 0 || data.collections.length > 0} isEmpty={listing.hasLoaded && listing.loadedTotal === 0 && !data.collections.length} emptyTitle={tab === "checkout" ? "No Cash Checkouts" : "No Cash Deposit activity"} emptyDescription={tab === "checkout" ? "No checkout records match this outlet and date range." : "No deposit ledger or handover records match this outlet and date range."} emptyIcon={Banknote} onRetry={listingActions.retry}>{tab === "checkout" ? <>
      <AdminSummaryGrid ariaLabel="Cash checkout summary" items={[{ label: "Floating Cash", value: data.settings ? money(data.settings.effective_floating_cash ?? data.settings.floating_cash) : "Not configured", helper: data.settings ? "Current effective outlet amount" : "Set this before Crew can reconcile opening cash", icon: WalletCards }, { label: "Completed", value: data.checkouts.filter((item) => item.status === "completed").length, helper: "Selected period", icon: CheckCircle2, tone: "success" }, { label: "In Progress", value: data.checkouts.filter((item) => item.status !== "completed" && item.status !== "cancelled").length, helper: "Draft through submitted", icon: History, tone: "warning" }, { label: "Needs Review", value: reviewCount, helper: "Submitted for Manager decision or receipt difference", icon: Banknote, tone: reviewCount ? "warning" : "success" }]} />
      <AdminDataSection className="crew-cash-table"><DataTable density="compact" tableClassName="min-w-[1080px]" rows={data.checkouts} getRowKey={(row) => row.id} columns={[
        { key: "date", header: "Date & time", render: (row) => <AdminDateTimeCell {...checkoutDateTime(row)} /> },
        { key: "crew", header: "Checked Out By", render: (row) => <span className="font-semibold text-text-primary">{formatCrewEmployee(row.checked_out_by)}</span> },
        { key: "opening", header: "Opening", align: "right", render: (row) => money(row.expected_opening_cash) },
        { key: "counted", header: "Counted", align: "right", render: (row) => money(row.counted_cash) },
        { key: "pos", header: "POS Expected", align: "right", render: (row) => row.pos_expected_cash == null ? "—" : money(row.pos_expected_cash) },
        { key: "variance", header: "Variance", align: "right", render: (row) => <Badge tone={semanticStatusTone(row.reconciliation_status)}>{row.variance == null ? "—" : `${row.variance > 0 ? "+" : ""}${money(row.variance)}`}</Badge> },
        { key: "carry", header: "Carry Forward", align: "right", render: (row) => money(row.carry_forward) },
        { key: "deposit", header: "For Deposit", align: "right", render: (row) => <strong>{money(row.amount_for_deposit)}</strong> },
        { key: "status", header: "Status", render: (row) => <Badge tone={row.is_returned ? "warning" : semanticStatusTone(row.status === "submitted" ? "review_required" : row.status)}>{row.is_previous_day ? `Previous Day · Action Required · ${row.is_returned ? "Returned" : row.status === "submitted" ? "Needs Review" : "In Progress"}` : row.is_returned ? "Returned · Action Required" : row.status === "submitted" ? "Needs Review" : statusLabel(row.status)}</Badge> },
        { key: "actions", header: "Actions", align: "right", render: (row) => <button className="icon-btn h-9 w-9" aria-label={`View checkout ${date(row.business_date)}`} onClick={() => setSelected(row)}><Eye size={16} /></button> },
      ]} /><AdminPagination {...checkoutListing} onPageChange={checkoutActions.requestPage} onPageSizeChange={checkoutActions.requestPageSize} noun="cash checkouts" /></AdminDataSection>
    </> : <>
      <AdminSummaryGrid ariaLabel="Cash deposit summary" items={[{ label: "Cash Deposit Balance", value: money(data.summary.current_balance), helper: "Canonical append-only ledger balance", icon: WalletCards, emphasis: true }, { label: "Pending Confirmation", value: money(data.summary.pending_handover ?? 0), helper: "Already deducted; confirmation is audit-only", icon: HandCoins, tone: Number(data.summary.pending_handover) ? "warning" : "neutral" }, { label: "Total Collected", value: money(data.summary.total_collected), helper: "Submitted collections", icon: History }]} />
      <AdminDataSection title="Deposit Ledger" description="Append-only checkout, handover, and correction activity." actions={<button className="btn-secondary" onClick={copySummary}><Clipboard size={15} /> Copy Summary</button>}><DataTable density="compact" tableClassName="min-w-[860px]" rows={data.ledger} getRowKey={(row) => row.id} columns={[
        { key: "date", header: "Date & time", render: (row) => <AdminDateTimeCell {...ledgerDateTime(row.occurred_at)} /> }, { key: "activity", header: "Activity", render: (row) => <span className="grid gap-0.5"><strong>{ledgerActivity(row)}</strong>{ledgerActor(row) !== "—" && <small className="text-xs text-text-muted">{ledgerActor(row)}</small>}</span> },
        { key: "amount", header: "Amount", align: "right", render: (row) => Number(row.amount_in) ? <span className="font-semibold text-emerald-700">+{money(row.amount_in)}</span> : Number(row.amount_out) ? <span className="font-semibold text-slate-700">−{money(row.amount_out)}</span> : "—" },
        { key: "balance", header: "Balance", align: "right", render: (row) => <strong>{money(row.balance)}</strong> },
        { key: "receiver", header: "Receiver", render: (row) => ledgerActor(row) },
        { key: "recorded", header: "Recorded By", render: (row) => formatCrewEmployee(row.recorded_by) },
      ]} /><AdminPagination {...ledgerListing} onPageChange={ledgerActions.requestPage} onPageSizeChange={ledgerActions.requestPageSize} noun="ledger entries" /></AdminDataSection>
      {data.collections.some((item) => ["pending_receipt", "review_required"].includes(item.status)) && <AdminDataSection title="Handover Status"><DataTable density="compact" rows={data.collections.filter((item) => ["pending_receipt", "review_required"].includes(item.status))} getRowKey={(row) => row.id} columns={[{ key: "receiver", header: "Receiver", render: (row) => row.receiver_name }, { key: "amount", header: "Handed Over", render: (row) => money(row.amount) }, { key: "received", header: "Received", render: (row) => row.received_amount ? money(row.received_amount) : "Awaiting confirmation" }, { key: "status", header: "Status", render: (row) => <Badge tone={semanticStatusTone(row.status)}>{statusLabel(row.status)}</Badge> }, { key: "action", header: "Action", align: "right", render: (row) => row.status === "review_required" && canReview ? <button className="btn-secondary" onClick={() => reviewCollection(row, refresh, ui)}>Review Difference</button> : null }]} /></AdminDataSection>}
    </>}</AsyncDataSurface>
    {selected && <CheckoutDetail row={selected} canReview={canReview} canManage={canManage} onReview={review} onChanged={refresh} ui={ui} onClose={() => setSelected(null)} />}
    {settingsOpen && <CashSettings initial={data.settings || {}} positions={data.checkout_positions} employees={data.employees} approvedReceivers={data.eligible_receivers} receiverConfiguration={data.receiver_configuration} outletId={outletId} onClose={() => setSettingsOpen(false)} onSaved={() => afterSettingsSaved(() => setSettingsOpen(false))} ui={ui} />}
    {floatOpen && <FloatingCash initial={data.settings || {}} outletId={outletId} canManage={canManage} onClose={() => setFloatOpen(false)} onHistory={() => { setFloatOpen(false); setFloatHistoryOpen(true); }} onSaved={() => afterSettingsSaved(() => setFloatOpen(false))} ui={ui} />}
    {floatHistoryOpen && <FloatingCashHistory history={data.float_history} onClose={() => setFloatHistoryOpen(false)} />}
    {collectionOpen && <CollectionForm outletId={outletId} employees={data.eligible_receivers} balance={data.summary.current_balance} onClose={() => setCollectionOpen(false)} onSaved={async () => { setCollectionOpen(false); await refresh(); }} ui={ui} />}
  </div>;
}

function CheckoutDetail({ row, canReview, canManage, onReview, onChanged, ui, onClose }) {
  const counts = Object.entries(row.denomination_counts || {}).filter(([, qty]) => Number(qty) > 0);
  const [correcting, setCorrecting] = useState(false);
  const [returning, setReturning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const approve = async () => { if (reviewing) return; setReviewing(true); try { await onReview(row, "approve"); } catch {} finally { setReviewing(false); } };
  return <Modal title={`Cash Checkout · ${date(row.business_date)}`} description={`${formatCrewEmployee(row.checked_out_by)} · ${statusLabel(row.status)}`} size="xl" onClose={onClose} footer={<div className="flex w-full justify-between"><span>{canReview && !["completed", "cancelled"].includes(row.status) && <button className="btn-secondary" disabled={reviewing} onClick={() => setCancelling(true)}>Cancel Checkout</button>}{canManage && row.status === "completed" ? <button className="btn-secondary" onClick={() => setCorrecting(true)}>Record Correction</button> : null}</span><span className="flex gap-2">{canReview && row.status === "submitted" ? <><button className="btn-secondary" disabled={reviewing} onClick={() => setReturning(true)}>Return</button><button className="btn-primary" disabled={reviewing} onClick={approve}>{reviewing ? "Completing…" : "Approve & Complete"}</button></> : <button className="btn-secondary" onClick={onClose}>Close</button>}</span></div>}>
    <div className="grid gap-3 sm:grid-cols-3"><Detail label="Expected Opening" value={money(row.expected_opening_cash)} /><Detail label="Counted Cash" value={money(row.counted_cash)} /><Detail label="POS Expected" value={row.pos_expected_cash == null ? "—" : money(row.pos_expected_cash)} /><Detail label="Variance" value={row.variance == null ? "—" : money(row.variance)} /><Detail label="Carry Forward" value={money(row.carry_forward)} /><Detail label="For Deposit" value={money(row.amount_for_deposit)} /></div>
    {row.float_shortfall > 0 && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Float shortfall: {money(row.float_shortfall)}</p>}
    {(row.variance_reason || row.opening_variance_reason) && <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm"><strong>Recorded reasons</strong>{row.opening_variance_reason && <p>Opening: {row.opening_variance_reason}</p>}{row.variance_reason && <p>Reconciliation: {row.variance_reason}</p>}</div>}
    <div className="mt-5"><h3 className="font-semibold">Denomination Count</h3><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">{counts.length ? counts.map(([denomination, qty]) => <div className="rounded-lg border border-border p-2 text-sm" key={denomination}><small className="text-text-muted">RM{denomination}</small><strong className="block">× {qty}</strong></div>) : <p className="text-sm text-text-muted">No denomination quantities recorded.</p>}</div></div>
    {row.is_previous_day && <p role="status" className="mt-4 rounded-xl border border-amber-200 p-3"><strong>Previous Day · Action Required</strong> · {date(row.business_date)}<br />{row.status === "submitted" ? "Manager decision required; the submitting Crew can correct it after Return." : "Continue with the submitting Crew in the existing Count → Allocate → Confirm workflow."}</p>}
    {!!row.previous_unresolved?.length && <p role="status" className="mt-4 rounded-xl border border-amber-200 p-3">Complete or cancel earlier checkouts before approving this checkout.</p>}
    {row.basis_review_required && <p role="status" className="mt-4 rounded-xl border border-amber-200 p-3"><strong>Opening basis · Review Required</strong><br />An earlier resolution changed the carry basis to {money(row.resolved_carry)}. The recorded opening evidence is unchanged; approval records the Manager review.</p>}
    {row.cancellation && <p className="mt-4 rounded-xl border border-border p-3"><strong>Cancelled</strong><br />{row.cancellation.reason}<br />{row.cancellation.actor_name} · {formatCrewOperationalDateTime(row.cancellation.occurred_at)}</p>}
    {row.is_returned && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><strong>Returned · Action Required</strong><p>{row.return_reason}</p></div>}
    {!!row.review_history?.length && <section className="mt-5" aria-label="Review History"><h3 className="font-semibold">Review History</h3><ol className="mt-2 space-y-3">{row.review_history.map((event, index) => <li key={event.id || index} className="border-l-2 border-border pl-3 text-sm"><strong>{{ submitted: "Submitted", resubmitted: "Resubmitted", returned: "Returned to Crew", approved: "Approved & Completed", completed: "Completed", cancelled: "Cancelled", basis_changed: "Opening basis · Review Required", basis_reviewed: "Opening basis reviewed" }[event.event]}</strong><p>{event.actor_name} · {formatCrewOperationalDateTime(event.occurred_at)}</p>{event.reason && <p>{event.reason}</p>}</li>)}</ol></section>}
    <CrewCashAllocationAudit checkout={row} />
    {cancelling && <ReturnCheckout cancel onClose={() => setCancelling(false)} onReturn={(reason) => onReview(row, "cancel", reason)} />}
    {returning && <ReturnCheckout onClose={() => setReturning(false)} onReturn={(reason) => onReview(row, "reject", reason)} /> }
    {correcting && <Correction checkout={row} onClose={() => setCorrecting(false)} onSaved={async () => { setCorrecting(false); onClose(); await onChanged(); }} ui={ui} />}
  </Modal>;
}

function Detail({ label, value }) { return <div className="rounded-xl border border-border p-3"><small className="text-text-muted">{label}</small><strong className="mt-1 block">{value}</strong></div>; }

function CashSettings({ initial, positions, employees, approvedReceivers, receiverConfiguration, outletId, onClose, onSaved, ui }) {
  const [form, setForm] = useState({ variance_tolerance: initial.variance_tolerance ?? 0, required_position_ids: initial.required_position_ids || [], allow_authorized_management_checkout: initial.allow_authorized_management_checkout ?? false, closing_deadline: initial.closing_deadline || "", require_receiver_confirmation: initial.require_receiver_confirmation ?? true, require_manager_review_over_tolerance: initial.require_manager_review_over_tolerance ?? true });
  const [saving, setSaving] = useState(false);
  const [receiverIds, setReceiverIds] = useState(() => approvedReceivers.map((item) => item.id));
  const positionOptions = positions.map((position) => ({ value: position.id, label: `${position.name}${position.status === "inactive" ? " (Inactive)" : ""}` }));
  const receiverOptions = employees.map((item) => ({ value: item.id, label: `${item.name} · ${item.position || "Crew"}${item.workplace === "Management" ? " · Management" : ""}` }));
  const receiversChanged = !sameIds(receiverIds, approvedReceivers.map((item) => item.id));
  const settingsChanged = Number(form.variance_tolerance) !== Number(initial.variance_tolerance ?? 0) || !sameIds(form.required_position_ids, initial.required_position_ids || []) || form.allow_authorized_management_checkout !== (initial.allow_authorized_management_checkout ?? false) || form.closing_deadline !== (initial.closing_deadline || "") || form.require_receiver_confirmation !== (initial.require_receiver_confirmation ?? true) || form.require_manager_review_over_tolerance !== (initial.require_manager_review_over_tolerance ?? true);
  async function submit(event) {
    event.preventDefault();
    if (!settingsChanged && !receiversChanged) { onClose(); return; }
    setSaving(true);
    let rulesSaved = false;
    try {
      if (settingsChanged) { await crewService.saveCashSettings(outletId, form); rulesSaved = true; }
      if (receiversChanged) await crewService.saveCashHandoverReceivers(outletId, receiverIds, Number(receiverConfiguration?.version || 0));
      const readbackOk = await onSaved();
      ui.notify({ title: readbackOk ? "Cash settings saved" : "Cash settings saved; refresh unavailable", message: readbackOk ? "Outlet checkout rules and handover receivers are up to date." : "Reload the page to verify the saved values.", tone: readbackOk ? undefined : "warning" });
    } catch (cause) {
      if (rulesSaved) await onSaved();
      ui.notify({ title: rulesSaved ? "Checkout rules saved; receivers not updated" : "Unable to save settings", message: cause.message, tone: "error" });
    } finally { setSaving(false); }
  }
  return <Modal title="Cash Checkout Settings" description="Outlet checkout rules, eligibility, handover and review. Floating Cash is managed separately." size="lg" onClose={onClose} bodyClassName="pb-5" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving} form="cash-settings" type="submit">{saving ? "Saving…" : "Save Settings"}</button></>}>
    <form id="cash-settings" onSubmit={submit} className="space-y-7">
      <SettingsSection title="Checkout Rules" description="Set the variance threshold and operational closing reference for this outlet.">
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField label="Variance Tolerance (RM)" helper="Sets the amount allowed before the review rule applies." value={form.variance_tolerance} onChange={(value) => setForm({ ...form, variance_tolerance: value })} min="0" />
          <AdminFormField label="Closing Deadline" helper="Operational reference only; this currently does not block checkout."><input className="control h-10" type="time" value={form.closing_deadline} onChange={(event) => setForm({ ...form, closing_deadline: event.target.value })} /></AdminFormField>
        </div>
      </SettingsSection>
      <SettingsSection title="Checkout Eligibility" description="Crew positions and authorized Management are configured separately.">
        <MultiSelectField variant="form" label="Checkout Positions" helper="Uses canonical Job Positions. Leaving this empty allows all otherwise eligible Crew in the outlet." value={form.required_position_ids} options={positionOptions} onApply={(required_position_ids) => setForm({ ...form, required_position_ids })} placeholder="All active positions" />
        <ToggleField checked={form.allow_authorized_management_checkout} onChange={(checked) => setForm({ ...form, allow_authorized_management_checkout: checked })} label="Allow authorized Management to perform Cash Checkout" helper="Active Management must already be authorized for this outlet. This does not grant Initiate Cash Handover or Cash Handover Receiver eligibility." />
      </SettingsSection>
      <SettingsSection title="Handover" description="Control receipt acknowledgement and who can receive new Cash Handovers.">
        <div className="space-y-4">
          <ToggleField checked={form.require_receiver_confirmation} onChange={(checked) => setForm({ ...form, require_receiver_confirmation: checked })} label="Require internal receiver confirmation" helper="Internal handovers remain pending until the named receiver confirms receipt." />
          <MultiSelectField variant="form" label="Cash Handover Receivers" helper="Select active Crew at this outlet or active Management authorized for this outlet. Initiate Cash Handover access is separate. Removing a receiver does not change existing assignments." value={receiverIds} options={receiverOptions} onApply={setReceiverIds} placeholder="Add eligible receiver" />
        </div>
      </SettingsSection>
      <SettingsSection title="Review Rules" description="When checkout must pause for manager review.">
        <ToggleField checked={form.require_manager_review_over_tolerance} onChange={(checked) => setForm({ ...form, require_manager_review_over_tolerance: checked })} label="Require review when variance exceeds tolerance" helper="Variances above the configured tolerance stay in review before completion." />
      </SettingsSection>
    </form>
  </Modal>;
}

function FloatingCash({ initial, outletId, canManage, onClose, onHistory, onSaved, ui }) {
  const currentAmount = Number(initial.effective_floating_cash ?? initial.floating_cash ?? 0);
  const [form, setForm] = useState({ floating_cash: currentAmount, effective_date: localDate(), reason: "" });
  const [saving, setSaving] = useState(false);
  const amountChanged = Number(form.floating_cash) !== currentAmount;
  async function submit(event) {
    event.preventDefault();
    if (!amountChanged) { onClose(); return; }
    if (!form.reason.trim()) { ui.notify({ title: "Reason required", message: "Add a reason before changing Floating Cash.", tone: "error" }); return; }
    setSaving(true);
    try {
      await crewService.saveCashSettings(outletId, { floating_cash: form.floating_cash, effective_date: form.effective_date, reason: form.reason });
      const readbackOk = await onSaved();
      ui.notify({ title: readbackOk ? "Floating Cash change recorded" : "Change recorded; refresh unavailable", message: readbackOk ? "The adjustment is available in Floating Cash History." : "Reload the page to verify the effective amount and history.", tone: readbackOk ? undefined : "warning" });
    } catch (cause) { ui.notify({ title: "Unable to change Floating Cash", message: cause.message, tone: "error" }); }
    finally { setSaving(false); }
  }
  return <Modal title="Floating Cash" description="Outlet opening float. Changes create immutable adjustment history." size="lg" onClose={onClose} footer={<div className="flex w-full flex-wrap items-center justify-between gap-2"><button className="btn-secondary" onClick={onHistory}><History size={16} /> View History</button><div className="flex gap-2"><button className="btn-secondary" onClick={onClose}>Close</button>{canManage ? <button className="btn-primary" disabled={saving || !amountChanged} form="floating-cash-change" type="submit">{saving ? "Recording…" : "Record Change"}</button> : null}</div></div>}>
    <p className="mb-5 rounded-xl border border-border bg-surface-subtle px-4 py-3 text-sm text-text-secondary">Current effective amount: <strong className="text-text-primary">{money(currentAmount)}</strong></p>
    {canManage ? <form id="floating-cash-change" onSubmit={submit} className="space-y-4">
      <MoneyField label="Floating Cash (RM)" value={form.floating_cash} onChange={(value) => setForm({ ...form, floating_cash: value })} min="0" />
      <DatePickerField label="Effective Date" helper="The new amount applies from this date." value={form.effective_date} onChange={(value) => setForm({ ...form, effective_date: value })} />
      {amountChanged ? <AdminFormField label="Reason for change" required><textarea className="control min-h-20" required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Explain why the effective amount is changing" /></AdminFormField> : null}
    </form> : null}
  </Modal>;
}

function FloatingCashHistory({ history, onClose }) {
  return <Modal title="Floating Cash History" description="Immutable outlet adjustments. Saving checkout settings does not change these records." size="lg" onClose={onClose} footer={<button className="btn-secondary" onClick={onClose}>Close</button>}>
    {history.length ? <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">{history.map((item) => <div className="grid gap-1 px-3 py-3 text-sm sm:grid-cols-[112px_150px_minmax(0,1fr)_auto]" key={item.id}><span className="text-text-secondary">{date(item.effective_date)}</span><strong>{money(item.previous_amount)} → {money(item.new_amount)}</strong><span className="truncate text-text-secondary">{item.reason || "—"}</span><span className="text-text-muted">{formatCrewEmployee(item.adjusted_by)}</span></div>)}</div> : <p className="text-sm text-text-muted">No Floating Cash adjustments recorded.</p>}
  </Modal>;
}

function SettingsSection({ title, description, children }) { return <section><div className="mb-3"><h3 className="text-sm font-semibold text-text-primary">{title}</h3><p className="mt-0.5 text-xs text-text-secondary">{description}</p></div>{children}</section>; }

function CollectionForm({ outletId, employees, balance, onClose, onSaved, ui }) {
  const [form, setForm] = useState({ request_id: crypto.randomUUID(), receiver_employee_id: "", amount: "", purpose: CASH_HANDOVER_PURPOSE, note: "" }); const [saving, setSaving] = useState(false);
  async function submit(event) { event.preventDefault(); setSaving(true); try { await crewService.recordAdminCashCollection(outletId, form); await onSaved(); ui.notify({ title: "Cash Handover submitted", message: "The Cash Deposit Balance was updated immediately." }); } catch (cause) { ui.notify({ title: "Unable to record handover", message: cause.message, tone: "error" }); } finally { setSaving(false); } }
  const employeeOptions = employees.map((item) => ({ value: item.id, label: `${item.name} · ${item.position}` }));
  return <Modal title="Hand Over Cash" description={`Cash Deposit Balance: ${money(balance)}`} onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button form="collection-form" type="submit" className="btn-primary" disabled={saving || !form.receiver_employee_id}>{saving ? "Saving…" : "Confirm Handover"}</button></>}><form id="collection-form" className="space-y-4" onSubmit={submit}><SelectField label="Receiver" required searchable value={form.receiver_employee_id} options={employeeOptions} placeholder="Select approved receiver" onChange={(receiver_employee_id) => setForm({ ...form, receiver_employee_id })} /><p className="-mt-2 rounded-xl bg-primary/5 px-3 py-2 text-xs text-text-secondary">Only Admin-configured Cash Deposit Receivers can be selected. Confirmation is acknowledgement only.</p><MoneyField label="Amount (RM)" required value={form.amount} min="0.05" max={Number(balance || 0)} onChange={(amount) => setForm({ ...form, amount })} /><Field label="Note (optional)"><textarea className="control min-h-20" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field></form></Modal>;
}

function Correction({ checkout, onClose, onSaved, ui }) {
  const [form, setForm] = useState({ action: "allocation", carry: String(checkout.carry_forward), amount: "", reason: "" });
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const allocatable = Number(checkout.carry_forward) + Number(checkout.amount_for_deposit);
  const change = (key, value) => { setForm((current) => ({ ...current, [key]: value })); setRequestId(crypto.randomUUID()); };
  async function submit(event) {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setSaving(true);
    try {
      if (form.action === "allocation") await crewService.correctCashCheckoutAllocation(checkout.id, form.carry, checkout.allocation_correction_id || null, requestId, form.reason);
      else await crewService.adjustCashCheckout(checkout.id, form.action, form.action === "reversal" ? null : form.amount, form.reason);
      await onSaved(); ui.notify({ title: "Correction recorded", message: "The original completed checkout remains immutable." });
    } catch (cause) { ui.notify({ title: "Unable to record correction", message: cause.message, tone: "error" }); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <Modal title="Record Cash Correction" description="Appends audited correction evidence; the completed checkout remains immutable." onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" type="submit" form="cash-correction" disabled={saving}>{saving ? "Saving…" : "Record Correction"}</button></>}>
    <form id="cash-correction" onSubmit={submit} className="space-y-4">
      <SelectField label="Action" disabled={saving} value={form.action} options={[{ value: "allocation", label: "Correct Allocation" }, { value: "adjustment", label: "Ledger Adjustment" }, { value: "reversal", label: "Reversal" }]} onChange={(value) => change("action", value)} />
      {form.action === "allocation" && <>
        <p>Current allocation: Carry Forward {money(checkout.carry_forward)} · For Deposit {money(checkout.amount_for_deposit)}</p>
        <AdminFormField label="Carry Forward to Next Day (RM)" required><input aria-label="Carry Forward to Next Day (RM)" className="control h-10" required disabled={saving} type="number" min="0" max={allocatable} step="0.01" value={form.carry} onChange={(event) => change("carry", event.target.value)} /></AdminFormField>
        <p>For Deposit: {money(allocatable - Number(form.carry))}</p>
        <p className="text-xs text-text-muted">Counted cash, Floating Cash, POS Expected and Variance are preserved. The linked Cash Deposit adjustment is recorded together with this allocation correction.</p>
      </>}
      {form.action === "adjustment" && <MoneyField label="Signed Amount (RM)" required value={form.amount} onChange={(value) => change("amount", value)} helper="Use a negative value for deduction." />}
      <Field label="Reason" required><textarea aria-label="Reason" className="control min-h-24" disabled={saving} required minLength={3} maxLength={500} value={form.reason} onChange={(event) => change("reason", event.target.value)} /></Field>
      <p className="text-xs text-text-muted">Correction evidence cannot be edited or removed.</p>
    </form>
  </Modal>;
}

async function reviewCollection(row, refresh, ui) { const note = window.prompt(`Received ${money(row.received_amount)} vs handed over ${money(row.amount)}. Enter review note:`); if (!note) return; const approve = window.confirm("Approve the received amount? The deposit balance remains unchanged."); try { await crewService.reviewCashCollection(row.id, approve ? "approve" : "reject", note); await refresh(); ui.notify({ title: approve ? "Collection completed" : "Collection cancelled", message: "The receipt difference remains in the audit trail; balance was already updated at submission." }); } catch (cause) { ui.notify({ title: "Unable to review collection", message: cause.message, tone: "error" }); } }
function Field({ label, children, required = false }) { return <AdminFormField label={label} required={required}>{children}</AdminFormField>; }
function MoneyField({ label, value, onChange, min, max, required = false, helper }) { return <AdminFormField label={label} required={required} helper={helper}><input aria-label={label} className="control h-10" required={required} type="number" min={min} max={max} step="0.05" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} /></AdminFormField>; }

function ReturnCheckout({ onClose, onReturn, cancel = false }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  async function submit(event) {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setSaving(true);
    try { await onReturn(reason.trim()); } catch {} finally { inFlight.current = false; setSaving(false); }
  }
  return <Modal title={cancel ? "Cancel Checkout" : "Return Cash Checkout"} description={cancel ? "End this unresolved checkout. Its financial evidence remains in History, with your reason and audit. No deposit or carry-forward will be created." : "The checkout will be sent back to the submitting Crew for correction. The same checkout and its submitted financial evidence will be preserved."} onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" type="submit" form="return-cash-checkout" disabled={saving || reason.trim().length < 3}>{saving ? cancel ? "Saving…" : "Returning…" : cancel ? "Cancel Checkout" : "Return to Crew"}</button></>}><form id="return-cash-checkout" onSubmit={submit}><AdminFormField label="Reason" required><textarea className="control min-h-24" aria-label="Reason" required minLength={3} maxLength={500} disabled={saving} value={reason} onChange={(event) => setReason(event.target.value)} /></AdminFormField></form></Modal>;
}
