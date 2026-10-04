import { cleanup, fireEvent, act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const qa=vi.hoisted(()=>({begin:vi.fn(),interruption:vi.fn(),captures:[],transports:[],state:vi.fn(),activation:vi.fn(),recordStart:vi.fn(),flush:vi.fn(),connect:vi.fn()}));
vi.mock("./interviewClient.js",()=>({acquireInterviewClient:async()=>({clientId:"stable-client",release:vi.fn()})}));
vi.mock("./recruitmentService.js",()=>({recruitmentService:{
  begin:qa.begin, recoverBegin:qa.begin,recoveryState:qa.state,recoverPause:qa.interruption,observeRecovery:vi.fn().mockResolvedValue(),interruption:qa.interruption, heartbeat:vi.fn(),
}}));
vi.mock("./interviewRecordingStore.js",()=>({interviewLocalKey:async()=>"partition"}));
vi.mock("./InterviewRecording.js",()=>({InterviewRecording:class {
  static activateAudio() {return qa.activation();}
  dispose() {}
  constructor(props) { this.props=props; this.attemptKey="partition"; this.recorder={state:"inactive"}; qa.captures.push(this); }
  async recover() { this.uploadRecovery=new Promise(()=>{}); }
  async start() { await qa.recordStart(); this.recorder.state="recording"; this.props.onStatus("recording"); }
  stop() { this.recorder.state="inactive"; this.captureStopped=new Promise(()=>{}); this.stopPromise=new Promise(()=>{}); return this.stopPromise; }
}}));
vi.mock("./RecruitmentRealtimeSession.js",()=>({RecruitmentRealtimeSession:class {
  constructor(props) { this.props=props; qa.transports.push(this); }
  async flush() {return qa.flush();}
  async connect() {await qa.connect(); this.props.onStatus?.("connected");}
  close() {this.closed=true;}
}}));
import RecruitmentInterviewSession from "./RecruitmentInterviewSession.jsx";
beforeEach(()=>{
  vi.clearAllMocks();qa.captures.length=0;qa.transports.length=0;
  qa.state.mockResolvedValue({state:"RECOVERY_REQUIRED",recovery_id:null});
  qa.activation.mockReturnValue({context:{close:vi.fn().mockResolvedValue(),state:"running"},ready:Promise.resolve()});
  qa.recordStart.mockResolvedValue();qa.flush.mockResolvedValue(0);qa.connect.mockResolvedValue();
  qa.begin.mockResolvedValue({status:"starting",started_at:new Date().toISOString(),max_ends_at:new Date(Date.now()+600000).toISOString()});
  qa.interruption.mockResolvedValue({status:"interrupted"});
  vi.spyOn(document,"hidden","get").mockReturnValue(false);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});
function mount() {
  const devices={start:vi.fn().mockResolvedValue({getTracks:()=>[]}),stop:vi.fn(),streamRef:{current:{}},previewRef:{current:null}};
  render(<RecruitmentInterviewSession token={"a".repeat(64)} entry={{status:"interviewing"}} devices={devices}/>);
  return devices;
}
it("refresh presents explicit resume and reconnects without waiting for old evidence upload",async()=>{
  const devices=mount();
  expect(screen.queryByRole("button",{name:"Start interview"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));
  await screen.findByText(/AI connected/);
  expect(qa.begin.mock.calls[0].slice(0,2)).toEqual(["a".repeat(64),"stable-client"]);
  expect(devices.start).toHaveBeenCalledTimes(1);
  expect(qa.captures.filter(c=>c.recorder.state==="recording")).toHaveLength(1);
});
it("background closes the owner and foreground reacquires devices into a new unit on the same attempt",async()=>{
  const devices=mount();
  fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));
  await screen.findByText(/AI connected/);
  const prior=qa.transports.at(-1);
  vi.spyOn(document,"hidden","get").mockReturnValue(true);
  fireEvent(document,new Event("visibilitychange"));
  await screen.findByRole("heading",{name:"Interview interrupted"});
  expect(prior.closed).toBe(true);
  expect(qa.interruption.mock.calls[0][3]).toBe("page_backgrounded");
  prior.props.onStatus("connected");
  expect(screen.getByRole("heading",{name:"Interview interrupted"})).toBeTruthy();
  vi.spyOn(document,"hidden","get").mockReturnValue(false);
  fireEvent(document,new Event("visibilitychange"));
  fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));
  await waitFor(()=>expect(devices.start).toHaveBeenCalledTimes(2));
  await screen.findByText(/AI connected/);
  expect(qa.begin).toHaveBeenCalledTimes(2);
  expect(qa.captures.filter(c=>c.recorder.state==="recording")).toHaveLength(1);
});

