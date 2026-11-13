import { AlertCircle, Camera, Check, Clock, Mic, Volume2 } from "lucide-react";
import { candidateText } from "./candidatePreparation.js";

export function InterviewComplete({ entry, completedAt, status = "completed", language }) {
  const t = candidateText(language);
  const failed = status === "failed";
  return (
    <section className="candidate-complete">
      <div className={`candidate-state-icon ${failed ? "is-warning" : ""}`} aria-hidden="true">
        {failed ? <AlertCircle size={25} /> : <Check size={25} />}
      </div>
      <h1>{t[status]}</h1>
      <p>{t[`${status}Help`]}</p>
      <dl className="recruitment-details">
        <div><dt>{t.interview}</dt><dd>{entry.job?.position || entry.job?.title || t.interview}</dd></div>
        {entry.job?.workplace && <div><dt>{t.workplace}</dt><dd>{entry.job.workplace}</dd></div>}
        {!failed && completedAt && <div>
          <dt>{t.completedOn}</dt>
          <dd>{new Date(completedAt).toLocaleString(language === "zh" ? "zh-MY" : "en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" })}</dd>
        </div>}
      </dl>
      {!failed && <p className="recruitment-hint">{t.closePage}</p>}
    </section>
  );
}

export default function RecruitmentInterviewRoom({
  entry, presence, recordingStatus, elapsed, previewRef, children, language,
}) {
  const t = candidateText(language);
  const state = presence.state;
  const PresenceIcon = state === "speaking" ? Volume2 : Mic;
  return (
    <section className="candidate-room" data-presence={state}>
      <header className="candidate-room-context">
        <div>
          <h1>{t.interview}</h1>
          <p>{entry.job?.position || entry.job?.title}{entry.job?.workplace && ` · ${entry.job.workplace}`}</p>
        </div>
        <span className="candidate-room-time" aria-label={t.elapsed}>
          <Clock size={16} aria-hidden="true" />
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
        </span>
      </header>
      <div className="candidate-stage">
        <div className="candidate-presence" role="status">
          <span className="candidate-state-icon"><PresenceIcon size={22} aria-hidden="true" /></span>
          <div><strong>{t[state] || t.connecting}</strong>{state === "listening" && <span>{t.speakNow}</span>}</div>
        </div>
        <div className="candidate-self-view">
          <video ref={previewRef} autoPlay playsInline muted aria-label={t.cameraPreview} />
          <span><Camera size={13} aria-hidden="true" />{t.you}</span>
        </div>
        {recordingStatus === "recording" && <span className="candidate-recording"><i aria-hidden="true" />{t.recording}</span>}
      </div>
      <div className="candidate-prompt">
        <span>{t.interviewer}</span>
        <p>{presence.prompt || t.waitingForQuestion}</p>
      </div>
      <div className="candidate-room-controls">{children}</div>
    </section>
  );
}
