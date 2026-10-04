import { bounded } from "./interviewRecovery.js";
import { useEffect, useState } from "react";
import { recruitmentService } from "./recruitmentService.js";
import RecruitmentInterviewSession from "./RecruitmentInterviewSession.jsx";
import { useInterviewDevices } from "./useInterviewDevices.js";
import "./recruitmentPublic.css";

const consentPurposes = ["ai", "recording", "review"];
const tokenFromPath = () =>
  window.location.pathname.match(/^\/i\/([a-f0-9]{64})\/?$/)?.[1] || "";

export default function RecruitmentInterviewPublic() {
  const [token] = useState(tokenFromPath);
  const [entry, setEntry] = useState(null);
  const [bootstrapError,setBootstrapError] = useState("");
  const [bootstrapRevision,setBootstrapRevision] = useState(0);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [agreed, setAgreed] = useState([false, false, false]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const devices = useInterviewDevices();
  useEffect(() => {
    let active = true;
    setBootstrapError("");
    bounded(recruitmentService.publicEntry(token), "Loading saved interview", {timeoutMs:15000})
      .then((value) => {
        if (!active) return;
        setEntry(value);
        setName(value?.profile?.full_name || "");
        setContact(value?.profile?.contact || "");
        if (
          [
            "ready",
            "starting",
            "interviewing",
            "interrupted",
            "finalizing",
            "completed",
            "partial",
            "failed",
          ].includes(value?.status)
        )
          setStep(5);
        else if (value?.status === "consented") setStep(4);
        else if (value?.status === "profile_confirmed") setStep(3);
      })
      .catch(cause => {
        if (active) setBootstrapError(cause.message || "Could not load your saved interview. Retry with a stable connection.");
      });
    return () => {
      active = false;
    };
  }, [token,bootstrapRevision]);
  async function run(action, nextStep) {
    setBusy(true);
    setError("");
    try {
      const value = await action();
      setEntry(value);
      setStep(nextStep);
    } catch (cause) {
      setError(cause.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const job = entry?.job;
  return (
    <main className="recruitment-public">
      <div className="recruitment-public-card">
        <header className="recruitment-public-header">
          <span className="recruitment-mark">FeedX</span>
          <span>Interview</span>
        </header>
        {entry === null ? (
          <section>
            <h1>{bootstrapError ? "Interview recovery required" : "Preparing interview…"}</h1>
            {bootstrapError ? <><p role="alert">{bootstrapError}</p><button className="recruitment-primary" onClick={()=>setBootstrapRevision(value=>value+1)}>Retry loading interview</button></> : null}
          </section>
        ) : !entry.available ? (
          <section>
            <h1>Interview link unavailable</h1>
            <p>
              This link may have expired, been revoked, or the opening may have
              closed. Please contact your recruiter.
            </p>
          </section>
        ) : (
          <>
            {entry.consent_status !== "approved" ? (
              <p className="recruitment-notice" role="status">
                Synthetic testing only. This interview is not ready for real
                candidate collection until approved consent is configured.
              </p>
            ) : null}
            <nav
              className="recruitment-progress"
              aria-label="Interview preparation progress"
            >
              {["Welcome", "Job", "Profile", "Consent", "Devices", "Ready"].map(
                (label, index) => (
                  <span key={label} className={index <= step ? "active" : ""}>
                    {label}
                  </span>
                ),
              )}
            </nav>
            {step === 0 ? (
              <section>
                <p className="recruitment-eyebrow">Your interview</p>
                <h1>Welcome, {entry.profile.full_name}</h1>
                <p>
                  We’ll guide you through a short preparation before the
                  interview. You will need a camera and microphone.
                </p>
                <button
                  className="recruitment-primary"
                  type="button"
                  onClick={() => setStep(1)}
                >
                  Continue
                </button>
              </section>
            ) : null}
            {step === 1 ? (
              <section>
                <p className="recruitment-eyebrow">Job information</p>
                <h1>{job.title}</h1>
                <dl className="recruitment-details">
                  <div>
                    <dt>Position</dt>
                    <dd>{job.position}</dd>
                  </div>
                  <div>
                    <dt>Workplace</dt>
                    <dd>{job.workplace}</dd>
                  </div>
                  <div>
                    <dt>Company</dt>
                    <dd>{job.company}</dd>
                  </div>
                  <div>
                    <dt>Expected duration</dt>
                    <dd>About {job.target_minutes} minutes</dd>
                  </div>
                </dl>
                {job.description ? <p>{job.description}</p> : null}
                {job.candidate_instructions ? (
                  <p>{job.candidate_instructions}</p>
                ) : null}
                <button
                  className="recruitment-primary"
                  type="button"
                  onClick={() => setStep(2)}
                >
                  Continue
                </button>
              </section>
            ) : null}
            {step === 2 ? (
              <section>
                <p className="recruitment-eyebrow">Confirm your profile</p>
                <h1>Your details</h1>
                <p>
                  Confirm the name and contact number your recruiter will use
                  for this application.
                </p>
                <label>
                  Full name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Contact number
                  <input
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </label>
                <button
                  className="recruitment-primary"
                  type="button"
                  disabled={
                    busy || name.trim().length < 2 || contact.trim().length < 5
                  }
                  onClick={() =>
                    run(
                      () =>
                        recruitmentService.confirmProfile(token, name, contact),
                      3,
                    )
                  }
                >
                  Confirm details
                </button>
              </section>
            ) : null}
            {step === 3 ? (
              <section>
                <p className="recruitment-eyebrow">Consent</p>
                <h1>{entry.consent_copy?.title || "Before you continue"}</h1>
                {entry.consent_copy?.body?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {entry.consent_copy?.notice ? (
                  <p className="recruitment-notice">
                    {entry.consent_copy.notice}
                  </p>
                ) : null}
                {entry.consent_copy?.consent ? (
                  <label className="recruitment-checkbox">
                    <input
                      type="checkbox"
                      checked={agreed.every(Boolean)}
                      onChange={(e) =>
                        setAgreed(consentPurposes.map(() => e.target.checked))
                      }
                    />
                    <span>{entry.consent_copy.consent}</span>
                  </label>
                ) : (
                  consentPurposes.map((purpose, index) => (
                    <label className="recruitment-checkbox" key={purpose}>
                      <input
                        type="checkbox"
                        checked={agreed[index]}
                        onChange={(e) =>
                          setAgreed((current) =>
                            current.map((value, i) =>
                              i === index ? e.target.checked : value,
                            ),
                          )
                        }
                      />
                      <span>{entry.consent_copy?.[purpose]}</span>
                    </label>
                  ))
                )}
                <button
                  className="recruitment-primary"
                  type="button"
                  disabled={busy || !agreed.every(Boolean)}
                  onClick={() =>
                    run(
                      () =>
                        recruitmentService.consent(token, entry.copy_version),
                      4,
                    )
                  }
                >
                  I agree and continue
                </button>
              </section>
            ) : null}
            {step === 4 ? (
              <section>
                <p className="recruitment-eyebrow">Device check</p>
                <h1>Camera and microphone</h1>
                <p>
                  Allow both devices, check your camera preview, and speak to
                  test the microphone. No interview recording starts in this
                  preparation step.
                </p>
                <video
                  ref={devices.previewRef}
                  className="recruitment-preview"
                  autoPlay
                  playsInline
                  muted
                  aria-label="Camera preview"
                />
                <div
                  className="recruitment-meter"
                  role="meter"
                  aria-label="Microphone activity"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={Math.round(devices.state.level * 100)}
                >
                  <span
                    style={{
                      width: `${Math.max(2, devices.state.level * 100)}%`,
                    }}
                  />
                </div>
                {devices.state.cameras.length > 1 ? (
                  <label>
                    Camera
                    <select
                      value={devices.state.cameraId}
                      onChange={(e) =>
                        devices.start({
                          cameraId: e.target.value,
                          microphoneId: devices.state.microphoneId,
                        })
                      }
                    >
                      {devices.state.cameras.map((x) => (
                        <option value={x.deviceId} key={x.deviceId}>
                          {x.label || "Camera"}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {devices.state.microphones.length > 1 ? (
                  <label>
                    Microphone
                    <select
                      value={devices.state.microphoneId}
                      onChange={(e) =>
                        devices.start({
                          cameraId: devices.state.cameraId,
                          microphoneId: e.target.value,
                        })
                      }
                    >
                      {devices.state.microphones.map((x) => (
                        <option value={x.deviceId} key={x.deviceId}>
                          {x.label || "Microphone"}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {devices.state.error ? (
                  <p role="alert" className="recruitment-error">
                    {devices.state.error}
                  </p>
                ) : null}
                <div className="recruitment-actions">
                  <button
                    className="recruitment-secondary"
                    type="button"
                    disabled={devices.state.status === "checking"}
                    onClick={() =>
                      devices.start({
                        cameraId: devices.state.cameraId,
                        microphoneId: devices.state.microphoneId,
                      })
                    }
                  >
                    {devices.state.status === "ready"
                      ? "Recheck devices"
                      : "Check devices"}
                  </button>
                  <button
                    className="recruitment-primary"
                    type="button"
                    disabled={busy || devices.state.status !== "ready"}
                    onClick={() =>
                      run(() => recruitmentService.ready(token), 5)
                    }
                  >
                    Devices ready
                  </button>
                </div>
              </section>
            ) : null}
            {step === 5 ? (
              <RecruitmentInterviewSession
                token={token}
                entry={entry}
                devices={devices}
              />
            ) : null}
            {error ? (
              <p role="alert" className="recruitment-error">
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
