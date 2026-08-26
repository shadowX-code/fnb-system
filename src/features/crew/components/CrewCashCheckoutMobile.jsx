import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowRight, ArrowUp, Banknote, CalendarCheck, Check, ChevronRight, HandCoins, History, Minus, Plus, RefreshCw, ShieldCheck, WalletCards, X } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewEmptyState, CrewStatusBadge } from "./CrewMobileUI.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { formatCrewEmployee, formatCrewMoney, formatCrewOperationalDate, formatCrewOperationalDateTime, formatCrewTime } from "../utils/crewI18n.js";

const DENOMINATION_GROUPS = [
  { key: "notes", values: [100, 50, 20, 10, 5, 1] },
  { key: "coins", values: [0.5, 0.2, 0.1, 0.05] },
];
const DENOMINATIONS = DENOMINATION_GROUPS.flatMap((group) => group.values);
const denominationKey = (value) => value < 1 ? value.toFixed(2) : String(value);
const money = (value) => formatCrewMoney(value);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
const time = (value) => formatCrewTime(value, { hour12: true });
const initialDraft = (checkout, cashContext, settings) => ({
  actual_opening_cash: checkout?.actual_opening_cash ?? cashContext?.expected_opening_cash ?? settings?.floating_cash ?? "",
  opening_variance_reason: checkout?.opening_variance_reason || "",
  denomination_counts: checkout?.denomination_counts || {},
  pos_expected_cash: checkout?.pos_expected_cash ?? "",
  carry_forward: checkout?.carry_forward ?? 0,
  variance_reason: checkout?.variance_reason || "",
});

