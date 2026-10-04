import { interviewLocalKey } from "./interviewRecordingStore.js";

export async function acquireInterviewClient(token) {
  const key = await interviewLocalKey(token);
  if (!navigator.locks) throw Error("Use a current Safari or Chrome browser to resume safely.");
  return new Promise((resolve, reject) => {
    navigator.locks.request(`feedx-interview:${key}`, { ifAvailable: true }, async (lock) => {
      if (!lock) { reject(Error("This interview is already open in another tab. Close that tab and try again.")); return; }
      let clientId;
      try {
        clientId = sessionStorage.getItem(`feedx-interview-client:${key}`) || crypto.randomUUID();
        sessionStorage.setItem(`feedx-interview-client:${key}`, clientId);
      } catch { reject(Error("Allow browser storage so your interview can recover after refresh.")); return; }
      await new Promise((release) => resolve({ clientId, release }));
    }).catch(reject);
  });
}
