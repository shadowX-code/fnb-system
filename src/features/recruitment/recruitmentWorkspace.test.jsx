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
  summary: { open_roles: 1, interviewing: 1, needs_review: 1, shortlisted: 0 },
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
  qa.workspace.mockResolvedValue(structuredClone(data));
  qa.saveOpening.mockResolvedValue("opening1");
  qa.publishProfile.mockResolvedValue("profile2");
});
afterEach(cleanup);
const auth = { hasPermission: () => true };
async function enter() {
  render(<RecruitmentPage auth={auth} />);
  await screen.findByRole("heading", { name: "Active openings" });
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
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Candidate A/ }));
    expect(screen.getByRole("dialog").textContent).toBe("Review Candidate A");
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  });
  it("uses server-scoped filters and only opts into QA openings explicitly", async () => {
    render(<RecruitmentPage auth={auth} />);
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
    fireEvent.change(screen.getByRole("combobox", { name: "Opening status" }), {
      target: { value: "draft" },
    });
    expect(screen.queryByRole("button", { name: /^Open opening:/ })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Opening status" }), {
      target: { value: "open" },
    });
    expect(screen.getByRole("button", { name: /^Open opening:/ })).toBeTruthy();
    expect(qa.workspace).toHaveBeenCalledOnce();
  });
  it("saves a profile reference and opening requirements through the canonical RPC", async () => {
    await enter();
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));

    fireEvent.change(
      screen.getByLabelText("Closing shift requirement / time"),
      { target: { value: "Midnight" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save opening" }));
    await waitFor(() => expect(qa.saveOpening).toHaveBeenCalled());
    expect(qa.saveOpening.mock.calls[0][0].config).toMatchObject({
      interview_profile_id: "profile1",
      opening_requirements: { closing_shift: "Midnight" },
    });
  });
  it("hides management controls from view-only readers", async () => {
    render(<RecruitmentPage auth={{ hasPermission: () => false }} />);
    await screen.findByRole("heading", { name: "Active openings" });
    expect(screen.queryByRole("button", { name: "New opening" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Interview Profiles" }));
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(
      screen.queryByRole("button", { name: "Prepare next version" }),
    ).toBeNull();
  });
  it("publishes explicitly as a new version without opening mutation", async () => {
    render(<RecruitmentPage auth={auth} />);
    await screen.findByRole("heading", { name: "Active openings" });
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