export default function CrewCashCheckoutMobile({ token, onBack, onFlowChange, onNotify }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(initialDraft(null, null));
  const [step, setStep] = useState("count");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const result = await crewService.cashCheckoutMobile(token, today());
      setData(result); setDraft(initialDraft(result?.checkout, result?.cash_context, result?.settings));
      if (result?.checkout?.status === "completed") setStep("complete");
      else if (result?.checkout?.status === "submitted") setStep("confirm");
      else if (result?.checkout?.status === "reconciled") setStep("allocate");
    } catch (cause) { setError(cause.message || t("cash.unableLoad")); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [token]);
  useEffect(() => () => onFlowChange?.(false), [onFlowChange]);

  const counted = useMemo(() => DENOMINATIONS.reduce((sum, denomination) => sum + denomination * Number(draft.denomination_counts[denominationKey(denomination)] || 0), 0), [draft.denomination_counts]);
  const posExpected = draft.pos_expected_cash === "" ? null : Number(draft.pos_expected_cash);
  const variance = posExpected == null ? null : counted - posExpected;
  const carry = Number(draft.carry_forward || 0);
  const completed = data?.checkout?.status === "completed";
  const cashContext = data?.cash_context || {};
  const floating = Number(cashContext.floating_cash ?? data?.settings?.floating_cash ?? 0);
  const previousCarry = Number(cashContext.previous_carry_forward ?? data?.checkout?.previous_carry_forward ?? 0);
  const expectedOpening = Number(cashContext.expected_opening_cash ?? data?.checkout?.expected_opening_cash ?? floating + previousCarry);
  const deposit = Math.max(0, counted - floating - carry);
  const requiresReview = Math.max(0, floating - counted) > 0 || (variance != null && Math.abs(variance) > Number(data?.settings?.variance_tolerance || 0));
  const checkoutStatus = data?.checkout?.status;
  const checkoutAction = completed ? t("cash.viewDetails") : data?.checkout?.review_required ? t("cash.continueReview") : data?.checkout ? t("cash.continueCheckout") : t("cash.startCheckout");

  async function save(action) {
    setSaving(true); setError("");
    try {
      await crewService.saveCashCheckout(token, action, draft);
      await load();
      setStep(action === "draft" ? "count" : action === "reconcile" ? "allocate" : action === "submit" ? "confirm" : "complete");
      if (action === "draft") onNotify?.({ title: t("cash.draftSaved"), tone: "success" });
    } catch (cause) { const message = cause.message || t("cash.unableSave"); setError(message); onNotify?.({ title: t("cash.unableSave"), message, tone: "error" }); }
    finally { setSaving(false); }
  }

  if (loading && !data) return <section className="crew-cash-mobile"><CrewMobileDetailHeader title={t("cash.title")} onBack={onBack} variant="workflow" /><div className="crew-cash-loading">{t("common.loading")}</div></section>;
  if (error && !data) return <section className="crew-cash-mobile"><CrewMobileDetailHeader title={t("cash.title")} onBack={onBack} variant="workflow" /><CrewEmptyState title={t("cash.unableLoad")} body={error} /><button className="crew-mobile-secondary" type="button" onClick={load}><RefreshCw size={17} />{t("common.retry")}</button></section>;

  const openFlow = () => { setFlowOpen(true); onFlowChange?.(true); };
  const closeFlow = () => { setFlowOpen(false); onFlowChange?.(false); };

  if (showDetails && completed) return <CheckoutDetails checkout={data.checkout} onBack={() => setShowDetails(false)} />;
  if (ledgerOpen) return <CashLedger data={data} onBack={() => setLedgerOpen(false)} onCollection={() => { setLedgerOpen(false); setCollectionOpen(true); }} />;
  if (flowOpen) return <CheckoutFlow data={data} draft={draft} setDraft={setDraft} step={step} setStep={setStep} counted={counted} posExpected={posExpected} variance={variance} deposit={deposit} floating={floating} previousCarry={previousCarry} expectedOpening={expectedOpening} requiresReview={requiresReview} saving={saving} error={error} onBack={closeFlow} onSave={save} />;

  return <section className="crew-cash-mobile crew-cash-summary-page">
    <CrewMobileDetailHeader title={t("cash.title")} onBack={onBack} variant="workflow" />
    <section className="crew-cash-summary">
      <article className="crew-cash-today-summary"><header><span className="crew-ui-icon-container crew-ui-icon-container--large"><CalendarCheck size={22} /></span><div><small>{data?.business_date ? formatCrewOperationalDate(data.business_date) : t("cash.today")}</small><h2>{t("cash.todayCheckout")}</h2><div className="crew-cash-summary-status"><CrewStatusBadge tone={completed || checkoutStatus === "reconciled" ? "success" : "neutral"}>{data?.checkout ? t(`cash.status.${checkoutStatus}`) : t("cash.notStarted")}</CrewStatusBadge>{data?.checkout?.review_required && <CrewStatusBadge tone="warning">{t("cash.reviewRequired")}</CrewStatusBadge>}</div></div></header><dl><div><dt>{t("cash.floatToKeep")}</dt><dd>{money(floating)}</dd></div><div><dt>{t("cash.previousCarryForward")}</dt><dd>{money(previousCarry)}</dd></div><div><dt>{t("cash.countedCash")}</dt><dd>{data?.checkout ? money(data.checkout.counted_cash) : "—"}</dd></div><div className="is-deposit"><dt>{t("cash.forDeposit")}</dt><dd>{data?.checkout ? money(data.checkout.amount_for_deposit) : "—"}</dd></div></dl><button className="crew-mobile-primary" type="button" onClick={() => completed ? setShowDetails(true) : openFlow()}>{checkoutAction}<ChevronRight size={17} /></button></article>
      <article className="crew-cash-deposit-summary"><span className="crew-ui-icon-container crew-ui-icon-container--large"><HandCoins size={22} /></span><div><small>{t("cash.cashDepositBalance")}</small><strong>{money(data?.deposit?.current_balance)}</strong>{Number(data?.deposit?.pending_confirmation_amount) > 0 && <small>{t("cash.pendingConfirmationAmount", { amount: money(data.deposit.pending_confirmation_amount) })}</small>}</div><button type="button" onClick={() => setLedgerOpen(true)}>{t("cash.viewLedger")}<ChevronRight size={17} /></button></article>
      <CashHandoverAction canInitiate={data?.can_initiate_handover ?? data?.can_record_collection} balance={data?.deposit?.current_balance} onOpen={() => setCollectionOpen(true)} />
    </section>

    {data?.is_cash_handover_receiver && <PendingReceipts rows={data.pending_receipts || []} token={token} onChanged={load} />}

    {completed && <p className="crew-cash-complete-note"><Check size={16} />{t("cash.completedAt", { time: time(data.checkout.completed_at) })}</p>}
    <section className="crew-cash-recent-activity"><header><h2>{t("cash.recentActivity")}</h2></header>{data?.deposit?.recent?.length ? <div>{data.deposit.recent.slice(0, 3).map((row) => <RecentActivityRow key={row.id} row={row} onOpen={() => setLedgerOpen(true)} />)}</div> : <CrewEmptyState title={t("cash.noLedger")} body={t("cash.noLedgerBody")} />}</section>
    {collectionOpen && <CollectionSheet data={data} token={token} onClose={() => setCollectionOpen(false)} onSaved={async () => { setCollectionOpen(false); await load(); }} />}
  </section>;
}

