import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interviewInstructions, firstInterviewResponse } from "../../../supabase/functions/recruitment-realtime/prompt.ts";
import { interviewerProfile } from "../../../supabase/functions/recruitment-realtime/voice.ts";
const qa = vi.hoisted(() => ({publicEntry:vi.fn(),consent:vi.fn(),confirmProfile:vi.fn(),ready:vi.fn(),start:vi.fn(),devices:{state:{status:"idle",level:0},previewRef:{current:null},streamRef:{current:null},start:vi.fn()}}));
vi.mock("./recruitmentService.js",()=>({recruitmentService:qa}));
vi.mock("./useInterviewDevices.js",()=>({useInterviewDevices:()=>qa.devices}));
vi.mock("./RecruitmentInterviewSession.jsx",()=>({default:({renderPreparation})=>renderPreparation({start:qa.start})}));
import RecruitmentInterviewPublic from "./RecruitmentInterviewPublic.jsx";
const entry={available:true,status:"invited",consented:false,profile:{full_name:"Synthetic tester",contact:"0000000055"},job:{title:"Service Crew Opening",position:"Service Crew",workplace:"Outlet",target_minutes:9},copy_version:"feedx-interview-v1-concise",consent_status:"approved",consent_copy:{title:"About this interview",body:["This interview is conducted using an automated interviewer and will be recorded for recruitment review."],consent:"I consent to the recording of my camera, microphone and interview responses for recruitment review."}};
beforeEach(()=>{
  vi.clearAllMocks(); window.history.replaceState({},"",`/i/${"a".repeat(64)}`);
  qa.devices.state={status:"idle",level:0};
  qa.publicEntry.mockResolvedValue(entry);
  qa.confirmProfile.mockResolvedValue({...entry,status:"profile_confirmed"});
  qa.consent.mockResolvedValue({...entry,status:"consented",consented:true});
  qa.ready.mockResolvedValue({...entry,status:"ready",consented:true});
});
afterEach(cleanup);
describe("Two-screen versioned candidate preparation",()=>{
  it("combines job/profile details, removes progress pills and persists allowed profile before Get ready",async()=>{
    render(<RecruitmentInterviewPublic/>);
    await screen.findByRole("heading",{name:"Interview details"});
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("About 9 minutes")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Candidate name"),{target:{value:"Updated tester"}});
    fireEvent.click(screen.getByRole("button",{name:"Continue"}));
    await screen.findByRole("heading",{name:"Get ready"});
    expect(qa.confirmProfile).toHaveBeenCalledWith("a".repeat(64),"Updated tester","0000000055");
    expect(screen.queryByRole("heading",{name:"Consent"})).toBeNull();
    expect(screen.getByRole("button",{name:"Start interview"}).disabled).toBe(true);
  });
  it.each(["consent-first","devices-first"])("gates Start on persisted consent, live devices and server readiness (%s)",async order=>{
    qa.publicEntry.mockResolvedValue({...entry,status:"profile_confirmed"});
    if(order==="devices-first") qa.devices.state={status:"ready",level:.2};
    const view=render(<RecruitmentInterviewPublic/>);
    await screen.findByRole("heading",{name:"Get ready"});
    expect(screen.getByRole("button",{name:"Start interview"}).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox",{name:entry.consent_copy.consent}));
    await screen.findByText("Consent recorded");
    expect(qa.consent).toHaveBeenCalledWith("a".repeat(64),entry.copy_version);
    if(order==="consent-first") { expect(qa.ready).not.toHaveBeenCalled(); qa.devices.state={status:"ready",level:.2}; view.rerender(<RecruitmentInterviewPublic/>); }
    await waitFor(()=>expect(screen.getByRole("button",{name:"Start interview"}).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button",{name:"Start interview"}));
    expect(qa.start).toHaveBeenCalledOnce();
    qa.devices.state={status:"lost",level:0};view.rerender(<RecruitmentInterviewPublic/>);
    expect(screen.getByRole("button",{name:"Start interview"}).disabled).toBe(true);
  });
  it("retains accepted historical copy without accepting or relabeling a new version",async()=>{
    qa.publicEntry.mockResolvedValue({...entry,status:"consented",consented:true,copy_version:"feedx-interview-v1-approved",consent_copy:{title:"Before you begin",body:["Historical approved disclosure"],consent:"Historical approved consent"}});
    render(<RecruitmentInterviewPublic/>);
    await screen.findByText("Historical approved disclosure");
    expect(screen.getByRole("checkbox").checked).toBe(true);
    expect(screen.getByRole("checkbox").disabled).toBe(true);
    expect(qa.consent).not.toHaveBeenCalled();
  });
  it("does not enable Start when the readiness authority rejects; offers a working retry",async()=>{
    qa.publicEntry.mockResolvedValue({...entry,status:"consented",consented:true});
    qa.devices.state={status:"ready",level:0};qa.ready.mockRejectedValueOnce(Error("Connection unavailable"));
    render(<RecruitmentInterviewPublic/>);
    await screen.findByText("Connection unavailable");
    expect(screen.getByRole("button",{name:"Start interview"}).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Retry readiness check"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Start interview"}).disabled).toBe(false));
  });
});
it("reconnect uses the same presentation while retaining durable coverage and server completion permission", () => {
  const context = {
    generation: 2,
    target_minutes: 9,
    language_guidance: "EN/BM/Chinese",
    interview_instructions: "Opening guidance",
    turns: [
      {
        turn_number: 1,
        speaker: "candidate",
        transcript: "I worked at a café.",
      },
    ],
    topics: [{ index: 0, topic: "Experience", state: "covered" }],
    scenarios: [{ index: 0, brief: "Complaint", state: "answered" }],
    required_topics: ["Experience"],
    scenario_briefs: ["Complaint"],
  };
  const prompt = interviewInstructions(context);
  expect(interviewerProfile.voice).toBe("marin");
  expect(prompt).toContain(interviewerProfile.instructions);
  expect(prompt).toContain("Experience [covered]");
  expect(prompt).toContain("Complaint [answered]");
  expect(prompt).toContain("Only conclude if the tool allows it");
  expect(prompt).not.toContain("Briefly acknowledge the interruption");
  expect(firstInterviewResponse(context)).toContain("For this first response only");
  expect(prompt).not.toContain("Begin with a short introduction");
});
