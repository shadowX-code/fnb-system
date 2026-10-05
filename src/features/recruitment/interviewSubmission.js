import { bounded } from "./interviewRecovery.js";
export const isSubmissionTerminal = (status) =>
  ["completed", "partial", "failed"].includes(status);

// A lost upload/finalize response is not evidence of failure. Observe the token-
// authorized durable outcome independently of the expired media/session lease.
export async function reconcileSubmission({
  read,
  finalize,
  onResult,
  signal,
  timeoutMs = 90000,
  intervalMs = 2000,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const entry = await bounded(read(), "Checking saved interview", {
        signal,
        timeoutMs: 5000,
      });
      if (!entry.available)
        throw Object.assign(
          Error(
            "This interview link is no longer available. Contact the hiring team.",
          ),
          { code: "submission_unavailable" },
        );
      if (isSubmissionTerminal(entry.status)) {
        onResult(entry);
        return entry;
      }
      if (finalize) {
        const result = await bounded(finalize(), "Submitting your interview", {
          signal,
          timeoutMs: 10000,
        });
        if (isSubmissionTerminal(result.status)) {
          onResult(result);
          return result;
        }
      }
    } catch (error) {
      if (signal?.aborted || error.code === "submission_unavailable")
        throw error;
      lastError = error;
    }
    await bounded(
      new Promise((resolve) => setTimeout(resolve, intervalMs)),
      "Checking submission",
      { signal, timeoutMs: intervalMs + 1000 },
    );
  }
  throw Error(
    lastError?.message ||
      "Your responses are saved, but submission is not yet confirmed. Retry submission with a stable connection.",
  );
}
