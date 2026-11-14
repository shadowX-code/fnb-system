import RecruitmentInterviewRoom, {
  InterviewComplete,
} from "./RecruitmentInterviewRoom.jsx";
import {
  reconcileSubmission,
  isSubmissionTerminal,
  submissionIntent,
} from "./interviewSubmission.js";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { recruitmentService } from "./recruitmentService.js";
import { RecruitmentRealtimeSession } from "./RecruitmentRealtimeSession.js";
import { InterviewRecording } from "./InterviewRecording.js";
import { InterviewSessionRecoveryController } from "./InterviewSessionRecoveryController.js";
import { InterviewRecoverySurface, InterviewRoomBoundary } from "./InterviewRecoverySurface.jsx";
import { flushSync } from "react-dom";
import { bounded } from "./interviewRecovery.js";

import { candidateText } from "./candidatePreparation.js";

function SessionSurface({active,controller,...props}) {
  if(!active)return <InterviewRecoverySurface {...props}/>;
  return <InterviewRoomBoundary key={controller.snapshot.roomEpoch} controller={controller} active><RecruitmentInterviewRoom {...props}/></InterviewRoomBoundary>;
}

export default function RecruitmentInterviewSession({
  token,
  entry,
  devices,
  renderPreparation,
  language,
}) {
  const t = candidateText(language);
  const [controller]=useState(()=>new InterviewSessionRecoveryController({token,entry,devices}));
  controller.devices=devices;
  const view=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  const {hasConnected,status,recordingStatus,error,recoveryView,recoveryNotice,presence,turnView}=view;
  const setStatus=value=>controller.update("status",value),setRecordingStatus=value=>controller.update("recordingStatus",value),setError=value=>controller.update("error",value);
  const [actionBusy,setBusy]=useState(false),[elapsed,setElapsed]=useState(0),[actionState,setActionState]=useState("IDLE"),[partialConfirm,setPartialConfirm]=useState(false),[completedAt,setCompletedAt]=useState(entry.completed_at);
  const finishReason=useRef(submissionIntent(controller.journal.key)),actionOwner=useRef(null);
  const [submissionState,setSubmissionState]=useState(() =>
    entry.status === "finalizing" ? "PENDING" :
      !isSubmissionTerminal(entry.status) && finishReason.current ? "SUBMISSION_REQUIRED" : "IDLE"
  );
  controller.submissionPending = ["PENDING", "SUBMISSION_REQUIRED"].includes(submissionState);
  const busy=actionBusy||view.busy;

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
    submissionIntent(controller.journal.key, null);
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
    if (controller.transport?.naturalQa) {
      setPartialConfirm(true);
      return;
    }
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
        setError("moreNeeded");
      }
    } catch (cause) {
      if (actionOwner.current === owner) {
        observe("recovery.command", {stage:"finish.failed",code:cause.code || "completion_check_failed",request_id:owner});
        setError("finishUnavailable");
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
    controller.submissionPending = true;
    finishReason.current = reason;
    submissionIntent(controller.journal.key, reason);
    setBusy(true);
    setError("");
    setSubmissionState("PENDING");
    setActionState("SUBMITTING");
    setPartialConfirm(false);
    observe("recovery.command", {stage:"submission.requested",code:reason});
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
          controller.transport?.flush(),
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
      if (isFinishDenied(cause)) {
        releaseDeniedSubmission();
        return;
      }
      controller.transport?.close();
      controller.abandon(() => controller.capture?.stop("completed"), "capture.submission");
      devices.stop();
      submissionFailed(cause);
    } finally {
      controller.submitting = false;
      setActionState("IDLE");
      setBusy(false);
    }
  }
  const isFinishDenied = (cause) => (cause.cause?.code || cause.code) === "55000";
  function releaseDeniedSubmission() {
    submissionIntent(controller.journal.key, null);
    finishReason.current = null;
    controller.submitting = false;
    controller.submissionPending = false;
    setSubmissionState("IDLE");
    if (controller.session && controller.state === "RESUMED") pause("completion_not_authorized");
    setStatus(controller.snapshot.hasConnected ? "interrupted" : "start_failed");
    setError("moreNeeded");
  }
  function submissionFailed(cause) {
    if (cause.code === "submission_unavailable") {
      submissionIntent(controller.journal.key, null);
      setStatus("failed");
      setSubmissionState("COMPLETE");
      return;
    }
    setSubmissionState("SUBMISSION_REQUIRED");
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
        throw Object.assign(Error("Interview unavailable"), { code: "submission_unavailable" });
      await claimClient();
      controller.session = await bounded(
        recruitmentService.begin(token, controller.clientId),
        "Loading your interview",
        { timeoutMs: 15000 },
      );
      if (controller.session.status !== "finalizing" && saved.status !== "finalizing" && !finishReason.current)
        throw Error("Submission state changed");
      if (controller.session.status !== "finalizing" && saved.status !== "finalizing") {
        await bounded(
          recruitmentService.finish(
            token,
            controller.clientId,
            finishReason.current,
          ),
          "Saving interview outcome",
          { timeoutMs: 15000 },
        ).catch(cause => {
          if (isFinishDenied(cause)) releaseDeniedSubmission();
          throw cause;
        });
      }
      setStatus("finalizing");
      if (controller.capture?.captureStopped)
        await bounded(controller.capture.captureStopped, "Saving recording evidence", { timeoutMs: 15000 });
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
      observe("recovery.command", {stage:"submission.retry_failed", code:cause.cause?.code || cause.code || "submission_failed"});
      if (controller.submissionPending) submissionFailed(cause);
    } finally {
      controller.submitting = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (status !== "finalizing" || controller.submitting || submissionState === "SUBMISSION_REQUIRED") return;
    const submissionAbort = new AbortController();
    setSubmissionState("PENDING");
    reconcileSubmission({
      read: () => recruitmentService.publicEntry(token),
      onResult: acceptSubmission,
      signal: submissionAbort.signal,
    }).catch((cause) => {
      if (!submissionAbort.signal.aborted) {
        submissionFailed(cause);
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
        controller.submissionPending ||
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
          setError("offlineInterview");
        else {
          pause("session_authority_lost");
          setError("continueFailed");
        }
      }
    }, 15000);
    return()=>{clearInterval(clock);clearInterval(tick);clearTimeout(controller.maxTimer);};
  }, [token]);
  const submitting = controller.submissionPending || status === "finalizing";
  const terminal = isSubmissionTerminal(status);
  const { previewRef, streamRef } = devices;
  const preview = useCallback((node) => {
    previewRef.current = node;
    if (node && node.srcObject !== streamRef.current) node.srcObject = streamRef.current;
  }, [previewRef, streamRef]);
  if (
    !submitting && renderPreparation &&
    status === "ready" &&
    recoveryView.state !== "RECOVERING"
  )
    return <>{renderPreparation({ start })}<div key="interview-audio" ref={node=>{controller.audioHost=node;}} hidden aria-hidden="true" /></>;
  const activeRoom=recoveryView.state==="RESUMED"&&!submitting;
  return (
    <>
      {terminal ? (
        <InterviewComplete
          entry={entry}
          completedAt={completedAt}
          status={status}
          language={language}
        />
      ) : (
        <SessionSurface active={activeRoom} controller={controller}
          entry={entry}
          language={language}
          presence={presence}
          status={
            submissionState === "SUBMISSION_REQUIRED"
              ? "submission_required"
              : submitting ? "finalizing" : status
          }
          recovering={recoveryView.state === "RECOVERING"}
          hasConnected={hasConnected}
          recordingStatus={recordingStatus}
          elapsed={elapsed}
          previewRef={preview}
          analyser={activeRoom ? controller.transport?.remoteAnalyser : undefined}
        >
          {error && !partialConfirm && <p className="recruitment-error" role="alert">{t[error] || t.continueFailed}</p>}
          {!submitting && !partialConfirm && recoveryView.state === "RECOVERY_REQUIRED" &&
            ["interrupted", "start_failed"].includes(status) && (
            <button className="candidate-button is-primary" onPointerDown={() => controller.pointer()} onClick={start}>
              {hasConnected ? t.resume : t.retryStart}
            </button>
          )}
          {!submitting && !partialConfirm && activeRoom && status === "interviewing" && controller.session && (
            <div className="candidate-interview-actions">
              {recoveryNotice && <p role="status">{t.recoveryWarning}</p>}
              {turnView.listening && turnView.uncertain && (
                <div className="candidate-answer">
                  <p role="status">{t.answerUnclear}</p>
                  {turnView.text && <p className="candidate-answer-preview">{turnView.text}</p>}
                  {turnView.canSend && <button className="candidate-button is-secondary" onClick={() => {
                    const accepted = controller.confirmAnswer();
                    observe("recovery.command", {stage:"answer.manual", code:accepted ? "accepted" : "not_ready", request_id:controller.recoveryId});
                    setError(accepted ? "" : "answerNotReady");
                  }}>{t.useWords}</button>}
                  {turnView.text && <button className="candidate-button is-secondary" onClick={() => controller.clearAnswer()}>{t.discardWords}</button>}
                </div>
              )}
              <div className="candidate-live-actions">
                {turnView.canInterrupt && <button className="candidate-button is-secondary" onClick={() => {
                  const accepted = controller.interrupt();
                  observe("recovery.command", {stage:"answer.interrupt", code:accepted ? "requested" : "not_ready", request_id:controller.recoveryId});
                  if (!accepted) setError("interruptionNotReady");
                }}>{t.interrupt}</button>}
                <button className="candidate-button is-end" disabled={busy} onClick={requestFinish}>
                  {actionState === "CHECKING" ? t.checkingFinish : t.finish}
                </button>
              </div>
            </div>
          )}
          {!submitting && !partialConfirm && (activeRoom || (status === "interrupted" && hasConnected)) && (
            <button className="candidate-button is-quiet" disabled={busy} onClick={() => {
              if (actionOwner.current || controller.submitting) return;
              setPartialConfirm(true);
              setError("");
              observe("recovery.command", {stage:"partial.confirmation"});
            }}>{t.stop}</button>
          )}
          {submissionState === "SUBMISSION_REQUIRED" && (
            <button className="candidate-button is-primary" disabled={busy} onClick={retryFinalization}>{t.retrySubmit}</button>
          )}
          {partialConfirm && !submitting && (
            <div role="group" aria-label={t.stopHeading} className="candidate-stop">
              <h2>{t.stopHeading}</h2>
              <p>{t.stopHelp}</p>
              <button className="candidate-button is-primary" disabled={busy} onClick={confirmPartialStop}>{t.confirmStop}</button>
              <button className="candidate-button is-secondary" disabled={busy} onClick={() => setPartialConfirm(false)}>{t.keepInterviewing}</button>
            </div>
          )}
        </SessionSurface>
      )}
      <div key="interview-audio" ref={node=>{controller.audioHost=node;}} hidden aria-hidden="true" />
    </>
  );
}
