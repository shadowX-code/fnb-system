// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import {
  initialPresence,
  observeInterviewPresence,
} from "./interviewPresentation.js";
import {
  invitationAction,
  currentInvitation,
} from "./invitationPresentation.js";
const mocks = vi.hoisted(() => ({
  entry: {},
  devices: {
    state: { status: "idle", level: 0 },
    previewRef: { current: null },
    streamRef: { current: null },
    start: vi.fn(),
    stop: vi.fn(),
  },
  publicEntry: vi.fn(),
  language: vi.fn(),
  confirmProfile: vi.fn(),
  consent: vi.fn(),
  ready: vi.fn(),
}));
vi.mock("./recruitmentService.js", () => ({ recruitmentService: mocks }));
vi.mock("./useInterviewDevices.js", () => ({
  useInterviewDevices: () => mocks.devices,
}));
vi.mock("./RecruitmentInterviewSession.jsx", () => ({
  default: ({ renderPreparation }) => renderPreparation({ start: vi.fn() }),
}));
import Public from "./RecruitmentInterviewPublic.jsx";
import Room, { InterviewComplete } from "./RecruitmentInterviewRoom.jsx";
const base = {
  available: true,
  status: "invited",
  preferred_language: "en",
  profile: { full_name: "Candidate", contact: "0000000011" },
  job: {
    title: "Service Crew",
    position: "Service Crew",
    workplace: "Ipoh",
    target_minutes: 10,
  },
  consent_status: "approved",
  copy_version: "pinned-copy",
  consent_copy: {
    title: "About this interview",
    body: ["Automated interviewer and recording."],
    consent: "I consent to recruitment recording.",
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.entry = structuredClone(base);
  mocks.publicEntry.mockImplementation(async () => mocks.entry);
  mocks.language.mockImplementation(async (_, language) => ({
    ...mocks.entry,
    preferred_language: (mocks.entry.preferred_language = language),
  }));
  mocks.confirmProfile.mockImplementation(async () => ({
    ...mocks.entry,
    status: "profile_confirmed",
  }));
  mocks.devices.state = { status: "idle", level: 0 };
});
afterEach(cleanup);
describe("candidate preparation gates", () => {
  it("shows compact identity, all languages, no editable form until Edit", async () => {
    render(<Public />);
    await screen.findByText("Interview details");
    expect(screen.getByText("Candidate")).toBeTruthy();
    for (const label of ["English", "Bahasa Melayu", "中文", "粤语"])
      expect(within(screen.getByRole("group", {name:"Preferred interview language"})).getByRole("button", { name: label })).toBeTruthy();
    expect(screen.queryByLabelText("Candidate name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
    expect(screen.getByLabelText("Candidate name")).toBeTruthy();
  });
  it("persists chosen language before profile confirmation and advances", async () => {
    render(<Public />);
    await screen.findByText("Interview details");
    fireEvent.click(screen.getByRole("button", { name: "粤语" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Continue", exact: true }),
    );
    await screen.findByText("Get ready");
    expect(mocks.language).toHaveBeenCalledWith("", "yue");
    expect(mocks.confirmProfile).toHaveBeenCalledOnce();
  });
  it("uses persisted preference after refresh; confirmed identity is not editable", async () => {
    mocks.entry = {
      ...base,
      status: "profile_confirmed",
      preferred_language: "yue",
    };
    render(<Public />);
    await screen.findByText("Get ready");
    expect(screen.getByText("粤语")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(
      screen.queryByRole("button", { name: "Edit", exact: true }),
    ).toBeNull();
  });
  it("does not enable Start from consent alone", async () => {
    mocks.entry = { ...base, status: "ready", consented: true };
    render(<Public />);
    expect(
      (await screen.findByRole("button", { name: /Start interview/ })).disabled,
    ).toBe(true);
  });
  it("does not enable Start from camera/mic alone", async () => {
    mocks.entry = { ...base, status: "profile_confirmed" };
    mocks.devices.state = { status: "ready", level: 0.4 };
    render(<Public />);
    expect(
      (await screen.findByRole("button", { name: /Start interview/ })).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: /Enable camera/ })).toBeNull();
  });
  it("keeps existing consent version/purposes RPC and canonical ready gate", async () => {
    mocks.entry = { ...base, status: "profile_confirmed" };
    mocks.devices.state = { status: "ready", level: 0.4 };
    mocks.consent.mockResolvedValue({
      ...base,
      status: "consented",
      consented: true,
    });
    mocks.ready.mockResolvedValue({
      ...base,
      status: "ready",
      consented: true,
    });
    render(<Public />);
    fireEvent.click(await screen.findByRole("checkbox"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Start interview/ }).disabled,
      ).toBe(false),
    );
    expect(mocks.consent).toHaveBeenCalledWith("", "pinned-copy");
    expect(mocks.ready).toHaveBeenCalledOnce();
  });
});
describe("runtime-only interviewer presence", () => {
  it("uses VAD/response/audio buffer events, not transcription receipt timing", () => {
    let p = initialPresence;
    for (const [type, state] of [
      ["input_audio_buffer.speech_started", "listening"],
      ["input_audio_buffer.committed", "thinking"],
      ["response.created", "thinking"],
      ["output_audio_buffer.started", "speaking"],
      ["output_audio_buffer.stopped", "listening"],
    ]) {
      p = observeInterviewPresence(p, { type });
      expect(p.state).toBe(state);
    }
    expect(
      observeInterviewPresence(p, {
        type: "conversation.item.input_audio_transcription.completed",
      }),
    ).toBe(p);
  });
  it("only shows actual latest provider prompt and resets across units", () => {
    let p = observeInterviewPresence(initialPresence, {
      type: "response.output_audio_transcript.delta",
      item_id: "a",
      delta: "Hello",
    });
    p = observeInterviewPresence(p, {
      type: "response.output_audio_transcript.delta",
      item_id: "b",
      delta: "您好",
    });
    expect(p.prompt).toBe("您好");
  });
  it("room exposes no coverage/provider/control inventions", () => {
    render(
      <Room
        entry={base}
        presence={{ ...initialPresence, state: "speaking", prompt: "你好" }}
        status="interviewing"
        recordingStatus="recording"
        elapsed={61}
      />,
    );
    expect(screen.getByText("Speaking")).toBeTruthy();
    expect(screen.getByText("你好")).toBeTruthy();
    expect(
      screen.queryByText(/Reconnect AI|coverage|Settings|Mute/),
    ).toBeNull();
  });
  it("completion uses canonical time and makes no notification/report promises", () => {
    render(
      <InterviewComplete entry={base} completedAt="2026-10-05T10:00:00Z" />,
    );
    expect(screen.getByText("Interview complete")).toBeTruthy();
    expect(
      screen.queryByText(/notified|report generation|coverage/i),
    ).toBeNull();
  });
});
describe("application-bound invitation actions", () => {
  it("uses lifecycle primary action and only permits manager issuance", () => {
    expect(invitationAction({ stage: "registered" }, true, "open")).toBe(
      "issue",
    );
    for (const stage of [
      "interviewing",
      "needs_review",
      "hired",
      "rejected",
      "shortlisted",
    ])
      expect(invitationAction({ stage }, true, "open")).toBe("review");
    expect(invitationAction({ stage: "registered" }, false, "open")).toBe(
      "review",
    );
  });
  it("cannot return revoked, expired or replaced in-memory URLs", () => {
    const expiresAt = new Date(Date.now() + 86400000).toISOString(),
      row = {
        id: "application-a",
        issued_at: "now",
        expires_at: expiresAt,
        stage: "invited",
      },
      links = { "application-a": { url: "private", expiresAt } };
    expect(invitationAction(row, true, "open")).toBe("copy");
    expect(currentInvitation(row, links)?.url).toBe("private");
    expect(currentInvitation({ ...row, revoked_at: "now" }, links)).toBeNull();
    expect(
      currentInvitation(
        { ...row, expires_at: new Date(Date.now() + 1).toISOString() },
        links,
      ),
    ).toBeNull();
  });
});

describe("canonical language context", () => {
  it("every language preference reaches entry instructions, including Cantonese distinct from Mandarin", async () => {
    const { firstInterviewResponse } = await import(
      "../../../supabase/functions/recruitment-realtime/prompt.ts"
    );
    for (const [preferred_language, expected] of [
      ["en", "English"],
      ["ms", "Bahasa Melayu"],
      ["zh", "Mandarin Chinese"],
      ["yue", "Cantonese (粤语, not Mandarin)"],
    ]) {
      const prompt = firstInterviewResponse({
        generation: 1,
        preferred_language,
        turns: [],
        topics: [],
        scenarios: [],
        target_minutes: 10,
        required_topics: [],
        scenario_briefs: [],
        language_guidance: "",
        interview_instructions: "",
      });
      expect(prompt).toContain(`Greeting / ambiguity fallback language only: ${expected}`);
      expect(prompt).toContain("never a restriction or evaluation signal");
    }
  });
  it("quiet canonical context preserves preference without replaying history", async () => {
    const { continuationContext } = await import(
      "../../../supabase/functions/recruitment-realtime/context.ts"
    );
    const result = continuationContext(
      {
        max_ends_at: new Date(Date.now() + 100000).toISOString(),
        turns: [],
        topics: [],
        scenarios: [],
      },
      { provider_generation: 2, preferred_language: "yue" },
      { target_minutes: 10, required_topics: [], scenario_briefs: [] },
      {},
      [],
    );
    expect(result.preferred_language).toBe("yue");
    expect(result.turns).toEqual([]);
  });
});

it("shared checkbox styling belongs to the input, leaving the consent label touchable", async () => {
  mocks.entry = { ...base, status: "profile_confirmed" };
  render(<Public />);
  const checkbox = await screen.findByRole("checkbox");
  expect(checkbox.className).toContain("candidate-checkbox");
  expect(checkbox.closest("label").className).not.toContain("candidate-checkbox");
});

it("interface translation never changes spoken preference and persists canonical bilingual consent", async () => {
  mocks.entry.consent_copy = {body:[],consent:"I understand the automated interviewer and consent to recruitment recording.",translations:{zh:{body:[],consent:"我了解自动面试官，并同意录制摄像头、麦克风及回答，供招聘审核。"}}};
  render(<Public />);
  await screen.findByText("Interview details");
  fireEvent.click(within(screen.getByRole("group",{name:"Interface language / 界面语言"})).getByRole("button",{name:"中文"}));
  expect(screen.getByRole("heading",{name:"面试详情"})).toBeTruthy();
  expect(mocks.language).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"继续",exact:true}));
  await screen.findByText("准备面试");
  expect(mocks.language).toHaveBeenCalledWith("","en");
  expect(screen.getByRole("button",{name:"开启摄像头和麦克风"})).toBeTruthy();
  expect(screen.getByRole("checkbox").closest("label").textContent).toContain("摄像头、麦克风及回答");
  expect(screen.queryByText("I understand the automated interviewer and consent to recruitment recording.")).toBeNull();
  mocks.consent.mockResolvedValue({...mocks.entry,status:"consented",consented:true});
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(()=>expect(mocks.consent).toHaveBeenCalledWith("","pinned-copy"));
  expect(localStorage.getItem("feedx-interview-interface")).toBe("zh");
});
it("submission replaces live speech and camera presentation while preserving retry state", () => {
  render(<Room entry={base} presence={{...initialPresence,prompt:"Old goodbye",state:"speaking"}} status="finalizing" recordingStatus="pending" elapsed={386} />);
  expect(screen.getByText("Submitting your responses")).toBeTruthy();
  expect(screen.queryByText("Old goodbye")).toBeNull();
  expect(screen.queryByLabelText("Your interview camera")).toBeNull();
});


