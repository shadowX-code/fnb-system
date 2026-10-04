import { bounded } from "./interviewRecovery.js";
import { useEffect, useState } from "react";
import { recruitmentService } from "./recruitmentService.js";
import RecruitmentInterviewSession from "./RecruitmentInterviewSession.jsx";
import { useInterviewDevices } from "./useInterviewDevices.js";
import "./recruitmentPublic.css";

const tokenFromPath = () => window.location.pathname.match(/^\/i\/([a-f0-9]{64})\/?$/)?.[1] || "";
const interviewStates = ["starting", "interviewing", "interrupted", "finalizing", "completed", "partial", "failed"];

export default function RecruitmentInterviewPublic() {
  const [token] = useState(tokenFromPath);
  const [entry, setEntry] = useState(null);
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [consentSelected, setConsentSelected] = useState(false);
  const [error, setError] = useState("");
  const [readinessBusy, setReadinessBusy] = useState(false);
  const devices = useInterviewDevices();
  useEffect(() => {
    let active = true;
    setBootstrapError("");
    bounded(recruitmentService.publicEntry(token), "Loading saved interview", {timeoutMs:15000})
      .then(value => {
        if (!active) return;
        setEntry(value);
        setName(value?.profile?.full_name || "");
        setContact(value?.profile?.contact || "");
      }).catch(cause => {
        if (active) setBootstrapError(cause.message || "Could not load your saved interview. Retry with a stable connection.");
      });
    return () => { active = false; };
  }, [token, bootstrapRevision]);

  async function run(action) {
    setBusy(true); setError("");
    try { setEntry(await bounded(action(), "Saving preparation", {timeoutMs:15000})); return true; }
    catch(cause) { setError(cause.message || "Could not save. Please try again."); return false; }
    finally { setBusy(false); }
  }
  // The persisted milestone remains server-owned. It can be reached in either
  // consent/device order; a later device loss still disables Start locally.
  useEffect(() => {
    if (!entry?.consented || entry.status !== "consented" || devices.state.status !== "ready") return;
    let active = true;
    setError(""); setReadinessBusy(true);
    bounded(recruitmentService.ready(token), "Confirming readiness", {timeoutMs:15000})
      .then(value => { if(active) setEntry(value); })
      .catch(cause => { if(active) setError(cause.message || "Could not confirm readiness. Retry below."); })
      .finally(() => { if(active) setReadinessBusy(false); });
    return () => { active = false; setReadinessBusy(false); };
  }, [entry?.status, entry?.consented, devices.state.status, token]);

  const preview = node => {
    devices.previewRef.current = node;
    if (node && node.srcObject !== devices.streamRef.current) node.srcObject = devices.streamRef.current;
  };
  const getReady = ({start, preparing = false} = {}) => <section>
    <h1>Get ready</h1>
    <p>Find a quiet, comfortable place. Check your camera and speak to test your microphone.</p>
    <video ref={preview} className="recruitment-preview recruitment-check-preview" autoPlay playsInline muted aria-label="Camera preview" />
    <div className="recruitment-device-status" role="status">{devices.state.status === "ready" ? "Camera and microphone ready" : devices.state.status === "checking" ? "Checking camera and microphone…" : "Camera and microphone check needed"}</div>
    <div className="recruitment-meter" role="meter" aria-label="Microphone activity" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(devices.state.level * 100)}><span style={{width:`${Math.max(2,devices.state.level * 100)}%`}} /></div>
    {devices.state.error ? <p className="recruitment-error" role="alert">{devices.state.error}</p> : null}
    <button className="recruitment-secondary" disabled={devices.state.status === "checking"} onClick={() => devices.start()}> {devices.state.status === "ready" ? "Recheck camera and microphone" : "Check camera and microphone"}</button>
    <div className="recruitment-consent">
      <h2>{entry.consent_copy?.title || "About this interview"}</h2>
      {entry.consent_copy?.body?.map(text => <p key={text}>{text}</p>)}
      {entry.consent_copy?.notice ? <p className="recruitment-notice">{entry.consent_copy.notice}</p> : null}
      {entry.consent_copy?.consent ? <label className="recruitment-checkbox">
        <input type="checkbox" checked={!!entry.consented || consentSelected} disabled={busy || entry.consented || entry.consent_status !== "approved"} onChange={event => { if(event.target.checked) { setConsentSelected(true); run(() => recruitmentService.consent(token,entry.copy_version)).then(saved => { if(!saved) setConsentSelected(false); }); } }} />
        <span>{entry.consent_copy.consent}</span>
      </label> : <p>Consent for this interview is not ready. Please contact your recruiter.</p>}
      {entry.consented ? <p className="recruitment-saved" role="status">Consent recorded</p> : null}
    </div>
    {error ? <p role="alert" className="recruitment-error">{error}</p> : null}
    {entry.consented && devices.state.status === "ready" && entry.status !== "ready" && !busy && !readinessBusy ? <button className="recruitment-secondary" onClick={() => run(() => recruitmentService.ready(token))}>Retry readiness check</button> : null}
    <button className="recruitment-primary recruitment-full" disabled={busy || readinessBusy || preparing || !entry.consented || entry.status !== "ready" || devices.state.status !== "ready"} onClick={start}>Start interview</button>
    <p className="recruitment-hint">Recording begins when you start. Keep this page open during your interview.</p>
  </section>;
  return <main className="recruitment-public"><div className="recruitment-public-card">
    <header className="recruitment-public-header"><span className="recruitment-mark">FeedX</span><span>Interview</span></header>
    {entry === null ? <section><h1>{bootstrapError ? "Could not load your interview" : "Preparing interview…"}</h1>{bootstrapError ? <><p role="alert">{bootstrapError}</p><button className="recruitment-primary" onClick={() => setBootstrapRevision(x => x+1)}>Retry loading interview</button></> : null}</section>
      : !entry.available ? <section><h1>Interview link unavailable</h1><p>This link may have expired, been revoked, or the opening may have closed. Please contact your recruiter.</p></section>
      : entry.status === "invited" ? <section>
        <h1>Interview details</h1>
        <h2 className="recruitment-position">{entry.job.position || entry.job.title}</h2>
        {entry.job.title !== entry.job.position ? <p className="recruitment-job-title">{entry.job.title}</p> : null}
        <dl className="recruitment-details"><div><dt>Workplace</dt><dd>{entry.job.workplace}</dd></div><div><dt>Expected duration</dt><dd>About {entry.job.target_minutes} minutes</dd></div></dl>
        <p>You can use English, BM, Chinese, or switch naturally. You’ll need a camera, microphone and a quiet place.</p>
        {entry.job.candidate_instructions ? <p>{entry.job.candidate_instructions}</p> : null}
        <label>Candidate name<input value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={160} /></label>
        <label>Contact number<input value={contact} onChange={e => setContact(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={40} /></label>
        {error ? <p role="alert" className="recruitment-error">{error}</p> : null}
        <button className="recruitment-primary recruitment-full" disabled={busy || name.trim().length < 2 || contact.trim().length < 5} onClick={() => run(() => recruitmentService.confirmProfile(token,name,contact))}>Continue</button>
      </section>
      : entry.status === "ready" || interviewStates.includes(entry.status) ? <RecruitmentInterviewSession token={token} entry={entry} devices={devices} renderPreparation={getReady} />
      : getReady()}
  </div></main>;
}
