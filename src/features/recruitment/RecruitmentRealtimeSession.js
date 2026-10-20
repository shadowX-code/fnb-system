import { interviewPlaybackOwner } from "./InterviewPlayback.js";
import { bounded } from "./interviewRecovery.js";
import { OpenAIInterviewConversation } from "./OpenAIInterviewConversation.js";
import { recruitmentService } from "./recruitmentService.js";
import { interviewTranscriptQueue } from "./interviewTranscriptQueue.js";
import { InterviewTranscriptEvidence } from "./InterviewTranscriptEvidence.js";

// This transport consumes an existing microphone track. Closing WebRTC never stops the recording stream.
export class RecruitmentRealtimeSession {
  constructor({
    token,
    clientId,
    mediaStream,
    startedAt,
    audioElement,
    onStatus,
    onEvent,
    onRemote,
    recoveryId,
    onTool,
    onCompletion,
    onTurnState = () => {},
  }) {
    this.token = token;
    this.recoveryId = recoveryId;
    this.clientId = clientId;
    this.mediaStream = mediaStream;
    this.startedAt = Date.parse(startedAt);
    this.audioElement = audioElement;
    this.playbackOwner = interviewPlaybackOwner(audioElement);
    this.onStatus = onStatus || (() => {});
    this.onEvent = onEvent || (() => {});
    this.onRemote = onRemote || (() => {});
    this.evidence = new InterviewTranscriptEvidence({token,clientId,startedAt,onStatus:this.onStatus});
    this.peer = null;
    this.channel = null;
    this.generation = 0;
    this.closed = false;
    this.flushing = false;
    this.conversation = new OpenAIInterviewConversation({candidateEligible:itemId=>this.evidence.candidateEligible(itemId),
      onInput:open=>{if(this.providerMicrophone && !this.closed)this.providerMicrophone.enabled=open;
        if(open && this.conversation?.controlled && !this.evidence.outputActive.size)this.evidence.interruptionBoundary=false;},
      onTurnState:view=>{if(!this.closed){onTurnState(view);this.onEvent({type:"candidate.answer.preview",...view});}},
      onAcceptCandidate:itemId=>{if(this.evidence.acceptCandidate(itemId)){this.trace({type:"input_audio_buffer.committed",item_id:itemId,phase:this.conversation.acceptanceMode === "automatic" ? "candidate_auto_accepted" : "candidate_confirmed"});this.onEvent({type:"candidate.answer.accepted",item_id:itemId});}},
      onRejectCandidate:itemId=>this.evidence.rejectCandidate(itemId),trace:event=>this.trace(event),send:event=>this.send(event), onTool, onCompletion,
      onOrientation:receipt=>this.trace({type:"output_audio_buffer.stopped",phase:"orientation_complete",...receipt}),
      onRecovery:reason=>{this.trace({type:"transport.disconnected",status:reason});this.disconnected(reason);}});
    this.audioPlaying = false;
    this.eventSequence = 0;
  }

