import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, Check, ChevronRight, FileText, Plus, X } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import { CrewActionRow, CrewEmptyState, CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";

const typeLabel = { annual: "Annual Leave", medical: "Medical Leave / MC", unpaid: "Unpaid Leave", other: "Other Leave" };
const statusTone = { pending: "ready", approved: "success", rejected: "danger", cancelled: "neutral" };
const today = () => new Date().toISOString().slice(0, 10);
const formatDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
const dateRange = (item) => item.start_date === item.end_date ? formatDate(item.start_date) : `${formatDate(item.start_date)} – ${formatDate(item.end_date)}`;
const requestedDays = (form) => form.duration_type === "half_day" ? 0.5 : form.start_date && form.end_date ? Math.max(0, Math.round((new Date(`${form.end_date}T00:00:00`) - new Date(`${form.start_date}T00:00:00`)) / 86400000) + 1) : 0;

export default function CrewLeaveMobile({ token, onBack, onChanged }) {
  const [data, setData] = useState({ requests: [], upcoming: [] });
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
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value, ...(key === "start_date" && current.end_date < value ? { end_date: value } : {}), ...(key === "duration_type" && value === "half_day" ? { end_date: current.start_date } : {}) }));
  const submit = async () => { setSaving(true); setError(""); try { await crewService.submitLeave(token, { ...form, half_day_period: form.duration_type === "half_day" ? form.half_day_period : null }); setStep(0); setTab("pending"); await load(); onChanged?.(); } catch (cause) { setError(cause.message); } finally { setSaving(false); } };
  const cancel = async (id) => { setSaving(true); try { await crewService.cancelLeave(token, id); await load(); onChanged?.(); } catch (cause) { setError(cause.message); } finally { setSaving(false); } };

  if (step) return <section className="crew-v3-leave">
    <header className="crew-v2-page-header"><div><button type="button" onClick={() => setStep(0)} aria-label="Back"><ArrowLeft size={19} /></button><h1>Apply Leave</h1></div><span>Step {step} of 4</span></header>
    <div className="crew-v3-leave-steps" aria-label="Application progress">{[1, 2, 3, 4].map((value) => <span key={value} className={value <= step ? "is-active" : ""} />)}</div>
    {step === 1 && <section className="crew-v3-leave-form"><CrewSectionHeader title="Leave Type" /><div className="crew-v3-choice-list">{Object.entries(typeLabel).map(([value, label]) => <button type="button" className={form.leave_type === value ? "is-selected" : ""} key={value} onClick={() => update("leave_type", value)}><span><strong>{label}</strong><small>{value === "medical" ? "Supporting document can be added in a future update." : ""}</small></span>{form.leave_type === value ? <Check size={18} /> : <ChevronRight size={18} />}</button>)}</div></section>}
    {step === 2 && <section className="crew-v3-leave-form"><CrewSectionHeader title="Dates" /><div className="crew-v3-field-grid"><label>Start Date<input type="date" min={today()} value={form.start_date} onChange={(event) => update("start_date", event.target.value)} /></label><label>End Date<input type="date" min={form.start_date} disabled={form.duration_type === "half_day"} value={form.end_date} onChange={(event) => update("end_date", event.target.value)} /></label></div><div className="crew-v3-segment"><button type="button" className={form.duration_type === "full_day" ? "is-active" : ""} onClick={() => update("duration_type", "full_day")}>Full Day</button><button type="button" className={form.duration_type === "half_day" ? "is-active" : ""} onClick={() => update("duration_type", "half_day")}>Half Day</button></div>{form.duration_type === "half_day" && <div className="crew-v3-segment"><button type="button" className={form.half_day_period === "am" ? "is-active" : ""} onClick={() => update("half_day_period", "am")}>AM</button><button type="button" className={form.half_day_period === "pm" ? "is-active" : ""} onClick={() => update("half_day_period", "pm")}>PM</button></div>}<div className="crew-v3-leave-total"><CalendarDays size={18} /><span><strong>{days} requested day{days === 1 ? "" : "s"}</strong><small>No balance is shown until a Leave Entitlement source is available.</small></span></div></section>}
    {step === 3 && <section className="crew-v3-leave-form"><CrewSectionHeader title="Reason" /><label>Reason / Note<textarea rows="6" maxLength="1000" value={form.reason} onChange={(event) => update("reason", event.target.value)} placeholder="Briefly explain your leave request" /></label>{form.leave_type === "medical" && <div className="crew-v3-document-note"><FileText size={18} /><span><strong>Supporting document not uploaded</strong><small>You can submit Medical Leave without an attachment in v1.</small></span></div>}</section>}
    {step === 4 && <section className="crew-v3-leave-form"><CrewSectionHeader title="Review Request" /><div className="crew-v3-review-list"><div><span>Leave Type</span><strong>{typeLabel[form.leave_type]}</strong></div><div><span>Dates</span><strong>{dateRange(form)}</strong></div><div><span>Duration</span><strong>{days} day{days === 1 ? "" : "s"}{form.duration_type === "half_day" ? ` · ${form.half_day_period.toUpperCase()}` : ""}</strong></div><div><span>Reason</span><strong>{form.reason}</strong></div></div></section>}
    {error && <div className="crew-v2-error" role="alert">{error}</div>}
    <footer className="crew-v3-leave-footer"><button type="button" className="crew-v2-secondary" onClick={() => step === 1 ? setStep(0) : setStep(step - 1)}>Back</button>{step < 4 ? <button type="button" className="crew-v2-primary" disabled={(step === 2 && !days) || (step === 3 && form.reason.trim().length < 2)} onClick={() => setStep(step + 1)}>Continue</button> : <button type="button" className="crew-v2-primary" disabled={saving} onClick={submit}>{saving ? "Submitting…" : "Submit Request"}</button>}</footer>
  </section>;

  return <section className="crew-v3-leave">
    <header className="crew-v2-page-header"><div><button type="button" onClick={onBack} aria-label="Back"><ArrowLeft size={19} /></button><h1>My Leave</h1></div><button type="button" className="crew-v3-header-action" onClick={() => setStep(1)}><Plus size={16} /> Apply Leave</button></header>
    <div className="crew-v3-leave-tabs" role="tablist">{[["upcoming", "Upcoming"], ["pending", "Pending"], ["history", "History"]].map(([value, label]) => <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? "is-active" : ""} key={value} onClick={() => setTab(value)}>{label}</button>)}</div>
    {error && <div className="crew-v2-error" role="alert">{error}</div>}
    {loading ? <div className="crew-v3-mobile-loading">Loading leave…</div> : <div className="crew-v3-row-group">{rows.length ? rows.map((item) => <article className="crew-v3-leave-card" key={item.id}><div><span><strong>{typeLabel[item.leave_type]}</strong><small>{dateRange(item)} · {item.requested_days} day{Number(item.requested_days) === 1 ? "" : "s"}</small></span><CrewStatusBadge tone={statusTone[item.status]}>{item.status[0].toUpperCase() + item.status.slice(1)}</CrewStatusBadge></div><p>Submitted {new Date(item.submitted_at).toLocaleDateString("en-MY")}</p>{item.status === "rejected" && <div className="crew-v3-rejection"><strong>Reason</strong>{item.rejection_reason}</div>}{item.status === "approved" && <p className="is-help">Contact your manager to change approved leave.</p>}{item.can_cancel && <button type="button" disabled={saving} onClick={() => cancel(item.id)}><X size={15} /> Cancel Request</button>}</article>) : <CrewEmptyState title={`No ${tab} leave`} body={tab === "upcoming" ? "Approved upcoming leave will appear here." : tab === "pending" ? "Your submitted requests will appear here while awaiting review." : "Rejected and cancelled requests will appear here."} />}</div>}
  </section>;
}
