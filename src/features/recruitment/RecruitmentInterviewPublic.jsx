import { bounded } from "./interviewRecovery.js";
import { useEffect, useState } from "react";
import {
  MapPin,
  Clock,
  MessageCircle,
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
import { preparationText, consentPresentation, preparationDeviceError } from "./candidatePreparation.js";
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
  const t = preparationText[interfaceLanguage];
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
      .catch((c) => {
        if (active)
          setBootstrapError(
            c.message ||
              "Could not load your interview. Try again with a stable connection.",
          );
      });
    return () => {
      active = false;
    };
  }, [token, bootstrapRevision]);
  async function run(action) {
    setBusy(true);
    setError("");
    try {
      const value = await bounded(action(), "Saving preparation", {
        timeoutMs: 15000,
      });
      setEntry(value);
      return true;
    } catch (c) {
      setError(c.message || "Could not save. Please try again.");
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
      .catch((c) => {
        if (active)
          setError(
            c.message || "Could not confirm readiness. Try again below.",
          );
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
  const getReady = ({ start, preparing = false } = {}) => (
    <section className="candidate-preparation">
      <h1>{t.getReady}</h1>
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
          className="btn-secondary recruitment-full"
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
          className="btn-secondary"
          disabled={busy}
          onClick={() => setDetails(true)}
        >
          {t.change}
        </button>
      </div>
      <div className="recruitment-consent">
        {/* Current bilingual copy includes the automated disclosure in the
            consent itself. Historical pinned copies retain their disclosure. */}
        {consentCopy.body?.map(text => <p key={text}>{text}</p>)}
        {consentCopy.notice && <p>{consentCopy.notice}</p>}
        {entry.consent_copy?.consent ? (
          <label className="recruitment-checkbox">
            <input
              className="admin-checkbox"
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
        {entry.consented && (
          <p className="recruitment-saved" role="status">
            <Check size={15} /> {t.consentRecorded}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="recruitment-error">
          {error}
        </p>
      )}
      {entry.consented &&
        devices.state.status === "ready" &&
        entry.status !== "ready" &&
        !busy &&
        !readinessBusy && (
          <button
            className="btn-secondary"
            onClick={() => run(() => recruitmentService.ready(token))}
          >
            {t.retryReadiness}
          </button>
        )}
      <button
        className="btn-primary recruitment-full"
        disabled={
          busy ||
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
          <div className="candidate-interface-language" role="group" aria-label="Interface language / 界面语言">
            {[['en', 'EN'], ['zh', '中文']].map(([value,label]) => <button key={value} type="button" className="btn-secondary" aria-pressed={interfaceLanguage === value} onClick={() => {
              setInterfaceLanguage(value);
              try { localStorage.setItem("feedx-interview-interface",value); } catch { /* Optional presentation preference. */ }
            }}>{label}</button>)}
          </div>
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
                <p role="alert">{bootstrapError}</p>
                <button
                  className="btn-primary"
                  onClick={() => setBootstrapRevision((x) => x + 1)}
                >
                  {t.retry}
                </button>
              </>
            )}
          </section>
        ) : !entry.available ? (
          <section>
            <h1>{t.linkUnavailable}</h1>
            <p>
              {t.linkUnavailableReason}
            </p>
          </section>
        ) : entry.status === "invited" || details ? (
          <section className="candidate-details">
            <h1>{t.details}</h1>
            <p>{t.detailsGuidance}</p>
            <div className="candidate-role">
              <h2>{entry.job.position || entry.job.title}</h2>
              {entry.job.title !== entry.job.position && (
                <p>{entry.job.title}</p>
              )}
              <dl className="recruitment-details">
                <div>
                  <dt>
                    <MapPin size={17} /> {t.workplace}
                  </dt>
                  <dd>{entry.job.workplace}</dd>
                </div>
                <div>
                  <dt>
                    <Clock size={17} /> {t.duration}
                  </dt>
                  <dd>{t.minutes(entry.job.target_minutes)}</dd>
                </div>
                <div>
                  <dt>
                    <MessageCircle size={17} /> {t.whatToExpect}
                  </dt>
                  <dd>
                    {t.conversation}
                  </dd>
                </div>
              </dl>
            </div>
            <fieldset className="candidate-languages">
              <legend>{t.preferredLanguage}</legend>
              <p>
                {t.languageGuidance}
              </p>
              <div>
                {interviewLanguages.map((option) => (
                  <button
                    key={option.value}
                    className="btn-secondary"
                    type="button"
                    aria-pressed={language === option.value}
                    disabled={busy}
                    onClick={() => setLanguage(option.value)}
                  >
                    {language === option.value && <Check size={17} />}
                    <span lang={option.value}>{option.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>
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
                  className="btn-secondary"
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
                {error}
              </p>
            )}
            <button
              className="btn-primary recruitment-full"
              disabled={
                busy || name.trim().length < 2 || contact.trim().length < 5
              }
              onClick={continueDetails}
            >
              {busy ? t.saving : t.continue}
              <ArrowRight size={18} />
            </button>
          </section>
        ) : entry.status === "ready" ||
          interviewStates.includes(entry.status) ? (
          <RecruitmentInterviewSession
            token={token}
            entry={entry}
            devices={devices}
            renderPreparation={getReady}
          />
        ) : (
          getReady()
        )}
      </div>
    </main>
  );
}
