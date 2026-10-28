import RecruitmentInterviewRoom, {
  InterviewComplete,
} from "./RecruitmentInterviewRoom.jsx";
import {
  reconcileSubmission,
  isSubmissionTerminal,
} from "./interviewSubmission.js";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { recruitmentService } from "./recruitmentService.js";
import { RecruitmentRealtimeSession } from "./RecruitmentRealtimeSession.js";
import { interviewLocalKey as acquirePartition } from "./interviewRecordingStore.js";
import { InterviewRecording } from "./InterviewRecording.js";
import { InterviewSessionRecoveryController } from "./InterviewSessionRecoveryController.js";
import { InterviewRecoverySurface, InterviewRoomBoundary } from "./InterviewRecoverySurface.jsx";
import { flushSync } from "react-dom";
import { bounded } from "./interviewRecovery.js";

const recoveryLabels = {
  preparing: "Preparing to continue",
  "tab ownership": "Checking this browser tab",
  "server state": "Loading your saved interview",
  "server resume": "Restoring your interview",
  "transcript partition": "Finding saved answers",
  "recent transcript": "Saving recent answers",
  "camera and microphone": "Reacquiring camera and microphone",
  "fresh recording": "Starting a new recording",
  "fresh AI session": "Preparing your interviewer",
  "device readiness": "Waiting for camera and microphone",
  "interviewer playback": "Preparing interviewer audio",
};

function SessionSurface({active,controller,...props}) {
  if(!active)return <InterviewRecoverySurface {...props}/>;
  return <InterviewRoomBoundary key={controller.snapshot.roomEpoch} controller={controller} active><RecruitmentInterviewRoom {...props}/></InterviewRoomBoundary>;
}