it("activates fresh audio and requests fresh media during the tap, before server awaits",async()=>{
  const devices=mount();
  fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));
  expect(qa.activation).toHaveBeenCalledTimes(1);expect(devices.start).toHaveBeenCalledTimes(1);
  expect(qa.begin).not.toHaveBeenCalled();
  await screen.findByText(/AI connected/);
});
it("a never-settling capture acquisition becomes visible retryable recovery; retry succeeds",async()=>{
  vi.useFakeTimers();qa.recordStart.mockImplementationOnce(()=>new Promise(()=>{}));mount();
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));});
  await act(async()=>{await vi.advanceTimersByTimeAsync(16000);});
  expect(screen.getByRole("alert").textContent).toMatch(/timed out/);
  expect(screen.getByRole("button",{name:"Resume with camera and microphone"}).disabled).toBe(false);
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));});
  expect(screen.getByText(/AI connected/)).toBeTruthy();
  expect(qa.begin).toHaveBeenCalledTimes(2);
});
it("repeated Resume during recovery cannot compete and foreground cancels pending server work",async()=>{
  qa.begin.mockImplementationOnce(()=>new Promise(()=>{}));mount();
  const button=screen.getByRole("button",{name:"Resume with camera and microphone"});
  fireEvent.click(button);fireEvent.click(button);
  await waitFor(()=>expect(qa.begin).toHaveBeenCalledTimes(1));
  vi.spyOn(document,"hidden","get").mockReturnValue(true);fireEvent(document,new Event("visibilitychange"));
  vi.spyOn(document,"hidden","get").mockReturnValue(false);fireEvent(document,new Event("visibilitychange"));
  qa.begin.mockResolvedValue({status:"starting",started_at:new Date().toISOString(),max_ends_at:new Date(Date.now()+600000).toISOString()});
  fireEvent.click(button);await screen.findByText(/AI connected/);
  expect(qa.begin).toHaveBeenCalledTimes(2);
});
it("cold refresh discards pending in-memory media/transport rather than joining it",async()=>{
  qa.connect.mockImplementationOnce(()=>new Promise(()=>{}));mount();
  fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));
  await waitFor(()=>expect(qa.connect).toHaveBeenCalledTimes(1));
  const stale=qa.transports.at(-1);cleanup();qa.connect.mockResolvedValue();
  mount();fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));
  await screen.findByText(/AI connected/);expect(stale.closed).toBe(true);expect(qa.connect).toHaveBeenCalledTimes(2);
});
it("durable terminal state explains the outcome without creating capture/provider ownership",async()=>{
  qa.state.mockResolvedValue({state:"TERMINAL",reason:"Interview link is unavailable."});mount();
  fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));
  await screen.findByRole("heading",{name:"Interview cannot continue"});
  expect(qa.begin).not.toHaveBeenCalled();expect(qa.recordStart).not.toHaveBeenCalled();
});

it("pending old transcript persistence cannot hold a cold durable resume indefinitely",async()=>{
  vi.useFakeTimers();qa.flush.mockImplementationOnce(()=>new Promise(()=>{}));mount();
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));});
  await act(async()=>{await vi.advanceTimersByTimeAsync(8100);});
  expect(screen.getByText(/AI connected/)).toBeTruthy();
  expect(screen.getByText(/Some local evidence is still waiting/)).toBeTruthy();
});
