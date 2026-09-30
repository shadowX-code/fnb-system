const databaseName = "feedx-recruitment-transcript-v1";
const storeName = "turns";

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(mode, work) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transcript storage failed."));
      result = work(tx.objectStore(storeName));
    });
  } finally { db.close(); }
}

export const interviewTranscriptQueue = {
  put: (item) => transaction("readwrite", (store) => store.put(item)),
  remove: (key) => transaction("readwrite", (store) => store.delete(key)),
  list: async (attemptKey) => {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result.filter((item) => item.attemptKey === attemptKey).sort((a, b) => a.turn_number - b.turn_number));
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  },
};