export default function RecruitmentInterviewSession({
  token,
  entry,
  devices,
  renderPreparation,
}) {
  const [controller]=useState(()=>new InterviewSessionRecoveryController({token,entry,devices}));
  controller.devices=devices;
  const view=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  const {status,recordingStatus,aiStatus,error,recoveryView,terminalReason,recoveryNotice,presence,turnView}=view;
  const setStatus=value=>controller.update("status",value),setRecordingStatus=value=>controller.update("recordingStatus",value),setError=value=>controller.update("error",value),setTerminalReason=value=>controller.update("terminalReason",value);
  const [actionBusy,setBusy]=useState(false),[elapsed,setElapsed]=useState(0),[actionState,setActionState]=useState("IDLE"),[partialConfirm,setPartialConfirm]=useState(false),[completedAt,setCompletedAt]=useState(entry.completed_at);
  const [submissionState,setSubmissionState]=useState(entry.status==="finalizing"?"PENDING":"IDLE");
  const busy=actionBusy||view.busy;

  const finishReason=useRef(null),actionOwner=useRef(null);
  controller.onCompletion=finalize;
  controller.onInvalidate=()=>{actionOwner.current=null;setActionState("IDLE");setPartialConfirm(false);setBusy(false);};
  const observe=(type,details)=>controller.observe(type,details);
  const claimClient=signal=>controller.claimClient(signal);
  const pause=reason=>controller.pause(reason);
  const start=()=>controller.start(work=>flushSync(work));
  useEffect(()=>controller.mount(),[controller]);
  async function assess() {
    return controller.assess?.();
  }
  function acceptSubmission(result) {
    if (!controller.mounted) return;
    setStatus(result.status);
    setCompletedAt(result.completed_at || entry.completed_at);
    if (!result.completed_at)
      bounded(
        recruitmentService.publicEntry(token),
        "Reading completed interview",
        { timeoutMs: 5000 },
      )
        .then((saved) => {
          if (controller.mounted && isSubmissionTerminal(saved.status))
            setCompletedAt(saved.completed_at);
        })
        .catch(() => {});
    if (result.recording_state) setRecordingStatus(result.recording_state);
    setError("");
    setSubmissionState("COMPLETE");
  }
  async function requestFinish() {
    if (actionOwner.current || controller.submitting) return;
    const owner = crypto.randomUUID();
    actionOwner.current = owner;
    setActionState("CHECKING"); setBusy(true); setError(""); setPartialConfirm(false);
    observe("recovery.command", {stage:"finish.clicked",request_id:owner});
    try {
      const result = await bounded(assess(), "Checking interview completion", {timeoutMs:45000});
      if (actionOwner.current !== owner) return;
      if (!result) throw Error("The interviewer is unavailable. Continue interview or stop and save a partial interview.");
      if (result.can_finish) await finalize(result.max_reached ? "max_duration" : "coverage");
      else {
        observe("recovery.command", {stage:"finish.denied",request_id:owner});
        setError("The interviewer still needs more information. Continue the conversation, or choose Stop and save partial interview.");
      }
    } catch (cause) {
      if (actionOwner.current === owner) {
        observe("recovery.command", {stage:"finish.failed",code:cause.code || "completion_check_failed",request_id:owner});
        setError(cause.message || "Could not check completion. Try again or stop and save a partial interview.");
      }
    } finally {
      if (actionOwner.current === owner) {actionOwner.current=null;setActionState("IDLE");setBusy(false);}
    }
  }
  async function confirmPartialStop() {
    if (actionOwner.current || controller.submitting) return;
    actionOwner.current = crypto.randomUUID();
    setPartialConfirm(false);
    try { await finalize("candidate_stop"); } finally { actionOwner.current=null; }
  }
  async function finalize(reason) {
    if (controller.submitting) return;
    controller.submitting = true;
    finishReason.current = reason;
    setBusy(true);
    setError("");
    setSubmissionState("PENDING");
    setActionState("SUBMITTING");
    setPartialConfirm(false);
    observe("recovery.command", {stage:"submission.requested",code:reason});
    controller.transport?.close();
    clearTimeout(controller.maxTimer);
    try {
      await bounded(
        recruitmentService.finish(token, controller.clientId, reason),
        "Saving interview outcome",
        { timeoutMs: 15000 },
      );
      observe("recovery.command", {stage:"submission.accepted"});
      setStatus("finalizing");
      clearTimeout(controller.maxTimer);
      controller.transport?.close();
      // Native stop still owns its immutable upload. A slow upload must not
      // strand the UI after the server has independently reconciled that unit.
      const tasks = await Promise.allSettled([
        bounded(
          (controller.transport || controller.transport)?.flush(),
          "Saving your responses",
          { timeoutMs: 8000 },
        ),
        bounded(
          controller.capture?.stop("completed"),
          "Saving recording evidence",
          { timeoutMs: 30000 },
        ),
      ]);
      devices.stop();
      const pending = tasks[0].status === "rejected" || tasks[0].value;
      await reconcileSubmission({
        read: () => recruitmentService.publicEntry(token),
        finalize: pending
          ? null
          : () =>
              recruitmentService.evidence("finalize", token, controller.clientId),
        onResult: acceptSubmission,
      });
    } catch (cause) {
      observe("recovery.command", {stage:"submission.failed",code:cause.cause?.code || cause.code || "submission_failed"});
      if (cause.cause?.code === "55000" || cause.code === "55000") {
        controller.submitting = false;
        setSubmissionState("IDLE");
        pause("completion_not_authorized");
        setError("The interview still needs more information. Continue interview to finish the conversation, or save a partial interview.");
        return;
      }
      setError(
        cause.message ||
          "Submission could not be confirmed. Retry with a stable connection.",
      );
      setStatus("finalizing");
      if (cause.code === "submission_unavailable")
        setTerminalReason(cause.message);
      setSubmissionState("SUBMISSION_REQUIRED");
    } finally {
      controller.submitting = false;
      setActionState("IDLE");
      setBusy(false);
    }
  }
  async function retryFinalization() {
    if (controller.submitting) return;
    controller.submitting = true;
    setSubmissionState("PENDING");
    setBusy(true);
    setError("");
    try {
      const saved = await bounded(
        recruitmentService.publicEntry(token),
        "Checking saved interview",
        { timeoutMs: 5000 },
      );
      if (isSubmissionTerminal(saved.status)) {
        acceptSubmission(saved);
        return;
      }
      if (!saved.available)
        throw Error(
          "This interview link is no longer available. Contact the hiring team.",
        );
      await claimClient();
      controller.session = await bounded(
        recruitmentService.begin(token, controller.clientId),
        "Loading your interview",
        { timeoutMs: 15000 },
      );
      if (saved.status !== "finalizing")
        await bounded(
          recruitmentService.finish(
            token,
            controller.clientId,
            finishReason.current || "candidate_stop",
          ),
          "Saving interview outcome",
          { timeoutMs: 15000 },
        );
      const recovery = new InterviewRecording({
        token,
        clientId: controller.clientId,
        startedAt: controller.session.started_at,
        onStatus: setRecordingStatus,
      });
      await bounded(recovery.recover(), "Saving your interview", {
        timeoutMs: 25000,
      });
      if (!controller.transport)
        controller.transport = new RecruitmentRealtimeSession({
          token,
          clientId: controller.clientId,
          startedAt: controller.session.started_at,
          audioElement: controller.audio,
        });
      controller.transport.attemptKey = recovery.attemptKey;
      const pending = await bounded(
        controller.transport.flush(),
        "Saving your responses",
        { timeoutMs: 8000 },
      );
      if (pending)
        throw Error(
          "Some responses are still saving. Try again with a stable connection.",
        );
      await reconcileSubmission({
        read: () => recruitmentService.publicEntry(token),
        finalize: () =>
          recruitmentService.evidence("finalize", token, controller.clientId),
        onResult: acceptSubmission,
      });
    } catch (cause) {
      setError(cause.message);
      if (cause.code === "submission_unavailable")
        setTerminalReason(cause.message);
      setSubmissionState("SUBMISSION_REQUIRED");
    } finally {
      controller.submitting = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (status !== "finalizing" || controller.submitting) return;
    const submissionAbort = new AbortController();
    setSubmissionState("PENDING");
    reconcileSubmission({
      read: () => recruitmentService.publicEntry(token),
      onResult: acceptSubmission,
      signal: submissionAbort.signal,
    }).catch((cause) => {
      if (!submissionAbort.signal.aborted) {
        setError(cause.message);
        if (cause.code === "submission_unavailable")
          setTerminalReason(cause.message);
        setSubmissionState("SUBMISSION_REQUIRED");
      }
    });
    return () => submissionAbort.abort();
  }, [status, token]);
  useEffect(() => {
    const clock = setInterval(() => {
      if (
        controller.session &&
        !controller.submitting &&
        !["completed", "partial", "failed", "finalizing"].includes(
          controller.snapshot.status,
        )
      )
        setElapsed(
          Math.max(
            0,
            Math.floor(
              (Date.now() - Date.parse(controller.session.started_at)) / 1000,
            ),
          ),
        );
    }, 1000);
    const tick = setInterval(async () => {
      if (
        !controller.session ||
        ["completed", "partial", "failed", "finalizing"].includes(
          controller.snapshot.status,
        )
      )
        return;
      setElapsed(
        Math.max(
          0,
          Math.floor(
            (Date.now() - Date.parse(controller.session.started_at)) / 1000,
          ),
        ),
      );
      if (
        document.hidden ||
        controller.paused ||
        controller.state !== "RESUMED"
      )
        return;
      const heartbeatSession = controller.session,
        heartbeatOwner = controller.recoveryId;
      try {
        const state = await recruitmentService.heartbeat(
          token,
          controller.clientId,
        );
        if (
          controller.paused ||
          controller.state !== "RESUMED" ||
          controller.session !== heartbeatSession ||
          controller.recoveryId !== heartbeatOwner
        )
          return;
        controller.transport?.flush().catch(() => {});
        if (state.status === "finalizing" && controller.snapshot.status !== "finalizing")
          finalize("max_duration");
      } catch {
        if (
          controller.paused ||
          controller.state !== "RESUMED" ||
          controller.session !== heartbeatSession ||
          controller.recoveryId !== heartbeatOwner
        )
          return;
        if (!navigator.onLine)
          setError(
            "Connection lost. Recording continues locally. Return online to save evidence.",
          );
        else {
          pause("session_authority_lost");
          setError(
            "The interview could not continue. Tap Continue interview or contact your recruiter.",
          );
        }
      }
    }, 15000);
    return()=>{clearInterval(clock);clearInterval(tick);clearTimeout(controller.maxTimer);};
  }, [token]);
  const submitting = submissionState === "PENDING" || status === "finalizing";
  const terminal =
    ["completed", "partial", "failed"].includes(status) || !!terminalReason;
  if (
    renderPreparation &&
    status === "ready" &&
    recoveryView.state !== "RECOVERING"
  )
    return <>{renderPreparation({ start })}<div ref={node=>{controller.audioHost=node;}} hidden aria-hidden="true" /></>;
  const preview = (node) => {
    devices.previewRef.current = node;
    if (node && node.srcObject !== devices.streamRef.current)
      node.srcObject = devices.streamRef.current;
  };
  const activeRoom=recoveryView.state==="RESUMED"&&!submitting;
  return (
    <>
      {terminal ? (
        <InterviewComplete
          entry={entry}
          completedAt={completedAt}
          reason={
            terminalReason ||
            (status === "partial"
              ? "Your interview was saved with partial evidence. The hiring team can review the available responses."
              : status === "failed"
                ? "Your responses were retained, but the interview evidence could not be fully verified. Contact the hiring team for the next step."
                : "")
          }
        />
      ) : (
        <SessionSurface active={activeRoom} controller={controller}
          entry={entry}
          presence={presence}
          status={
            submissionState === "SUBMISSION_REQUIRED"
              ? "submission_required"
              : submitting ? "finalizing" : status
          }
          recovering={recoveryView.state === "RECOVERING"}
          recordingStatus={recordingStatus}
          elapsed={elapsed}
          previewRef={preview}
        >
          {!submitting && ["RECOVERY_REQUIRED","RECOVERING"].includes(recoveryView.state) && ["interrupted","starting"].includes(status) && (
            <button className="candidate-button is-primary" disabled={controller.submitting} onPointerDown={()=>controller.pointer()} onClick={start}>
              {recoveryView.state==="RECOVERING"?"Retry continuing":"Continue interview"}
            </button>
          )}
          {!submitting && recoveryView.state === "RESUMED" &&
          status === "interviewing" &&
          controller.session ? (
            <div className="recruitment-actions">
              {turnView.listening && <div className="candidate-answer">
                {turnView.uncertain && <p role="status">We couldn’t confidently recognize that answer. Speak again, or check the words in Answer controls.</p>}
                <details>
                  <summary>Answer controls</summary>
                  <p>Answers are sent automatically when you finish speaking. If detection misses your answer, you can check and submit it here.</p>
                  {turnView.text && <p className="candidate-answer-preview">{turnView.text}</p>}
                  {turnView.waiting && <p role="status">Recognizing your answer…</p>}
                  <button className="candidate-button is-secondary" disabled={!turnView.canSend} onClick={()=>{
                    const accepted=controller.confirmAnswer();
                    observe("recovery.command",{stage:"answer.manual",code:accepted ? "accepted" : "not_ready",request_id:controller.recoveryId});
                    setError(accepted ? "" : "Finish speaking and wait for the recognized words, then try again.");
                  }}>Use these words</button>
                  <button className="candidate-button is-secondary" onClick={()=>controller.clearAnswer()}>Discard recognized words</button>
                </details>
              </div>}
              {turnView.canInterrupt && <button className="candidate-button is-secondary" onClick={()=>{
                const accepted=controller.interrupt();
                observe("recovery.command",{stage:"answer.interrupt",code:accepted ? "requested" : "not_ready",request_id:controller.recoveryId});
                if(!accepted)setError("Please wait for the interviewer to finish, then speak your answer.");
              }}>I’d like to speak</button>}
              <button
                className="candidate-button is-secondary"
                disabled={busy}
                onClick={requestFinish}
              >
                {actionState === "CHECKING" ? "Checking completion…" : "Finish interview"}
              </button>
              <button
                className="candidate-button is-secondary"
                disabled={busy}
                onClick={() => { if (!actionOwner.current && !controller.submitting) { setPartialConfirm(true); setError(""); observe("recovery.command", {stage:"partial.confirmation"}); } }}
              >
                Stop and save partial interview
              </button>
            </div>
          ) : null}
          {!submitting && recoveryView.state !== "RECOVERING" && status === "interrupted" && controller.session ? (
            <button
              className="candidate-button is-secondary"
              disabled={busy}
              onClick={() => { if (!actionOwner.current && !controller.submitting) { setPartialConfirm(true); setError(""); observe("recovery.command", {stage:"partial.confirmation"}); } }}
            >
              Stop and save partial interview
            </button>
          ) : null}
          {status === "finalizing" &&
          submissionState === "SUBMISSION_REQUIRED" ? (
            <button
              className="candidate-button is-primary"
              disabled={busy}
              onClick={retryFinalization}
            >
              Retry submission
            </button>
          ) : null}

          {partialConfirm && !submitting && (
            <section role="alertdialog" aria-label="Save partial interview">
              <p>Your saved responses will be submitted as an incomplete interview. Recording gaps remain visible to the hiring team.</p>
              <button className="candidate-button is-primary" disabled={busy} onClick={confirmPartialStop}>Confirm stop and save</button>
              <button className="candidate-button is-secondary" disabled={busy} onClick={() => setPartialConfirm(false)}>Keep interviewing</button>
            </section>
          )}
          {actionState === "CHECKING" && <p role="status" aria-live="polite">Checking whether your interview can finish. Your recording continues.</p>}
          {recoveryView.state === "RECOVERING" && (
            <p role="status">
              {recoveryLabels[recoveryView.stage] || "Preparing your interview"}
            </p>
          )}
          {recoveryNotice && <p role="status">{recoveryNotice}</p>}
          {error && (
            <p className="recruitment-error" role="alert">
              {error}
            </p>
          )}
          {recoveryView.state!=="RESUMED" && <details className="recruitment-hint"><summary>Recovery reference</summary><p>{controller.operation?.id||controller.lastReference||controller.recoveryId||"Not started"}</p><p>{controller.journal.persistent?"Diagnostics are retained after refresh.":"Diagnostics could not be stored on this device; available observations will be sent when connected."}</p></details>}
        </SessionSurface>
      )}
      <div ref={node=>{controller.audioHost=node;}} hidden aria-hidden="true" />
    </>
  );
}