function RecentActivityRow({ row, onOpen, interactive = true }) {
  const { t } = useTranslation();
  const isOut = Number(row.signed_amount) < 0;
  const checkout = row.entry_type === "checkout_due" || !isOut;
  const actor = row.handover_from && row.handover_to ? `${row.handover_from} → ${row.handover_to}` : row.receiver_name || row.recorded_by || row.employee_name;
  const confirmation = row.confirmation_status || (row.status === "pending_receipt" ? "pending_confirmation" : row.status === "completed" && isOut ? "confirmed" : null);
  const activity = checkout ? t("cash.ledgerCheckout") : row.activity || t("cash.ledgerCollection");
  return <article className="crew-cash-activity-row"><span className={`crew-ui-icon-container crew-ui-icon-container--round crew-cash-activity-icon${isOut ? " is-danger" : ""}`}>{isOut ? <ArrowDown size={20} /> : <ArrowUp size={20} />}</span><div className="crew-cash-activity-copy"><strong>{activity}</strong><small>{formatCrewOperationalDateTime(row.occurred_at)}</small>{actor && <small>{formatCrewEmployee(actor)}</small>}{confirmation && <CrewStatusBadge tone={confirmation === "pending_confirmation" ? "warning" : confirmation === "confirmed" ? "success" : "neutral"}>{t(`cash.confirmation.${confirmation}`)}</CrewStatusBadge>}</div><div className="crew-cash-activity-amount"><em className={isOut ? "is-out" : "is-in"}>{isOut ? "−" : "+"}{money(Math.abs(row.signed_amount))}</em><small>{t("cash.ledgerBalance", { amount: money(row.balance_after) })}</small></div>{interactive && <button type="button" aria-label={t("cash.openLedgerEntry", { activity })} onClick={onOpen}><ChevronRight size={18} /></button>}</article>;
}

function CheckoutFlow({ data, draft, setDraft, step, setStep, counted, posExpected, variance, deposit, floating, previousCarry, expectedOpening, requiresReview, saving, error, onBack, onSave }) {
  const { t } = useTranslation();
  return <section className="crew-cash-mobile crew-cash-flow">
    <CrewMobileDetailHeader title={t(`cash.steps.${step}`)} onBack={onBack} variant="workflow" />
    {!data?.can_perform ? <CrewEmptyState title={t("cash.notAssigned")} body={t("cash.notAssignedBody")} /> : <>
      <StepBar step={step} />
      {step === "count" && <CountStep data={data} draft={draft} setDraft={setDraft} expectedOpening={expectedOpening} floating={floating} previousCarry={previousCarry} />}
      {step === "allocate" && <AllocateStep floating={floating} counted={counted} deposit={deposit} draft={draft} setDraft={setDraft} />}
      {step === "confirm" && <ConfirmStep data={data} draft={draft} setDraft={setDraft} counted={counted} variance={variance} deposit={deposit} floating={floating} previousCarry={previousCarry} />}
      {error && <p className="crew-cash-error" role="alert">{error}</p>}
      <footer className={`crew-ui-sticky-actions crew-cash-actions crew-cash-actions-${step}`}>
        {step === "count" && <div className="crew-cash-action-total"><span>{t("cash.countedCash")}</span><strong>{money(counted)}</strong></div>}
        {step === "allocate" && <div className="crew-cash-action-total"><span>{t("cash.forDeposit")}</span><strong>{money(deposit)}</strong></div>}
        {step === "confirm" && <div className="crew-cash-action-total"><span>{t("cash.forDeposit")}</span><strong>{money(deposit)}</strong></div>}
        {step !== "count" && <button type="button" className="crew-mobile-secondary" onClick={() => setStep(step === "confirm" ? "allocate" : "count")} disabled={saving}>{t("common.back")}</button>}
        {step === "count" && <><button type="button" className="crew-mobile-secondary" onClick={() => onSave("draft")} disabled={saving}>{t("cash.saveDraft")}</button><button className="crew-mobile-primary" type="button" onClick={() => onSave("reconcile")} disabled={saving || posExpected == null}>Next: {t("cash.steps.allocate")}<ArrowRight size={16} /></button></>}
        {step === "allocate" && <button className="crew-mobile-primary" type="button" onClick={() => setStep("confirm")} disabled={saving}>Next: {t("cash.steps.confirm")}<ArrowRight size={16} /></button>}
        {step === "confirm" && <button className="crew-mobile-primary" type="button" onClick={() => onSave(requiresReview ? "submit" : "complete")} disabled={saving || (requiresReview && data?.checkout?.status === "submitted")}>{saving ? t("common.saving") : requiresReview && data?.checkout?.status === "submitted" ? t("cash.awaitingReview") : requiresReview ? t("cash.submitForReviewAmount", { amount: money(deposit) }) : t("cash.completeCheckout")}</button>}
      </footer>
    </>}
  </section>;
}

