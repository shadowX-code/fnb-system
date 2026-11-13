import {afterEach, expect, it, vi} from "vitest";
import {watchInterviewPlaybackDrain} from "./interviewPlaybackDrain.js";

afterEach(() => vi.useRealTimers());

it("waits for actual remote speech and a quiet tail after completion, with no drain receipt", () => {
  vi.useFakeTimers({toFake:["setInterval","clearInterval","performance"]});
  let sound = 0, playing = true;
  const onDrain = vi.fn();
  const monitor = watchInterviewPlaybackDrain({
    fftSize: 32, getFloatTimeDomainData: samples => samples.fill(sound),
  }, () => playing, onDrain);
  vi.advanceTimersByTime(2000);
  expect(onDrain).not.toHaveBeenCalled();
  sound = 0.2;
  vi.advanceTimersByTime(200);
  sound = 0;
  vi.advanceTimersByTime(2000);
  expect(onDrain).not.toHaveBeenCalled();
  monitor.complete();
  vi.advanceTimersByTime(800);
  sound = 0.2;
  vi.advanceTimersByTime(200);
  expect(onDrain).not.toHaveBeenCalled();
  sound = 0;
  playing = false;
  vi.advanceTimersByTime(2000);
  expect(onDrain).not.toHaveBeenCalled();
  playing = true;
  vi.advanceTimersByTime(1500);
  expect(onDrain).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1500);
  expect(onDrain).toHaveBeenCalledOnce();
});
