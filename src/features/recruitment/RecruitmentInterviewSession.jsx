import { useEffect, useRef, useState } from "react";
import { recruitmentService } from "./recruitmentService.js";
import { RecruitmentRealtimeSession } from "./RecruitmentRealtimeSession.js";
import { InterviewRecording } from "./InterviewRecording.js";

export default function RecruitmentInterviewSession({ token, entry, devices }) {
  const [status, setStatus] = useState(entry.status),
    [recordingStatus, setRecordingStatus] = useState("idle"),
    [aiStatus, setAiStatus] = useState("idle"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [coverage, setCoverage] = useState(null);
  const clientId = useRef(crypto.randomUUID()),
    recording = useRef(null),
    ai = useRef(null),
    audio = useRef(null),
    session = useRef(null),
    finishing = useRef(false),
    paused = useRef(false),
    reconnectTimer = useRef(null),
    finishTimer = useRef(null),
    maxTimer = useRef(null),
    finishReason = useRef("coverage"),
    finishApproved = useRef(false),
    statusRef = useRef(status),
    assessing = useRef(false);
  statusRef.current = status;
  const alive = useRef(true);
  async function assess() {
    if (assessing.current) return null;
    assessing.current = true;
    try {
      await ai.current?.flush();
      const result = await recruitmentService.evidence(
        "coverage",
        token,
        clientId.current,
      );
      setCoverage(result);
      return result;
    } finally {
      assessing.current = false;
    }
  }
  async function finalize(reason) {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(true);
    setError("");
    try {
      await recruitmentService.finish(token, clientId.current, reason);
      setStatus("finalizing");
      clearTimeout(reconnectTimer.current);
      clearTimeout(finishTimer.current);
      clearTimeout(maxTimer.current);
      ai.current?.send({ type: "response.cancel" });
      ai.current?.send({ type: "output_audio_buffer.clear" });
      ai.current?.close();
      const pending = await ai.current?.flush();
      await recording.current?.stop("completed");
      devices.stop();
      if (pending)
        throw Error(
          "Some transcript turns are still waiting to save. Keep this page open and retry finalization.",
        );
      const result = await recruitmentService.evidence(
        "finalize",
        token,
        clientId.current,
      );
      setStatus(result.status);
      setRecordingStatus(result.recording_state);
    } catch (cause) {
      setError(
        cause.message ||
          "Evidence is still waiting to upload. Keep this page open and retry.",
      );
      setStatus("finalizing");
    } finally {
      finishing.current = false;
      setBusy(false);
    }
  }
  async function pause(reason) {
    if (paused.current || finishing.current || !recording.current) return;
    paused.current = true;
    setStatus("interrupted");
    setAiStatus("paused");
    clearTimeout(reconnectTimer.current);
    ai.current?.close();
    recruitmentService
      .interruption(token, clientId.current, reason)
      .catch(() => {});
    const stop = recording.current.stop(reason);
    stop.catch(() => setRecordingStatus("upload-pending"));
    setError(
      "The recording was interrupted. Resume when this page is visible and your camera and microphone are available. The interruption will be visible to your recruiter.",
    );
  }
  async function connectAI() {
    if (paused.current || finishing.current || !alive.current) return;
    setAiStatus("connecting");
    const transport = new RecruitmentRealtimeSession({
      token,
      clientId: clientId.current,
      mediaStream: devices.streamRef.current,
      startedAt: session.current.started_at,
      audioElement: audio.current,
      onRemote: (stream) => recording.current?.remote(stream),
      onStatus: (state) => {
        if (!alive.current) return;
        setAiStatus(state);
        if (state === "connected") setStatus("interviewing");
        if (state === "disconnected" && !paused.current && !finishing.current) {
          setError(
            "Reconnecting the AI interviewer. Your camera recording continues.",
          );
          reconnectTimer.current = setTimeout(
            () =>
              connectAI().catch(() => {
                setAiStatus("disconnected");
              }),
            9000,
          );
        }
      },
      onEvent: (event) => {
        if (
          event.type === "conversation.item.input_audio_transcription.completed"
        )
          setTimeout(() => assess().catch(() => {}), 1000);
        if (
          event.type === "response.function_call_arguments.done" &&
          event.name === "request_completion"
        ) {
          assess()
            .then((result) => {
              transport.send({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: event.call_id,
                  output: JSON.stringify(
                    result || {
                      can_finish: false,
                      reason: "Coverage check pending; continue the interview.",
                    },
                  ),
                },
              });
              if (result?.can_finish) {
                finishApproved.current = true;
                finishReason.current = result.max_reached
                  ? "max_duration"
                  : "coverage";
                finishTimer.current = setTimeout(
                  () =>
                    finalize(result.max_reached ? "max_duration" : "coverage"),
                  30000,
                );
              }
              transport.send({ type: "response.create" });
            })
            .catch(() => {
              transport.send({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: event.call_id,
                  output: JSON.stringify({
                    can_finish: false,
                    reason:
                      "Coverage check is temporarily unavailable. Continue with a follow-up.",
                  }),
                },
              });
              transport.send({ type: "response.create" });
            });
        }
        if (
          event.type === "output_audio_buffer.stopped" &&
          finishApproved.current
        )
          finalize(finishReason.current);
      },
    });
    ai.current?.close();
    await ai.current?.flush();
    ai.current = transport;
    await transport.connect();
    setError("");
  }
  async function start() {
    setBusy(true);
    setError("");
    try {
      await recording.current?.captureStopped;
      paused.current = false;
      session.current = await recruitmentService.begin(token, clientId.current);
      const recovering = new InterviewRecording({
        token,
        clientId: clientId.current,
        startedAt: session.current.started_at,
        onStatus: setRecordingStatus,
        onLost: pause,
      });
      await recovering.recover();
      if (!ai.current)
        ai.current = new RecruitmentRealtimeSession({
          token,
          clientId: clientId.current,
          startedAt: session.current.started_at,
          audioElement: audio.current,
        });
      ai.current.attemptKey = recovering.attemptKey;
      const pendingTurns = await ai.current.flush();
      if (session.current.status === "finalizing") {
        setStatus("finalizing");
        if (pendingTurns)
          throw Error(
            "Transcript save is still pending. Retry with a stable connection.",
          );
        const result = await recruitmentService.evidence(
          "finalize",
          token,
          clientId.current,
        );
        setStatus(result.status);
        setRecordingStatus(result.recording_state);
        return;
      }
      devices.stop();
      const stream = await devices.start();
      if (!stream)
        throw Error("Allow your camera and microphone before starting.");
      recording.current = new InterviewRecording({
        token,
        clientId: clientId.current,
        stream,
        startedAt: session.current.started_at,
        onStatus: setRecordingStatus,
        onLost: pause,
      });
      await recording.current.start();
      clearTimeout(maxTimer.current);
      maxTimer.current = setTimeout(
        () => finalize("max_duration"),
        Math.max(0, Date.parse(session.current.max_ends_at) - Date.now()),
      );
      setStatus("starting");
      await connectAI();
    } catch (cause) {
      setError(cause.message || "Unable to start the interview.");
      if (recording.current?.recorder?.state === "recording") {
        setStatus("interrupted");
        await pause("start_failed");
      }
    } finally {
      setBusy(false);
    }
  }
  async function retryFinalization() {
    setBusy(true);
    setError("");
    try {
      session.current = await recruitmentService.begin(token, clientId.current);
      const recovery = new InterviewRecording({
        token,
        clientId: clientId.current,
        startedAt: session.current.started_at,
        onStatus: setRecordingStatus,
      });
      await recovery.recover();
      if (!ai.current)
        ai.current = new RecruitmentRealtimeSession({
          token,
          clientId: clientId.current,
          startedAt: session.current.started_at,
          audioElement: audio.current,
        });
      ai.current.attemptKey = recovery.attemptKey;
      const pending = await ai.current.flush();
      if (pending)
        throw Error(
          "Transcript save is still pending. Retry with a stable connection.",
        );
      const result = await recruitmentService.evidence(
        "finalize",
        token,
        clientId.current,
      );
      setStatus(result.status);
      setRecordingStatus(result.recording_state);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    const clock = setInterval(() => {
      if (
        session.current &&
        !finishing.current &&
        !["completed", "partial", "failed", "finalizing"].includes(
          statusRef.current,
        )
      )
        setElapsed(
          Math.max(
            0,
            Math.floor(
              (Date.now() - Date.parse(session.current.started_at)) / 1000,
            ),
          ),
        );
    }, 1000);
    const tick = setInterval(async () => {
      if (
        !session.current ||
        ["completed", "partial", "failed"].includes(statusRef.current)
      )
        return;
      setElapsed(
        Math.max(
          0,
          Math.floor(
            (Date.now() - Date.parse(session.current.started_at)) / 1000,
          ),
        ),
      );
      try {
        const state = await recruitmentService.heartbeat(
          token,
          clientId.current,
        );
        await ai.current?.flush();
        if (state.status === "finalizing" && statusRef.current !== "finalizing")
          finalize("max_duration");
      } catch {
        if (!navigator.onLine)
          setError(
            "Connection lost. Recording continues locally. Return online to save evidence.",
          );
        else {
          pause("session_authority_lost");
          setError(
            "The interview session could not be renewed. Reopen this link or contact your recruiter.",
          );
        }
      }
    }, 15000);
    const hidden = () => {
      if (document.hidden) pause("page_backgrounded");
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      alive.current = false;
      clearInterval(clock);
      clearInterval(tick);
      clearTimeout(reconnectTimer.current);
      clearTimeout(finishTimer.current);
      clearTimeout(maxTimer.current);
      document.removeEventListener("visibilitychange", hidden);
      ai.current?.close();
      recording.current?.stop("page_closed").catch(() => {});
    };
  }, [token]);
  const terminal = ["completed", "partial", "failed"].includes(status);
  return (
    <section>
      <p className="recruitment-eyebrow">AI voice interview</p>
      <h1>
        {terminal
          ? "Interview saved"
          : status === "finalizing"
            ? "Saving your interview"
            : status === "interrupted"
              ? "Interview interrupted"
              : "Your interview"}
      </h1>
      {terminal ? (
        <>
          <p>
            {status === "completed"
              ? "Thank you. Your interview is ready for your recruiter to review."
              : "Your available interview evidence has been saved. Your recruiter can see any missing or interrupted evidence."}
          </p>
          <p className="recruitment-notice">
            The AI does not make the hiring decision. Your manager reviews the
            interview evidence.
          </p>
        </>
      ) : (
        <>
          <p>
            Use English, BM, Chinese, or switch naturally. Keep this page
            visible throughout the interview. Changing apps or locking your
            phone may interrupt recording.
          </p>
          <video
            ref={devices.previewRef}
            className="recruitment-preview"
            autoPlay
            playsInline
            muted
            aria-label="Interview camera preview"
          />
          <p role="status" className="recruitment-notice">
            <strong>
              {recordingStatus === "recording"
                ? "● Recording"
                : recordingStatus === "verified"
                  ? "Recording saved"
                  : recordingStatus === "upload-pending"
                    ? "Recording upload pending"
                    : recordingStatus === "uploading"
                      ? "Uploading recording"
                      : status === "finalizing"
                        ? "Finalizing evidence"
                        : "Camera recording will start before AI voice"}
            </strong>{" "}
            · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}{" "}
            · AI {aiStatus}
          </p>
          {status === "ready" ||
          (["starting", "interviewing", "interrupted"].includes(status) &&
            !session.current) ? (
            <button
              className="recruitment-primary"
              disabled={busy}
              onClick={start}
            >
              {session.current ? "Resume interview" : "Start interview"}
            </button>
          ) : null}
          {status === "interrupted" && session.current ? (
            <button
              className="recruitment-primary"
              disabled={busy}
              onClick={start}
            >
              Resume with camera and microphone
            </button>
          ) : null}
          {status === "interviewing" || status === "starting" ? (
            <div className="recruitment-actions">
              <button
                className="recruitment-secondary"
                disabled={busy}
                onClick={() => connectAI().catch((c) => setError(c.message))}
              >
                Reconnect AI
              </button>
              <button
                className="recruitment-secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await assess();
                    if (result?.can_finish)
                      await finalize(
                        result.max_reached ? "max_duration" : "coverage",
                      );
                    else
                      setError(
                        "A few required topics remain. Continue with the interviewer, or stop and save a partial interview.",
                      );
                  } catch (c) {
                    setError(c.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Finish interview
              </button>
              <button
                className="recruitment-secondary"
                disabled={busy}
                onClick={() => finalize("candidate_stop")}
              >
                Stop and save partial interview
              </button>
            </div>
          ) : null}
          {status === "interrupted" && session.current ? (
            <button
              className="recruitment-secondary"
              disabled={busy}
              onClick={() => finalize("candidate_stop")}
            >
              Stop and save partial interview
            </button>
          ) : null}
          {status === "finalizing" ? (
            <button
              className="recruitment-primary"
              disabled={busy}
              onClick={retryFinalization}
            >
              Retry saving evidence
            </button>
          ) : null}
          {aiStatus === "audio-blocked" ? (
            <button
              className="recruitment-secondary"
              onClick={() => audio.current.play().catch(() => {})}
            >
              Enable interviewer audio
            </button>
          ) : null}
          {coverage ? (
            <p>
              {coverage.unresolved_topics.length} required topics remaining ·{" "}
              {coverage.pending_scenarios.length} scenarios remaining
            </p>
          ) : null}
        </>
      )}
      <audio ref={audio} autoPlay />
      {error ? (
        <p className="recruitment-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
