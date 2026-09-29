import { useEffect, useRef, useState } from "react";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import AdminFilterToolbar, { AdminOutletField } from "../../../components/layout/AdminFilterToolbar.jsx";
import MonthPickerField from "../../../components/forms/MonthPickerField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import AdminDataSection from "../../../components/tables/AdminDataSection.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { crewService } from "../../../services/crewService.js";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";
import "./CrewTeamReviewAdminPage.css";

const dimensions = [["teamwork", "Teamwork"], ["reliability", "Reliability"], ["communication", "Communication"], ["work_attitude", "Work Attitude"]];
const scale = ["Rarely", "Sometimes", "Usually", "Often", "Consistently"];
const monthNow = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7) + "-01";
const stamp = (value) => value ? new Date(value).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const lastDay = (exclusiveClose) => exclusiveClose ? new Date(new Date(exclusiveClose).getTime() - 1).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }) : "—";
const stateLabel = { unavailable: "Not available", upcoming: "Upcoming", open: "Open", closed: "Closed", provisional: "Provisional", ready: "Ready", admin_review_required: "Admin Review Required", pending: "Pending" };
function employeeState(row, windowState) {
  if (row.source === "admin") return "Admin Reviewed";
  if (row.status === "ready") return "Ready";
  if (row.status === "admin_review_required") return "Admin Review Required";
  if (!row.eligible_teammates) return "No eligible teammates";
  if (row.status === "provisional" && row.reviews_received) return "Provisional";
  return windowState === "upcoming" ? "Upcoming" : "Awaiting reviews";
}

function RatingFields({ value, onChange }) {
  return <div className="crew-team-admin-ratings">
    <p>1 Rarely · 2 Sometimes · 3 Usually · 4 Often · 5 Consistently</p>
    {dimensions.map(([key, label]) => <fieldset key={key}><legend>{label}</legend><div>{scale.map((word, index) => <button type="button" key={word} aria-label={`${label}: ${index + 1} ${word}`} aria-pressed={value[key] === index + 1} className={value[key] === index + 1 ? "is-active" : ""} onClick={() => onChange((current) => ({ ...current, [key]: index + 1 }))}>{index + 1}</button>)}</div></fieldset>)}
  </div>;
}

