import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, ChevronRight, ClipboardCheck, MessageSquareText, Search, UsersRound } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import { crewService } from "../../../services/crewService.js";
import { outletService } from "../../../services/outletService.js";

const serviceCriteria = [
  ["welcome_greeting", "Welcome / Greeting"], ["thank_you_goodbye", "Thank You / Goodbye"], ["grooming", "Grooming"],
  ["work_area_cleanliness", "Work Area Cleanliness"], ["initiative", "Initiative"], ["guest_interaction", "Guest Interaction"],
];
const conductCriteria = [["professional_conduct", "Professional Conduct"], ["teamwork", "Teamwork"], ["responsibility", "Responsibility"], ["communication", "Communication"], ["policy_compliance", "Policy Compliance"]];
const ratings = [{ value: "meets_standard", label: "Meets Standard" }, { value: "needs_improvement", label: "Needs Improvement" }, { value: "not_observed", label: "Not Observed" }];
const periodValue = () => new Date().toISOString().slice(0, 7) + "-01";
const score = (value, max) => value == null ? `— / ${max}` : `${Math.round(Number(value))} / ${max}`;
const statusLabel = (value) => ({ draft: "Draft", review_required: "Review Required", finalized: "Finalized" }[value] || value);
const statusTone = (value) => value === "finalized" ? "success" : value === "review_required" ? "warning" : "neutral";
const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function CrewPerformanceAdminPage({ auth, ui, store, initialTab = "overview" }) {
  const [outlets, setOutlets] = useState([]); const [outletId, setOutletId] = useState(""); const [period, setPeriod] = useState(periodValue());
  const [data, setData] = useState({ summary: {}, crew: [], reviews: [], feedback: [] }); const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null); const [review, setReview] = useState(null); const [moderation, setModeration] = useState(null);
  const canReview = auth.hasPermission("crew_performance.review"); const canFinalize = auth.hasPermission("crew_performance.finalize"); const canModerate = auth.hasPermission("crew_feedback.moderate");
  useEffect(() => { let active = true; (async () => { try { const rows = store?.outlets?.length ? store.outlets : await outletService.listActiveOutlets(); if (active) setOutlets((rows || []).filter((row) => row.is_active !== false)); } catch (cause) { ui.notify({ title: "Unable to load outlets", message: cause.message, tone: "error" }); } })(); return () => { active = false; }; }, [store?.outlets, ui]);
  useEffect(() => { if (!outletId && outlets.length) setOutletId(outlets[0].id); }, [outletId, outlets]);
  async function refresh() { if (!outletId) return; setLoading(true); try { setData(await crewService.performanceAdminData(outletId, period)); } catch (cause) { ui.notify({ title: "Unable to load Performance", message: cause.message, tone: "error" }); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, [outletId, period]);
  async function submitReview(values) { await crewService.submitPerformanceReview(values); setReview(null); await refresh(); ui.notify({ title: "Review submitted", message: "The server recalculated this performance component." }); }
  async function finalize(employeeId) { await crewService.finalizePerformance(employeeId, period); setDetail(null); await refresh(); ui.notify({ title: "Performance finalized", message: "This monthly result is now immutable." }); }
  async function moderate(values) { await crewService.moderateFeedback(values.id, true, values.reason); setModeration(null); await refresh(); ui.notify({ title: "Feedback excluded", message: "The reason was retained in the moderation audit." }); }
  const meta = initialTab === "reviews" ? ["Reviews", "Complete Service Standards and Conduct reviews from one queue."] : initialTab === "feedback" ? ["Customer Feedback", "Understand guest sentiment without deleting unfavorable feedback."] : ["Performance Overview", "Explainable monthly performance from Attendance, Reviews, Feedback and Learning evidence."];
  return <div className="crew-performance-page"><PageHeader section="Crew · Performance" title={meta[0]} description={meta[1]} actions={<><SelectField className="crew-growth-outlet" label="Outlet" value={outletId} onChange={setOutletId} options={outlets.map((row) => ({ value: row.id, label: row.name }))} /><label className="crew-performance-period">Period<input className="control" type="month" value={period.slice(0, 7)} onChange={(event) => setPeriod(`${event.target.value}-01`)} /></label></>} />
    {loading ? <div className="crew-growth-skeleton"><span /><span /><span /><p>Loading performance evidence…</p></div> : initialTab === "reviews" ? <ReviewQueue rows={data.crew} onReview={setReview} canReview={canReview} /> : initialTab === "feedback" ? <FeedbackAdmin data={data.feedback} onModerate={setModeration} canModerate={canModerate} /> : <PerformanceOverview data={data} onOpen={setDetail} />}
    {detail ? <PerformanceDetail item={detail} canFinalize={canFinalize} onClose={() => setDetail(null)} onFinalize={() => finalize(detail.employee.id)} /> : null}
    {review ? <PerformanceReview item={review} period={period} onClose={() => setReview(null)} onSubmit={submitReview} /> : null}
    {moderation ? <ModerationDialog item={moderation} onClose={() => setModeration(null)} onSubmit={moderate} /> : null}
  </div>;
}

