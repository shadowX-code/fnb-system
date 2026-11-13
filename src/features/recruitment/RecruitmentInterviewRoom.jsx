import { useEffect, useRef } from "react";
import { AlertCircle, Camera, Check, Clock } from "lucide-react";
import { candidateText } from "./candidatePreparation.js";
import InterviewOrb from "./InterviewOrb.jsx";

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
  entry, presence, recordingStatus, elapsed, previewRef, analyser, children, language,
}) {
  const t = candidateText(language);
  const state = presence.state;
  const caption = useRef(null);
  const followCaption = useRef(true);
  useEffect(() => { followCaption.current = true; }, [presence.item]);
  useEffect(() => {
    if (followCaption.current) caption.current.scrollTop = caption.current.scrollHeight;
  }, [presence.item, presence.prompt]);
  return (
    <section className="candidate-room" data-presence={state}>
      <header className="candidate-room-context">
        <div>
          <h1>{t.interview}</h1>
          <p>{entry.job?.position || entry.job?.title}{entry.job?.workplace && ` · ${entry.job.workplace}`}</p>
        </div>
        <div className="candidate-room-meta">
          {recordingStatus === "recording" && <span className="candidate-recording"><i aria-hidden="true" />{t.recording}</span>}
          <span className="candidate-room-time" aria-label={t.elapsed}>
            <Clock size={14} aria-hidden="true" />
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
          </span>
        </div>
      </header>
      <div className="candidate-stage">
        <div className="candidate-self-view">
          <video ref={previewRef} autoPlay playsInline muted aria-label={t.cameraPreview} />
          <span><Camera size={12} aria-hidden="true" />{t.you}</span>
        </div>
        <InterviewOrb state={state} analyser={analyser} />
        <div className="candidate-presence" role="status">
          <strong>{t[state] || t.connecting}</strong>
          <span>{state === "listening" ? t.speakNow : ""}</span>
        </div>
      </div>
      <div className="candidate-prompt" ref={caption} tabIndex={0} role="region" aria-label={t.interviewer}
        onScroll={({ currentTarget: node }) => {
          followCaption.current = node.scrollHeight - node.clientHeight - node.scrollTop < 12;
        }}>
        <span aria-hidden="true">{t.interviewer}</span>
        <p>{presence.prompt || t.waitingForQuestion}</p>
      </div>
      <div className="candidate-room-controls">{children}</div>
    </section>
  );
}
