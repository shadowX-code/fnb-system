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

export class InterviewRecovery {
  constructor(onState) { this.onState = onState; this.state = "RECOVERY_REQUIRED"; }
  transition(state, stage = "") { this.state = state; this.stage = stage; this.onState?.({ state, stage }); }
  begin() {
    if (this.operation) return null;
    const operation = { id: crypto.randomUUID(), controller: new AbortController() };
    this.operation = operation;
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
