import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import RecruitmentPage from "./RecruitmentPage.jsx";
import { interviewInstructions } from "../../../supabase/functions/recruitment-realtime/prompt.ts";
import { continuationContext } from "../../../supabase/functions/recruitment-realtime/context.ts";
const qa = vi.hoisted(() => ({
  workspace: vi.fn(),
  saveOpening: vi.fn(),
  publishProfile: vi.fn(),
  issueInvitation: vi.fn(),
  registerApplication: vi.fn(),
  findApplicants: vi.fn(),
  revokeInvitation: vi.fn(),
}));
vi.mock("./recruitmentService.js", () => ({ recruitmentService: qa }));
vi.mock("./RecruitmentEvidenceReview.jsx", () => ({
  default: ({ application }) => (
    <div role="dialog">Review {application.name}</div>
  ),
}));
const definition = {
  role_context: "Service Crew role",
  evidence_areas: [
    {
      name: "Customer Handling",
      priority: "Core",
      intent: "Concrete customer example",
    },
    { name: "Teamwork", priority: "Important", intent: "Team evidence" },
  ],
  follow_up_guidance:
    "Accept transferable examples and do not repeat established facts.",
  scenarios: ["Customer complaint"],
  completion_criteria: {
    Core: "covered",
    Important: "partial",
    Optional: "unresolved",
    scenarios: "answered",
  },
  target_minutes: 10,
  max_minutes: 15,
};
const profile = {
  id: "profile1",
  name: "Service Crew",
  version: 1,
  definition,
};
const opening = {
  id: "opening1",
  title: "Service Crew",
  position_id: "position1",
  workplace: "Management",
  legal_entity_id: "entity1",
  status: "open",
  config: {
    interview_profile_id: "profile1",
    opening_requirements: { closing_shift: "11pm" },
    required_topics: ["Customer Handling", "Teamwork"],
    scenario_briefs: ["Customer complaint"],
    target_minutes: 10,
    max_minutes: 15,
  },
  pipeline: {
    total: 3,
    invited: 1,
    interviewing: 1,
    needs_review: 1,
    shortlisted: 0,
    rejected: 0,
  },
};
const data = {
  profiles: [profile],
  openings: [opening],
  summary: {
    open_roles: 1,
    active_candidates: 3,
    interviewing: 1,
    needs_review: 1,
    shortlisted: 0,
  },
  positions: [{ id: "position1", name: "Crew" }],
  outlets: [],
  legal_entities: [{ id: "entity1", name: "FeedX" }],
  applications: [
    {
      id: "app1",
      name: "Candidate A",
      contact: "QA",
      stage: "needs_review",
      decision_state: "review",
    },
  ],
  applications_total: 1,
  page: 1,
  page_size: 20,
  activity: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  qa.workspace.mockImplementation(async (query) => ({
    ...structuredClone(data),
    applications_total: query.stage === "hired" ? 0 : data.applications_total,
  }));
  qa.saveOpening.mockResolvedValue("opening1");
  qa.publishProfile.mockResolvedValue("profile2");
});
afterEach(cleanup);
const auth = { hasPermission: () => true };
async function enter() {
  render(<RecruitmentPage auth={auth} />);
  await screen.findByRole("heading", { name: "Open jobs" });
  await screen.findByRole("button", { name: /^Open opening: Service Crew/ });
  fireEvent.click(
    screen.getByRole("button", { name: /^Open opening: Service Crew/ }),
  );
  await screen.findByRole("tab", { name: "Overview" });
}
describe("opening-centred Recruitment workspace", () => {
  it("has one opening workflow, no duplicate Interviews tab or acceptance banner", async () => {
    await enter();
    expect(screen.queryByRole("tab", { name: "Interviews" })).toBeNull();
    expect(screen.queryByText(/Real-device acceptance/)).toBeNull();
    expect(screen.getByRole("tab", { name: "Candidates" })).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /^Interviews ready for review/ }),
    );
    await waitFor(() =>
      expect(qa.workspace).toHaveBeenLastCalledWith({
        openingId: "opening1",
        stage: "needs_review",
        page: 1,
        includeQa: false,
        search: "",
        offering: "all",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Candidate A/ }));
    expect(screen.getByRole("dialog").textContent).toBe("Review Candidate A");
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  });
  it("uses server-scoped filters and only opts into QA openings explicitly", async () => {
    render(<RecruitmentPage auth={auth} />);
    await screen.findByRole("heading", { name: "Open jobs" });
    fireEvent.click(screen.getByRole("button", { name: "More filters" }));
    await screen.findByRole("checkbox", { name: "Include QA openings" });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include QA openings" }),
    );
    await waitFor(() =>
      expect(qa.workspace).toHaveBeenLastCalledWith({
        openingId: null,
        stage: "all",
        page: 1,
        includeQa: true,
        search: "",
        offering: "all",
      }),
    );
  });
  it("combines search and status filters without changing scoped backend reads", async () => {
    render(<RecruitmentPage auth={auth} />);
    await screen.findByRole("button", { name: /^Open opening:/ });
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search openings" }),
      { target: { value: "missing" } },
    );
    expect(screen.queryByRole("button", { name: /^Open opening:/ })).toBeNull();
    expect(screen.getByText(/No openings match/)).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Service" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Opening status" }));
    fireEvent.click(screen.getByRole("option", { name: "Draft", exact: true }));
    expect(screen.queryByRole("button", { name: /^Open opening:/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Opening status" }));
    fireEvent.click(screen.getByRole("option", { name: "Open", exact: true }));
    expect(screen.getByRole("button", { name: /^Open opening:/ })).toBeTruthy();
    expect(
      qa.workspace.mock.calls.filter(([query]) => query.stage !== "hired"),
    ).toHaveLength(1);
  });
  it("saves a profile reference and opening requirements through the canonical RPC", async () => {
    await enter();
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit setup" }));

    fireEvent.change(
      screen.getByLabelText("Closing shift requirement / time"),
      { target: { value: "Midnight" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(qa.saveOpening).toHaveBeenCalled());
    expect(qa.saveOpening.mock.calls[0][0].config).toMatchObject({
      interview_profile_id: "profile1",
      opening_requirements: { closing_shift: "Midnight" },
    });
  });
  it("hides management controls from view-only readers", async () => {
    render(<RecruitmentPage auth={{ hasPermission: () => false }} />);
    await screen.findByRole("heading", { name: "Open jobs" });
    expect(
      screen.queryByRole("button", { name: "Create job opening" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Interview Profiles" }));
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(
      screen.queryByRole("button", { name: "Prepare next version" }),
    ).toBeNull();
  });
  it("publishes explicitly as a new version without opening mutation", async () => {
    render(<RecruitmentPage auth={auth} />);
    await screen.findByRole("heading", { name: "Open jobs" });
    fireEvent.click(screen.getByRole("button", { name: "Interview Profiles" }));
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare next version" }),
    );
    fireEvent.change(screen.getByLabelText("Role context"), {
      target: { value: "Revised role context" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Publish Service Crew v2" }),
    );
    await waitFor(() =>
      expect(qa.publishProfile).toHaveBeenCalledWith(
        expect.objectContaining({ role_context: "Revised role context" }),
        1,
      ),
    );
    expect(qa.saveOpening).not.toHaveBeenCalled();
  });
});
it("hydrates pinned priorities, partial evidence, facts and requirements as context only", () => {
  const context = continuationContext(
    {
      interview_profile: profile,
      opening_requirements: { closing_shift: "11pm" },
      max_ends_at: new Date(Date.now() + 60000).toISOString(),
      turns: [
        {
          id: 2,
          provider_generation: 1,
          provider_item_id: "answer",
          speaker: "candidate",
          transcript: "I can close at 11pm",
          turn_number: 2,
        },
      ],
      topics: [
        {
          topic_index: 0,
          topic: "Customer Handling",
          state: "partial",
          evidence_turn_id: 2,
        },
      ],
      scenarios: [
        { scenario_index: 0, brief: "Customer complaint", state: "pending" },
      ],
    },
    { provider_generation: 2 },
    opening.config,
    { opening_title_snapshot: "Crew" },
    [],
  );
  const text = interviewInstructions(context);
  expect(text).toContain('"priority":"Core"');
  expect(text).toContain("[partial]");
  expect(text).toContain("11pm");
  expect(text).toContain("never replay as speech");
  expect(text).toContain("Prioritize unresolved Core");
  expect(context.established_facts[0].turn_number).toBe(2);
});
it("labels recording failure separately from candidate stage and interview evidence", async () => {
  const fixture = structuredClone(data);
  fixture.applications[0].attempt_status = "failed";
  fixture.applications[0].recording_state = "failed";
  qa.workspace.mockResolvedValue(fixture);
  // Evidence read failure must not block candidate review.
  qa.managerEvidence = vi.fn().mockRejectedValue(new Error("not available"));
  await enter();
  fireEvent.click(screen.getByRole("tab", { name: "Candidates" }));
  expect(screen.getByText("Incomplete")).toBeTruthy();
  expect(screen.getByText("Recording failed")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Review", exact: true }),
  ).toBeTruthy();
});
describe("application invitation journey", () => {
  it("registration offers optional immediate issuance rather than auto-inviting", async () => {
    qa.registerApplication.mockResolvedValue("new-application");
    await enter();
    fireEvent.click(screen.getByRole("button", { name: "Add candidate" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Full name/ }), {
      target: { value: "Synthetic Candidate" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Contact number/ }), {
      target: { value: "0000000337" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Register", exact: true }),
    );
    await screen.findByRole("dialog", { name: "Candidate added" });
    expect(qa.issueInvitation).not.toHaveBeenCalled();
    qa.issueInvitation.mockResolvedValue("c".repeat(64));
    fireEvent.click(
      screen.getByRole("button", { name: "Issue interview link", exact: true }),
    );
    await screen.findByRole("dialog", { name: "Interview link issued" });
    expect(qa.issueInvitation.mock.calls[0][0]).toBe("new-application");
    expect(
      screen
        .getByRole("link", { name: "Open interview link" })
        .getAttribute("href"),
    ).toContain(`/i/${"c".repeat(64)}`);
  });
  it("active unretrievable hash-only invitation explains reissue rather than fabricating a link", async () => {
    qa.workspace.mockResolvedValue({
      ...structuredClone(data),
      applications: [
        {
          id: "app1",
          name: "Candidate A",
          contact: "QA",
          stage: "invited",
          issued_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
      ],
    });
    await enter();
    fireEvent.click(
      screen.getByRole("tab", { name: "Candidates", exact: true }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy link", exact: true }),
    );
    await screen.findByRole("dialog", { name: "Invitation active" });
    expect(screen.getByText(/original link is not stored/)).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Open interview link" }),
    ).toBeNull();
    expect(qa.issueInvitation).not.toHaveBeenCalled();
  });
  it.each([
    ["Candidates", "all"],
    ["Invited", "invited"],
    ["Interviewing", "interviewing"],
    ["Needs review", "needs_review"],
    ["Shortlisted", "shortlisted"],
  ])("%s funnel deep-links to the existing stage", async (label, stage) => {
    await enter();
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(`^${label}:.*View candidates$`),
      }),
    );
    await waitFor(() =>
      expect(qa.workspace).toHaveBeenLastCalledWith({
        openingId: "opening1",
        stage,
        page: 1,
        includeQa: false,
        search: "",
        offering: "all",
      }),
    );
  });
});
it("an invitation expiring after render cannot turn a Copy tap into automatic reissue", async () => {
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  qa.workspace.mockResolvedValue({
    ...structuredClone(data),
    applications: [
      {
        id: "app1",
        name: "Candidate A",
        contact: "QA",
        stage: "invited",
        issued_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
    ],
  });
  await enter();
  fireEvent.click(screen.getByRole("tab", { name: "Candidates", exact: true }));
  const copy = screen.getByRole("button", { name: "Copy link", exact: true });
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValue(Date.parse(expiresAt) + 1);
  try {
    fireEvent.click(copy);
    await screen.findByRole("dialog", { name: "Invitation expired" });
    expect(qa.issueInvitation).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});
it("opens Setup read-only, edits explicitly and cancels without saving", async () => {
  await enter();
  fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  expect(screen.getByLabelText(/Job-facing title/).disabled).toBe(false); // native disabled ancestor is authoritative
  expect(
    screen.getByLabelText(/Job-facing title/).closest("fieldset[disabled]"),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit setup" }));
  fireEvent.change(screen.getByLabelText(/Job-facing title/), {
    target: { value: "Unsaved name" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText(/Job-facing title/).value).toBe("Service Crew");
  expect(qa.saveOpening).not.toHaveBeenCalled();
});
it("uses server search and offering filters before pagination, with quiet normal recording health", async () => {
  const fixture = structuredClone(data);
  fixture.applications[0].recording_state = "complete";
  fixture.applications[0].employment_preference = "both";
  qa.workspace.mockResolvedValue(fixture);
  await enter();
  fireEvent.click(screen.getByRole("tab", { name: "Candidates" }));
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.queryByText("Recording complete")).toBeNull();
  expect(screen.getByRole("cell", { name: "Both" })).toBeTruthy();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search candidates" }),
    { target: { value: "Candidate" } },
  );
  await waitFor(() =>
    expect(qa.workspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "Candidate", page: 1 }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Offering filter" }));
  fireEvent.click(screen.getByRole("option", { name: "Both", exact: true }));
  await waitFor(() =>
    expect(qa.workspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ offering: "both", page: 1 }),
    ),
  );
});

it("creates a job in a workspace with explicit draft/open actions through the existing authority", async () => {
  render(<RecruitmentPage auth={auth} />);
  await screen.findByRole("heading", { name: "Open jobs" });
  fireEvent.click(screen.getByRole("button", { name: "Create job opening" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole("heading", { name: "Create job opening" }),
  ).toBeTruthy();
  expect(screen.getByText("Job / Workplace Information")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open job" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/Job-facing title/), {
    target: { value: "Test Crew" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() =>
    expect(qa.saveOpening).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Test Crew", status: "draft" }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Create job opening" }));
  fireEvent.change(screen.getByLabelText(/Job-facing title/), {
    target: { value: "Open Crew" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open job" }));
  await waitFor(() =>
    expect(qa.saveOpening).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Open Crew", status: "open" }),
    ),
  );
});
it("uses four shared summary cards and puts canonical filters outside operational tables", async () => {
  render(<RecruitmentPage auth={auth} />);
  await screen.findByRole("heading", { name: "Open jobs" });
  const summary = screen.getByLabelText("Recruitment summary");
  expect(summary.querySelectorAll("[data-admin-summary-card]")).toHaveLength(4);
  expect(
    screen
      .getByRole("region", { name: "Job filters" })
      .closest(".recruitment-section"),
  ).toBeNull();
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reconnect AI" })).toBeNull();
});
