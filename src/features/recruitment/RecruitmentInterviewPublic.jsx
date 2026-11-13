import { bounded } from "./interviewRecovery.js";
import { useEffect, useState } from "react";
import {
  MapPin,
  Clock,
  UserRound,
  Camera,
  Mic,
  Wifi,
  Check,
  ArrowRight,
} from "lucide-react";
import { recruitmentService } from "./recruitmentService.js";
import RecruitmentInterviewSession from "./RecruitmentInterviewSession.jsx";
import { useInterviewDevices } from "./useInterviewDevices.js";
import { interviewLanguages, languageLabel } from "./interviewPresentation.js";
import { candidateText, consentPresentation, preparationDeviceError } from "./candidatePreparation.js";
import "./recruitmentPublic.css";

const tokenFromPath = () =>
  window.location.pathname.match(/^\/i\/([a-f0-9]{64})\/?$/)?.[1] || "";
const interviewStates = [
  "starting",
  "interviewing",
  "interrupted",
  "finalizing",
  "completed",
  "partial",
  "failed",
];
export default function RecruitmentInterviewPublic() {
  const [token] = useState(tokenFromPath);
  const [entry, setEntry] = useState(null),
    [bootstrapError, setBootstrapError] = useState(""),
    [bootstrapRevision, setBootstrapRevision] = useState(0);
  const [name, setName] = useState(""),
    [contact, setContact] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(false),
    [language, setLanguage] = useState("en"),
    [consentSelected, setConsentSelected] = useState(false);
  const [error, setError] = useState(""),
    [readinessBusy, setReadinessBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const [interfaceLanguage, setInterfaceLanguage] = useState(() => {
    try { return localStorage.getItem("feedx-interview-interface") === "zh" ? "zh" : "en"; }
    catch { return "en"; }
  });
  const t = candidateText(interfaceLanguage);
  const consentCopy = consentPresentation(entry?.consent_copy, interfaceLanguage);
  const devices = useInterviewDevices();
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setBootstrapError("");
    bounded(recruitmentService.publicEntry(token), "Loading saved interview", {
      timeoutMs: 15000,
    })
      .then((value) => {
        if (!active) return;
        setEntry(value);
        setName(value?.profile?.full_name || "");
        setContact(value?.profile?.contact || "");
        setLanguage(value?.preferred_language || "en");
      })
      .catch(() => {
        if (active) setBootstrapError("loadErrorDetail");
      });
    return () => {
      active = false;
    };
  }, [token, bootstrapRevision]);
  async function run(action, failure = "saveError") {
    setBusy(true);
    setError("");
    try {
      const value = await bounded(action(), "Saving preparation", {
        timeoutMs: 15000,
      });
      setEntry(value);
      if (value?.preferred_language) setLanguage(value.preferred_language);
      return true;
    } catch {
      setError(failure);
      return false;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      !entry?.consented ||
      entry.status !== "consented" ||
      devices.state.status !== "ready"
    )
      return;
    let active = true;
    setError("");
    setReadinessBusy(true);
    bounded(recruitmentService.ready(token), "Confirming readiness", {
      timeoutMs: 15000,
    })
      .then((value) => {
        if (active) setEntry(value);
      })
      .catch(() => {
        if (active) setError("readinessError");
      })
      .finally(() => {
        if (active) setReadinessBusy(false);
      });
    return () => {
      active = false;
      setReadinessBusy(false);
    };
  }, [entry?.status, entry?.consented, devices.state.status, token]);
  const preview = (node) => {
    devices.previewRef.current = node;
    if (node && node.srcObject !== devices.streamRef.current)
      node.srcObject = devices.streamRef.current;
  };
  async function continueDetails() {
    const saved = await run(async () => {
      let value = await recruitmentService.language(token, language);
      if (value.status === "invited")
        value = await recruitmentService.confirmProfile(token, name, contact);
      return value;
    });
    if (saved) {
      setDetails(false);
      setEditing(false);
    }
  }
  const languageChoices = (
    <fieldset className="candidate-languages">
      <legend>{t.interviewLanguage}</legend>
      <p>{t.languageGuidance}</p>
      <div>
        {interviewLanguages.map((option) => (
          <button key={option.value} className="candidate-button is-secondary" type="button"
            aria-pressed={language === option.value} disabled={busy} onClick={() => setLanguage(option.value)}>
            {language === option.value && <Check size={17} aria-hidden="true" />}
            <span lang={option.value}>{option.value === "zh" && interfaceLanguage === "zh" ? "普通话" : option.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
  const readyHeading = () => <>
    <h1>{t.getReady}</h1>
    <div className="candidate-role">
      <h2>{entry.job.position || entry.job.title}</h2>
      <div className="candidate-role-meta">
        {entry.job.workplace && <span><MapPin size={16} aria-hidden="true" />{entry.job.workplace}</span>}
        {entry.job.target_minutes && <span><Clock size={16} aria-hidden="true" />{t.minutes(entry.job.target_minutes)}</span>}
      </div>
    </div>
  </>;
  const getReady = ({ start, preparing = false } = {}) => (
    <section className="candidate-preparation">
      {readyHeading()}
      <p>
        {t.deviceGuidance}
      </p>
      <div className="candidate-camera">
        <video
          ref={preview}
          className="recruitment-preview recruitment-check-preview"
          autoPlay
          playsInline
          muted
          aria-label={t.cameraPreview}
        />
        {devices.state.status !== "ready" && (
          <span className="candidate-camera-placeholder">
            <Camera size={28} /> {t.cameraPreview}
          </span>
        )}
      </div>
      <div className="candidate-readiness" role="status">
        <div>
          <Camera size={18} />
          <strong>{t.camera}</strong>
          <span>
            {devices.state.status === "ready"
              ? t.ready
              : devices.state.status === "checking"
                ? t.checking
                : t.notReady}
          </span>
        </div>
        <div>
          <Mic size={18} />
          <strong>{t.microphone}</strong>
          <span>
            {devices.state.status === "ready" ? t.ready : t.notReady}
          </span>
          <div
            className="recruitment-meter"
            role="meter"
            aria-label={t.microphoneActivity}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(devices.state.level * 100)}
          >
            <span style={{ width: `${devices.state.level * 100}%` }} />
          </div>
        </div>
        <div>
          <Wifi size={18} />
          <strong>{t.connection}</strong>
          <span>{online ? t.online : t.offline}</span>
        </div>
      </div>
      {devices.state.error && (
        <p className="recruitment-error" role="alert">
          {preparationDeviceError(devices.state.error, interfaceLanguage)}
        </p>
      )}
      {devices.state.status !== "ready" && (
        <button
          className="candidate-button is-secondary recruitment-full"
          disabled={devices.state.status === "checking"}
          onClick={() => devices.start()}
        >
          {devices.state.status === "checking"
            ? t.openingDevices
            : t.enableDevices}
        </button>
      )}
      <div className="candidate-language-summary">
        <div>
          <span>{t.interviewLanguage}</span>
          <strong>{languageLabel(entry.preferred_language)}</strong>
        </div>
        <button
          className="candidate-button is-secondary"
          disabled={busy || details}
          onClick={() => setDetails(true)}
        >
          {t.change}
        </button>
      </div>
      {details && <div className="candidate-language-edit">
        {languageChoices}
        <button className="candidate-button is-secondary" disabled={busy} onClick={continueDetails}>{busy ? t.saving : t.saveLanguage}</button>
        <button className="candidate-button is-quiet" disabled={busy} onClick={() => { setLanguage(entry.preferred_language); setDetails(false); }}>{t.cancel}</button>
      </div>}
      <div className="recruitment-consent">
        {/* Display the canonical versioned disclosure and acceptance snapshot. */}
        {consentCopy.body?.map(text => <p key={text}>{text}</p>)}
        {consentCopy.notice && <p>{consentCopy.notice}</p>}
        {entry.consent_copy?.consent ? (
          <label className="recruitment-checkbox">
            <input
              className="candidate-checkbox"
              type="checkbox"
              checked={!!entry.consented || consentSelected}
              disabled={
                busy || entry.consented || entry.consent_status !== "approved"
              }
              onChange={(event) => {
                if (event.target.checked) {
                  setConsentSelected(true);
                  run(() =>
                    recruitmentService.consent(token, entry.copy_version),
                  ).then((saved) => {
                    if (!saved) setConsentSelected(false);
                  });
                }
              }}
            />
            <span>{consentCopy.consent}</span>
          </label>
        ) : (
          <p>{t.consentUnavailable}</p>
        )}

      </div>
      {error && (
        <p role="alert" className="recruitment-error">
          {t[error]}
        </p>
      )}
      {entry.consented &&
        devices.state.status === "ready" &&
        entry.status !== "ready" &&
        !busy &&
        !readinessBusy && (
          <button
            className="candidate-button is-secondary"
            onClick={() => run(() => recruitmentService.ready(token), "readinessError")}
          >
            {t.retryReadiness}
          </button>
        )}
      <button
        className="candidate-button is-primary recruitment-full"
        disabled={
          busy ||
          details ||
          readinessBusy ||
          preparing ||
          !online ||
          !entry.consented ||
          entry.status !== "ready" ||
          devices.state.status !== "ready"
        }
        onClick={start}
      >
        {t.start} <ArrowRight size={18} />
      </button>
      <p className="recruitment-hint">
        {t.keepOpen}
      </p>
    </section>
  );
  return (
    <main className="recruitment-public" data-resolved-theme="light" lang={interfaceLanguage === "zh" ? "zh-Hans" : "en"}>
      <div className="recruitment-public-card">
        <header className="recruitment-public-header">
          <span className="recruitment-mark">FeedX</span>
          <div className="candidate-interface-language"><span>{t.interfaceLanguage}</span><div role="group" aria-label="Interface language / 界面语言">
            {[['en', 'EN'], ['zh', '中文']].map(([value,label]) => <button key={value} type="button" className="candidate-button is-secondary" aria-pressed={interfaceLanguage === value} onClick={() => {
              setInterfaceLanguage(value);
              try { localStorage.setItem("feedx-interview-interface",value); } catch { /* Optional presentation preference. */ }
            }}>{label}</button>)}
          </div></div>
        </header>
        {entry === null ? (
          <section>
            <h1>
              {bootstrapError
                ? t.loadError
                : t.preparing}
            </h1>
            {bootstrapError && (
              <>
                <p role="alert">{t[bootstrapError]}</p>
                <button
                  className="candidate-button is-primary"
                  onClick={() => setBootstrapRevision((x) => x + 1)}
                >
                  {t.retry}
                </button>
              </>
            )}
          </section>
        ) : !entry.available && !["finalizing", "completed", "partial", "failed"].includes(entry.status) ? (
          <section>
            <h1>{t.linkUnavailable}</h1>
            <p>
              {t.linkUnavailableReason}
            </p>
          </section>
        ) : entry.status === "invited" ? (
          <section className="candidate-preparation">
            {readyHeading()}
            {languageChoices}
            <div className="candidate-identity">
              <div>
                <UserRound size={20} />
                <div>
                  <span>{t.yourDetails}</span>
                  <strong>{name}</strong>
                  <p>{contact}</p>
                </div>
              </div>
              {entry.status === "invited" && (
                <button
                  className="candidate-button is-secondary"
                  disabled={busy}
                  onClick={() => setEditing(!editing)}
                >
                  {editing ? t.done : t.edit}
                </button>
              )}
            </div>
            {editing && entry.status === "invited" && (
              <div className="candidate-edit">
                <label>
                  {t.name}
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    maxLength={160}
                  />
                </label>
                <label>
                  {t.contact}
                  <input
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={40}
                  />
                </label>
              </div>
            )}
            {entry.job.candidate_instructions && (
              <p className="recruitment-hint">
                {entry.job.candidate_instructions}
              </p>
            )}
            {error && (
              <p role="alert" className="recruitment-error">
                {t[error]}
              </p>
            )}
            <button
              className="candidate-button is-primary recruitment-full"
              disabled={
                busy || name.trim().length < 2 || contact.trim().length < 5
              }
              onClick={continueDetails}
            >
              {busy ? t.saving : t.confirmDetails}
              <ArrowRight size={18} />
            </button>
          </section>
        ) : entry.status === "ready" ||
          interviewStates.includes(entry.status) ? (
          <RecruitmentInterviewSession
            token={token}
            entry={entry}
            devices={devices}
            language={interfaceLanguage}
            renderPreparation={getReady}
          />
        ) : (
          getReady()
        )}
      </div>
    </main>
  );
}