function CashLedger({ data, onBack, onCollection }) {
  const { t } = useTranslation();
  return <section className="crew-cash-mobile crew-cash-details">
    <CrewMobileDetailHeader title={t("cash.depositLedger")} onBack={onBack} />
    <section className="crew-cash-ledger"><header><span className="crew-ui-icon-container crew-ui-icon-container--large"><HandCoins size={22} /></span><div><small className="crew-cash-ledger-balance-label">{t("cash.cashDepositBalance")}</small><h2>{money(data?.deposit?.current_balance)}</h2>{Number(data?.deposit?.pending_confirmation_amount) > 0 && <small className="crew-cash-ledger-pending">{t("cash.pendingConfirmationAmount", { amount: money(data.deposit.pending_confirmation_amount) })}</small>}</div><CashHandoverAction canInitiate={data?.can_initiate_handover ?? data?.can_record_collection} balance={data?.deposit?.current_balance} onOpen={onCollection} /></header>{data?.deposit?.ledger?.length ? <div className="crew-cash-ledger-list">{data.deposit.ledger.map((row) => <RecentActivityRow key={row.id} row={row} interactive={false} />)}</div> : <CrewEmptyState title={t("cash.noLedger")} body={t("cash.noLedgerBody")} />}</section>
  </section>;
}

function CashHandoverAction({ canInitiate, balance, onOpen }) {
  const { t } = useTranslation();
  const disabledReason = !canInitiate
    ? t("cash.handoverUnavailablePermission")
    : Number(balance || 0) <= 0
      ? t("cash.handoverUnavailableNoBalance")
      : null;
  return <div className="crew-cash-handover-action">
    <button className="crew-mobile-primary" type="button" disabled={Boolean(disabledReason)} onClick={onOpen}>{t("cash.handOverCash")}</button>
    {disabledReason && <small>{disabledReason}</small>}
  </div>;
}

function StepBar({ step }) { const { t } = useTranslation(); const steps = ["count", "allocate", "confirm"]; const active = Math.max(0, steps.indexOf(step)); return <nav className="crew-cash-steps" aria-label={t("cash.progress")}><span style={{ width: `${(active / 2) * 100}%` }} />{steps.map((item, index) => <div className={index <= active ? "is-active" : ""} key={item}><i>{index < active ? <Check size={13} /> : index + 1}</i><small>{t(`cash.steps.${item}`)}</small></div>)}</nav>; }

