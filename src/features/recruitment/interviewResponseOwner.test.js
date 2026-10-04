import { afterEach, describe, it, expect, vi } from "vitest";
import { InterviewResponseOwner } from "./InterviewResponseOwner.js";
afterEach(() => vi.useRealTimers());
function owner() {
  const send = vi.fn(), control = new InterviewResponseOwner(send);
  const event = (type, fields = {}) => control.event({type,...fields});
  const creates = () => send.mock.calls.map(([e])=>e).filter(e=>e.type === "response.create");
  return {send,control,event,creates};
}
describe("One response owner per semantic candidate turn", () => {
  it("does not create responses from thinking pauses or duplicate EOS commits", () => {
    const {event,creates}=owner();
    event("input_audio_buffer.speech_started",{item_id:"candidate"});
    event("input_audio_buffer.speech_stopped",{item_id:"candidate"});
    expect(creates()).toHaveLength(0);
    event("input_audio_buffer.committed",{item_id:"candidate"});
    event("input_audio_buffer.committed",{item_id:"candidate"});
    expect(creates()).toHaveLength(1);
  });
  it("waits for both generation and actual playback before continuing a tool", () => {
    const {control,event,creates}=owner();
    control.request("candidate");
    event("response.created",{response:{id:"r1",metadata:{owner:"candidate"}}});
    event("output_audio_buffer.started",{response_id:"r1"});
    control.tool({call_id:"tool",response_id:"r1"},{can_finish:false},"candidate");
    event("response.done",{response:{id:"r1"}});
    expect(creates()).toHaveLength(1);
    event("output_audio_buffer.stopped",{response_id:"r1"});
    expect(creates()).toHaveLength(2);
    control.tool({call_id:"tool",response_id:"r1"},{can_finish:false},"candidate");
    expect(creates()).toHaveLength(2);
  });
  it("cancels barge-in audio, ignores late tool results and stale response events", () => {
    const {control,event,creates,send}=owner();
    control.request("first");
    event("response.created",{response:{id:"r1",metadata:{owner:"first"}}});
    event("output_audio_buffer.started",{response_id:"r1"});
    event("input_audio_buffer.speech_started",{item_id:"second"});
    control.tool({call_id:"late",response_id:"r1"},{can_finish:true},"first");
    event("input_audio_buffer.speech_stopped",{item_id:"second"});
    event("input_audio_buffer.committed",{item_id:"second"});
    expect(creates()).toHaveLength(1);
    expect(event("response.done",{response:{id:"r1"}})).toBe(false);
    expect(creates()).toHaveLength(1);
    event("output_audio_buffer.cleared",{response_id:"r1"});
    expect(creates()).toHaveLength(2);
    expect(send.mock.calls.map(([e])=>e.type)).toContain("output_audio_buffer.clear");
    expect(event("response.output_audio_transcript.done",{response_id:"r1"})).toBe(false);
  });
  it("cancels a response whose acknowledgement arrives after interruption", () => {
    const {control,event,send}=owner();
    control.request("first");
    event("input_audio_buffer.speech_started",{item_id:"second"});
    expect(event("response.created",{response:{id:"late",metadata:{owner:"first"}}})).toBe(false);
    expect(send.mock.calls.map(([e])=>e)).toContainEqual({type:"response.cancel",response_id:"late"});
  });
  it("closed transports cannot create or accept responses", () => {
    const {control,event,creates}=owner();
    control.close();
    control.request("new");
    event("input_audio_buffer.committed",{item_id:"candidate"});
    expect(creates()).toHaveLength(0);
  });
});

it("iPhone trace: a generated-but-still-playing question keeps ownership until its clear acknowledgement", () => {
  const {control,event,creates}=owner();
  control.request("session:2",false,false,"first continuation only");
  event("response.created",{response:{id:"resume",metadata:{owner:"session:2"}}});
  event("output_audio_buffer.started",{response_id:"resume"});
  event("response.done",{response:{id:"resume"}});
  event("input_audio_buffer.speech_started",{item_id:"answer"});
  event("input_audio_buffer.speech_stopped",{item_id:"answer"});
  event("input_audio_buffer.committed",{item_id:"answer"});
  expect(creates()).toHaveLength(1);
  event("output_audio_buffer.cleared",{response_id:"resume"});
  expect(creates()).toHaveLength(2);
  expect(creates()[0].response.instructions).toBe("first continuation only");
  expect(creates()[1].response.instructions).toBeUndefined();
  control.request("session:2");
  expect(creates()).toHaveLength(2);
  event("response.created",{response:{id:"answer-r",metadata:{owner:"answer"}}});
  event("output_audio_buffer.started",{response_id:"answer-r"});
  event("output_audio_buffer.stopped",{response_id:"resume"});
  expect(control.active.id).toBe("answer-r");
  expect(control.active.playing).toBe(true);
  control.close();
});
it("a duplicate speech-start or late previous commit cannot cancel or own a newer candidate turn", () => {
  const {control,event,creates}=owner();
  event("input_audio_buffer.speech_started",{item_id:"first"});
  event("input_audio_buffer.speech_stopped",{item_id:"first"});
  event("input_audio_buffer.committed",{item_id:"first"});
  event("response.created",{response:{id:"r1",metadata:{owner:"first"}}});
  event("input_audio_buffer.speech_started",{item_id:"first"});
  expect(control.cancelled.has("r1")).toBe(false);
  event("input_audio_buffer.speech_started",{item_id:"second"});
  event("input_audio_buffer.committed",{item_id:"first"});
  expect(control.owner).toBe("second");
  expect(creates()).toHaveLength(1);
  control.close();
});
it("missing cancellation/playback acknowledgements fail into transport recovery instead of wedging the owner",async()=>{
  vi.useFakeTimers();
  const fail=vi.fn(),control=new InterviewResponseOwner(vi.fn(),vi.fn(),fail);
  control.request("first");
  await vi.advanceTimersByTimeAsync(30001);
  expect(fail).toHaveBeenCalledOnce();
  control.close();
});

it("exactly one first continuation intent cannot overtake early live candidate speech",()=>{
  const first=owner();
  first.control.begin("session:2","first only");first.control.begin("session:2","first only");
  expect(first.creates()).toHaveLength(1);first.control.close();
  const early=owner();
  early.event("input_audio_buffer.speech_started",{item_id:"early"});
  early.event("input_audio_buffer.speech_stopped",{item_id:"early"});
  early.event("input_audio_buffer.committed",{item_id:"early"});
  early.control.begin("session:2","first only");
  expect(early.creates()).toHaveLength(1);
  expect(early.creates()[0].response.metadata.owner).toBe("early");early.control.close();
});
