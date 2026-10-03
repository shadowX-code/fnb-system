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
  }) {
    this.token = token;
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
  }

  async connect() {
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
    const previousChannel = this.channel;
    const previousPeer = this.peer;
    this.channel = null;
    this.peer = null;
    previousChannel?.close();
    previousPeer?.close();
    this.disconnectionSent = false;
    const secret = await recruitmentService.realtimeSecret(
      this.token,
      this.clientId,
    );
    this.generation = secret.generation;
    this.itemOrder.clear();
    this.pendingFinal.clear();
    this.order = 0;
    const peer = new RTCPeerConnection();
    this.peer = peer;
    peer.ontrack = (event) => {
      this.onRemote(event.streams[0]);
      this.audioElement.srcObject = event.streams[0];
      this.audioElement.play().catch(() => this.onStatus("audio-blocked"));
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
    channel.onmessage = (message) => this.consume(message.data);
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
      });
      if (!answer.ok) throw new Error("AI interviewer could not connect.");
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
      await recruitmentService.providerConnected(
        this.token,
        this.clientId,
        this.generation,
      );
      this.onStatus("connected");
      await this.flush();
      this.send({ type: "response.create" });
      return secret;
    } catch (error) {
      channel.close();
      peer.close();
      if (this.peer === peer) this.peer = null;
      throw error;
    }
  }

  send(event) {
    if (this.channel?.readyState === "open")
      this.channel.send(JSON.stringify(event));
  }

  async consume(raw) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    this.onEvent(event);
    if (event.type === "input_audio_buffer.speech_started")
      this.times.set(event.item_id, Math.max(0, Date.now() - this.startedAt));
    if (
      [
        "conversation.item.truncated",
        "conversation.item.input_audio_transcription.failed",
      ].includes(event.type)
    )
      this.queueAnnotation(
        event.item_id,
        event.type.endsWith("failed") ? "transcription_failed" : "truncated",
      );
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
      await this.saveFinal({
        itemId: event.item_id,
        speaker: "ai",
        transcript: event.transcript,
      });
    }
  }

  async saveFinal({ itemId, speaker, transcript }) {
    const order = this.itemOrder.get(itemId);
    if (!order) {
      this.pendingFinal.set(itemId, { itemId, speaker, transcript });
      return;
    }
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
        for (const item of await interviewTranscriptQueue.list(
          this.attemptKey,
        )) {
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
      } catch {
        this.onStatus("transcript-pending");
      }
      return (
        (await interviewTranscriptQueue.list(this.attemptKey)).length +
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
    this.markUnfinishedSpeech();
    this.onStatus("disconnected");
    recruitmentService
      .providerDisconnected(this.token, this.clientId, this.generation)
      .catch(() => {});
  }

  close() {
    if (this.closed) return;
    this.markUnfinishedSpeech();
    this.closed = true;
    this.channel?.close();
    this.peer?.close();
    this.audioElement.srcObject = null;
    this.peer = null;
    this.channel = null;
  }
}
