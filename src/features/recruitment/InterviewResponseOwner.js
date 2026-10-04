// One owner controls response creation, generation completion and WebRTC playback.
// EOS remains semantic VAD; this does not introduce a second silence timer.
export class InterviewResponseOwner {
  constructor(send, trace = () => {}, onStall = () => {}) {
    this.send = send;
    this.onStall = onStall;
    this.speechItems = new Set();
    this.trace = trace;
    this.seen = new Set();
    this.cancelled = new Set();
    this.tools = new Set();
    this.speaking = false;
    this.active = null;
    this.pending = null;
    this.owner = null;
    this.closed = false;
  }
  begin(owner, instructions) {
    // A candidate can speak while the connected acknowledgement is in flight.
    // Never enqueue an entry question behind that newer live turn.
    if (this.entryRequested) return;
    this.entryRequested = true;
    if (this.owner !== null) return;
    this.request(owner, false, false, instructions);
  }
  request(owner, continuation = false, closing = false, instructions) {
    if (this.closed || (!continuation && this.seen.has(owner))) return;
    if (!continuation) this.seen.add(owner);
    this.owner = owner;
    this.pending = { owner, closing, instructions };
    this.pump();
  }
  pump() {
    if (this.closed || this.speaking || this.active || !this.pending) return;
    const { owner, closing, instructions } = this.pending;
    this.pending = null;
    this.active = { owner, closing, id: null, generated: false, playing: false, audioExpected: false, playbackFinished: false };
    this.trace({ type: "response.requested", owner });
    this.watch();
    this.send({ type: "response.create", response: { metadata: { owner }, ...(instructions ? {instructions} : {}) } });
  }
  watch(timeout = 30000) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.closed && this.active) this.onStall();
    }, timeout);
  }
  settle() {
    if (!this.active?.generated || (this.active.audioExpected && !this.active.playbackFinished)) return;
    clearTimeout(this.timer); this.active = null; this.pump();
  }
  event(e) {
    if (this.closed) return false;
    if (e.type === "input_audio_buffer.speech_started") {
      if (this.speechItems.has(e.item_id)) return false;
      this.speechItems.add(e.item_id);
      this.speaking = true;
      this.pending = null;
      this.owner = e.item_id;
      this.cancel();
    }
    if (e.type === "input_audio_buffer.speech_stopped" && e.item_id === this.owner) this.speaking = false;
    if (e.type === "input_audio_buffer.committed") {
      if (this.speechItems.size && this.owner !== e.item_id) return true; // retain late transcription, never take a newer turn
      this.request(e.item_id);
    }
    if (e.type === "response.created") {
      if (!this.active || this.active.id || e.response.metadata?.owner !== this.active.owner) {
        this.cancelled.add(e.response.id);
        this.send({ type: "response.cancel", response_id: e.response.id });
        return false;
      }
      this.active.id = e.response.id;
      if (this.active.cancelOnCreated) {
        this.cancelled.add(e.response.id);
        this.send({ type: "response.cancel", response_id: e.response.id });
        this.send({ type: "output_audio_buffer.clear" });
        return false;
      }
    }
    const id = e.response_id || e.response?.id;
    if (id && this.cancelled.has(id)) {
      // Cancellation and WebRTC buffer clearance are separate acknowledgements.
      // Keep the old owner until both arrive, in either order. The clearance
      // remains observable for transcript truncation and playback bookkeeping.
      if (this.active?.id === id) {
        if (e.type === "response.done") this.active.generated = true;
        if (["output_audio_buffer.stopped", "output_audio_buffer.cleared"].includes(e.type)) {
          this.active.playbackFinished = true; this.active.playing = false;
        }
        this.settle();
      }
      return ["output_audio_buffer.stopped", "output_audio_buffer.cleared"].includes(e.type);
    }
    if (id && this.active?.id !== id) return false;
    if (e.type === "output_audio_buffer.started" && this.active) {
      this.active.playing = true;
      this.active.audioExpected = true;
      this.watch(60000);
    }
    if (e.type === "response.done" && this.active) {
      this.active.generated = true;
      if (e.response.output?.some(item => item.content?.some(part => ["audio", "output_audio"].includes(part.type))))
        this.active.audioExpected = true;
      this.watch(60000);
    }
    if (["output_audio_buffer.stopped", "output_audio_buffer.cleared"].includes(e.type) && this.active)
      { this.active.playing = false; this.active.playbackFinished = true; }
    this.settle();
    return true;
  }
  cancel() {
    if (this.active?.id) {
      this.cancelled.add(this.active.id);
      if (!this.active.generated) this.send({ type: "response.cancel", response_id: this.active.id });
    }
    if (this.active) {
      this.active.audioExpected = true; // explicit clearance receipt required, even before output starts
      this.watch();
      this.send({ type: "output_audio_buffer.clear" });
    }
    // A response not yet acknowledged must be cancelled when response.created arrives.
    if (this.active && !this.active.id) this.active.cancelOnCreated = true;

  }
  tool(e, result, owner) {
    if (this.closed || this.tools.has(e.call_id)) return;
    if (this.owner !== owner || this.speaking || this.cancelled.has(e.response_id)) return;
    this.tools.add(e.call_id);
    this.send({ type: "conversation.item.create", item: {
      type: "function_call_output", call_id: e.call_id, output: JSON.stringify(result),
    } });
    this.request(owner, true, result.can_finish === true);
  }
  close() {
    this.cancel();
    this.closed = true;
    clearTimeout(this.timer);
    this.pending = null;
  }
}
