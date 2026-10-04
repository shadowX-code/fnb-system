import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const qa=vi.hoisted(()=>({begin:vi.fn(),interruption:vi.fn(),captures:[],transports:[]}));
vi.mock("./interviewClient.js",()=>({acquireInterviewClient:async()=>({clientId:"stable-client",release:vi.fn()})}));
vi.mock("./recruitmentService.js",()=>({recruitmentService:{
  begin:qa.begin, interruption:qa.interruption, heartbeat:vi.fn(),
}}));
vi.mock("./InterviewRecording.js",()=>({InterviewRecording:class {
  constructor(props) { this.props=props; this.attemptKey="partition"; this.recorder={state:"inactive"}; qa.captures.push(this); }
  async recover() { this.uploadRecovery=new Promise(()=>{}); }
  async start() { this.recorder.state="recording"; this.props.onStatus("recording"); }
  stop() { this.recorder.state="inactive"; this.captureStopped=Promise.resolve(); this.stopPromise=new Promise(()=>{}); return this.stopPromise; }
}}));
vi.mock("./RecruitmentRealtimeSession.js",()=>({RecruitmentRealtimeSession:class {
  constructor(props) { this.props=props; qa.transports.push(this); }
  async flush() {return 0;}
  async connect() {this.props.onStatus?.("connected");}
  close() {this.closed=true;}
}}));
import RecruitmentInterviewSession from "./RecruitmentInterviewSession.jsx";
beforeEach(()=>{
  vi.clearAllMocks();qa.captures.length=0;qa.transports.length=0;
  qa.begin.mockResolvedValue({status:"starting",started_at:new Date().toISOString(),max_ends_at:new Date(Date.now()+600000).toISOString()});
  qa.interruption.mockResolvedValue({status:"interrupted"});
  vi.spyOn(document,"hidden","get").mockReturnValue(false);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function mount() {
  const devices={start:vi.fn().mockResolvedValue({}),stop:vi.fn(),streamRef:{current:{}},previewRef:{current:null}};
  render(<RecruitmentInterviewSession token={"a".repeat(64)} entry={{status:"interviewing"}} devices={devices}/>);
  return devices;
}
it("refresh presents explicit resume and reconnects without waiting for old evidence upload",async()=>{
  const devices=mount();
  expect(screen.queryByRole("button",{name:"Start interview"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Resume with camera and microphone"}));
  await screen.findByText(/AI connected/);
  expect(qa.begin).toHaveBeenCalledWith("a".repeat(64),"stable-client");
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
  expect(qa.interruption).toHaveBeenCalledWith("a".repeat(64),"stable-client","page_backgrounded");
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
