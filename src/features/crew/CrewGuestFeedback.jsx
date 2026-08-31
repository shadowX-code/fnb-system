import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, MessageCircleHeart, Send, UserRound } from "lucide-react";
import { crewService } from "../../services/crewService.js";
import "./CrewGuestFeedback.css";

const experiences = [
  { value: "great", label: "Great", hint: "A positive experience" },
  { value: "okay", label: "Okay", hint: "Everything was fine" },
  { value: "needs_improvement", label: "Needs Improvement", hint: "Something could be better" },
];
const positiveTags = ["Friendly", "Helpful", "Attentive", "Fast", "Knowledgeable"];
const improvementTags = ["Greeting", "Response Time", "Accuracy", "Cleanliness", "Product Knowledge"];

function outletFromHash() {
  const query = String(window.location.hash || "").split("?")[1] || "";
  return new URLSearchParams(query).get("outlet") || "";
}

function outletTokenFromPath() {
  const match = window.location.pathname.match(/^\/feedback\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]).toLowerCase() : "";
}

export function isPublicFeedbackRoute() {
  return Boolean(outletTokenFromPath()) || window.location.hash.startsWith("#feedback");
}

function publicFeedbackPath(token) {
  return `/feedback/${encodeURIComponent(token)}`;
}

function feedbackToken() {
  const key = "feedx_guest_feedback_token";
  let token = window.sessionStorage.getItem(key);
  if (!token) { token = crypto.randomUUID(); window.sessionStorage.setItem(key, token); }
  return token;
}

export default function CrewGuestFeedback() {
  const entry = useMemo(() => ({ outletId: outletFromHash(), outletToken: outletTokenFromPath() }), []);
  const [data, setData] = useState(null);
  const [step, setStep] = useState("crew");
  const [employee, setEmployee] = useState(null);
  const [experience, setExperience] = useState("");
  const [positive, setPositive] = useState([]);
  const [improvement, setImprovement] = useState([]);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const request = entry.outletToken ? crewService.publicFeedbackEntry(entry.outletToken) : crewService.publicFeedbackCrew(entry.outletId);
    request.then((value) => {
      if (!active) return;
      setData(value);
      const token = value?.outlet?.public_feedback_token;
      if (!entry.outletToken && token) window.history.replaceState(null, "", publicFeedbackPath(token));
    }).catch((cause) => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [entry.outletId, entry.outletToken]);

  function toggle(list, value, setter) { setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]); }
  async function submit() {
    if (!employee || !experience) return;
    setSubmitting(true); setError("");
    try {
      const payload = { employeeId: employee.id, experience, positiveTags: positive, improvementTags: improvement, comment, clientToken: feedbackToken() };
      if (entry.outletToken) await crewService.submitPublicFeedbackByToken({ ...payload, outletToken: entry.outletToken });
      else await crewService.submitPublicFeedback({ ...payload, outletId: entry.outletId });
      setStep("done");
    } catch (cause) { setError(cause.message); }
    finally { setSubmitting(false); }
  }

  if (loading) return <main className="guest-feedback-shell"><div className="guest-feedback-state">Loading Crew…</div></main>;
  if (!data?.outlet) return <main className="guest-feedback-shell"><div className="guest-feedback-state"><strong>Feedback link unavailable</strong><span>{error || "Please scan the outlet QR code again."}</span></div></main>;
  if (step === "done") return <main className="guest-feedback-shell"><section className="guest-feedback-done"><CheckCircle2 size={44} /><h1>Thank you</h1><p>Your feedback helps {data.outlet.name} recognise great service and coach with care.</p></section></main>;

  return <main className="guest-feedback-shell">
    <header><div className="guest-feedback-brand"><MessageCircleHeart size={20} /> FeedX</div><span>{data.outlet.name}</span></header>
    {step === "crew" ? <section className="guest-feedback-panel">
      <div className="guest-feedback-copy"><small>Guest feedback</small><h1>Who helped you today?</h1><p>Select a Crew member who served you recently.</p></div>
      <div className="guest-feedback-crew">{data.crew.map((row) => <button key={row.id} type="button" onClick={() => { setEmployee(row); setStep("feedback"); }}><span><UserRound size={19} /></span><strong>{row.name}</strong><small>{row.position || "Crew"}{row.on_shift ? " · On shift" : ""}</small></button>)}</div>
      {!data.crew.length ? <div className="guest-feedback-empty">No recent Crew are available for feedback.</div> : null}
    </section> : <section className="guest-feedback-panel">
      <button className="guest-feedback-back" type="button" onClick={() => setStep("crew")}><ChevronLeft size={16} /> Choose another Crew member</button>
      <div className="guest-feedback-copy"><small>Feedback for {employee.name}</small><h1>How was your experience?</h1><p>Simple, honest feedback is most helpful.</p></div>
      <div className="guest-feedback-experience">{experiences.map((item) => <button type="button" className={experience === item.value ? "is-active" : ""} aria-pressed={experience === item.value} key={item.value} onClick={() => setExperience(item.value)}><strong>{item.label}</strong><small>{item.hint}</small></button>)}</div>
      <fieldset><legend>What stood out?</legend><div className="guest-feedback-tags">{positiveTags.map((tag) => <button type="button" className={positive.includes(tag) ? "is-active" : ""} aria-pressed={positive.includes(tag)} key={tag} onClick={() => toggle(positive, tag, setPositive)}>{tag}</button>)}</div></fieldset>
      <fieldset><legend>What could improve?</legend><div className="guest-feedback-tags is-improvement">{improvementTags.map((tag) => <button type="button" className={improvement.includes(tag) ? "is-active" : ""} aria-pressed={improvement.includes(tag)} key={tag} onClick={() => toggle(improvement, tag, setImprovement)}>{tag}</button>)}</div></fieldset>
      <label className="guest-feedback-comment">Optional comment<textarea maxLength={500} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Share a short detail" /><span>{comment.length}/500</span></label>
      {error ? <div className="guest-feedback-error">{error}</div> : null}
      <button className="guest-feedback-submit" type="button" disabled={!experience || submitting} onClick={submit}><Send size={16} /> {submitting ? "Submitting…" : "Submit Feedback"}</button>
    </section>}
  </main>;
}
