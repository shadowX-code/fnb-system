// WebRTC can omit the provider's drain receipt. After generation and the audio
// transcript finish, observe the existing remote recording source for a quiet tail.
export function watchInterviewPlaybackDrain(analyser, isPlaying, onDrain) {
  const samples = new Float32Array(analyser.fftSize);
  let heard = false;
  let completed = false;
  let quietSince = null;
  let sampledAt = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const delayed = now - sampledAt > 250;
    sampledAt = now;
    if (delayed || !isPlaying()) {
      quietSince = null;
      return;
    }
    analyser.getFloatTimeDomainData(samples);
    if (samples.some(sample => Math.abs(sample) > 0.001)) {
      heard = true;
      quietSince = null;
    } else if (heard && completed) {
      quietSince ??= now;
      if (now - quietSince >= 1400) {
        clearInterval(timer);
        onDrain();
      }
    }
  }, 50);
  return {
    complete() { completed = true; },
    stop() { clearInterval(timer); },
  };
}
