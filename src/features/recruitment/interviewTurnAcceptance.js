// These are conservative acceptance guards, not calibrated speech confidence or
// speaker verification. Provider timings include padding; logprobs describe ASR.
export function automaticTurnDecision({started, stopped, committed, startMs, endMs, logprobs}, text) {
  if (!started || !stopped || !committed || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs - startMs < 200)
    return "uncertain_boundaries";
  if (/^[\s\p{P}]*(?:um+|uh+|erm+|hmm+|嗯+|呃+)[\s\p{P}]*$/iu.test(text)) return "thinking_pause";
  const values = Array.isArray(logprobs) ? logprobs.map(x => x?.logprob) : null;
  if (!values?.length || !values.every(Number.isFinite)) return "confidence_unavailable";
  // No amplitude threshold: a quiet but confidently transcribed answer can pass.
  if (values.reduce((a,b) => a + b, 0) / values.length < -0.5 || values.filter(x => x < -2).length / values.length > 0.2)
    return "uncertain_transcription";
  return "accept";
}