  async connect({ signal } = {}) {
    if (this.connectionStarted) throw Error("Continue interview to start a fresh connection.");
    this.connectionStarted = true;
    if (!this.recoveryId) throw Error("Continue interview to restore your interview safely.");
    signal?.addEventListener("abort", () => this.close(), {once:true});
    if (this.closed) throw new Error("Interview session is closed.");
    if (!this.attemptKey) {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(this.token),
      );
      this.attemptKey = [...new Uint8Array(digest)]
        .map((part) => part.toString(16).padStart(2, "0"))
        .join("");
    }
    this.disconnectionSent = false;
    const secret = await recruitmentService.realtimeSecret(
      this.token,
      this.clientId,
      this.recoveryId,
      signal,
    );
    if (this.closed) throw new Error("Interview session was replaced.");
    this.generation = secret.generation;
    if (secret.conversation_protocol !== "continuity-v2") throw Error("The interviewer needs the current interview version. Please reload this page.");
    if (secret.turn_policy !== "controlled-auto-v1") throw Error("The interviewer needs the current turn policy. Please reload this page.");
    this.conversation.controlled = true;
    this.conversation.automatic = true;
    this.evidence.requireAcceptance = true;
    this.conversation.presentationOwned = true;
    this.conversation.orientationRequired = secret.orientation_required === true;
    this.conversation.instructions = secret.conversation_instructions;
    this.conversation.introductionPending = secret.introduction_pending === true;
    this.evidence.itemOrder.clear();
    this.evidence.pendingFinal.clear();
    const peer = new RTCPeerConnection();
    this.peer = peer;
    this.playbackListeners = ["playing", "pause", "waiting", "stalled", "ended", "error"].map(type => {
      const listener = () => {
        if (this.closed || this.peer !== peer || !this.ownsPlayback()) return;
        this.trace({type:"playback." + (type === "error" ? "blocked" : type),phase:"browser"});
        const unavailable = (type === "pause" && this.audioElement.paused) || (type === "stalled" && this.audioElement.readyState < 3) || (type === "error" && this.audioElement.error);
        if (unavailable && this.audioPlaying) this.disconnected();
      };
      this.audioElement.addEventListener?.(type, listener);
      return {type, listener};
    });
    let playbackReady, playbackFailed;
    const remotePlayback = new Promise((resolve,reject) => {playbackReady=resolve;playbackFailed=reject;});
    remotePlayback.catch(() => {});
    this.rejectPlayback = playbackFailed;
    let connectionReady, connectionFailed;
    const connection = new Promise((resolve,reject) => {connectionReady=resolve;connectionFailed=reject;});
    connection.catch(() => {});
    this.rejectConnection = connectionFailed;
    peer.ontrack = (event) => {
      if (this.closed || this.peer !== peer || !this.ownsPlayback()) return;
      const track = event.track;
      if (track?.kind !== "audio" || track.readyState !== "live" || !event.streams[0]) {
        playbackFailed(Error("Interviewer audio is unavailable. Tap Continue interview to try again."));
        return;
      }
      this.remoteTrack = track;
      const ended = () => {
        if (this.closed || this.peer !== peer || !this.ownsPlayback()) return;
        this.trace({type:"playback.ended",phase:"remote_track"});
        playbackFailed(Error("Interviewer audio stopped. Tap Continue interview to try again."));
        this.disconnected();
      };
      track.addEventListener("ended", ended);
      this.remoteTrackCleanup?.();
      this.remoteTrackCleanup = () => track.removeEventListener("ended", ended);
      this.onRemote(event.streams[0]);
      this.audioElement.srcObject = event.streams[0];
      let nativePlayback;
      try { nativePlayback = this.audioElement.play(); }
      catch (error) { nativePlayback = Promise.reject(error); }
      bounded(nativePlayback, "Interviewer playback", {signal,timeoutMs:8000}).then(() => {
        if (!this.closed && this.peer === peer && this.ownsPlayback()) {
          if (track.readyState !== "live" || this.audioElement.paused || this.audioElement.muted || this.audioElement.volume === 0)
            throw Error("Interviewer audio could not start. Tap Continue interview to try again.");
          playbackReady();
        }
      }).catch((error) => {
        if (this.closed || this.peer !== peer || !this.ownsPlayback()) return;
        playbackFailed(error);
        this.trace({type:"playback.blocked",phase:"browser"});
        this.onStatus("audio-blocked");
      });
    };
    peer.onconnectionstatechange = () => {
      if (this.closed || this.peer !== peer || !this.ownsPlayback()) return;
      if (peer.connectionState === "connected") connectionReady();
      if (["disconnected", "failed", "closed"].includes(peer.connectionState)) {
        connectionFailed(Error("The interviewer connection stopped. Tap Continue interview to try again."));
        this.disconnected();
      }
    };
    const microphone = this.mediaStream.getAudioTracks()[0];
    if (!microphone || microphone.readyState !== "live")
      throw new Error("Microphone is unavailable.");
    // Gate a dedicated provider clone; raw microphone evidence is never muted.
    this.providerMicrophone = microphone.clone();
    this.providerMicrophone.enabled = false;
    peer.addTrack(this.providerMicrophone, new MediaStream([this.providerMicrophone]));
    const channel = peer.createDataChannel("oai-events");
    this.channel = channel;
    channel.onmessage = (message) => {
      if (!this.closed && this.channel === channel) this.consume(message.data);
    };
    channel.onerror = () => { if (!this.closed && this.channel === channel) this.disconnected(); };
    channel.onclose = () => {
      if (!this.closed && this.channel === channel) this.disconnected();
    };
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const answer = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret.value}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
        signal,
      });
      if (!answer.ok) throw new Error("AI interviewer could not connect.");
      if (this.closed || this.peer !== peer) throw new Error("Interview session was replaced.");
      await peer.setRemoteDescription({
        type: "answer",
        sdp: await answer.text(),
      });
      await new Promise((resolve, reject) => {
        if (channel.readyState === "open") return resolve();
        const timeout = setTimeout(
          () => reject(new Error("AI interviewer timed out.")),
          15000,
        );
        channel.addEventListener(
          "open",
          () => {
            clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
        channel.addEventListener(
          "error",
          () => {
            clearTimeout(timeout);
            reject(new Error("AI interviewer could not connect."));
          },
          { once: true },
        );
      });
      if (this.closed || this.peer !== peer) throw new Error("Interview session was replaced.");
      if (peer.connectionState === "connected") connectionReady();
      await bounded(Promise.all([remotePlayback, connection]), "Interviewer audio connection", {signal,timeoutMs:8000});
      if (this.remoteTrack?.readyState !== "live" || peer.connectionState !== "connected" || this.audioElement.paused)
        throw Error("Interviewer audio is unavailable. Tap Continue interview to try again.");
      if (this.closed || this.peer !== peer) throw Error("Interview session was replaced.");
      await recruitmentService.providerConnected(
        this.token,
        this.clientId,
        this.generation,
        this.recoveryId,
        signal,
      );
      if (this.closed || this.disconnectionSent || !this.ownsPlayback()) throw Error("Interview session was replaced.");
      if (this.remoteTrack?.readyState !== "live" || peer.connectionState !== "connected" || this.audioElement.paused)
        throw Error("Interviewer audio stopped. Tap Continue interview to try again.");
      const settings = microphone.getSettings?.() || {};
      this.trace({type:"transport.connected",phase:secret.orientation_required ? "orientation_pending" : "continuity-v2",status:`aec:${settings.echoCancellation ?? "unknown"};noise:${settings.noiseSuppression ?? "unknown"};peer:${peer.connectionState};remote:${this.remoteTrack.readyState}`});
      this.onStatus("connected");
      this.flush().catch(() => this.onStatus("transcript-pending"));
      if (this.closed) throw Error("Interview session was replaced.");
      this.conversation.begin(`session:${this.generation}`, secret.first_response_instructions);
      return secret;
    } catch (error) {
      channel.close();
      peer.close();
      if (this.peer === peer) this.peer = null;
      throw error;
    }
  }

  ownsPlayback() { return !this.playbackOwner || interviewPlaybackOwner(this.audioElement) === this.playbackOwner; }

  send(event) {
    if (!this.closed && this.channel?.readyState === "open")
      { this.trace({ ...event, type: `client.${event.type}` }); this.channel.send(JSON.stringify(event)); }
  }

  consume(raw) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (this.closed) return;
    this.trace(event);
    if (["conversation.item.input_audio_transcription.completed","conversation.item.input_audio_transcription.failed"].includes(event.type))
      this.trace({type:"input_audio_buffer.committed",item_id:event.item_id,phase:event.type.endsWith("completed") ? "transcription_completed" : "transcription_failed"});
    this.evidence.cancelled=this.conversation.cancelled;
    this.evidence.observe(event);
    const accepted = this.conversation.event(event);
    this.audioPlaying = this.conversation.playing;
    if (!accepted) return;
    this.onEvent(event);
  }

  async refreshContext(signal) {
    const data = await recruitmentService.realtimeContext(this.token,this.clientId,this.recoveryId,this.generation,signal);
    if (!this.closed && data.generation === this.generation) this.conversation.updateContext(data.instructions);
  }

  trace(event) {
    if (!this.attemptKey || !this.generation) return;
    const allowed = /^(input_audio_buffer\.(speech_started|speech_stopped|committed)|response\.(created|done|requested|output_item.added|function_call_arguments.done)|output_audio_buffer\.(started|stopped|cleared)|conversation.item.truncated|error|client\.(response.create|response.cancel|output_audio_buffer.clear)|transport\.(closed|connected|disconnected)|playback\.(playing|pause|waiting|stalled|ended|blocked))$/;
    if (!allowed.test(event.type)) return;
    const record = { type: event.type, response_id: event.response_id || event.response?.id || null,
      item_id: event.item_id || event.item?.id || null, owner: event.owner || event.response?.metadata?.owner || null,
      status: event.response?.status || event.error?.code || event.status || null, phase: event.item?.phase || event.phase || (event.type === "response.function_call_arguments.done" ? event.name : null),
      audio_end_ms: event.audio_end_ms ?? null, playing: event.phase === "browser" ? !this.audioElement.paused : this.audioPlaying,
      elapsed_ms: Math.max(0, Date.now() - this.startedAt) };
    const item = { key: `${this.attemptKey}:${this.generation}:trace:${crypto.randomUUID()}`,
      attemptKey: this.attemptKey, kind: "realtime_trace", generation: this.generation, record };
    this.persistence = this.persistence.catch(() => {}).then(() => interviewTranscriptQueue.put(item));
    this.persistence.catch(() => {});
  }

  flush() { return this.evidence.flush(); }
  markUnfinishedSpeech() { this.evidence.markUnfinishedSpeech(); }
  get attemptKey() { return this.evidence.attemptKey; }
  set attemptKey(value) { this.evidence.attemptKey=value; }
  get generation() { return this.evidence.generation; }
  set generation(value) { this.evidence.generation=value; }
  get persistence() { return this.evidence.persistence; }
  set persistence(value) { this.evidence.persistence=value; }
  disconnected(reason) {
    if (this.closed || this.disconnectionSent) return;
    this.disconnectionSent = true;
    this.trace({type:"transport.disconnected"});
    this.markUnfinishedSpeech();
    this.onStatus(reason === "repeated_unverified_input" ? "audio-interference" : reason?.startsWith("transcription_") ? "transcription-unavailable" : "disconnected");
    recruitmentService
      .providerDisconnected(this.token, this.clientId, this.generation)
      .catch(() => {});
  }

  close() {
    if (this.closed) return;
    this.conversation.close();
    this.trace({ type: "transport.closed" });
    this.evidence.close();
    this.closed = true;
    this.rejectPlayback?.(Error("Interview session was replaced."));
    this.rejectPlayback = null;
    this.rejectConnection?.(Error("Interview session was replaced."));
    this.rejectConnection = null;
    this.remoteTrackCleanup?.();
    this.remoteTrackCleanup = null;
    for (const cleanup of [()=>this.channel?.close(),()=>this.peer?.close(),()=>this.providerMicrophone?.stop()]) {
      try {cleanup();} catch {this.trace({type:"transport.closed",status:"native_cleanup_failed"});}
    }
    if (this.playbackOwner) this.playbackOwner.dispose();
    else if (!interviewPlaybackOwner(this.audioElement)) { this.audioElement.pause?.(); this.audioElement.srcObject = null; }
    for (const {type,listener} of this.playbackListeners || []) this.audioElement.removeEventListener?.(type,listener);
    this.peer = null;
    this.channel = null;
  }
}