export default function CrewTeamReviewAdminPage({ auth, store, ui }) {
  const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
  const [period, setPeriod] = useState(monthNow());
  const [response, setResponse] = useState(null);
  const scopeKey = `${outletId}:${period}`;
  const data = response?.scopeKey === scopeKey ? response.data : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailId, setDetailId] = useState(null);
  const [detailDimensions, setDetailDimensions] = useState(null);
  const detailRequest = useRef(0);
  const [control, setControl] = useState("");
  const [deadline, setDeadline] = useState("");
  const [reason, setReason] = useState("");
  const [exclusion, setExclusion] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [ratings, setRatings] = useState({});
  const [busy, setBusy] = useState(false);
  const canReview = auth.hasPermission("crew_performance.review");

  async function refresh() {
    if (!outletId || !canReview) return;
    setLoading(true); setError("");
    try { setResponse({ scopeKey, data: await crewService.teamReviewAdmin(outletId, period) }); }
    catch (cause) { setError(cause.message || "Unable to load Team Review."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    if (!outletId || !canReview) return undefined;
    setLoading(true); setError("");
    crewService.teamReviewAdmin(outletId, period).then((next) => { if (active) setResponse({ scopeKey, data: next }); })
      .catch((cause) => { if (active) setError(cause.message || "Unable to load Team Review."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [outletId, period, canReview, scopeKey]);

  async function run(action) {
    setBusy(true); setError("");
    try {
      if (action === "window") await crewService.setTeamReviewWindow(outletId, period, control, deadline, reason);
      if (action === "exclude") await crewService.excludeTeamReview(exclusion.id, reason);
      if (action === "assess") await crewService.submitTeamAdminReview(assessment.employee_id, period, ratings);
      setControl(""); setExclusion(null); setAssessment(null); setReason(""); setDeadline(""); setRatings({});
      await refresh();
      ui?.notify?.({ title: "Team Review updated", tone: "success" });
    } catch (cause) { setError(cause.message || "Unable to update Team Review."); }
    finally { setBusy(false); }
  }

  const windowState = data?.window?.status;
  const summary = data?.summary || {};
  const employees = data?.employees || [];
  const detail = employees.find((row) => row.employee_id === detailId);
  const employeeReviews = data?.reviews?.filter((row) => row.subject_id === detailId) || [];
  const adminReview = data?.admin_reviews?.find((row) => row.subject_id === detailId);
  const controls = windowState === "upcoming" ? [["open_early", "Open Early"]] : windowState === "open" ? [["close_early", "Close Early"], ["extend_deadline", "Extend Deadline"]] : [];

  async function openDetail(employeeId) {
    const request = ++detailRequest.current;
    setDetailId(employeeId);
    setDetailDimensions(null);
    try {
      const result = await crewService.teamReviewAdminDimensions(employeeId, period);
      if (request === detailRequest.current) setDetailDimensions(result);
    } catch (cause) {
      if (request === detailRequest.current) setError(cause.message || "Unable to load Team Review dimensions.");
    }
  }

  useEffect(() => { detailRequest.current += 1; setDetailId(null); setDetailDimensions(null); }, [outletId, period]);

  return <div className="crew-team-admin-page">
    <PageHeader section="Crew · Performance" title="Team Review" description="Monthly coworker evidence and audited Admin review." />
    <AdminFilterToolbar compact denseFields ariaLabel="Team Review context" outlet={<AdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((item) => ({ value: item.id, label: item.name }))} />} period={<MonthPickerField label="Month" value={period.slice(0, 7)} onChange={(value) => setPeriod(`${value}-01`)} />} />
    {error ? <p role="alert" className="crew-team-admin-error">{error}</p> : null}
    {loading && !data ? <p className="text-text-secondary">Loading Team Review…</p> : null}
    {data ? <>
      <div className="crew-team-admin-context"><span className="crew-team-admin-window-label">Review Window</span><strong className={`crew-team-admin-window-state is-${windowState || "unavailable"}`}>{windowState === "open" ? `Open until ${lastDay(data.window.closes_at)}` : windowState === "upcoming" ? "Upcoming" : windowState === "closed" ? "Closed" : "Not available"}</strong>{windowState === "upcoming" ? <span className="crew-team-admin-window-detail">Opens {stamp(data.window.opens_at)}</span> : null}{controls.length ? <details className="crew-team-admin-menu"><summary aria-label="Review window actions"><MoreHorizontal size={19} /></summary><div>{controls.map(([key, label]) => <button type="button" key={key} onClick={() => { setControl(key); setReason(""); setDeadline(""); }}>{label}</button>)}</div></details> : null}</div>
      <div className="crew-team-admin-summary" aria-label="Team Review summary">{[["Crew", summary.eligible_crew], ["Reviews Received", summary.reviews_received], ["Team Reviews Ready", summary.ready], ["Admin Reviews Required", summary.admin_required]].map(([label, value]) => <div key={label}><strong>{value ?? 0}</strong><span>{label}</span></div>)}</div>
      <AdminDataSection title="Crew" description={windowState === "upcoming" ? "Eligibility preview from published roster overlap." : `${employees.length} Crew in this outlet and month.`}>
        {employees.length ? <DataTable density="compact" rows={employees} getRowKey={(row) => row.employee_id} tableClassName="min-w-[760px]" columns={[
          { key: "name", header: "Employee", render: (row) => <strong>{row.employee_name}</strong> },
          { key: "eligible", header: "Eligible Teammates", align: "right", render: (row) => row.eligible_teammates },
          { key: "received", header: "Reviews", align: "right", render: (row) => row.reviews_received },
          { key: "score", header: "Team Review", align: "right", render: (row) => row.score == null ? <span className="crew-team-admin-score is-pending">— / 5</span> : <strong className="crew-team-admin-score">{Number(row.score).toFixed(2)} <small>/ 5</small></strong> },
          { key: "source", header: "Source", render: (row) => <span className="crew-team-admin-source">{row.source === "admin" ? "Admin" : row.source === "crew" ? "Team" : "—"}</span> },
          { key: "status", header: "Status", render: (row) => <span className={`crew-team-admin-status is-${row.source === "admin" ? "admin" : row.status || "pending"}`}>{employeeState(row, windowState)}</span> },
          { key: "action", header: "", render: (row) => <button className="crew-team-admin-row-action" type="button" aria-label={`View Team Review for ${row.employee_name}`} title="View details" onClick={() => openDetail(row.employee_id)}><ChevronRight size={17} /></button> },
        ]} /> : <p className="text-sm text-text-secondary">No participating Crew with scheduled work this month.</p>}
      </AdminDataSection>
    </> : null}
    {detail ? <Modal title={detail.employee_name} description={`${detail.reviews_received} valid reviews · ${detail.eligible_teammates} eligible teammates`} onClose={() => setDetailId(null)} footer={<button className="btn-secondary" type="button" onClick={() => setDetailId(null)}>Close</button>}>
      <div className="crew-team-admin-detail"><p><strong>Team Review:</strong> {detail.score == null ? "Pending" : `${Number(detail.score).toFixed(2)} / 5`} · {employeeState(detail, windowState)}</p>
        {detail.status === "admin_review_required" ? <button type="button" className="btn-primary" onClick={() => { setAssessment(detail); setRatings({}); setDetailId(null); }}>Complete Admin Review</button> : null}
        {detail.score != null && detailDimensions ? <p>{dimensions.map(([key, label]) => `${label} ${Number(detailDimensions[key]).toFixed(2)}`).join(" · ")}</p> : null}
        <h3>Review evidence</h3>{employeeReviews.length ? employeeReviews.map((review) => {
          const values = dimensions.map(([key]) => Number(review.criteria[key]));
          const extreme = values.every((value) => value === 1) || values.every((value) => value === 5);
          return <div key={review.id} className="crew-team-admin-review"><div><strong>{review.reviewer_name}</strong><small>{stamp(review.submitted_at)}</small></div><p>{dimensions.map(([key, label]) => `${label} ${review.criteria[key]}`).join(" · ")}</p>{extreme ? <Badge tone="warning">Uniform extreme ratings · inspect evidence</Badge> : null}{review.work_evidence ? <small>Published roster overlap · {review.work_evidence.attendance_overlaps} matching attendance overlap{review.work_evidence.attendance_overlaps === 1 ? "" : "s"}</small> : null}{review.comment ? <p><strong>Internal comment:</strong> {review.comment}</p> : null}{review.excluded_at ? <Badge tone="neutral">Excluded by {review.excluded_by_name || "Admin"} · {stamp(review.excluded_at)} · {review.exclusion_reason}</Badge> : !review.eligible ? <Badge tone="warning">Eligibility changed</Badge> : <button type="button" className="btn-secondary" onClick={() => { setExclusion(review); setReason(""); setDetailId(null); }}>Exclude Review</button>}</div>;
        }) : !adminReview ? <p>No Crew reviews received.</p> : null}
        {adminReview ? <div className="crew-team-admin-review"><div><strong>Admin Review · {adminReview.reviewed_by_name}</strong><small>{stamp(adminReview.reviewed_at)}</small></div><p>{dimensions.map(([key, label]) => `${label} ${adminReview.criteria[key]}`).join(" · ")}</p></div> : null}
        {data?.window_events?.length ? <><h3>Window history</h3>{data.window_events.map((event, index) => <p key={index}>{event.action.replaceAll("_", " ")} · {event.actor_name} · {stamp(event.created_at)} · {event.reason}</p>)}</> : null}
      </div>
    </Modal> : null}
    {control ? <Modal title={{ open_early: "Open Team Review early", close_early: "Close Team Review early", extend_deadline: "Extend Team Review deadline" }[control]} onClose={() => setControl("")} footer={<><button className="btn-secondary" type="button" onClick={() => setControl("")}>Cancel</button><button className="btn-primary" type="button" disabled={busy || reason.trim().length < 10 || (control === "extend_deadline" && !deadline)} onClick={() => run("window")}>Confirm</button></>}>
      {control === "extend_deadline" ? <DatePickerField label="New last day" value={deadline} onChange={setDeadline} /> : null}
      <label className="crew-team-admin-reason">Reason<textarea className="control" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label>
    </Modal> : null}
    {exclusion ? <Modal title="Exclude Team Review" description={`${exclusion.reviewer_name} → ${exclusion.subject_name}. Evidence remains in the Admin audit.`} onClose={() => setExclusion(null)} footer={<><button className="btn-secondary" type="button" onClick={() => setExclusion(null)}>Cancel</button><button className="btn-danger" type="button" disabled={busy || reason.trim().length < 10} onClick={() => run("exclude")}>Exclude Review</button></>}><label className="crew-team-admin-reason">Reason<textarea className="control" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label></Modal> : null}
    {assessment ? <Modal title="Admin Review" description={`Team Review for ${assessment.employee_name}`} onClose={() => setAssessment(null)} footer={<><button className="btn-secondary" type="button" onClick={() => setAssessment(null)}>Cancel</button><button className="btn-primary" type="button" disabled={busy || dimensions.some(([key]) => !ratings[key])} onClick={() => run("assess")}>Submit Admin Review</button></>}><RatingFields value={ratings} onChange={setRatings} /></Modal> : null}
  </div>;
}
