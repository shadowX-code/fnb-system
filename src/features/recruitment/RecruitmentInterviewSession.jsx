import { useEffect, useRef, useState } from "react";
import { recruitmentService } from "./recruitmentService.js";
import { RecruitmentRealtimeSession } from "./RecruitmentRealtimeSession.js";
import { acquireInterviewClient } from "./interviewClient.js";
import { interviewLocalKey as acquirePartition } from "./interviewRecordingStore.js";
import { InterviewRecording } from "./InterviewRecording.js";
import { bounded, InterviewRecovery, readyInterviewMedia } from "./interviewRecovery.js";

const recoveryLabels = {
  preparing: "Preparing to resume", "tab ownership": "Checking this browser tab",
  "server state": "Loading your saved interview", "server resume": "Restoring your interview",
  "transcript partition": "Finding saved answers", "recent transcript": "Saving recent answers",
  "camera and microphone": "Reacquiring camera and microphone", "fresh recording": "Starting a new recording",
  "fresh AI session": "Reconnecting your interviewer",
  "device readiness": "Waiting for camera and microphone",
};

export default function RecruitmentInterviewSession({ token, entry, devices }) {
  const [status, setStatus] = useState(["starting", "interviewing", "interrupted"].includes(entry.status) ? "interrupted" : entry.status),
    [recordingStatus, setRecordingStatus] = useState("idle"),
    [aiStatus, setAiStatus] = useState("idle"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [coverage, setCoverage] = useState(null),
    [recoveryView, setRecoveryView] = useState({state:"RECOVERY_REQUIRED",stage:""}),
    [terminalReason, setTerminalReason] = useState(""),
    [recoveryNotice,setRecoveryNotice] = useState("");
  const clientId = useRef(null),
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
  const alive = useRef(true), connecting = useRef(null), starting = useRef(false), releaseClient = useRef(null), recovery = useRef(null);
  const machine = useRef(null), recoveryId = useRef(null), observations = useRef([]);
  function observe(type, details = {}) {
    const item = {key:crypto.randomUUID(), record:{type,at:Date.now(),hidden:document.hidden,...details}};
    observations.current.push(item);
    if (!clientId.current) return;
    for (const event of observations.current.splice(0, 40))
      bounded(recruitmentService.observeRecovery(token,clientId.current,event.key,event.record), "Saving recovery observation", {timeoutMs:5000}).catch(() => {});
  }
  if (!machine.current) machine.current = new InterviewRecovery(view => {
    if (!alive.current) return;
    setRecoveryView(view);
    setBusy(view.state === "RECOVERING");
    observe("recovery.transition",{...view,request_id:machine.current?.operation?.id || recoveryId.current});
  });
  async function claimClient(signal) {
    if (!releaseClient.current) {
      const claim = await bounded(acquireInterviewClient(token), "Interview tab ownership", {signal,onLate: value=>value.release()});
      clientId.current = claim.clientId;
      releaseClient.current = claim.release;
    }
  }
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
      await bounded(recruitmentService.finish(token, clientId.current, reason),"Saving interview outcome",{timeoutMs:15000});
      setStatus("finalizing");
      clearTimeout(reconnectTimer.current);
      clearTimeout(finishTimer.current);
      clearTimeout(maxTimer.current);
      ai.current?.close();
      const pending = await bounded(ai.current?.flush(),"Saving transcript",{timeoutMs:8000});
      await bounded(recording.current?.stop("completed"),"Saving recording evidence",{timeoutMs:30000});
      devices.stop();
      if (pending)
        throw Error(
          "Some transcript turns are still waiting to save. Keep this page open and retry finalization.",
        );
      const result = await bounded(recruitmentService.evidence(
        "finalize",token,clientId.current,
      ),"Finalizing saved evidence",{timeoutMs:20000});
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
  function pause(reason) {
    if (finishing.current) return;
    const wasPaused = paused.current;
    paused.current = true;
    machine.current.cancel();
    connecting.current = null;
    setStatus("interrupted");
    setAiStatus("paused");
    clearTimeout(reconnectTimer.current);
    clearTimeout(maxTimer.current);
    clearTimeout(finishTimer.current);
    finishApproved.current = false;
    ai.current?.close();
    const prior = recording.current;
    // Never join stale close/upload/IndexedDB promises before a new acquisition.
    prior?.stop(reason).catch(() => setRecordingStatus("upload-pending"));
    devices.stop();
    if (!wasPaused && clientId.current && recoveryId.current) {
      const pauseId = recoveryId.current;
      recovery.current = bounded(recruitmentService.recoverPause(token,clientId.current,recoveryId.current,reason), "Pausing interview", {timeoutMs:8000});
      recovery.current.catch(cause=>{
        observe("recovery.error",{stage:"pause",code:cause.code||"request_failed",request_id:pauseId});
        if (paused.current) setError("Your connection could not confirm the pause. Tap Resume to restore the server state.");
      });
    }
    setError("The interview paused. Tap Resume to reacquire camera and microphone. Saved answers remain; the recording gap will be visible to your recruiter.");
  }
  async function connectAI(signal) {
    if (connecting.current) return connecting.current;
    connecting.current = replaceAI(signal);
    const pending = connecting.current;
    try { return await pending; } catch(cause) {
      if (!machine.current.operation && !paused.current) pause("provider_reconnect_failed");
      throw cause;
    } finally { if (connecting.current === pending) connecting.current = null; }
  }
  async function replaceAI(signal) {
    if (paused.current || finishing.current || !alive.current || document.hidden) return;
    clearTimeout(reconnectTimer.current);
    finishApproved.current = false;
    clearTimeout(finishTimer.current);
    setAiStatus("connecting");
    const transport = new RecruitmentRealtimeSession({
      token,
      clientId: clientId.current,
      mediaStream: devices.streamRef.current,
      recoveryId: recoveryId.current,
      startedAt: session.current.started_at,
      audioElement: audio.current,
      onRemote: (stream) => { if (ai.current === transport && !paused.current) recording.current?.remote(stream); },
      onStatus: (state) => {
        if (!alive.current || ai.current !== transport || paused.current) return;
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
        if (!alive.current || ai.current !== transport || paused.current) return;
        if (
          event.type === "conversation.item.input_audio_transcription.completed"
        )
          setTimeout(() => assess().catch(() => {}), 1000);
        if (
          event.type === "response.function_call_arguments.done" &&
          event.name === "request_completion"
        ) {
          const owner = transport.responses.owner;
          assess().then((result) => {
            if (ai.current !== transport || paused.current) return;
            const output = result || { can_finish: false, reason: "Coverage check pending; continue the interview." };
            if (result?.can_finish && transport.responses.owner === owner) {
              finishApproved.current = true;
              finishReason.current = result.max_reached ? "max_duration" : "coverage";
              finishTimer.current = setTimeout(() => finalize(finishReason.current), 30000);
            }
            transport.completeTool(event, output, owner);
          }).catch(() => {
            if (ai.current === transport && !paused.current)
              transport.completeTool(event, {can_finish:false,reason:"Coverage check unavailable. Continue with the remaining evidence."}, owner);
          });
        }
        if (
          event.type === "output_audio_buffer.stopped" &&
          finishApproved.current && event.response_id === transport.closingResponseId
        )
          finalize(finishReason.current);
      },
    });
    ai.current?.close();
    ai.current?.flush().catch(() => {});
    if (paused.current || finishing.current || !alive.current || document.hidden) { transport.close(); return; }
    ai.current = transport;
    await bounded(transport.connect({signal}), "AI connection", {signal,timeoutMs:25000});
    if (ai.current === transport && !paused.current) setError("");
  }
  async function start() {
    if (document.hidden) { setError("Return to this page before resuming."); return; }
    if (machine.current.state === "RESUMED") return;
    let activation, mediaPromise;
    let operation;
    try {
      operation = machine.current.begin(owner=>{
        mediaPromise = devices.start({signal:owner.controller.signal,meter:false,
          onNative:details=>observe("recovery.media",{request_id:owner.id,...details})});
        mediaPromise.catch(() => {});
        activation = InterviewRecording.activateAudio();
      });
    } catch(cause) {
      setError("Native audio could not start. Tap Resume to try again.");
      setStatus("interrupted");setAiStatus("paused");devices.stop();return;
    }
    observe("recovery.command",{stage:"resume",request_id:operation.id});
    recoveryId.current = operation.id;
    starting.current = true;
    paused.current = false;
    setError("");
    setAiStatus("recovering");
    setRecoveryNotice("");
    let media, capture, serverClaimed = false;
    const step = (stage,work,options) => machine.current.step(operation,stage,work,options);
    try {
      // getUserMedia must precede Web Audio, old transport and capture cleanup.
      observe("recovery.media",{request_id:operation.id,stage:"audio.activation",audio_state:activation.context.state});
      bounded(activation.ready,"Audio activation",{signal:operation.controller.signal,timeoutMs:10000})
        .then(()=>observe("recovery.media",{request_id:operation.id,stage:"audio.activated",audio_state:activation.context.state}))
        .catch(cause=>observe("recovery.error",{request_id:operation.id,stage:"audio.activation",code:cause.code||cause.name||"native_audio_failed"}));
      let freshStream;
      operation.controller.signal.addEventListener("abort",()=>{
        freshStream?.getTracks().forEach(track=>track.stop());
        activation.context.close().catch(()=>{});
      },{once:true});
      media = bounded(mediaPromise, "Camera and microphone", {signal:operation.controller.signal,timeoutMs:15000,onLate:stream=>stream?.getTracks().forEach(track=>track.stop())});
      media.catch(() => {});
      ai.current?.close(); ai.current = null;
      connecting.current = null;
      clearTimeout(maxTimer.current);
      const oldCapture = recording.current;
      oldCapture?.stop("recovery_replaced").catch(() => {});
      const stream = freshStream = await step("camera and microphone",()=>media);
      if (!stream) throw Object.assign(Error("Camera and microphone could not start. Tap Resume to reacquire them."),{code:"native_media_failed"});
      await step("device readiness",signal=>readyInterviewMedia(stream,signal),{timeoutMs:5000});
      observe("recovery.media",{request_id:operation.id,stage:"tracks.validated",tracks:stream.getTracks().map(t=>({kind:t.kind,state:t.readyState,muted:t.muted})),audio_state:activation.context.state});
      await step("tab ownership",signal=>claimClient(signal));
      observe("recovery.bootstrap",{request_id:operation.id});
      const durable = await step("server state",signal=>recruitmentService.recoveryState(token,clientId.current,signal));
      if (durable.state === "TERMINAL" && durable.status !== "finalizing") {
        setTerminalReason(durable.reason || "This interview has already ended. Please contact your recruiter if another interview is needed.");
        machine.current.finish(operation,"TERMINAL");
        devices.stop(); activation.context.close().catch(()=>{}); return;
      }
      session.current = await step("server resume",signal=>recruitmentService.recoverBegin(token,clientId.current,operation.id,durable.recovery_id||null,signal));
      serverClaimed = true;
      if (session.current.status === "finalizing") {
        setStatus("finalizing"); machine.current.finish(operation,"TERMINAL"); devices.stop(); activation.context.close().catch(()=>{}); return;
      }
      const recovering = new InterviewRecording({token,clientId:clientId.current,startedAt:session.current.started_at,onStatus:state=>{if(recording.current?.recorder?.state!=="recording")setRecordingStatus(state);}});
      // Old unit reconciliation/uploads are independent of live continuation.
      recovering.recover({deferUploads:true,excludeUnit:()=>recording.current?.unit?.id}).then(()=>recovering.uploadRecovery).catch(()=>setRecordingStatus("upload-pending"));
      const transcript = new RecruitmentRealtimeSession({token,clientId:clientId.current,startedAt:session.current.started_at,audioElement:audio.current});
      // Restore locally queued turns before constructing server-approved continuation context.
      transcript.attemptKey = await step("transcript partition",()=>acquirePartition(token));
      try {
        const pendingTurns = await step("recent transcript",()=>transcript.flush(),{timeoutMs:8000});
        if (pendingTurns) setRecoveryNotice("Some local evidence is still waiting to save. The interview continues from your saved answers; missing evidence remains visible to your recruiter.");
      } catch(cause) {
        if (!machine.current.current(operation)) throw cause;
        observe("recovery.error",{request_id:operation.id,stage:"recent transcript",code:cause.code||"local_evidence_pending"});
        setRecoveryNotice("Some local evidence is still waiting to save. The interview continues from your saved answers; missing evidence remains visible to your recruiter.");
      }
      capture = new InterviewRecording({token,clientId:clientId.current,stream,startedAt:session.current.started_at,audioActivation:activation,recoveryId:operation.id,onStatus:state=>{if(recording.current===capture)setRecordingStatus(state);},onLost:reason=>{if(recording.current===capture && recoveryId.current===operation.id)pause(reason);}});
      recording.current = capture;
      await step("fresh recording",signal=>capture.start({signal}));
      if (document.hidden || paused.current) throw Error("Return to this page and tap Resume again.");
      setStatus("starting");
      await step("fresh AI session",signal=>connectAI(signal),{timeoutMs:30000});
      clearTimeout(maxTimer.current);
      const approvedSession = session.current;
      maxTimer.current = setTimeout(()=>{
        if (!paused.current && machine.current.state === "RESUMED" && session.current === approvedSession) finalize("max_duration");
      },Math.max(0,Date.parse(approvedSession.max_ends_at)-Date.now()));
      machine.current.finish(operation,"RESUMED");
    } catch (cause) {
      if (!machine.current.current(operation)) return;
      observe("recovery.error",{request_id:operation.id,stage:machine.current.stage,code:cause.code||cause.name||"dependency_failed"});
      operation.controller.abort();
      ai.current?.close();
      capture?.stop("recovery_failed").catch(()=>{});
      capture?.dispose();
      devices.stop();
      activation?.context.close().catch(()=>{});
      paused.current = true;
      if (serverClaimed) bounded(recruitmentService.recoverPause(token,clientId.current,operation.id,"recovery_failed"),"Pausing failed recovery",{timeoutMs:8000}).catch(()=>{});
      setStatus("interrupted");setAiStatus("paused");
      setError(cause.message||"Recovery failed. Tap Resume to try again.");
      machine.current.finish(operation,"RECOVERY_REQUIRED");
    } finally {
      if (!machine.current.operation) { starting.current = false; setBusy(false); }
    }
  }
  async function retryFinalization() {
    setBusy(true);
    setError("");
    try {
      await claimClient();
      session.current = await bounded(recruitmentService.begin(token, clientId.current),"Loading evidence recovery",{timeoutMs:15000});
      const recovery = new InterviewRecording({
        token,
        clientId: clientId.current,
        startedAt: session.current.started_at,
        onStatus: setRecordingStatus,
      });
      await bounded(recovery.recover(),"Recovering saved evidence",{timeoutMs:25000});
      if (!ai.current)
        ai.current = new RecruitmentRealtimeSession({
          token,
          clientId: clientId.current,
          startedAt: session.current.started_at,
          audioElement: audio.current,
        });
      ai.current.attemptKey = recovery.attemptKey;
      const pending = await bounded(ai.current.flush(),"Saving transcript",{timeoutMs:8000});
      if (pending)
        throw Error(
          "Transcript save is still pending. Retry with a stable connection.",
        );
      const result = await bounded(recruitmentService.evidence(
        "finalize",token,clientId.current,
      ),"Finalizing saved evidence",{timeoutMs:20000});
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
      if (document.hidden || paused.current || machine.current.state !== "RESUMED") return;
      const heartbeatSession = session.current, heartbeatOwner = recoveryId.current;
      try {
        const state = await recruitmentService.heartbeat(
          token,
          clientId.current,
        );
        if (paused.current || machine.current.state !== "RESUMED" || session.current !== heartbeatSession || recoveryId.current !== heartbeatOwner) return;
        ai.current?.flush().catch(() => {});
        if (state.status === "finalizing" && statusRef.current !== "finalizing")
          finalize("max_duration");
      } catch {
        if (paused.current || machine.current.state !== "RESUMED" || session.current !== heartbeatSession || recoveryId.current !== heartbeatOwner) return;
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
      observe("recovery.visibility",{stage:document.hidden?"background":"foreground",request_id:recoveryId.current});
      if (document.hidden) pause("page_backgrounded");
      else if (paused.current) {
        setStatus("interrupted");
        setError("Ready to continue. Tap Resume to start a fresh camera and microphone. Your saved answers are retained; the recording gap will be visible to your recruiter.");
      }
    };
    const pagehide = () => pause("page_closed");
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", pagehide);
    return () => {
      alive.current = false;
      machine.current.cancel();
      devices.stop();
      clearInterval(clock);
      clearInterval(tick);
      clearTimeout(reconnectTimer.current);
      clearTimeout(finishTimer.current);
      clearTimeout(maxTimer.current);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", pagehide);
      releaseClient.current?.();
      releaseClient.current = null;
      ai.current?.close();
      recording.current?.stop("page_closed").catch(() => {});
    };
  }, [token]);
  const terminal = ["completed", "partial", "failed"].includes(status) || !!terminalReason;
  return (
    <section>
      <p className="recruitment-eyebrow">AI voice interview</p>
      <h1>
        {terminal
          ? terminalReason ? "Interview cannot continue" : "Interview saved"
          : status === "finalizing"
            ? "Saving your interview"
            : status === "interrupted"
              ? "Interview interrupted"
              : "Your interview"}
      </h1>
      {terminal ? (
        <>
          <p>
            {terminalReason || (status === "completed"
              ? "Thank you. Your interview is ready for your recruiter to review."
              : "Your available interview evidence has been saved. Your recruiter can see any missing or interrupted evidence.")}
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
              disabled={finishing.current}
              onClick={start}
            >
              {status === "ready" ? "Start interview" : "Resume with camera and microphone"}
            </button>
          ) : null}
          {status === "interrupted" && session.current ? (
            <button
              className="recruitment-primary"
              disabled={finishing.current}
              onClick={start}
            >
              Resume with camera and microphone
            </button>
          ) : null}
          {recoveryView.state === "RECOVERING" && status === "starting" && session.current ? <button className="recruitment-primary" onClick={start}>Resume with camera and microphone</button> : null}
          {(status === "interviewing" || status === "starting") && session.current ? (
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
      {recoveryView.state === "RECOVERING" ? <p role="status">{recoveryLabels[recoveryView.stage] || "Restoring your interview"}</p> : null}
      {recoveryNotice ? <p role="status">{recoveryNotice}</p> : null}
      <audio ref={audio} autoPlay />
      {error ? (
        <p className="recruitment-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
