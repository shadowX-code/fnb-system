export const FACTORY_BOOTSTRAP_TIMEOUT_MS = 30000;

export async function factoryBootstrap(load, controller, timeoutMs = FACTORY_BOOTSTRAP_TIMEOUT_MS, dependencies = new Map()) {
  let timer;
  let onAbort;
  const boundary = new Promise((_, reject) => {
    onAbort = () => reject(Object.assign(new Error("Factory loading cancelled."), { name: "AbortError" }));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (controller.signal.aborted) return onAbort();
    timer = setTimeout(() => {
      const pending = [...dependencies.values()].filter((item) => item.status === "pending");
      const waiting = pending.length ? ` Waiting for ${pending.map((item) => item.label).join(", ")} (${Math.round(timeoutMs / 1000)}s).` : "";
      // Labels/timings only: never log query URLs, parameters, payloads or auth material.
      console.warn("[Factory initialization deadline]", { elapsedMs: timeoutMs, pending: pending.map(({ key, label }) => ({ key, label })) });
      reject(Object.assign(new Error(`Factory initialization took too long.${waiting} Check your connection and retry.`), { name: "TimeoutError" }));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([boundary, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw Object.assign(new Error("Factory loading cancelled."), { name: "AbortError" });
      return load();
    })]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
