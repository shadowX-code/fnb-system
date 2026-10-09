import { meaningfulSpeech } from "../../../supabase/functions/recruitment-realtime/orientation.ts";
// Provider owns ordinary VAD -> response -> interruption. This adapter observes
// liveness; it never retries a candidate turn or waits for playback to schedule it.
export class OpenAIInterviewConversation {
  constructor({send, onRecovery, onTool, onCompletion, onOrientation = () => {}, trace = () => {}, candidateEligible = () => true}) {
    Object.assign(this, {send, onRecovery, onTool, onCompletion:onCompletion||(()=>{}), onOrientation, trace, candidateEligible});
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
    if (e.type === "conversation.item.input_audio_transcription.completed" && this.candidateEligible(e.item_id) && this.introductionPending && e.item_id === this.owner && this.revision > (this.orientationPresentedRevision ?? 0) && meaningfulSpeech(e.transcript || "")) {
      this.introductionPending = false;
      this.orientationConfirmed = true;
      this.updateContext(this.instructions);
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
      this.responses.set(id, {itemId:null,revision:this.revision,done:false,kind,closing:tool?.result?.can_finish === true});
      if (stale) { this.cancelled.add(id); this.send({type:"response.cancel",response_id:id}); return false; }
      this.unwatch("entry"); this.unwatch("tool-response");
      if (this.owner) {
        this.turns.set(this.owner, {responded:true}); this.unwatch(`turn:${this.owner}`);
      }
      this.watch(`response:${id}`, "response_generation_timeout", 60000);
      if (tool?.result?.can_finish) this.watch(`closing:${id}`, "closing_audio_timeout", 90000);
    }
    if (e.type === "response.output_item.added" && e.item?.type === "message") {
      const response = this.responses.get(id);
      if (response) response.itemId = e.item.id;
    }
    if (id && this.cancelled.has(id)) return ["output_audio_buffer.cleared", "output_audio_buffer.stopped", "response.done"].includes(e.type);
    if (e.type === "response.done") {
      const response = this.responses.get(id);
      if (response) { response.done = true; response.status = e.response.status; response.cancelled ||= e.response.status === "cancelled"; }
      this.unwatch(`response:${id}`);
      if (e.response.status === "cancelled") this.cancelled.add(id);
      if (["failed","incomplete"].includes(e.response.status)) this.onRecovery("response_failed");
      if (response?.drained && response.status === "completed" && !response.cancelled && response.itemId) response.delivered = true;
      this.settleCompletion(response);
      for (const tool of this.tools.values()) if (tool.responseId === id) tool.orientation ? this.settleOrientation(tool) : this.continueTool(tool);
    }
    if (e.type === "output_audio_buffer.started") {
      this.playing = true;
      this.watch(`audio:${id}`, "audio_playback_timeout", 90000);
    }
    if (["output_audio_buffer.stopped","output_audio_buffer.cleared"].includes(e.type)) {
      this.playing = false; this.unwatch(`audio:${id}`);
      if (e.type === "output_audio_buffer.cleared") { this.cancelled.add(id); const r = this.responses.get(id); if(r) r.cancelled = true; }
      const response = this.responses.get(id);
      if (e.type === "output_audio_buffer.stopped" && response) response.drained = true;
      if (response?.drained && response.status === "completed" && !this.cancelled.has(id) && response.itemId)
        response.delivered = true;
      for (const tool of this.tools.values()) if (tool.orientation && tool.responseId === id) this.settleOrientation(tool);
      this.settleCompletion(response);
    }
    if (e.type === "response.function_call_arguments.done" && !this.tools.has(e.call_id)) {
      if (this.responses.get(id)?.revision !== this.revision) return false;
      const tool = {callId:e.call_id,responseId:id,revision:this.revision};
      this.tools.set(e.call_id, tool);
      if (e.name === "confirm_orientation") {
        tool.orientation = true;
        this.watch("orientation:" + tool.callId, "orientation_audio_timeout", 15000);
        this.settleOrientation(tool);
        return true;
      }
      if (e.name !== "request_completion") { this.onRecovery("unknown_interview_tool"); return false; }
      if (this.orientationRequired || this.introductionPending) {
        tool.result = {can_finish:false,reason:"Complete the pending orientation and self-introduction opportunity first. Never describe this internal check aloud."};
        this.continueTool(tool);
        return true;
      }
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
  settleCompletion(response) {
    // Provider generation and audio drain may arrive in either order. Only one
    // successfully generated, drained authorized closing can submit the attempt.
    if (!response?.closing || response.cancelled || response.completionSent || !response.drained || !response.done || response.status !== "completed" || response.revision !== this.revision || this.closed) return;
    response.completionSent = true;
    for (const [id, owned] of this.responses) if (owned === response) this.unwatch(`closing:${id}`);
    queueMicrotask(() => { if (!this.closed && response.revision === this.revision) this.onCompletion(); });
  }
  settleOrientation(tool) {
    const response = this.responses.get(tool.responseId);
    // Tool-only output is not proof of delivered orientation audio.
    if (!tool.sent && response?.done && !response.itemId && tool.revision === this.revision && !this.closed) {
      this.unwatch("orientation:" + tool.callId);
      tool.orientation = false;
      tool.result = {orientation_delivered:false,reason:"No orientation audio was delivered. In the current language, finish only the missing opening details and one brief introduction invitation. Never claim the interrupted opening was heard."};
      this.continueTool(tool);
      return;
    }
    if (this.closed || tool.sent || tool.revision !== this.revision || this.cancelled.has(tool.responseId)
      || !response?.done || !response.delivered || response.status !== "completed") return;
    tool.sent = true;
    this.unwatch("orientation:" + tool.callId);
    if (this.orientationRequired) {
      this.orientationRequired = false;
      this.introductionPending = true;
      this.orientationPresented = true;
      this.orientationPresentedRevision = response.revision;
      this.onOrientation({response_id:tool.responseId, item_id:response.itemId});
      this.updateContext(this.instructions);
    }
    this.send({type:"conversation.item.create",item:{type:"function_call_output",call_id:tool.callId,output:JSON.stringify({orientation_delivered:true,next:"Listen for the self-introduction; do not repeat the opening."})}});
    // No response.create: the next candidate speech remains provider-owned.
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
    if ((this.orientationConfirmed || this.orientationPresented) && instructions) instructions = instructions.replace(
      /\[FEEDX ORIENTATION\][\s\S]*?\[\/FEEDX ORIENTATION\]/,
      this.orientationConfirmed
        ? "[FEEDX ORIENTATION]Orientation is complete. Never welcome or introduce the role again. Never call confirm_orientation again. Continue the current interview thread.[/FEEDX ORIENTATION]"
        : "[FEEDX ORIENTATION]Orientation has been delivered. Never repeat the welcome, role scope or duration. Await a brief self-introduction; Hello/Hi/OK/Yes/嗯/好/lah alone does not change language. After meaningful introduction or explicit decline, reuse its evidence and continue naturally; establish Unknown preference before offering-specific scheduling. Never call confirm_orientation again.[/FEEDX ORIENTATION]");
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
