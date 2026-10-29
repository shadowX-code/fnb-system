export const FACTORY_BOOTSTRAP_TIMEOUT_MS = 30000;

export async function factoryBootstrap(load, controller, timeoutMs = FACTORY_BOOTSTRAP_TIMEOUT_MS) {
  let timer;
  let onAbort;
  const boundary = new Promise((_, reject) => {
    onAbort = () => reject(Object.assign(new Error("Factory loading cancelled."), { name: "AbortError" }));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (controller.signal.aborted) return onAbort();
    timer = setTimeout(() => {
      reject(Object.assign(new Error("Factory initialization took too long. Check your connection and retry."), { name: "TimeoutError" }));
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