function PerformanceOverview({ data, onOpen }) {
  const s = data.summary || {};
  return <div className="crew-growth-stack"><section className="crew-growth-metrics"><Metric icon={BarChart3} label="Average Score" value={s.average_score == null ? "—" : Math.round(s.average_score)} detail="Out of 100" /><Metric icon={CheckCircle2} label="Crew Reviewed" value={s.crew_reviewed || 0} detail="Finalized this period" tone="success" /><Metric icon={ClipboardCheck} label="Awaiting Review" value={s.awaiting_review || 0} detail="Service or Conduct pending" tone="warning" /><Metric icon={AlertTriangle} label="Needs Attention" value={s.needs_attention || 0} detail="Calculated score below 70" tone="danger" /></section>
    <section className="crew-growth-table"><DataTable rows={data.crew || []} getRowKey={(row) => row.employee.id} onRowClick={onOpen} tableClassName="min-w-[1080px]" columns={[
      { key: "employee", header: "Employee", render: (row) => <NameCell row={row.employee} /> }, { key: "position", header: "Position", render: (row) => row.employee.position || "—" },
      { key: "performance", header: "Performance", render: (row) => <strong>{row.result.total_score == null ? "—" : Math.round(row.result.total_score)}</strong> },
      { key: "attendance", header: "Attendance", render: (row) => score(row.result.attendance_score, 30) }, { key: "service", header: "Service", render: (row) => score(row.result.service_score, 30) },
      { key: "customer", header: "Customer", render: (row) => score(row.result.customer_score, 15) }, { key: "knowledge", header: "Knowledge", render: (row) => score(row.result.knowledge_score, 15) }, { key: "conduct", header: "Conduct", render: (row) => score(row.result.conduct_score, 10) },
      { key: "status", header: "Status", render: (row) => <Badge tone={statusTone(row.result.status)}>{statusLabel(row.result.status)}</Badge> }, { key: "open", header: "", align: "right", render: () => <ChevronRight size={15} /> },
    ]} /></section></div>;
}

function ReviewQueue({ rows, onReview, canReview }) {
  const queue = (rows || []).flatMap((row) => ["service", "conduct"].map((component) => ({ ...row, component, reviewed: row.result.components?.[component]?.status === "reviewed" })));
  return <section className="crew-growth-table"><DataTable rows={queue} getRowKey={(row) => `${row.employee.id}:${row.component}`} tableClassName="min-w-[760px]" columns={[
    { key: "employee", header: "Employee", render: (row) => <NameCell row={row.employee} /> }, { key: "period", header: "Period", render: (row) => new Date(row.result.period_start).toLocaleDateString("en-MY", { month: "long", year: "numeric" }) },
    { key: "component", header: "Review", render: (row) => row.component === "service" ? "Service Standards" : "Conduct" }, { key: "status", header: "Status", render: (row) => <Badge tone={row.reviewed ? "success" : "warning"}>{row.reviewed ? "Completed" : "Pending"}</Badge> },
    { key: "action", header: "Action", align: "right", render: (row) => <button className={row.reviewed ? "btn-secondary" : "btn-primary"} disabled={!canReview} onClick={() => onReview(row)}>{row.reviewed ? "Review Again" : "Review"}</button> },
  ]} /></section>;
}

function FeedbackAdmin({ data, onModerate, canModerate }) {
  const [query, setQuery] = useState(""); const [experience, setExperience] = useState("all");
  const rows = (data || []).filter((row) => (experience === "all" || row.experience === experience) && `${row.employee_name} ${row.comment || ""}`.toLowerCase().includes(query.toLowerCase()));
  const included = rows.filter((row) => row.scoring_status === "included"); const positive = included.filter((row) => row.experience === "great").length; const improvement = included.filter((row) => row.experience === "needs_improvement").length;
  return <div className="crew-growth-stack"><section className="crew-growth-metrics"><Metric icon={MessageSquareText} label="Total Feedback" value={included.length} detail="Included this period" /><Metric icon={CheckCircle2} label="Positive Ratio" value={included.length ? `${Math.round(positive * 100 / included.length)}%` : "—"} detail="Great experiences" tone="success" /><Metric icon={AlertTriangle} label="Improvement" value={improvement} detail="Needs Improvement" tone="warning" /><Metric icon={UsersRound} label="Crew Mentioned" value={new Set(included.map((row) => row.employee_id)).size} detail="Unique Crew" /></section><section className="crew-growth-filterbar"><label className="crew-growth-search"><span>Search</span><div><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Crew or comment" /></div></label><SelectField label="Experience" value={experience} onChange={setExperience} options={[{ value: "all", label: "All" }, { value: "great", label: "Great" }, { value: "okay", label: "Okay" }, { value: "needs_improvement", label: "Needs Improvement" }]} /></section><section className="crew-growth-table"><DataTable rows={rows} getRowKey={(row) => row.id} tableClassName="min-w-[940px]" columns={[
    { key: "date", header: "Date", render: (row) => formatDate(row.submitted_at) }, { key: "crew", header: "Crew", render: (row) => row.employee_name }, { key: "experience", header: "Experience", render: (row) => <Badge tone={row.experience === "great" ? "success" : row.experience === "needs_improvement" ? "warning" : "neutral"}>{row.experience.replaceAll("_", " ")}</Badge> },
    { key: "tags", header: "Tags", render: (row) => [...row.positive_tags, ...row.improvement_tags].join(", ") || "—" }, { key: "comment", header: "Comment", render: (row) => row.comment || "—" }, { key: "scoring", header: "Scoring Status", render: (row) => <Badge tone={row.scoring_status === "included" ? "info" : "neutral"}>{row.scoring_status}</Badge> },
    { key: "action", header: "Action", align: "right", render: (row) => row.scoring_status === "included" && canModerate ? <button className="btn-secondary" onClick={() => onModerate(row)}>Exclude</button> : null },
  ]} /></section></div>;
}

