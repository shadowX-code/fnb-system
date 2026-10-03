const name = "feedx-recruitment-recording-v1";
function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("units", { keyPath: "id" });
      r.result.createObjectStore("chunks", { keyPath: "key" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function work(store, mode, fn) {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      let value;
      r.onsuccess = () => {
        value = r.result;
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error || Error("Local recording storage failed."));
    });
  } finally {
    d.close();
  }
}
export const recordingStore = {
  unit: (unit) => work("units", "readwrite", (s) => s.put(unit)),
  chunk: (chunk) => work("chunks", "readwrite", (s) => s.put(chunk)),
  units: async (attemptKey) =>
    (await work("units", "readonly", (s) => s.getAll())).filter(
      (u) => u.attemptKey === attemptKey,
    ),
  chunks: async (unitId) =>
    (await work("chunks", "readonly", (s) => s.getAll()))
      .filter((c) => c.unitId === unitId)
      .sort((a, b) => a.index - b.index),
  removeUnit: async (id) => {
    for (const c of await recordingStore.chunks(id))
      await work("chunks", "readwrite", (s) => s.delete(c.key));
    await work("units", "readwrite", (s) => s.delete(id));
  },
};
export async function interviewLocalKey(token) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(bytes)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