it("Mandarin survives confirmation and refresh independently from English page language", async () => {
  const view = render(<Public />);
  await screen.findByText("Interview details");
  fireEvent.click(within(screen.getByRole("group", {name: "Preferred interview language"})).getByRole("button", {name:"中文"}));
  fireEvent.click(screen.getByRole("button", {name:"Continue",exact:true}));
  await screen.findByText("Get ready");
  expect(screen.getByText("Spoken interview language").parentElement.textContent).toContain("中文");
  expect(screen.getByText("Page language")).toBeTruthy();
  expect(mocks.language).toHaveBeenCalledWith("", "zh");
  mocks.entry.status = "profile_confirmed";
  view.unmount();
  render(<Public />);
  await screen.findByText("Get ready");
  expect(screen.getByText("Spoken interview language").parentElement.textContent).toContain("中文");
});
it("Chinese page preference survives refresh without changing spoken English, and saved consent has no redundant confirmation", async () => {
  localStorage.setItem("feedx-interview-interface", "zh");
  mocks.entry = {...base,status:"ready",consented:true};
  render(<Public />);
  await screen.findByText("准备面试");
  expect(screen.getByText("面试对话语言").parentElement.textContent).toContain("English");
  expect(screen.queryByText("已记录同意")).toBeNull();
  expect(screen.getByRole("checkbox").checked).toBe(true);
  expect(mocks.language).not.toHaveBeenCalled();
});
