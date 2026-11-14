import {afterEach, expect, it, vi} from "vitest";
import {connectInterviewSdk, interviewQaTransport, observeRemoteAudio} from "./interviewSdkTransport.js";

const policy = {
  type:"realtime", model:"gpt-realtime-1.5", tracing:null,
  include:["item.input_audio_transcription.logprobs"],
  audio:{input:{
    turn_detection:{type:"semantic_vad",eagerness:"low",create_response:false,interrupt_response:false},
    transcription:{model:"gpt-4o-transcribe"}, noise_reduction:{type:"near_field"},
  }},
};

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function provider({ session = policy, stalled = false, delay = 0, error, naturalQa } = {}) {
  let peer;
  class Channel extends EventTarget {
    readyState = "connecting";
    send = vi.fn(raw => {
      if (JSON.parse(raw).type !== "session.update") return;
      if (error) {
        queueMicrotask(() => this.receive({type:"error", event_id:"event_error", error}));
      } else if (session) {
        const acknowledge = () => this.receive({type:"session.updated",event_id:"event_ack",session});
        if (delay) setTimeout(acknowledge, delay);
        else queueMicrotask(acknowledge);
      }
    });
    receive(data) { this.dispatchEvent(new MessageEvent("message",{data:JSON.stringify(data)})); }
    close() { this.readyState="closed"; this.dispatchEvent(new Event("close")); }
  }
  vi.stubGlobal("RTCPeerConnection", class {
    constructor() { peer=this; }
    createDataChannel() { return this.channel=new Channel(); }
    addTrack(track) { this.input=track; }
    async createOffer() { return {sdp:"fixture offer"}; }
    async setLocalDescription() {}
    async setRemoteDescription() {
      this.remoteDescriptionSet=true;
      this.channel.readyState="open";
      this.channel.dispatchEvent(new Event("open"));
    }
    close() { this.closed=true; }
  });
  let settle;
  const fetch=vi.fn(() => stalled ? new Promise(resolve => settle=resolve) : Promise.resolve({
    ok:true, headers:new Headers(), text:async()=>"fixture answer",
  }));
  vi.stubGlobal("fetch",fetch);
  const track={enabled:false,stop:vi.fn()};
  const bind=vi.fn(), consume=vi.fn(), checkpoint=vi.fn(), controller=new AbortController();
  const connection=connectInterviewSdk({
    signal:controller.signal, mediaStream:{getAudioTracks:()=>[track]},audioElement:{},
    apiKey:"ek_fake_test_key",bind,consume,checkpoint,naturalQa,
  });
  return {connection, bind, consume, checkpoint, controller, track, fetch, peer:()=>peer, settle:()=>settle({ok:true})};
}

it("uses the installed SDK to establish one channel without overwriting server config or generating speech",async()=>{
  const q=provider(); await q.connection;
  const {channel,input}=q.peer();
  expect(input).toBe(q.track);
  expect(input.enabled).toBe(false);
  expect(q.bind).toHaveBeenCalledWith(q.peer(),channel,expect.anything());
  expect(channel.send.mock.calls.map(([raw])=>JSON.parse(raw))).toEqual([
    {type:"session.update",session:{
      type:"realtime",tracing:null,include:policy.include,
      audio:{input:{
        turn_detection:policy.audio.input.turn_detection,
        noise_reduction:policy.audio.input.noise_reduction,
      }},
    }},
  ]);
  const event={type:"output_audio_buffer.started",response_id:"resp_1",event_id:"event_audio"};
  channel.receive(event);
  expect(q.consume).toHaveBeenLastCalledWith(event);
  const final = {type:"conversation.item.input_audio_transcription.completed",event_id:"event_final",item_id:"item_1",content_index:0,transcript:"QA"};
  channel.receive(final);
  expect(q.consume).toHaveBeenLastCalledWith(final);
  expect(channel.send).toHaveBeenCalledTimes(1);
  q.bind.mock.calls[0][2].close();
  expect(input.stop).not.toHaveBeenCalled();
});

it("fails closed if the provider enables automatic generation or explicitly disables evidence signals", async()=>{
  for (const override of [{include:[]},{audio:{input:{...policy.audio.input,turn_detection:{...policy.audio.input.turn_detection,create_response:true}}}}]) {
    const q=provider({session:{...policy,...override}});
    await expect(q.connection).rejects.toMatchObject({code:"sdk_policy_unverified"});
    expect(q.peer().closed).toBe(true);
    expect(q.peer().channel.readyState).toBe("closed");
  }
});