function CountStep({ draft, setDraft, expectedOpening, floating, previousCarry }) {
  const { t } = useTranslation();
  const isMoneyInput = (value) => /^\d*(\.\d{0,2})?$/.test(value);
  const setQuantity = (key, nextQuantity) => {
    const normalized = String(nextQuantity ?? "").trim();
    if (!/^\d*$/.test(normalized)) return;
    setDraft((current) => {
      const denomination_counts = { ...current.denomination_counts };
      if (!normalized) delete denomination_counts[key];
      else denomination_counts[key] = String(Math.max(0, Number.parseInt(normalized, 10) || 0));
      return { ...current, denomination_counts };
    });
  };
  return <section className="crew-cash-card crew-cash-count-card"><header><Banknote size={20} /><div><h2>{t("cash.countCash")}</h2></div></header>
    <div className="crew-cash-opening-summary" aria-label={t("cash.opening")}><div className="crew-cash-opening-source"><span><small>{t("cash.floatToKeep")}</small><strong>{money(floating)}</strong></span><span><small>{t("cash.previousCarryForward")}</small><strong>{money(previousCarry)}</strong></span></div><div className="is-expected"><small>{t("cash.expectedOpening")}</small><strong>{money(expectedOpening)}</strong></div></div>
    <label className="crew-cash-field crew-cash-amount-field">{t("cash.posExpected")}<input inputMode="decimal" pattern="[0-9]*[.]?[0-9]*" type="text" value={draft.pos_expected_cash} onChange={(event) => isMoneyInput(event.target.value) && setDraft({ ...draft, pos_expected_cash: event.target.value })} /></label>
    <div className="crew-cash-denominations" aria-label={t("cash.denominationCount")}>{DENOMINATION_GROUPS.map((group) => <section className="crew-cash-denomination-group" key={group.key}><h3>{t(`cash.${group.key}`)}</h3>{group.values.map((denomination) => { const key = denominationKey(denomination); const quantity = Number(draft.denomination_counts[key] || 0); return <div className="crew-cash-denomination-row" key={key}><b>RM {denomination.toFixed(denomination < 1 ? 2 : 0)}</b><div className="crew-cash-stepper"><button aria-label={`Decrease RM ${denomination}`} type="button" disabled={quantity === 0} onClick={() => setQuantity(key, quantity - 1)}><Minus size={16} /></button><input aria-label={`RM ${denomination}`} inputMode="numeric" pattern="[0-9]*" type="text" value={quantity} onChange={(event) => setQuantity(key, event.target.value)} /><button aria-label={`Increase RM ${denomination}`} type="button" onClick={() => setQuantity(key, quantity + 1)}><Plus size={16} /></button></div><small>{money(denomination * quantity)}</small></div>; })}</section>)}</div></section>;
}

function AllocateStep({ floating, counted, deposit, draft, setDraft }) { const { t } = useTranslation(); const shortfall = Math.max(0, floating - counted); return <section className="crew-cash-card crew-cash-allocation-card"><header><WalletCards size={20} /><div><h2>{t("cash.allocateCash")}</h2><p>{t("cash.allocateHelp")}</p></div></header><dl className="crew-cash-breakdown"><div className="is-source"><dt>{t("cash.countedCash")}</dt><dd>{money(counted)}</dd></div><div className="is-supporting"><dt>{t("cash.floatToKeep")}</dt><dd>{money(Math.min(floating, counted))}</dd></div><div className="is-decision"><dt><span>{t("cash.carryForwardNextCycle")}</span><small>{t("cash.crewDecision")}</small></dt><dd><input aria-label={t("cash.carryForwardNextCycle")} inputMode="decimal" type="number" min="0" max={Math.max(0, counted - floating)} step="0.05" value={draft.carry_forward} disabled={shortfall > 0} onChange={(event) => setDraft({ ...draft, carry_forward: event.target.value })} /></dd></div><div className="is-total"><dt>{t("cash.forDeposit")}</dt><dd>{money(deposit)}</dd></div></dl>{shortfall > 0 && <p className="crew-cash-warning"><strong>{t("cash.managerReview")}</strong>{t("cash.floatShortfall", { amount: money(shortfall) })}</p>}</section>; }

