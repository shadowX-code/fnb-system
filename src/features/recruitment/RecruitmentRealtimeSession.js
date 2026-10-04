import { bounded } from "./interviewRecovery.js";
import { InterviewResponseOwner } from "./InterviewResponseOwner.js";
import { recruitmentService } from "./recruitmentService.js";
import { interviewTranscriptQueue } from "./interviewTranscriptQueue.js";

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
    this.persistence = Promise.resolve();
    this.times = new Map();
    this.completedItems = new Set();
    this.attemptKey = null;
    this.peer = null;
    this.channel = null;
    this.generation = 0;
    this.itemOrder = new Map();
    this.pendingFinal = new Map();
    this.order = 0;
    this.closed = false;
    this.flushing = false;
    this.responses = new InterviewResponseOwner((event) => this.send(event), (event) => this.trace(event), () => { this.trace({type:"transport.disconnected",status:"response_lifecycle_timeout"}); this.disconnected(); });
    this.aiFinals = new Map();
    this.responseItems = new Map();
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
    this.itemOrder.clear();
    this.pendingFinal.clear();
    this.order = 0;
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
      if (!this.closed && this.channel === channel) this.consume(message.data).catch(() => this.onStatus("transcript-pending"));
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
      this.responses.begin(`session:${this.generation}`, secret.first_response_instructions);
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

  async consume(raw) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (this.closed) return;
    this.trace(event);
    const accepted = this.responses.event(event);
    if (!accepted) return;
    if (event.type === "response.created" && this.responses.active?.closing) this.closingResponseId = event.response.id;
    this.audioPlaying = !!this.responses.active?.playing;
    if (event.type === "response.output_item.added" && event.item?.type === "message") {
      const items = this.responseItems.get(event.response_id) || [];
      items.push(event.item.id);
      this.responseItems.set(event.response_id, items);
    }
    if (["output_audio_buffer.stopped", "output_audio_buffer.cleared"].includes(event.type)) {
      for (const item of this.responseItems.get(event.response_id) || []) {
        const final = this.aiFinals.get(item);
        if (final) {
          if (this.responses.cancelled.has(event.response_id)) this.queueAnnotation(item, "truncated");
          await this.saveFinal(final); this.aiFinals.delete(item);
        }
      }
    }
    if (event.type === "input_audio_buffer.speech_started")
      this.times.set(event.item_id, Math.max(0, Date.now() - this.startedAt));
    if (
      [
        "conversation.item.truncated",
        "conversation.item.input_audio_transcription.failed",
      ].includes(event.type)
    )
      { this.queueAnnotation(event.item_id, event.type.endsWith("failed") ? "transcription_failed" : "truncated");
        const final = this.aiFinals.get(event.item_id);
        if (final) { await this.saveFinal(final); this.aiFinals.delete(event.item_id); }
      }
    if (
      ([
        "conversation.item.added",
        "conversation.item.created",
        "response.output_item.added",
      ].includes(event.type) &&
        event.item?.type === "message") ||
      event.type === "input_audio_buffer.committed"
    ) {
      const itemId = event.item?.id || event.item_id;
      if (typeof itemId === "string" && !this.itemOrder.has(itemId)) {
        this.itemOrder.set(itemId, ++this.order);
        const pending = this.pendingFinal.get(itemId);
        if (pending) {
          this.pendingFinal.delete(itemId);
          await this.saveFinal(pending);
        }
      }
    }
    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      event.item_id &&
      event.transcript?.trim()
    ) {
      await this.saveFinal({
        itemId: event.item_id,
        speaker: "candidate",
        transcript: event.transcript,
      });
    }
    if (
      event.type === "response.output_audio_transcript.done" &&
      event.item_id &&
      event.transcript?.trim()
    ) {
      this.aiFinals.set(event.item_id, {
        itemId: event.item_id, speaker: "ai", transcript: event.transcript,
      });
    }
    this.onEvent(event);
  }

  completeTool(event, result, owner) { this.responses.tool(event, result, owner); }

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

  async saveFinal({ itemId, speaker, transcript }) {
    const order = this.itemOrder.get(itemId);
    if (!order) {
      this.pendingFinal.set(itemId, { itemId, speaker, transcript });
      return;
    }
    if (this.completedItems.has(itemId)) return;
    this.completedItems.add(itemId);
    const turn = {
      key: `${this.attemptKey}:${this.generation}:${itemId}:${speaker}`,
      attemptKey: this.attemptKey,
      turn_number: (this.generation - 1) * 10000 + order,
      generation: this.generation,
      providerOrder: order,
      itemId,
      speaker,
      transcript: transcript.trim(),
      elapsedMs: Math.max(0, Date.now() - this.startedAt),
      startMs: this.times.get(itemId) ?? null,
    };
    try {
      this.persistence = this.persistence.then(() =>
        interviewTranscriptQueue.put(turn),
      );
      await this.persistence;
      this.completedItems.add(itemId);
      await this.flush();
    } catch {
      this.onStatus("transcript-pending");
    }
  }

  async flush() {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = (async () => {
      await this.persistence;
      try {
        const items = await interviewTranscriptQueue.list(this.attemptKey);
        for (const item of items.filter(item => item.kind !== "realtime_trace")) {
          if (item.kind)
            await recruitmentService.annotation(
              this.token,
              this.clientId,
              item.generation,
              item.itemId,
              item.kind,
              item.elapsedMs,
            );
          else
            await recruitmentService.transcriptTurn(
              this.token,
              this.clientId,
              item,
            );
          await interviewTranscriptQueue.remove(item.key);
        }
        // Diagnostics cannot hold durable answers or recovery hostage.
        try {
        const traces = items.filter(item => item.kind === "realtime_trace");
        for (let offset = 0; offset < traces.length; offset += 40) {
          const batch = traces.slice(offset, offset + 40);
          await bounded(recruitmentService.trace(this.token, this.clientId, batch.map(item => ({generation:item.generation,key:item.key,record:item.record}))), "Saving diagnostics", {timeoutMs:2000});
          for (const item of batch) await interviewTranscriptQueue.remove(item.key);
        }
        } catch { /* Bounded diagnostic retries are independent of transcript authority. */ }

      } catch {
        this.onStatus("transcript-pending");
      }
      return (
        (await interviewTranscriptQueue.list(this.attemptKey)).filter(item=>item.kind!=="realtime_trace").length +
        this.pendingFinal.size
      );
    })();
    try {
      return await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  queueAnnotation(itemId, kind) {
    if (!itemId || !this.attemptKey || !this.generation) return;
    const item = {
      key: `${this.attemptKey}:${this.generation}:${itemId}:${kind}`,
      attemptKey: this.attemptKey,
      generation: this.generation,
      itemId,
      kind,
      elapsedMs: Math.max(0, Date.now() - this.startedAt),
    };
    this.persistence = this.persistence
      .catch(() => {})
      .then(() => interviewTranscriptQueue.put(item));
    this.persistence.catch(() => this.onStatus("transcript-pending"));
  }

  markUnfinishedSpeech() {
    for (const itemId of this.times.keys())
      if (!this.completedItems.has(itemId))
        this.queueAnnotation(itemId, "transcription_failed");
  }

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
    this.responses.close();
    this.trace({ type: "transport.closed" });
    for (const [itemId, final] of this.aiFinals) {
      // Generated text may exceed heard speech. Retain it only with explicit uncertainty.
      this.queueAnnotation(itemId, "truncated");
      this.saveFinal(final).catch(() => {});
    }
    this.markUnfinishedSpeech();
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
