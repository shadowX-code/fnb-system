import { useEffect, useState } from "react";
import Modal from "../../components/feedback/Modal.jsx";
import { recruitmentService } from "./recruitmentService.js";
export default function RecruitmentEvidenceReview({ application, onClose }) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  const load = () =>
    recruitmentService
      .managerEvidence(application.id)
      .then(setData)
      .catch((c) => setError(c.message || "Evidence unavailable."));
  useEffect(() => {
    load();
  }, [application.id]);
  return (
    <Modal
      title={`${application.name} · Interview evidence`}
      size="xl"
      onClose={onClose}
      footer={
        <button className="btn-secondary" onClick={load}>
          Refresh playback links
        </button>
      }
    >
      {error ? (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      ) : null}
      {!data ? (
        <p>Loading evidence…</p>
      ) : (
        <div className="space-y-5">
          <p>
            Interview: <strong>{data.attempt?.status || "Not started"}</strong>{" "}
            · Recording:{" "}
            <strong>{data.attempt?.recording_state || "Not started"}</strong>
          </p>
          <p className="text-sm text-text-secondary">
            Recordings are private interview evidence. Review answers against
            the transcript and recording. Appearance, expressions, voice
            characteristics and inferred personality are not hiring signals.
          </p>
          <div className="space-y-4">
            {data.units.map((unit) => (
              <div
                key={unit.id}
                className="rounded-xl border border-border p-3"
              >
                <p>
                  Recording {unit.sequence} · {unit.status} ·{" "}
                  {Math.round(unit.elapsed_start_ms / 1000)}s –{" "}
                  {unit.elapsed_end_ms == null
                    ? unit.status === "capturing"
                      ? "in progress"
                      : "end time unavailable"
                    : `${Math.round(unit.elapsed_end_ms / 1000)}s`}{" "}
                  {unit.end_reason && unit.end_reason !== "completed"
                    ? `· ${unit.end_reason.replaceAll("_", " ")}`
                    : ""}
                </p>
                {unit.signed_url ? (
                  <video
                    controls
                    playsInline
                    preload="metadata"
                    src={unit.signed_url}
                    className="mt-2 w-full max-h-96"
                  />
                ) : (
                  <p className="text-sm text-text-muted">
                    This unit has no verified playable file. Acknowledged upload
                    chunks remain private evidence.
                  </p>
                )}
              </div>
            ))}
          </div>
          <div>
            <h3 className="font-semibold">Required evidence coverage</h3>
            {data.topics.map((topic) => (
              <p key={topic.topic_index}>
                {topic.state === "covered" ? "Covered" : "Unresolved"} ·{" "}
                {topic.topic}
                {topic.evidence_turn_id
                  ? ` · transcript evidence ${data.turns.findIndex((t) => t.id === topic.evidence_turn_id) + 1}`
                  : ""}
              </p>
            ))}
            {data.scenarios.map((s) => (
              <p key={s.scenario_index}>
                Scenario {s.scenario_index + 1}: {s.state} · {s.brief}
                {s.evidence_turn_id
                  ? ` · transcript evidence ${data.turns.findIndex((t) => t.id === s.evidence_turn_id) + 1}`
                  : ""}
              </p>
            ))}
          </div>
          <div>
            <h3 className="font-semibold">Ordered transcript</h3>
            <p className="text-sm text-text-muted">
              AI text reflects provider output. Interrupted AI speech may
              include unplayed words; use the recording to confirm what was
              heard. Timing is approximate.
            </p>
            {data.turns.map((turn, index) => (
              <div key={turn.id} className="border-b border-border py-3">
                <p className="text-xs text-text-muted">
                  Turn {index + 1} ·{" "}
                  {turn.speaker === "ai" ? "AI interviewer" : "Candidate"} ·{" "}
                  {Math.round((turn.elapsed_end_ms || 0) / 1000)}s
                  {data.annotations.some(
                    (a) =>
                      a.provider_generation === turn.provider_generation &&
                      a.provider_item_id === turn.provider_item_id &&
                      a.kind === "truncated",
                  )
                    ? " · AI interrupted"
                    : ""}
                </p>
                <p className="whitespace-pre-wrap">{turn.transcript}</p>
              </div>
            ))}
          </div>
          <div>
            <h3 className="font-semibold">Interruptions and recovery</h3>
            {data.events
              .filter((e) =>
                /gap|reconnect|disconnected|resumed|finalized/.test(e.action),
              )
              .map((e, index) => (
                <p key={index} className="text-sm">
                  {new Date(e.occurred_at).toLocaleString()} ·{" "}
                  {e.action.replaceAll("_", " ")}
                  {e.details?.reason
                    ? ` · ${e.details.reason.replaceAll("_", " ")}`
                    : ""}
                </p>
              ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