it("waits for the actual acknowledgement after SDK 0.21.0 resolves on its five-second fallback", async()=>{
  vi.useFakeTimers();
  const q=provider({delay:5200});
  let ready = false;
  const connection = q.connection.then(() => { ready = true; });
  await vi.waitFor(() => expect(q.peer()?.channel.send).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(5050);
  expect(ready).toBe(false);
  expect(q.checkpoint).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(250);
  await connection;
  expect(q.checkpoint).toHaveBeenCalledWith("sdk.policy", "dependency_completed");
  q.bind.mock.calls[0][2].close();
});

it("reports a missing acknowledgement separately from a rejected SDK connection", async()=>{
  vi.useFakeTimers();
  const q=provider({session:null});
  const rejected=expect(q.connection).rejects.toMatchObject({code:"sdk_policy_unverified"});
  await vi.waitFor(() => expect(q.peer()?.channel.send).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(6100);
  await rejected;
  expect(q.checkpoint).toHaveBeenCalledWith("sdk.policy", "ack_missing");
  expect(q.peer().closed).toBe(true);

  const failure=provider({error:{type:"invalid_request_error",code:"fixture_rejected",message:"Fixture rejection"}});
  await expect(failure.connection).rejects.toMatchObject({code:"sdk_connection_failed"});
  expect(failure.checkpoint).not.toHaveBeenCalled();
});

it("abandons a stalled SDK exchange without applying its late SDP or emitting old events", async()=>{
  const q=provider({stalled:true});
  const rejected=expect(q.connection).rejects.toMatchObject({name:"AbortError"});
  await vi.waitFor(()=>expect(q.fetch).toHaveBeenCalledOnce());
  q.controller.abort();
  await rejected;
  q.settle();
  await Promise.resolve();
  expect(q.peer().closed).toBe(true);
  expect(q.peer().remoteDescriptionSet).toBeUndefined();
  expect(q.consume).not.toHaveBeenCalled();
});

it("selects only explicit legacy/SDK arms for labelled canonical Staging openings",()=>{
  const data="https://ujkzdaaadnvcfayuldmh.supabase.co";
  const loc={origin:"https://fnb-system-staging.vercel.app",search:"?voice-transport=sdk"};
  expect(interviewQaTransport("QA: Voice parity",loc,data)).toBe("sdk");
  expect(interviewQaTransport("QA: Voice parity",{...loc,search:"?voice-transport=legacy"},data)).toBe("legacy");
  expect(interviewQaTransport("QA: Voice parity",{...loc,search:""},data)).toBeUndefined();
  expect(interviewQaTransport("Service Crew",loc,data)).toBeUndefined();
  expect(interviewQaTransport("QA: Voice parity",loc,"https://other.supabase.co")).toBeUndefined();
  expect(interviewQaTransport("QA: Voice parity",{...loc,origin:"https://interview.feedx.my"},data)).toBeUndefined();
});

it("reports increasing received audio energy once, without mistaking silence or muted playback for onset",async()=>{
  vi.useFakeTimers();
  const track={muted:false};
  let energy=2;
  const audio={paused:false,muted:true,volume:1};
  const peer={getReceivers:()=>[{track,getStats:async()=>new Map([["a",{type:"inbound-rtp",kind:"audio",totalAudioEnergy:energy}]])}]};
  const onset=vi.fn();
  const stop=observeRemoteAudio(peer,track,audio,onset);
  await vi.advanceTimersByTimeAsync(50);
  expect(onset).not.toHaveBeenCalled();
  energy++;
  await vi.advanceTimersByTimeAsync(50);
  expect(onset).not.toHaveBeenCalled();
  audio.muted=false;
  energy++;
  await vi.advanceTimersByTimeAsync(50);
  energy++;
  await vi.advanceTimersByTimeAsync(150);
  expect(onset).toHaveBeenCalledOnce();
  stop();
});

it("accepts a provider snapshot name and an acknowledgement without optional echoed settings",async()=>{
  const q=provider({session:{
    ...policy, model:"gpt-realtime-1.5-2026-01-01", tracing:undefined, include:undefined,
    audio:{input:{...policy.audio.input,noise_reduction:undefined}},
  }});
  await q.connection;
  q.bind.mock.calls[0][2].close();
});


it("selects Natural QA only for the explicit Staging SDK arm and verifies provider flags and tool isolation", async()=>{
  const loc={origin:"https://fnb-system-staging.vercel.app",search:"?voice-transport=sdk&voice-policy=natural-qa"};
  const data="https://ujkzdaaadnvcfayuldmh.supabase.co";
  expect(interviewQaTransport("QA Profile Test",loc,data)).toBe("sdk-natural-qa");
  expect(interviewQaTransport("Service Crew",loc,data)).toBeUndefined();
  const turn_detection={...policy.audio.input.turn_detection,create_response:true,interrupt_response:true};
  const session={...policy,tools:[],audio:{input:{...policy.audio.input,turn_detection}}};
  const qa=provider({session,naturalQa:true});
  await qa.connection;
  const [[raw]]=qa.peer().channel.send.mock.calls;
  expect(JSON.parse(raw).session.audio.input.turn_detection).toEqual(turn_detection);
  qa.bind.mock.calls[0][2].close();
  await expect(provider({session:{...session,tools:[{name:"request_completion"}]},naturalQa:true}).connection)
    .rejects.toMatchObject({code:"sdk_policy_unverified"});
});
