import { InterviewTransportGeneration } from "./InterviewTransportGeneration.js";
import { InterviewRecoveryTrace } from "./InterviewRecoveryTrace.js";
import { activateInterviewPlayback } from "./InterviewPlayback.js";
import { InterviewRecording } from "./InterviewRecording.js";
import { RecruitmentRealtimeSession } from "./RecruitmentRealtimeSession.js";
import { acquireInterviewClient } from "./interviewClient.js";
import { interviewLocalKey as acquirePartition } from "./interviewRecordingStore.js";
import { recruitmentService } from "./recruitmentService.js";
import { bounded, readyInterviewMedia } from "./interviewRecovery.js";
import { initialPresence, observeInterviewPresence } from "./interviewPresentation.js";
import { isSubmissionTerminal } from "./interviewSubmission.js";

// Route/session owner. The Room is a disposable view and owns no recovery locks,
// native resources, lifecycle listeners or continuation transaction.
export class InterviewSessionRecoveryController extends InterviewTransportGeneration {
  constructor({token,entry,devices}) {
    super(view=>{
      this.updateAll({recoveryView:view,busy:view.state==="RECOVERING"});
      this.observe("recovery.transition",{...view,request_id:this.operation?.id||this.intentId||this.recoveryId});
    });
    Object.assign(this,{token,entry,devices});this.listeners=new Set();
    this.journal=new InterviewRecoveryTrace(token);this.lastReference=this.journal.latestRequest();
    this.snapshot={status:["starting","interviewing","interrupted"].includes(entry.status)?"interrupted":entry.status,
      recoveryView:{state:"RECOVERY_REQUIRED",stage:""},recordingStatus:"idle",aiStatus:"idle",error:"",busy:false,terminalReason:"",recoveryNotice:"",presence:initialPresence,turnView:{text:"",canSend:false,canInterrupt:false,listening:false},roomEpoch:0};
    this.onDiagnostic=details=>this.observe("recovery.command",details);
    this.getSnapshot=()=>this.snapshot;
    this.subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
  }
  update(field,value) {this.updateAll({[field]:typeof value==="function"?value(this.snapshot[field]):value});}
  updateAll(values) {this.snapshot={...this.snapshot,...values};for(const listener of this.listeners)listener();}
  observe(type,details) {if(details?.request_id&&(details.stage?.startsWith("continue.")||details.request_id===(this.intentId||this.recoveryId)))this.lastReference=details.request_id;this.journal.append(type,details);if(this.clientId)this.journal.identify(this.clientId);}
  pointer() {this.continueIntent=crypto.randomUUID();this.observe("recovery.command",{stage:"continue.pointer",state:this.state,request_id:this.continueIntent});}
  disposeNative() {
    const prior=this.native;this.native=null;
    for(const clean of [()=>prior?.playback?.dispose(),()=>prior?.activation?.context.close()?.catch(()=>{})])try{clean();}catch{/* Abandoned native ownership. */}
  }
  mount() {
    this.mounted=true;
    const unfinished=this.journal.unfinished();
    if(unfinished)this.observe("recovery.error",{stage:unfinished.stage,code:"previous_page_interrupted",request_id:unfinished.request_id});
    this.observe("recovery.bootstrap",{stage:"page.bootstrap"});
    this.claimClient().catch(error=>{if(this.mounted)this.observe("recovery.error",{stage:"tab.identity",code:error.code||"claim_failed"});});
    const lifecycle=(stage,hidden)=>{
      this.observe("recovery.visibility",{stage,request_id:this.recoveryId});
      if(hidden||this.wasHidden||stage==="page_restored"){
        this.wasHidden=hidden;
        if(this.operation||this.session||this.capture)this.pause(hidden?"page_backgrounded":"page_restored");
      }
      this.journal.flush();
    };
    const visibility=()=>lifecycle(document.hidden?"background":"foreground",document.hidden);
    const hide=()=>lifecycle("pagehide",true);
    const show=event=>{if(event.persisted)lifecycle("page_restored",false);else this.observe("recovery.visibility",{stage:"pageshow"});};
    document.addEventListener("visibilitychange",visibility);window.addEventListener("pagehide",hide);window.addEventListener("pageshow",show);
    return()=>{
      this.pause("page_closed");this.mounted=false;this.cancel();this.disposeNative();clearTimeout(this.maxTimer);
      this.releaseClient?.();this.releaseClient=null;
      document.removeEventListener("visibilitychange",visibility);window.removeEventListener("pagehide",hide);window.removeEventListener("pageshow",show);
    };
  }
  async claimClient(signal) {
    const {token}=this;
    if (this.releaseClient) return;
    if (!this.clientClaim) {
      this.clientClaim = bounded(
        acquireInterviewClient(token),
        "Interview tab ownership",
        { onLate: (value) => value.release() },
      )
        .then((claim) => {
          if (!this.mounted) {
            claim.release();
            throw Error("Interview page was closed.");
          }
          this.clientId = claim.clientId;
          this.releaseClient = claim.release;
          this.observe("recovery.bootstrap", { stage: "tab.identity" });
        })
        .finally(() => {
          this.clientClaim = null;
        });
    }
    await bounded(this.clientClaim, "Interview tab ownership", { signal });
  }
  abandon(work,stage,requestId=this.recoveryId) {
    try {Promise.resolve(work()).catch(()=>this.observe("recovery.error",{stage,code:"cleanup_failed",request_id:requestId}));}
    catch {this.observe("recovery.error",{stage,code:"cleanup_failed",request_id:requestId});}
  }
  pause(reason) {
    if(this.submitting||this.snapshot.status==="finalizing"||isSubmissionTerminal(this.snapshot.status))return;
    if(!this.operation&&!this.session&&!this.capture)return; // Preparation has no Room ownership to invalidate.
    const wasPaused=this.paused,prior=this.capture,pauseId=this.recoveryId;
    this.capture=null;this.paused=true;this.onInvalidate?.();
    this.cancel();clearTimeout(this.maxTimer);
    this.updateAll({status:"interrupted",aiStatus:"paused",error:"The interview paused. Tap Continue interview to reacquire camera and microphone. Saved answers remain; the recording gap will be visible to your recruiter."});
    this.observe("recovery.transition",{state:"RECOVERY_REQUIRED",stage:"room.disposed",request_id:pauseId});
    if(!wasPaused&&this.clientId&&pauseId) {
      this.pauseTask=bounded(recruitmentService.recoverPause(this.token,this.clientId,pauseId,reason),"Pausing interview",{timeoutMs:8000});
      this.pauseTask.catch(cause=>{
        this.observe("recovery.error",{stage:"pause",code:cause.code||"request_failed",request_id:pauseId});
        if(this.paused&&this.intentId===pauseId&&this.recoveryId===pauseId)this.update("error","Your connection could not confirm the pause. Tap Continue interview to restore the server state.");
      });
    }
    this.abandon(()=>prior?.stop(reason),"capture.dispose",pauseId);
    this.abandon(()=>this.devices.stop(),"devices.dispose",pauseId);
    this.disposeNative();
  }
  async createFreshInterviewer(signal) {
    const {token,devices}=this;
    const generation = this.recoveryId;
    const transport = await this.connectInterviewer({
      token,
      clientId: this.clientId,
      recoveryId: generation,
      mediaStream: devices.streamRef.current,
      startedAt: this.session.started_at,
      audioElement: this.audio,
      signal,
      onRemote: (stream) => this.capture?.remote(stream),
      onTurnState: view => {
        if (this.mounted && !this.paused && this.recoveryId === generation) this.update("turnView",view);
      },
      onEvent: (event) => {
        if (
          this.mounted &&
          !this.paused &&
          this.recoveryId === generation
        )
          this.update("presence",(current) => observeInterviewPresence(current, event));
      },
      onStatus: (state) => {
        if (
          this.mounted &&
          !this.paused &&
          this.recoveryId === generation
        )
          this.update("aiStatus",state);
      },
      onRecovery: (state) => {
        if (
          !this.mounted ||
          this.paused ||
          this.recoveryId !== generation
        )
          return;
        this.pause(
          state === "audio-blocked"
            ? "interviewer_audio_unavailable"
            : "interviewer_connection_lost",
        );
        this.update("error",
          state === "transcription-unavailable"
            ? "Your last answer could not be recognized. Tap Continue interview to retry. Earlier submitted answers are retained."
            : state === "audio-interference"
            ? "Audio was repeatedly interrupted by uncertain microphone input. Use earphones or a quieter place, then tap Continue interview. Saved answers are retained."
            : "The interviewer was interrupted. Tap Continue interview; your saved answers are retained.",
        );
      },
      onCompletion: (reason) => {
        if (
          this.mounted &&
          !this.paused &&
          this.recoveryId === generation
        )
          this.onCompletion?.(reason);
      },
    });
    if (this.recoveryId === generation && !this.paused) {
      this.transport = transport;
      this.update("error","");
    }
  }
  async start(acknowledge = work => work()) {
    const {token,devices}=this;
    const requestId = this.continueIntent || crypto.randomUUID();
    this.continueIntent = null;
    this.observe("recovery.command", {stage:"continue.tap",state:this.state,request_id:requestId});
    if (document.hidden) {
      this.observe("recovery.error",{stage:"continue.guard",code:"page_hidden",request_id:requestId});
      this.update("error","Return to this page before resuming.");
      return;
    }
    if (this.submitting || (this.state === "RESUMED" && this.snapshot.status !== "interrupted")) {
      this.observe("recovery.command",{stage:"continue.guard",code:this.submitting ? "submission_pending" : "already_active",request_id:requestId});
      return;
    }
    this.intentId=requestId;
    acknowledge(()=>this.updateAll({recoveryView:{state:"RECOVERING",stage:"preparing"},busy:true,error:"",status:"interrupted"}));
    let activation, mediaPromise, playback;
    let operation;
    try {
      operation = this.begin((owner) => {
        this.observe("recovery.media",{stage:"native.capture.call",request_id:owner.id});
        mediaPromise = devices.start({
          signal: owner.controller.signal,
          meter: false,
          onNative: (details) =>
            this.observe("recovery.media", { request_id: owner.id, ...details }),
        });
        this.observe("recovery.media",{stage:"native.capture.returned",request_id:owner.id});
        mediaPromise.catch(() => {});
        this.observe("recovery.media",{stage:"native.audio.call",request_id:owner.id});
        activation = InterviewRecording.activateAudio();
        this.observe("recovery.media",{stage:"native.audio.returned",request_id:owner.id,audio_state:activation.context.state});
        this.observe("recovery.media",{stage:"native.output.create",request_id:owner.id});
        const output = document.createElement("audio");
        this.audioHost?.replaceChildren(output);
        this.audio = output;
        this.observe("recovery.media",{stage:"native.output.attached",request_id:owner.id});
        this.observe("recovery.media",{stage:"native.playback.call",request_id:owner.id});
        playback = activateInterviewPlayback(output, activation.context);
        this.observe("recovery.media",{stage:"native.playback.returned",request_id:owner.id});
        this.native={id:owner.id,playback,activation};
        owner.controller.signal.addEventListener("abort", () => this.abandon(()=>playback?.dispose(),"playback.dispose",owner.id), {once:true});
      }, requestId);
    } catch (cause) {
      this.observe("recovery.error",{stage:"native activation",code:cause.name || "native_activation_failed",request_id:requestId});
      this.update("error",
        "Native audio could not start. Tap Continue interview to try again.",
      );
      this.update("status","interrupted");
      this.update("aiStatus","paused");
      this.closeInterviewer();
      this.abandon(()=>devices.stop(),"devices.dispose",requestId);
      this.abandon(()=>playback?.dispose(),"playback.dispose",requestId);
      this.abandon(()=>activation?.context.close(),"audio.dispose",requestId);
      this.updateAll({busy:false,recoveryView:{state:"RECOVERY_REQUIRED",stage:""}});
      return;
    }
    this.observe("recovery.command", { stage: "resume", request_id: operation.id });
    this.recoveryId = operation.id;
    this.paused = false;
    this.update("error","");
    this.update("aiStatus","recovering");
    this.update("presence",initialPresence);
    this.update("turnView",{text:"",canSend:false,canInterrupt:false,listening:false});
    this.update("recoveryNotice","");
    let media,
      capture,
      serverClaimed = false;
    const step = (stage, work, options) =>
      this.step(operation, stage, work, options);
    try {
      // getUserMedia must precede Web Audio, old transport and capture cleanup.
      this.observe("recovery.media", {
        request_id: operation.id,
        stage: "audio.activation",
        audio_state: activation.context.state,
      });
      bounded(activation.ready, "Audio activation", {
        signal: operation.controller.signal,
        timeoutMs: 10000,
      })
        .then(() =>
          this.observe("recovery.media", {
            request_id: operation.id,
            stage: "audio.activated",
            audio_state: activation.context.state,
          }),
        )
        .catch((cause) =>
          this.observe("recovery.error", {
            request_id: operation.id,
            stage: "audio.activation",
            code: cause.code || cause.name || "native_audio_failed",
          }),
        );
      let freshStream;
      operation.controller.signal.addEventListener(
        "abort",
        () => {
          for(const track of freshStream?.getTracks()||[])this.abandon(()=>track.stop(),"track.dispose",operation.id);
          this.abandon(()=>activation.context.close(),"audio.dispose",operation.id);
        },
        { once: true },
      );
      media = bounded(mediaPromise, "Camera and microphone", {
        signal: operation.controller.signal,
        timeoutMs: 15000,
        onLate: (stream) =>
          stream?.getTracks().forEach((track) => track.stop()),
      });
      media.catch(() => {});
      this.transport?.close();
      this.transport = null;
      clearTimeout(this.maxTimer);
      const oldCapture = this.capture;
      oldCapture?.stop("recovery_replaced").catch(() => {});
      // Identity loads concurrently with the already-invoked native acquisition.
      // This also flushes cold-bootstrap diagnostics if native acquisition hangs.
      await step("tab ownership", (signal) => this.claimClient(signal));
      const stream = (freshStream = await step(
        "camera and microphone",
        () => media,
      ));
      if (!stream)
        throw Object.assign(
          Error(
            "Camera and microphone could not start. Tap Continue interview to reacquire them.",
          ),
          { code: "native_media_failed" },
        );
      await step(
        "device readiness",
        (signal) => readyInterviewMedia(stream, signal),
        { timeoutMs: 5000 },
      );
      this.observe("recovery.media", {
        request_id: operation.id,
        stage: "tracks.validated",
        tracks: stream
          .getTracks()
          .map((t) => ({ kind: t.kind, state: t.readyState, muted: t.muted })),
        audio_state: activation.context.state,
      });
      this.observe("recovery.bootstrap", { request_id: operation.id });
      const durable = await step("server state", (signal) =>
        recruitmentService.recoveryState(token, this.clientId, signal),
      );
      if (durable.state === "TERMINAL" && durable.status !== "finalizing") {
        this.update("terminalReason",
          durable.reason ||
            "This interview has already ended. Please contact your recruiter if another interview is needed.",
        );
        this.finish(operation, "TERMINAL");
        playback?.dispose();
        devices.stop();
        activation.context.close().catch(() => {});
        return;
      }
      this.session = await step("server resume", (signal) =>
        recruitmentService.recoverBegin(
          token,
          this.clientId,
          operation.id,
          durable.recovery_id || null,
          signal,
        ),
      );
      serverClaimed = true;
      if (this.session.status === "finalizing") {
        this.update("status","finalizing");
        this.finish(operation, "TERMINAL");
        playback?.dispose();
        devices.stop();
        activation.context.close().catch(() => {});
        return;
      }
      const recovering = new InterviewRecording({
        token,
        clientId: this.clientId,
        startedAt: this.session.started_at,
        onStatus: (state) => {
          if (
            this.recoveryId === operation.id &&
            this.capture?.recorder?.state !== "recording"
          )
            this.update("recordingStatus",state);
        },
      });
      // Old unit reconciliation/uploads are independent of live continuation.
      recovering
        .recover({
          deferUploads: true,
          excludeUnit: () => this.capture?.unit?.id,
        })
        .then(() => recovering.uploadRecovery)
        .catch(() => {
          if (
            this.recoveryId === operation.id &&
            this.capture?.recorder?.state !== "recording"
          )
            this.update("recordingStatus","upload-pending");
        });
      const transcript = new RecruitmentRealtimeSession({
        token,
        clientId: this.clientId,
        startedAt: this.session.started_at,
        audioElement: this.audio,
      });
      // Restore locally queued turns before constructing server-approved continuation context.
      transcript.attemptKey = await step("transcript partition", () =>
        acquirePartition(token),
      );
      try {
        const pendingTurns = await step(
          "recent transcript",
          () => transcript.flush(),
          { timeoutMs: 8000 },
        );
        if (pendingTurns)
          this.update("recoveryNotice",
            "Some local evidence is still waiting to save. The interview continues from your saved answers; missing evidence remains visible to your recruiter.",
          );
      } catch (cause) {
        if (!this.current(operation)) throw cause;
        this.observe("recovery.error", {
          request_id: operation.id,
          stage: "recent transcript",
          code: cause.code || "local_evidence_pending",
        });
        this.update("recoveryNotice",
          "Some local evidence is still waiting to save. The interview continues from your saved answers; missing evidence remains visible to your recruiter.",
        );
      }
      capture = new InterviewRecording({
        token,
        clientId: this.clientId,
        stream,
        startedAt: this.session.started_at,
        audioActivation: activation,
        recoveryId: operation.id,
        onStatus: (state) => {
          if (this.capture === capture) this.update("recordingStatus",state);
        },
        onLost: (reason) => {
          if (
            this.capture === capture &&
            this.recoveryId === operation.id
          )
            this.pause(reason);
        },
      });
      this.capture = capture;
      await step("fresh recording", (signal) => capture.start({ signal }));
      if (document.hidden || this.paused)
        throw Error("Return to this page and tap Continue interview again.");
      this.update("status","starting");
      await step("interviewer playback", () => playback?.ready || Promise.resolve(), {timeoutMs:8000});
      await step(
        "fresh AI session",
        (signal) => this.createFreshInterviewer(signal),
        { timeoutMs: 30000 },
      );
      if(document.hidden||this.paused)throw Object.assign(Error("Return to this page and tap Continue interview again."),{code:"page_hidden"});
      if(activation.context.state!=="running")throw Object.assign(Error("Interviewer audio is not active. Tap Continue interview to start fresh audio."),{code:"native_audio_inactive"});
      clearTimeout(this.maxTimer);
      const approvedSession = this.session;
      this.maxTimer = setTimeout(
        () => {
          if (
            !this.paused &&
            this.state === "RESUMED" &&
            this.session === approvedSession
          )
            this.onCompletion?.("max_duration");
        },
        Math.max(0, Date.parse(approvedSession.max_ends_at) - Date.now()),
      );
      this.update("status","interviewing");
      this.update("roomEpoch",this.snapshot.roomEpoch+1);
      this.finish(operation, "RESUMED");
    } catch (cause) {
      if (!this.current(operation)) return;
      this.observe("recovery.error", {
        request_id: operation.id,
        stage: this.stage,
        code: cause.code || cause.name || "dependency_failed",
      });
      operation.controller.abort();
      this.closeInterviewer();
      this.abandon(()=>capture?.stop("recovery_failed"),"capture.dispose",operation.id);
      this.abandon(()=>capture?.dispose(),"capture.dispose",operation.id);
      this.abandon(()=>devices.stop(),"devices.dispose",operation.id);
      this.abandon(()=>activation?.context.close(),"audio.dispose",operation.id);
      this.paused = true;
      if (serverClaimed)
        bounded(
          recruitmentService.recoverPause(
            token,
            this.clientId,
            operation.id,
            "recovery_failed",
          ),
          "Pausing failed recovery",
          { timeoutMs: 8000 },
        ).catch(() => {});
      this.update("status","interrupted");
      this.update("aiStatus","paused");
      this.update("error",
        this.stage === "fresh AI session" && !["native_audio_inactive","page_hidden"].includes(cause.code)
          ? "The interviewer could not start. Check your connection and tap Continue interview to try again."
          : cause.message ||
              "The interview could not continue. Tap Continue interview to try again.",
      );
      this.finish(operation, "RECOVERY_REQUIRED");
    } finally {
      if (!this.operation) {
        this.update("busy",false);
      }
    }
  }
}
