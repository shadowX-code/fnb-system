// Corroborate provider VAD with the echo-cancelled microphone. These are
// conservative acoustic heuristics, not speech recognition or speaker identity.
export function watchInterviewBargeIn(microphone, playback, isCurrent, onSpeech) {
  const mic = new Float32Array(microphone.fftSize);
  const remote = new Float32Array(playback.fftSize);
  const sampleRate = microphone.context.sampleRate;
  const interval = 20;
  let noiseFloor = 0.003, previous = performance.now(), voicedMs = 0;
  let lastVoiced = -Infinity;
  const output = [];
  const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);

  const timer = setInterval(() => {
    const now = performance.now();
    const elapsed = now - previous;
    previous = now;
    if (elapsed > 60 || !isCurrent()) {
      voicedMs = 0;
      lastVoiced = -Infinity;
      output.length = 0;
      return;
    }
    microphone.getFloatTimeDomainData(mic);
    playback.getFloatTimeDomainData(remote);
    const level = rms(mic);
    // Bound residual speaker leakage using the recent playback envelope,
    // allowing for the device's output and acoustic echo delay.
    output.push(rms(remote));
    if (output.length > 8) output.shift();
    const aboveNoise = level >= Math.max(0.008, noiseFloor * 2.6, Math.max(...output) * 0.35);
    if (aboveNoise && voiced(mic, sampleRate)) {
      voicedMs = (now - lastVoiced > 90 ? 0 : voicedMs) + Math.min(elapsed, interval);
      lastVoiced = now;
      if (voicedMs >= 240) onSpeech(now);
    } else if (now - lastVoiced > 90) {
      voicedMs = 0;
      noiseFloor = Math.max(0.002, noiseFloor * 0.90 + level * 0.10);
    }
  }, interval);
  return () => clearInterval(timer);
}

function voiced(samples, sampleRate) {
  // A short, decimated autocorrelation distinguishes voiced syllables from
  // broadband noise and breathing. Semantic VAD independently gates admission.
  const stride = Math.max(1, Math.floor(sampleRate / 8000));
  const shortest = Math.floor(sampleRate / stride / 400);
  const longest = Math.ceil(sampleRate / stride / 85);
  for (let lag = shortest; lag <= longest; lag++) {
    const offset = lag * stride;
    let cross = 0, left = 0, right = 0;
    for (let i = offset; i < samples.length; i += stride) {
      const a = samples[i], b = samples[i - offset];
      cross += a * b;
      left += a * a;
      right += b * b;
    }
    if (cross > 0 && cross * cross >= 0.49 * left * right) return true;
  }
  return false;
}
