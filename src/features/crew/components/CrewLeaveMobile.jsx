import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Check, ChevronRight, FileText, Info, Plus, X } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import { CrewEmptyState, CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { formatCrewDate, translateStatus } from "../utils/crewI18n.js";

const statusTone = { pending: "ready", approved: "success", rejected: "danger", cancelled: "neutral" };
const today = () => new Date().toISOString().slice(0, 10);
const formatDate = (value) => formatCrewDate(`${value}T12:00:00+08:00`, { day: "numeric", month: "short", year: "numeric" });
const dateRange = (item) => item.start_date === item.end_date ? formatDate(item.start_date) : `${formatDate(item.start_date)} – ${formatDate(item.end_date)}`;
const requestedDays = (form) => form.duration_type === "half_day" ? 0.5 : form.start_date && form.end_date ? Math.max(0, Math.round((new Date(`${form.end_date}T00:00:00`) - new Date(`${form.start_date}T00:00:00`)) / 86400000) + 1) : 0;
const dayUnit = (value, t) => t("common.day", { count: Number(value) });

export default function CrewLeaveMobile({ token, onBack, onChanged }) {
  const { t } = useTranslation();
  const typeLabel = { annual: t("leave.annual"), medical: t("leave.medical"), unpaid: t("leave.unpaid"), other: t("leave.other") };
  const [data, setData] = useState({ balances: [], requests: [], upcoming: [] });
  const [tab, setTab] = useState("upcoming");
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ leave_type: "annual", start_date: today(), end_date: today(), duration_type: "full_day", half_day_period: "am", reason: "" });

  const load = async () => { setLoading(true); try { setData(await crewService.myLeave(token)); } catch (cause) { setError(cause.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [token]);
  const rows = useMemo(() => data.requests.filter((item) => tab === "pending" ? item.status === "pending" : tab === "history" ? ["rejected", "cancelled"].includes(item.status) : item.status === "approved" && item.end_date >= today()), [data, tab]);
  const days = requestedDays(form);
  const selectedBalance = data.balances?.find((item) => item.leave_type === form.leave_type);
  const afterRequest = selectedBalance?.balance_enforced ? Number(selectedBalance.available || 0) - days : null;
  const insufficient = selectedBalance?.balance_enforced && afterRequest < 0;
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value, ...(key === "start_date" && current.end_date < value ? { end_date: value } : {}), ...(key === "duration_type" && value === "half_day" ? { end_date: current.start_date } : {}) }));
  const submit = async () => { setSaving(true); setError(""); try { await crewService.submitLeave(token, { ...form, half_day_period: form.duration_type === "half_day" ? form.half_day_period : null }); setStep(0); setTab("pending"); await load(); onChanged?.(); } catch (cause) { setError(cause.message); } finally { setSaving(false); } };
  const cancel = async (id) => { setSaving(true); try { await crewService.cancelLeave(token, id); await load(); onChanged?.(); } catch (cause) { setError(cause.message); } finally { setSaving(false); } };

  if (step) return <section className="crew-leave-page">
    <CrewMobileDetailHeader title={t("leave.apply")} onBack={() => setStep(0)} variant="workflow" action={<span className="crew-mobile-header-step">{t("leave.step", { step })}</span>} />
    <div className="crew-leave-steps" aria-label={t("leave.progress")}>{[1, 2, 3, 4].map((value) => <span key={value} className={value <= step ? "is-active" : ""} />)}</div>
    {step === 1 && <section className="crew-leave-form"><CrewSectionHeader title={t("leave.leaveType")} /><div className="crew-ui-choice-list">{Object.entries(typeLabel).map(([value, label]) => <button type="button" className={form.leave_type === value ? "is-selected" : ""} key={value} onClick={() => update("leave_type", value)}><span><strong>{label}</strong>{value === "medical" && <small>{t("leave.medicalDocumentFuture")}</small>}</span>{form.leave_type === value ? <Check size={18} /> : <ChevronRight size={18} />}</button>)}</div></section>}
    {step === 2 && <section className="crew-leave-form"><CrewSectionHeader title={t("leave.dates")} /><div className="crew-ui-field-grid"><label className="crew-ui-form-field">{t("leave.startDate")}<input type="date" min={today()} value={form.start_date} onChange={(event) => update("start_date", event.target.value)} /></label><label className="crew-ui-form-field">{t("leave.endDate")}<input type="date" min={form.start_date} disabled={form.duration_type === "half_day"} value={form.end_date} onChange={(event) => update("end_date", event.target.value)} /></label></div><div className="crew-ui-segmented"><button type="button" className={form.duration_type === "full_day" ? "is-active" : ""} onClick={() => update("duration_type", "full_day")}>{t("leave.fullDay")}</button><button type="button" className={form.duration_type === "half_day" ? "is-active" : ""} onClick={() => update("duration_type", "half_day")}>{t("leave.halfDay")}</button></div>{form.duration_type === "half_day" && <div className="crew-ui-segmented"><button type="button" className={form.half_day_period === "am" ? "is-active" : ""} onClick={() => update("half_day_period", "am")}>AM</button><button type="button" className={form.half_day_period === "pm" ? "is-active" : ""} onClick={() => update("half_day_period", "pm")}>PM</button></div>}<BalancePreview balance={selectedBalance} requested={days} after={afterRequest} insufficient={insufficient} /></section>}
    {step === 3 && <section className="crew-leave-form"><CrewSectionHeader title={t("leave.reason")} /><label className="crew-ui-form-field">{t("leave.reasonNote")}<textarea rows="6" maxLength="1000" value={form.reason} onChange={(event) => update("reason", event.target.value)} placeholder={t("leave.reasonPlaceholder")} /></label>{form.leave_type === "medical" && <div className="crew-ui-note"><FileText size={18} /><span><strong>{t("leave.documentNotUploaded")}</strong><small>{t("leave.documentOptionalV1")}</small></span></div>}</section>}
    {step === 4 && <section className="crew-leave-form"><CrewSectionHeader title={t("leave.review")} /><div className="crew-ui-review-list"><div><span>{t("leave.leaveType")}</span><strong>{typeLabel[form.leave_type]}</strong></div><div><span>{t("leave.dates")}</span><strong>{dateRange(form)}</strong></div><div><span>{t("leave.duration")}</span><strong>{days} {dayUnit(days, t)}{form.duration_type === "half_day" ? ` · ${form.half_day_period.toUpperCase()}` : ""}</strong></div><div><span>{t("leave.availableBefore")}</span><strong>{selectedBalance?.balance_enforced ? `${selectedBalance.available} ${dayUnit(selectedBalance.available, t)}` : t("common.noLimit")}</strong></div><div><span>{t("leave.afterRequest")}</span><strong>{afterRequest == null ? t("common.noLimit") : `${afterRequest} ${dayUnit(afterRequest, t)}`}</strong></div><div><span>{t("leave.reason")}</span><strong>{form.reason}</strong></div></div></section>}
    {error && <div className="crew-ui-error" role="alert">{error}</div>}
    <footer className="crew-ui-sticky-actions crew-ui-sticky-actions--with-nav crew-leave-footer"><button type="button" className="crew-mobile-secondary" onClick={() => step === 1 ? setStep(0) : setStep(step - 1)}>{t("common.back")}</button>{step < 4 ? <button type="button" className="crew-mobile-primary" disabled={(step === 2 && (!days || insufficient)) || (step === 3 && form.reason.trim().length < 2)} onClick={() => setStep(step + 1)}>{t("common.continue")}</button> : <button type="button" className="crew-mobile-primary" disabled={saving || insufficient} onClick={submit}>{saving ? t("leave.submitting") : t("leave.submitRequest")}</button>}</footer>
  </section>;

  return <section className="crew-leave-page">
    <CrewMobileDetailHeader title={t("leave.title")} onBack={onBack} action={<button type="button" className="crew-mobile-primary crew-leave-header-action" onClick={() => setStep(1)}><Plus size={15} /> <span>{t("leave.apply")}</span></button>} />
    {!loading && <section className="crew-ui-kpi-grid crew-leave-balance-grid" aria-label={t("leave.balances")}>{data.balances?.filter((item) => item.leave_type !== "other").map((item) => <article className="crew-ui-kpi crew-leave-balance-card" key={item.entitlement_id}><span>{typeLabel[item.leave_type]}</span><strong>{item.balance_enforced ? item.available : "∞"}</strong><small className="crew-leave-balance-unit">{item.balance_enforced ? t("leave.availableDays", { count: item.available }) : t("leave.noBalanceLimit")}</small>{item.balance_enforced && <small className="crew-leave-balance-meta">{t("leave.pendingUsed", { pending: item.pending, used: item.used })}</small>}</article>)}</section>}
    <div className="crew-ui-tabs crew-leave-tabs" role="tablist">{[["upcoming", t("leave.upcoming")], ["pending", t("status.pending")], ["history", t("leave.history")]].map(([value, label]) => <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? "is-active" : ""} key={value} onClick={() => setTab(value)}>{label}</button>)}</div>
    {error && <div className="crew-ui-error" role="alert">{error}</div>}
    {loading ? <div className="crew-ui-loading">{t("leave.loading")}</div> : <div className="crew-ui-list-stack">{rows.length ? rows.map((item) => <article className="crew-ui-list-card crew-leave-request" key={item.id}><header><strong>{typeLabel[item.leave_type]}</strong><CrewStatusBadge tone={statusTone[item.status]}>{translateStatus(item.status, t)}</CrewStatusBadge></header><p className="crew-leave-request-dates">{dateRange(item)} · {item.requested_days} {dayUnit(item.requested_days, t)}</p><p className="crew-leave-request-submitted">{t("leave.submitted", { date: formatCrewDate(item.submitted_at) })}</p>{item.status === "rejected" && <div className="crew-leave-rejection"><strong>{t("leave.reason")}</strong>{item.rejection_reason}</div>}{item.status === "approved" && <div className="crew-leave-guidance"><Info size={15} /><span>{t("leave.approvedChangeHelp")}</span></div>}{item.can_cancel && <button type="button" className="crew-mobile-destructive crew-leave-cancel" disabled={saving} onClick={() => cancel(item.id)}><X size={15} /> {t("leave.cancelRequest")}</button>}</article>) : <CrewEmptyState title={t("leave.noLeave", { tab: t(`leave.${tab}`, { defaultValue: tab }) })} body={tab === "upcoming" ? t("leave.noUpcoming") : tab === "pending" ? t("leave.noPending") : t("leave.noHistory")} />}</div>}
  </section>;
}

function BalancePreview({ balance, requested, after, insufficient }) { const { t } = useTranslation(); return <div className={`crew-leave-balance-preview ${insufficient ? "is-insufficient" : ""}`}><CalendarDays size={18} /><div><span><small>{t("leave.available")}</small><strong>{balance?.balance_enforced ? balance.available : t("common.noLimit")}</strong></span><span><small>{t("leave.requested")}</small><strong>{requested}</strong></span><span><small>{t("leave.after")}</small><strong>{after == null ? t("common.noLimit") : after}</strong></span></div>{insufficient && <p>{t("leave.insufficient")}</p>}</div>; }
