// Recovery has a finite lifetime. Browser/media promises may never settle after suspension.
export function bounded(promise, label, { signal, timeoutMs = 15000, onLate } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(Object.assign(Error("Recovery was interrupted. Please resume again."), { code: "recovery_cancelled" }));
    const timer = setTimeout(() => finish(Object.assign(Error(`${label} timed out. Please try resuming again.`), { code: "recovery_timeout", stage: label })), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    Promise.resolve(promise).then(value => {
      if (settled) onLate?.(value);
      else finish(null, value);
    }, error => finish(error));
  });
}

export function readyInterviewMedia(stream, signal) {
  const tracks = stream.getTracks();
  if (!tracks.some(t=>t.kind === "audio") || !tracks.some(t=>t.kind === "video"))
    return Promise.reject(Object.assign(Error("Both camera and microphone are required. Tap Resume to reacquire them."),{code:"missing_media_tracks"}));
  return new Promise((resolve,reject)=>{
    const cleanup = () => {
      signal?.removeEventListener("abort",cancel);
      for(const track of tracks) { track.removeEventListener("unmute",check);track.removeEventListener("ended",check); }
    };
    const cancel=()=>{cleanup();reject(Error("Device acquisition was interrupted. Tap Resume again."));};
    const check=()=>{
      if(tracks.some(t=>t.readyState !== "live")) {cleanup();reject(Object.assign(Error("A device stopped. Tap Resume to reacquire it."),{code:"stale_media_tracks"}));}
      else if(tracks.every(t=>!t.muted)) {cleanup();resolve(stream);}
    };
    signal?.addEventListener("abort",cancel,{once:true});
    for(const track of tracks) {track.addEventListener("unmute",check);track.addEventListener("ended",check);}
    if(signal?.aborted) cancel();else check();
  });
}

export class InterviewRecovery {
  constructor(onState) { this.onState = onState; this.state = "RECOVERY_REQUIRED"; }
  transition(state, stage = "") { this.state = state; this.stage = stage; this.onState?.({ state, stage }); }
  begin(activate) {
    const previous = this.operation;
    const operation = { id: crypto.randomUUID(), controller: new AbortController() };
    this.operation = operation;
    try { activate?.(operation); } catch(error) { operation.controller.abort(); this.operation = null; previous?.controller.abort(); this.transition("RECOVERY_REQUIRED"); throw error; }
    // Abort after the new gesture has invoked native acquisition; old continuations
    // already fail the current-operation fence synchronously.
    if (previous) queueMicrotask(() => previous.controller.abort());
    this.transition("RECOVERING", "preparing");
    return operation;
  }
  current(operation) { return this.operation === operation && !operation.controller.signal.aborted; }
  async step(operation, stage, work, options = {}) {
    if (!this.current(operation)) throw Error("Recovery was replaced.");
    this.transition("RECOVERING", stage);
    const value = await bounded(work(operation.controller.signal), stage, { ...options, signal: operation.controller.signal });
    if (!this.current(operation)) throw Error("Recovery was replaced.");
    return value;
  }
  finish(operation, state) {
    if (this.operation !== operation) return;
    this.operation = null;
    this.transition(state);
  }
  cancel() {
    this.operation?.controller.abort();
    this.operation = null;
    this.transition("RECOVERY_REQUIRED");
  }
}
