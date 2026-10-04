// Provider owns ordinary VAD -> response -> interruption. This adapter observes
// liveness; it never retries a candidate turn or waits for playback to schedule it.
export class OpenAIInterviewConversation {
  constructor({send, onRecovery, onTool, onCompletion, trace = () => {}}) {
    Object.assign(this, {send, onRecovery, onTool, onCompletion:onCompletion||(()=>{}), trace});
    this.responses = new Map(); this.turns = new Map(); this.tools = new Map();
    this.cancelled = new Set(); this.revision = 0; this.closed = false;
    this.speaking = false; this.playing = false; this.owner = null;
  }
  watch(key, reason, timeout = 30000) {
    this.unwatch(key);
    this.timers ||= new Map();
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      if (!this.closed) this.onRecovery(reason);
    }, timeout));
  }
  unwatch(key) { clearTimeout(this.timers?.get(key)); this.timers?.delete(key); }
  begin(owner, instructions) {
    if (this.closed || this.entryRequested) return;
    this.entryRequested = true;
    if (this.owner !== null || this.speaking) return; // live candidate supersedes entry
    this.entryRevision = this.revision;
    this.watch("entry", "entry_response_timeout");
    this.send({type:"response.create", response:{instructions, metadata:{owner,feedx_kind:"entry"}}});
  }
  event(e) {
    if (this.closed) return false;
    const id = e.response_id || e.response?.id;
    if (e.type === "input_audio_buffer.speech_started") {
      if (this.owner !== e.item_id) {
        this.revision++; this.owner = e.item_id;
        // A newer live turn supersedes earlier response/tool obligations.
        for (const key of [...(this.timers?.keys() || [])]) this.unwatch(key);
      }
      this.speaking = true;
      // No client response.cancel/clear: provider interruption owns audible output.
    }
    if (e.type === "input_audio_buffer.speech_stopped" && e.item_id === this.owner) this.speaking = false;
    if (e.type === "input_audio_buffer.committed" || e.type === "conversation.item.input_audio_transcription.completed") {
      if (!this.turns.has(e.item_id)) this.turns.set(e.item_id, {responded:false});
      if (this.owner === null) this.owner = e.item_id;
      if (this.owner === e.item_id && !this.turns.get(e.item_id).responded)
        this.watch(`turn:${e.item_id}`, "next_response_timeout");
    }
    if (e.type === "response.created") {
      if (this.responses.has(id)) return false;
      const kind = e.response.metadata?.feedx_kind;
      if (!kind && this.owner && this.turns.get(this.owner)?.responded) {
        this.cancelled.add(id);this.send({type:"response.cancel",response_id:id});
        this.onRecovery("duplicate_provider_response");return false;
      }
      const tool = kind === "tool" ? this.tools.get(e.response.metadata.call_id) : null;
      const stale = kind === "entry" ? this.entryRevision !== this.revision : kind === "tool" && (!tool || tool.revision !== this.revision);
      this.responses.set(id, {revision:this.revision,done:false,kind,closing:tool?.result?.can_finish === true});
      if (stale) { this.cancelled.add(id); this.send({type:"response.cancel",response_id:id}); return false; }
      this.unwatch("entry"); this.unwatch("tool-response");
      if (this.owner) {
        this.turns.set(this.owner, {responded:true}); this.unwatch(`turn:${this.owner}`);
      }
      this.watch(`response:${id}`, "response_generation_timeout", 60000);
    }
    if (id && this.cancelled.has(id)) return ["output_audio_buffer.cleared", "output_audio_buffer.stopped", "response.done"].includes(e.type);
    if (e.type === "response.done") {
      const response = this.responses.get(id);
      if (response) response.done = true;
      this.unwatch(`response:${id}`);
      if (e.response.status === "cancelled") this.cancelled.add(id);
      if (["failed","incomplete"].includes(e.response.status)) this.onRecovery("response_failed");
      for (const tool of this.tools.values()) if (tool.responseId === id) this.continueTool(tool);
    }
    if (e.type === "output_audio_buffer.started") {
      this.playing = true;
      this.watch(`audio:${id}`, "audio_playback_timeout", 90000);
    }
    if (["output_audio_buffer.stopped","output_audio_buffer.cleared"].includes(e.type)) {
      this.playing = false; this.unwatch(`audio:${id}`);
      if (e.type === "output_audio_buffer.cleared") this.cancelled.add(id);
      const response = this.responses.get(id);
      if (e.type === "output_audio_buffer.stopped" && response?.closing && response.revision === this.revision)
        queueMicrotask(()=>{if(!this.closed && response.revision===this.revision)this.onCompletion();});
    }
    if (e.type === "response.function_call_arguments.done" && !this.tools.has(e.call_id)) {
      const tool = {callId:e.call_id,responseId:id,revision:this.revision};
      this.tools.set(e.call_id, tool);
      if (e.name !== "request_completion") { this.onRecovery("unknown_interview_tool"); return false; }
      this.watch(`tool:${e.call_id}`, "completion_check_timeout", 60000);
      Promise.resolve().then(() => this.onTool(e)).then(result => {
        if (this.closed) return;
        this.unwatch(`tool:${e.call_id}`); tool.result = result;
        this.continueTool(tool);
      }).catch(() => { if (!this.closed && tool.revision === this.revision) this.onRecovery("completion_check_failed"); });
    }
    if (e.type === "error") this.onRecovery("provider_error");
    return true;
  }
  continueTool(tool) {
    if (this.closed || tool.sent || !tool.result || !this.responses.get(tool.responseId)?.done) return;
    tool.sent = true;
    if (tool.revision !== this.revision || this.speaking || this.cancelled.has(tool.responseId)) return;
    // Another provider-owned response has already taken this turn: never append
    // a second continuation behind it. Failure is explicit rather than guessing.
    if ([...this.responses.entries()].some(([id,r]) => id !== tool.responseId && r.revision === tool.revision && !r.done)) {
      this.onRecovery("tool_response_conflict"); return;
    }
    this.send({type:"conversation.item.create",item:{type:"function_call_output",call_id:tool.callId,output:JSON.stringify(tool.result)}});
    this.watch("tool-response", "tool_response_timeout");
    this.send({type:"response.create",response:{metadata:{feedx_kind:"tool",call_id:tool.callId}}});
  }
  updateContext(instructions) {
    if (this.closed || !instructions || instructions === this.instructions) return;
    this.instructions = instructions;
    // Quiet configuration update: never create a response or replay conversation.
    this.send({type:"session.update",session:{type:"realtime",instructions}});
  }
  close() {
    this.closed = true;
    for (const key of [...(this.timers?.keys() || [])]) this.unwatch(key);
  }
}
