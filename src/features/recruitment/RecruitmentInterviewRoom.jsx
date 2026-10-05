import { Check, Clock, Camera, MapPin } from "lucide-react";
export function InterviewComplete({ entry, completedAt, reason }) {
  return (
    <section className="candidate-complete">
      <div className="candidate-complete-mark" aria-hidden="true">
        <Check size={42} />
      </div>
      <h1>{reason ? "Interview cannot continue" : "Interview complete"}</h1>
      <p>{reason || "Thank you for your time."}</p>
      {!reason && (
        <p className="candidate-complete-note">
          Your responses have been submitted to the hiring team for recruitment
          review.
        </p>
      )}
      <dl className="recruitment-details">
        <div>
          <dt>Interview</dt>
          <dd>{entry.job?.position || entry.job?.title || "Interview"}</dd>
        </div>
        <div>
          <dt>Workplace</dt>
          <dd>{entry.job?.workplace}</dd>
        </div>
        {completedAt && (
          <div>
            <dt>Completed on</dt>
            <dd>
              {new Date(completedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </dd>
          </div>
        )}
      </dl>
      <p className="recruitment-hint">You may now close this page.</p>
    </section>
  );
}
export default function RecruitmentInterviewRoom({
  entry,
  presence,
  status,
  recovering,
  recordingStatus,
  elapsed,
  previewRef,
  children,
}) {
  const state =
    status === "finalizing"
      ? "submitting"
      : recovering
        ? "connecting"
        : status === "interrupted"
          ? "recovering"
          : presence.state;
  const labels = {
    listening: "Listening",
    speaking: "Speaking",
    thinking: "Thinking",
    connecting: "Connecting",
    recovering: "Ready to continue",
    submitting: "Submitting your responses",
  };
  return (
    <section className="candidate-room" data-presence={state}>
      <header className="candidate-room-context">
        <div>
          <strong>
            {entry.job?.position || entry.job?.title || "Interview"}
          </strong>
          <span>
            <MapPin size={14} />
            {entry.job?.workplace}
          </span>
        </div>
        <span className="candidate-room-time">
          <Clock size={16} />
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
        </span>
      </header>
      <div className="candidate-recording" role="status">
        {recordingStatus === "recording" && status === "interviewing"
          ? "● Recording"
          : status === "interrupted"
            ? "Interview paused · saved responses retained"
            : status === "finalizing"
              ? "Submitting your interview"
              : "Preparing your interview"}
      </div>
      <div className="candidate-presence">
        <div className="candidate-orb" aria-hidden="true">
          <i />
          <div className="candidate-wave">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} />
            ))}
          </div>
        </div>
        <h1>FeedX Interviewer</h1>
        <p role="status">
          {labels[state] || "Connecting"}
          {state === "listening" ? " · You can speak now" : ""}
        </p>
      </div>
      {presence.prompt && (
        <div className="candidate-prompt">
          <span>FeedX Interviewer</span>
          <p>{presence.prompt}</p>
        </div>
      )}
      <div className="candidate-self-view">
        <video
          ref={previewRef}
          autoPlay
          playsInline
          muted
          aria-label="Your interview camera"
        />
        <span>
          <Camera size={13} />
          You
        </span>
      </div>
      <div className="candidate-room-controls">{children}</div>
      <p className="recruitment-hint">
        Keep this page open and your screen active. If interrupted, continue
        here with your saved answers.
      </p>
    </section>
  );
}