function PerformanceDetail({ item, canFinalize, onClose, onFinalize }) {
  const r = item.result; const components = [["attendance", "Attendance", 30], ["service", "Service Standards", 30], ["customer", "Customer Experience", 15], ["knowledge", "Knowledge & SOP", 15], ["conduct", "Conduct", 10]];
  return <Modal title={`${item.employee.full_name} · Performance`} description={`${new Date(r.period_start).toLocaleDateString("en-MY", { month: "long", year: "numeric" })} · ${statusLabel(r.status)}`} size="xl" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Close</button>{canFinalize && r.status !== "finalized" ? <button className="btn-primary" disabled={r.service_score == null || r.conduct_score == null} onClick={onFinalize}>Finalize Performance</button> : null}</>}><div className="crew-performance-detail"><section className="crew-performance-score"><span>Overall Score</span><strong>{r.total_score == null ? "—" : Math.round(r.total_score)}</strong><small>out of 100 · {r.calculation_version}</small></section><div className="crew-performance-breakdown">{components.map(([key, label, max]) => { const value = r.components?.[key]; return <article key={key}><header><strong>{label}</strong><span>{score(value?.score, max)}</span></header><div className="crew-performance-bar"><i style={{ width: `${value?.score == null ? 0 : Number(value.score) * 100 / max}%` }} /></div><p>{value?.explanation || (value?.status === "review_required" ? "Manager review required." : "Evidence is being calculated.")}</p></article>; })}</div></div></Modal>;
}

function PerformanceReview({ item, period, onClose, onSubmit }) {
  const definitions = item.component === "service" ? serviceCriteria : conductCriteria; const existing = item.result.components?.[item.component]?.criteria || [];
  const [criteria, setCriteria] = useState(() => definitions.map(([key, label]) => ({ key, label, rating: existing.find((row) => row.key === key)?.rating || "not_observed" }))); const [note, setNote] = useState(""); const [saving, setSaving] = useState(false);
  async function submit() { setSaving(true); try { await onSubmit({ employeeId: item.employee.id, period, component: item.component, criteria, note }); } finally { setSaving(false); } }
  return <Modal title={item.component === "service" ? "Service Standards Review" : "Conduct Review"} description={`${item.employee.full_name} · ${new Date(period).toLocaleDateString("en-MY", { month: "long", year: "numeric" })}`} size="xl" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving || criteria.every((row) => row.rating === "not_observed")} onClick={submit}>{saving ? "Submitting…" : "Submit Review"}</button></>}><div className="crew-performance-review">{criteria.map((row, index) => <article key={row.key}><strong>{row.label}</strong><div role="group" aria-label={`${row.label} rating`}>{ratings.map((rating) => <button type="button" key={rating.value} className={row.rating === rating.value ? "is-active" : ""} aria-pressed={row.rating === rating.value} onClick={() => setCriteria((current) => current.map((entry, i) => i === index ? { ...entry, rating: rating.value } : entry))}>{rating.label}</button>)}</div></article>)}<label>Manager note<textarea className="control" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional coaching context. This is never shown to Crew." /></label></div></Modal>;
}

function ModerationDialog({ item, onClose, onSubmit }) { const [reason, setReason] = useState(""); return <Modal title="Exclude From Scoring" description="The feedback remains visible and the reason is audited." onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-danger" disabled={reason.trim().length < 5} onClick={() => onSubmit({ id: item.id, reason })}>Exclude</button></>}><label className="crew-performance-moderation">Reason<textarea className="control" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this submission should not affect scoring" /></label></Modal>; }
function Metric({ icon: Icon, label, value, detail, tone = "neutral" }) { return <article className={`crew-growth-metric is-${tone}`}><div className="crew-growth-metric-icon"><Icon size={16} /></div><span><small>{label}</small><strong>{value}</strong><em>{detail}</em></span></article>; }
function NameCell({ row }) { return <span className="crew-growth-name"><span className="crew-growth-avatar">{row.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><span><strong>{row.full_name}</strong><small>{row.employee_code || row.position || "Crew"}</small></span></span>; }