function ConfirmStep({ data, draft, setDraft, counted, variance, deposit, floating, previousCarry }) { const { t } = useTranslation(); const requiresReason = Math.max(0, floating - counted) > 0 || (variance != null && Math.abs(variance) > Number(data.settings.variance_tolerance || 0)); return <section className="crew-cash-card crew-cash-confirm-card"><header><ShieldCheck size={20} /><div><h2>{t("cash.reviewCheckout")}</h2><p>{t("cash.serverCalculated")}</p></div></header><section className="crew-cash-review-section"><h3>{t("cash.reconciliation")}</h3><dl className="crew-cash-breakdown"><div><dt>{t("cash.posExpected")}</dt><dd>{money(draft.pos_expected_cash)}</dd></div><div><dt>{t("cash.countedCash")}</dt><dd>{money(counted)}</dd></div><div><dt>{t("cash.variance")}</dt><dd className={variance === 0 ? "is-balanced" : "is-warning"}>{variance > 0 ? "+" : ""}{money(variance)}</dd></div></dl></section><section className="crew-cash-review-section"><h3>{t("cash.allocation")}</h3><dl className="crew-cash-breakdown"><div><dt>{t("cash.previousCarryForward")}</dt><dd>{money(previousCarry)}</dd></div><div><dt>{t("cash.carryForwardNextCycle")}</dt><dd>{money(draft.carry_forward)}</dd></div><div className="is-total"><dt>{t("cash.forDeposit")}</dt><dd>{money(deposit)}</dd></div></dl></section>{requiresReason && <><p className="crew-cash-warning"><strong>{t("cash.managerReview")}</strong>{data.checkout?.review_required ? t("cash.managerReviewHelp") : t("cash.reasonRequired")}</p><label className="crew-cash-field">{t("cash.varianceReason")}<textarea required value={draft.variance_reason} onChange={(event) => setDraft({ ...draft, variance_reason: event.target.value })} /></label></>}</section>; }

function CheckoutDetails({ checkout, onBack }) { const { t } = useTranslation(); const counts = Object.entries(checkout?.denomination_counts || {}).filter(([, quantity]) => Number(quantity) > 0); const items = [
  [t("cash.expectedOpening"), checkout.expected_opening_cash], [t("cash.countedCash"), checkout.counted_cash], [t("cash.posExpected"), checkout.pos_expected_cash], [t("cash.variance"), checkout.variance],
];
  return <section className="crew-cash-mobile crew-cash-details"><CrewMobileDetailHeader title={t("cash.checkoutDetails")} onBack={onBack} /><header className="crew-cash-detail-heading"><div><CrewStatusBadge tone="success">{t("status.completed")}</CrewStatusBadge><h2>{t("cash.businessDate", { date: formatCrewOperationalDate(checkout.business_date) })}</h2><p>{t("cash.completedAt", { time: formatCrewOperationalDateTime(checkout.completed_at) })}</p></div></header><section className="crew-cash-detail-card"><h3>{t("cash.checkedOutBy")}</h3><strong>{formatCrewEmployee(checkout.checked_out_by)}</strong><small>{checkout.position || t("common.role")}</small></section><DetailSection title={t("cash.cashSummary")} rows={items} /><DetailSection title={t("cash.openingBreakdown")} rows={[[t("cash.floatToKeep"), checkout.floating_cash], [t("cash.carryForward"), checkout.previous_carry_forward], [t("cash.expectedOpening"), checkout.expected_opening_cash]]} /><DetailSection title={t("cash.closingAllocation")} rows={[[t("cash.floatRetained"), checkout.floating_cash], [t("cash.carryForward"), checkout.carry_forward], [t("cash.forDeposit"), checkout.amount_for_deposit]]} /><section className="crew-cash-detail-card"><h3>{t("cash.denominationCount")}</h3>{counts.length ? <div className="crew-cash-detail-denominations">{counts.map(([denomination, quantity]) => <div key={denomination}><span>RM{Number(denomination).toFixed(Number(denomination) < 1 ? 2 : 0)} × {quantity}</span><strong>{money(Number(denomination) * Number(quantity))}</strong></div>)}</div> : <p>{t("cash.noDenominations")}</p>}</section>{(checkout.variance_reason || checkout.opening_variance_reason) && <section className="crew-cash-detail-card"><h3>{t("cash.varianceReason")}</h3><p>{checkout.variance_reason || checkout.opening_variance_reason}</p></section>}<p className="crew-cash-readonly"><ShieldCheck size={16} />{t("cash.completedReadonly")}</p></section>; }
function DetailSection({ title, rows }) { return <section className="crew-cash-detail-card crew-cash-detail-section"><h3>{title}</h3><dl className="crew-cash-breakdown">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value == null ? "—" : money(value)}</dd></div>)}</dl></section>; }

