import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interviewInstructions } from "../../../supabase/functions/recruitment-realtime/prompt.ts";
import { interviewerProfile } from "../../../supabase/functions/recruitment-realtime/voice.ts";
const service = vi.hoisted(() => ({ publicEntry: vi.fn(), consent: vi.fn() }));
vi.mock("./recruitmentService.js", () => ({ recruitmentService: service }));
vi.mock("./useInterviewDevices.js", () => ({
  useInterviewDevices: () => ({
    state: { cameras: [], microphones: [], status: "idle", level: 0 },
    previewRef: { current: null },
  }),
}));
vi.mock("./RecruitmentInterviewSession.jsx", () => ({ default: () => null }));
import RecruitmentInterviewPublic from "./RecruitmentInterviewPublic.jsx";
const consent =
  "I understand and consent to the AI interview and recording of my camera and microphone for recruitment review.";
const body = [
  "This interview will be conducted by an AI interviewer and recorded using your camera and microphone.",
  "Your responses, interview transcript and recording will be used by the hiring team to review your application.",
  "Please complete the interview in a private and comfortable environment. You may leave the interview at any time before submitting it.",
];
const entry = {
  available: true,
  status: "profile_confirmed",
  profile: { full_name: "Synthetic tester", contact: "0000000055" },
  job: {},
  copy_version: "feedx-interview-v1-approved",
  consent_status: "approved",
  consent_copy: { title: "Before you begin", body, consent },
};
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", `/i/${"a".repeat(64)}`);
  service.publicEntry.mockResolvedValue(entry);
  service.consent.mockResolvedValue({ ...entry, status: "consented" });
});
afterEach(cleanup);
describe("Approved versioned candidate consent", () => {
  it("shows approved paragraphs and requires explicit combined consent before submitting its displayed version", async () => {
    render(<RecruitmentInterviewPublic />);
    await screen.findByRole("heading", { name: "Before you begin" });
    body.forEach((p) => expect(screen.getByText(p)).toBeTruthy());
    const submit = screen.getByRole("button", { name: "I agree and continue" });
    expect(submit.disabled).toBe(true);
    expect(screen.queryByText(/Synthetic testing only/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: consent }));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(service.consent).toHaveBeenCalledWith(
        "a".repeat(64),
        entry.copy_version,
      ),
    );
    await screen.findByRole("heading", { name: "Camera and microphone" });
  });
  it("keeps historical provisional copy distinct rather than presenting it as approved", async () => {
    service.publicEntry.mockResolvedValue({
      ...entry,
      copy_version: "phase1-provisional-v1",
      consent_status: "provisional",
      consent_copy: {
        ai: "Old AI purpose",
        recording: "Old recording purpose",
        review: "Old review purpose",
        notice: "Historical provisional copy",
      },
    });
    render(<RecruitmentInterviewPublic />);
    await screen.findByRole("heading", { name: "Before you continue" });
    expect(screen.getAllByRole("checkbox").length).toBe(3);
    expect(screen.getByText(/Synthetic testing only/)).toBeTruthy();
  });
});
it("reconnect uses the same presentation while retaining durable coverage and server completion permission", () => {
  const prompt = interviewInstructions({
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
  });
  expect(interviewerProfile.voice).toBe("marin");
  expect(prompt).toContain(interviewerProfile.instructions);
  expect(prompt).toContain("Experience [covered]");
  expect(prompt).toContain("Complaint [answered]");
  expect(prompt).toContain("Only conclude if the tool allows it");
  expect(prompt).toContain("This is a reconnect");
  expect(prompt).not.toContain("Begin with a short introduction");
});
