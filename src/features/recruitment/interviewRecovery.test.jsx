import { cleanup, fireEvent, act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const qa=vi.hoisted(()=>({begin:vi.fn(),interruption:vi.fn(),captures:[],transports:[],state:vi.fn(),activation:vi.fn(),recordStart:vi.fn(),flush:vi.fn(),connect:vi.fn(),heartbeat:vi.fn(),claim:vi.fn()}));
vi.mock("./interviewClient.js",()=>({acquireInterviewClient:qa.claim}));
vi.mock("./recruitmentService.js",()=>({recruitmentService:{
  begin:qa.begin, recoverBegin:qa.begin,recoveryState:qa.state,recoverPause:qa.interruption,observeRecovery:vi.fn().mockResolvedValue(),interruption:qa.interruption, heartbeat:qa.heartbeat,
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
  vi.clearAllMocks();qa.captures.length=0;qa.transports.length=0;qa.claim.mockResolvedValue({clientId:"stable-client",release:vi.fn()});
  qa.heartbeat.mockResolvedValue({status:"interviewing"});
  qa.state.mockResolvedValue({state:"RECOVERY_REQUIRED",recovery_id:null});
  qa.activation.mockReturnValue({context:{close:vi.fn().mockResolvedValue(),state:"running"},ready:Promise.resolve()});
  qa.recordStart.mockResolvedValue();qa.flush.mockResolvedValue(0);qa.connect.mockResolvedValue();
  qa.begin.mockResolvedValue({status:"starting",started_at:new Date().toISOString(),max_ends_at:new Date(Date.now()+600000).toISOString()});
  qa.interruption.mockResolvedValue({status:"interrupted"});
  vi.spyOn(document,"hidden","get").mockReturnValue(false);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});
function mount() {
  const devices={start:vi.fn().mockResolvedValue({getTracks:()=>["audio","video"].map(kind=>({kind,readyState:"live",muted:false,addEventListener:vi.fn(),removeEventListener:vi.fn(),stop:vi.fn()}))}),stop:vi.fn(),streamRef:{current:{}},previewRef:{current:null}};
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
it("repeated Resume replaces pending client work and stale results cannot take ownership",async()=>{
  let stale;
  qa.begin.mockImplementationOnce(()=>new Promise(resolve=>{stale=resolve;}));mount();
  const button=screen.getByRole("button",{name:"Resume with camera and microphone"});
  fireEvent.click(button);
  await waitFor(()=>expect(qa.begin).toHaveBeenCalledTimes(1));
  fireEvent.click(button);await screen.findByText(/AI connected/);
  expect(qa.begin).toHaveBeenCalledTimes(2);
  await act(async()=>stale({status:"finalizing"}));
  expect(screen.getByText(/AI connected/)).toBeTruthy();
  expect(qa.captures.filter(c=>c.recorder.state==="recording")).toHaveLength(1);
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

it("an old heartbeat cannot finalize or pause a newly recovered session",async()=>{
  vi.useFakeTimers();let resolveHeartbeat;
  qa.heartbeat.mockImplementationOnce(()=>new Promise(resolve=>{resolveHeartbeat=resolve;}));mount();
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));});
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(resolveHeartbeat).toBeTypeOf("function");
  vi.spyOn(document,"hidden","get").mockReturnValue(true);fireEvent(document,new Event("visibilitychange"));
  vi.spyOn(document,"hidden","get").mockReturnValue(false);fireEvent(document,new Event("visibilitychange"));
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));});
  await act(async()=>{resolveHeartbeat({status:"finalizing"});});
  expect(screen.getByText(/AI connected/)).toBeTruthy();expect(screen.queryByRole("heading",{name:"Saving your interview"})).toBeNull();
});
it("fresh but still-muted mobile tracks expose a bounded reacquire action instead of starting AI",async()=>{
  vi.useFakeTimers();const devices=mount();
  const tracks=["audio","video"].map(kind=>Object.assign(new EventTarget(),{kind,readyState:"live",muted:true,stop:vi.fn()}));
  devices.start.mockResolvedValueOnce({getTracks:()=>tracks});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));});
  await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});
  expect(screen.getByRole("alert").textContent).toMatch(/device readiness timed out/);
  expect(screen.getByRole("button",{name:"Resume with camera and microphone"}).disabled).toBe(false);
  expect(qa.connect).not.toHaveBeenCalled();
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));});
  expect(screen.getByText(/AI connected/)).toBeTruthy();
});

it("late loss from a previous recording cannot cancel a new recovery",async()=>{
  mount();fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));await screen.findByText(/AI connected/);
  const oldCapture=qa.captures.at(-1);
  vi.spyOn(document,"hidden","get").mockReturnValue(true);fireEvent(document,new Event("visibilitychange"));
  vi.spyOn(document,"hidden","get").mockReturnValue(false);fireEvent(document,new Event("visibilitychange"));
  let resolveBegin;
  qa.begin.mockImplementationOnce(()=>new Promise(resolve=>{resolveBegin=resolve;}));
  fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));
  await waitFor(()=>expect(resolveBegin).toBeTypeOf("function"));
  oldCapture.props.onLost("local_storage_failed");
  resolveBegin({status:"starting",started_at:new Date().toISOString(),max_ends_at:new Date(Date.now()+600000).toISOString()});
  await screen.findByText(/AI connected/);
});

it("requests native media before AudioContext activation or old cleanup",async()=>{
  const devices=mount();
  fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));
  expect(devices.start.mock.invocationCallOrder[0]).toBeLessThan(qa.activation.mock.invocationCallOrder[0]);
  expect(devices.stop).not.toHaveBeenCalled();
  await screen.findByText(/AI connected/);
});
it("hung camera acquisition has its own timeout and never starts a server resume",async()=>{
  vi.useFakeTimers();const devices=mount();devices.start.mockImplementationOnce(()=>new Promise(()=>{}));
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"})));
  await act(async()=>vi.advanceTimersByTimeAsync(15100));
  expect(screen.getByRole("alert").textContent).toMatch(/Camera and microphone timed out/);
  expect(screen.getByRole("alert").textContent).not.toMatch(/Allow access/);
  expect(qa.begin).not.toHaveBeenCalled();
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"})));
  expect(screen.getByText(/AI connected/)).toBeTruthy();
});

it("repeated Resume shares one pending tab identity without a competing own-tab lock",async()=>{
 let resolveClaim;qa.claim.mockImplementationOnce(()=>new Promise(resolve=>resolveClaim=resolve));const devices=mount();
 const button=screen.getByRole("button",{name:"Resume with camera and microphone"});fireEvent.click(button);fireEvent.click(button);
 await waitFor(()=>expect(resolveClaim).toBeTypeOf("function"));
 await act(async()=>resolveClaim({clientId:"stable-client",release:vi.fn()}));
 await screen.findByText(/AI connected/);expect(qa.claim).toHaveBeenCalledTimes(1);expect(devices.start).toHaveBeenCalledTimes(2);
 expect(qa.begin).toHaveBeenCalledTimes(1);
});