function PendingReceipts({ rows, token, onChanged }) { const { t } = useTranslation(); const [confirming, setConfirming] = useState(null); const [saving, setSaving] = useState(false); async function confirm() { setSaving(true); try { await crewService.confirmCashCollection(token, confirming.id, confirming.amount); await onChanged(); setConfirming(null); } finally { setSaving(false); } } return <section className="crew-cash-receipts"><h2>{t("cash.pendingConfirmations")}</h2>{rows.length ? rows.map((row) => <article key={row.id}><span><strong>{money(row.amount)}</strong><small>{row.sender} · {row.outlet_name || ""}</small><small>{row.purpose}{row.note ? ` · ${row.note}` : ""}</small></span><CrewStatusBadge tone="warning">{t("cash.confirmation.pending_confirmation")}</CrewStatusBadge><button className="crew-mobile-primary" type="button" onClick={() => setConfirming(row)}>{t("cash.confirmReceived")}</button></article>) : <p>{t("cash.noPendingConfirmations")}</p>}{confirming && <div className="crew-cash-sheet-backdrop"><section className="crew-cash-sheet"><header><h2>{t("cash.confirmCashReceived")}</h2><p>{money(confirming.amount)} · {confirming.sender}</p></header><footer><button className="crew-mobile-secondary" type="button" onClick={() => setConfirming(null)}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" disabled={saving} onClick={confirm}>{saving ? t("common.saving") : t("cash.confirmReceived")}</button></footer></section></div>}</section>; }

function CollectionSheet({ data, token, onClose, onSaved }) {
  const { t } = useTranslation();
  const balance = data.deposit.current_balance;
  // The server still receives its existing canonical purpose constant; it is not a Crew input.
  const [form, setForm] = useState({ request_id: crypto.randomUUID(), receiver_employee_id: "", amount: "", purpose: "Cash deposit collection", note: "" });
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const outletCrew = t("cash.outletCrew", { outlet: data?.outlet?.name || "FeedX" });
  const receiver = data.receivers.find((row) => row.id === form.receiver_employee_id);
  async function submit() {
    setSaving(true); setError("");
    try { await crewService.recordCashCollection(token, form); await onSaved(); }
    catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }
  return <div className="crew-ui-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="crew-ui-modal crew-cash-collection-modal" aria-modal="true" aria-labelledby="crew-cash-collection-title" onSubmit={(event) => { event.preventDefault(); review ? submit() : setReview(true); }}>
      <header className="crew-ui-modal-header"><div><h2 id="crew-cash-collection-title">{t("cash.handOverCash")}</h2><p>{t("cash.cashDepositBalance")}: {money(balance)}</p></div><button className="crew-ui-modal-close" type="button" aria-label={t("common.close")} onClick={onClose}><X size={18} /></button></header>
      <div className="crew-ui-modal-content">
        {review ? <section className="crew-cash-handover-review"><p>{t("cash.amount")}: <strong>{money(form.amount)}</strong></p><p>{t("cash.from")}: <strong>{data.initiator_name || "—"}</strong></p><p>{t("cash.to")}: <strong>{receiver?.name || "—"}</strong></p>{form.note && <p>{t("cash.noteOptional")}: <strong>{form.note}</strong></p>}</section> : <><div className="crew-cash-modal-field"><span>{t("cash.receiverType")}</span><strong>{outletCrew}</strong></div><SelectField label={t("cash.receiver")} ariaLabel={t("cash.receiver")} value={form.receiver_employee_id} placeholder={t("cash.chooseReceiver")} onChange={(receiver_employee_id) => setForm({ ...form, receiver_employee_id })} options={data.receivers.map((row) => ({ value: row.id, label: `${row.name} · ${row.position}` }))} searchable /><label>{t("cash.amount")}<input required inputMode="decimal" type="number" min="0.05" max={Number(balance)} step="0.05" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label><label>{t("cash.noteOptional")}<textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label></>}
        {error && <p className="crew-cash-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" className="crew-mobile-secondary" onClick={review ? () => setReview(false) : onClose}>{review ? t("common.back") : t("common.cancel")}</button><button className="crew-mobile-primary" disabled={saving || !form.receiver_employee_id || !form.amount}>{saving ? t("common.saving") : review ? t("cash.confirmHandover", { amount: money(form.amount) }) : t("common.continue")}</button></footer>
    </form>
  </div>;
}
