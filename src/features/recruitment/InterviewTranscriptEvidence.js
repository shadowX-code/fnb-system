import { bounded } from "./interviewRecovery.js";
import { recruitmentService } from "./recruitmentService.js";
import { interviewTranscriptQueue } from "./interviewTranscriptQueue.js";

// Append-only evidence observer. No response creation, cancellation or playback
// control. Slow persistence never holds provider conversation events.
export class InterviewTranscriptEvidence {
  constructor({token,clientId,startedAt,onStatus = () => {}}) {
    Object.assign(this,{token,clientId,onStatus});
    this.startedAt=Date.parse(startedAt);this.persistence=Promise.resolve();
    this.times=new Map();this.completedItems=new Set();this.itemOrder=new Map();
    this.pendingFinal=new Map();this.aiFinals=new Map();this.responseItems=new Map();
    this.receipts=new Map();this.cancelled=new Set();this.order=0;this.generation=0;
  }
  observe(event) {
    if (event.type === "response.output_item.added" && event.item?.type === "message") {
      const items = this.responseItems.get(event.response_id) || [];
      items.push(event.item.id);
      this.responseItems.set(event.response_id, items);
    }
    if (["output_audio_buffer.stopped", "output_audio_buffer.cleared"].includes(event.type)) {
      this.receipts.set(event.response_id,event.type);
      for (const item of this.responseItems.get(event.response_id) || []) {
        const final = this.aiFinals.get(item);
        if (final) {
          if (this.cancelled.has(event.response_id)) this.queueAnnotation(item, "truncated");
          this.saveFinal(final).catch(() => this.onStatus("transcript-pending")); this.aiFinals.delete(item);
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
        if (final) { this.saveFinal(final).catch(() => this.onStatus("transcript-pending")); this.aiFinals.delete(event.item_id); }
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
          this.saveFinal(pending).catch(() => this.onStatus("transcript-pending"));
        }
      }
    }
    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      event.item_id &&
      event.transcript?.trim()
    ) {
      this.saveFinal({
        itemId: event.item_id,
        speaker: "candidate",
        transcript: event.transcript,
      }).catch(() => this.onStatus("transcript-pending"));
    }
    if (
      event.type === "response.output_audio_transcript.done" &&
      event.item_id &&
      event.transcript?.trim()
    ) {
      const final = {itemId:event.item_id,speaker:"ai",transcript:event.transcript};
      if(this.receipts.has(event.response_id)) {
        if(this.receipts.get(event.response_id)==="output_audio_buffer.cleared" || this.cancelled.has(event.response_id)) this.queueAnnotation(event.item_id,"truncated");
        this.saveFinal(final).catch(()=>this.onStatus("transcript-pending"));
      } else this.aiFinals.set(event.item_id,final);
    }
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

  close() {
    for (const [itemId, final] of this.aiFinals) {
      // Generated text may exceed heard speech. Retain it only with explicit uncertainty.
      this.queueAnnotation(itemId, "truncated");
      this.saveFinal(final).catch(() => {});
    }
    this.markUnfinishedSpeech();
  }
}
