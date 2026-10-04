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
  }) {
    this.token = token;
    this.recoveryId = recoveryId;
    this.clientId = clientId;
    this.mediaStream = mediaStream;
    this.startedAt = Date.parse(startedAt);
    this.audioElement = audioElement;
    this.onStatus = onStatus || (() => {});
    this.onEvent = onEvent || (() => {});
    this.onRemote = onRemote || (() => {});
    this.evidence = new InterviewTranscriptEvidence({token,clientId,startedAt,onStatus:this.onStatus});
    this.peer = null;
    this.channel = null;
    this.generation = 0;
    this.closed = false;
    this.flushing = false;
    this.conversation = new OpenAIInterviewConversation({send:event=>this.send(event), onTool, onCompletion,
      onRecovery:reason=>{this.trace({type:"transport.disconnected",status:reason});this.disconnected();}});
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
    this.evidence.itemOrder.clear();
    this.evidence.pendingFinal.clear();
    const peer = new RTCPeerConnection();
    this.peer = peer;
    this.playbackListeners = ["playing", "pause", "waiting", "stalled", "ended"].map(type => {
      const listener = () => { if (!this.closed && this.peer === peer) this.trace({type:`playback.${type}`,phase:"browser"}); };
      this.audioElement.addEventListener?.(type, listener);
      return {type, listener};
    });
    peer.ontrack = (event) => {
      if (this.closed || this.peer !== peer) return;
      this.onRemote(event.streams[0]);
      this.audioElement.srcObject = event.streams[0];
      this.audioElement.play().catch(() => {
        this.trace({type:"playback.blocked",phase:"browser"});
        this.onStatus("audio-blocked");
      });
    };
    peer.onconnectionstatechange = () => {
      if (this.closed || this.peer !== peer) return;
      if (["disconnected", "failed", "closed"].includes(peer.connectionState))
        this.disconnected();
    };
    const microphone = this.mediaStream.getAudioTracks()[0];
    if (!microphone || microphone.readyState !== "live")
      throw new Error("Microphone is unavailable.");
    peer.addTrack(microphone, this.mediaStream);
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
      await recruitmentService.providerConnected(
        this.token,
        this.clientId,
        this.generation,
        this.recoveryId,
        signal,
      );
      if (this.closed) throw Error("Interview session was replaced.");
      this.trace({type:"transport.connected"});
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
    const accepted = this.conversation.event(event);
    this.audioPlaying = this.conversation.playing;
    this.evidence.cancelled=this.conversation.cancelled;
    this.evidence.observe(event);
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
      status: event.response?.status || event.error?.code || event.status || null, phase: event.item?.phase || event.phase || null,
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
  disconnected() {
    if (this.closed || this.disconnectionSent) return;
    this.disconnectionSent = true;
    this.trace({type:"transport.disconnected"});
    this.markUnfinishedSpeech();
    this.onStatus("disconnected");
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
    this.channel?.close();
    this.peer?.close();
    this.audioElement.pause?.();
    this.audioElement.srcObject = null;
    for (const {type,listener} of this.playbackListeners || []) this.audioElement.removeEventListener?.(type,listener);
    this.peer = null;
    this.channel = null;
  }
}
