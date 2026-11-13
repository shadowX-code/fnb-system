import { afterEach, expect, it, vi } from "vitest";
import { watchInterviewBargeIn } from "./interviewBargeIn.js";

afterEach(() => vi.useRealTimers());

function sample({ speech = 0, echo = 0, noise = 0, duration = 500 }) {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  let state = 2026;
  const analyser = (read) => ({
    fftSize: 2048, context: { sampleRate: 48000 },
    getFloatTimeDomainData: buffer => {
      for (let i = 0; i < buffer.length; i++) buffer[i] = read(i);
    },
  });
  const voice = i => Math.sin(2 * Math.PI * 185 * i / 48000);
  const playback = analyser(i => 0.10 * voice(i));
  const microphone = analyser(i => {
    state = (1664525 * state + 1013904223) >>> 0;
    return ((performance.now() <= duration ? speech : 0) + echo) * voice(i) +
      noise * (2 * state / 2 ** 32 - 1);
  });
  const confirmed = vi.fn();
  const stop = watchInterviewBargeIn(microphone, playback, () => true, confirmed);
  vi.advanceTimersByTime(500);
  stop();
  return confirmed;
}

it("needs about 240 ms of near-end voicing over residual playback", () => {
  const confirmed = sample({ speech:0.08, echo:0.015, noise:0.01 });
  expect(confirmed.mock.calls[0][0]).toBe(240);
});

it.each([
  { echo:0.024 },
  { noise:0.06 },
  { echo:0.018, noise:0.04 },
  { speech:0.12, duration:160 },
])("keeps playing through modeled residual echo, noise or a brief acknowledgement (%j)", signals => {
  expect(sample(signals)).not.toHaveBeenCalled();
});
